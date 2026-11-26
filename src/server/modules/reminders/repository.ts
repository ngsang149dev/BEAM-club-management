import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  appSettings, boards, columns, departments, memberDepartments,
  profiles, reminders, taskAssignees, taskDepartments, tasks,
} from '@db/schema';
import { REMINDERS_APP_SETTING_KEY } from '@/lib/reminders';
import type { TaskPriority } from '@/lib/tasks';
import {
  buildUserSummariesMap,
  notDoneColumnSqlCondition,
  type TaskMemberSummaryRecord,
} from '@/server/modules/tasks';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { parseStoredReminderSettings } from './policy';
import type {
  RecordReminderSentInput, ReminderCandidateTaskRecord, ReminderLocale,
  ReminderRecipientRecord, ReminderSentKeyRecord, ReminderSettingsRecord,
  RemindersRepository, UpsertReminderSettingsParams, UpsertReminderSettingsResult,
} from './types';

interface RawCandidateTaskRow {
  readonly id: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly columnId: string | null;
  readonly columnName: string | null;
  readonly title: string;
  readonly dueAt: Date | null;
  readonly priority: number;
  readonly isHidden: boolean;
  readonly createdBy: string;
}

interface RawRecipientProfileRow {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: string;
  readonly isActive: boolean;
  readonly isAdmin: boolean;
}

interface RawDirectAssigneeRow extends RawRecipientProfileRow {
  readonly taskId: string;
}

interface RawDeptMemberRow extends RawRecipientProfileRow {
  readonly departmentId: string;
}

const RECIPIENT_PROFILE_COLS = {
  userId: profiles.id,
  email: profiles.email,
  fullName: profiles.fullName,
  locale: profiles.locale,
  isActive: profiles.isActive,
  isAdmin: profiles.isAdmin,
};

const toPriority = (raw: number): TaskPriority =>
  raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 2;
const toLocale = (raw: string): ReminderLocale => (raw === 'en' ? 'en' : 'vi');

function buildUserDeptIdsMap(rows: readonly RawDeptMemberRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.userId);
    if (existing) {
      if (!existing.includes(row.departmentId)) existing.push(row.departmentId);
      continue;
    }
    map.set(row.userId, [row.departmentId]);
  }
  return map;
}

function buildMembersByDeptMap(rows: readonly RawDeptMemberRow[]): Map<string, RawDeptMemberRow[]> {
  const map = new Map<string, RawDeptMemberRow[]>();
  for (const row of rows) {
    const existing = map.get(row.departmentId);
    if (existing) existing.push(row);
    else map.set(row.departmentId, [row]);
  }
  return map;
}

function toRecipientRecord(
  row: RawRecipientProfileRow,
  userDeptMap: ReadonlyMap<string, string[]>,
): ReminderRecipientRecord {
  return {
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    locale: toLocale(row.locale),
    isActive: row.isActive,
    isAdmin: row.isAdmin,
    departmentIds: userDeptMap.get(row.userId) ?? [],
  };
}

function collectTaskRecipients(params: {
  readonly directRows: readonly RawDirectAssigneeRow[];
  readonly deptIds: readonly string[];
  readonly membersByDept: ReadonlyMap<string, RawDeptMemberRow[]>;
  readonly userDeptMap: ReadonlyMap<string, string[]>;
}): { readonly assigneeIds: string[]; readonly recipients: ReminderRecipientRecord[] } {
  const recipientById = new Map<string, ReminderRecipientRecord>();
  const assigneeIds: string[] = [];
  for (const direct of params.directRows) {
    assigneeIds.push(direct.userId);
    if (!recipientById.has(direct.userId)) {
      recipientById.set(direct.userId, toRecipientRecord(direct, params.userDeptMap));
    }
  }
  for (const deptId of params.deptIds) {
    for (const member of params.membersByDept.get(deptId) ?? []) {
      if (!recipientById.has(member.userId)) {
        recipientById.set(member.userId, toRecipientRecord(member, params.userDeptMap));
      }
    }
  }
  return { assigneeIds, recipients: Array.from(recipientById.values()) };
}

function assembleCandidateTask(params: {
  readonly row: RawCandidateTaskRow;
  readonly directRows: readonly RawDirectAssigneeRow[];
  readonly deptIds: readonly string[];
  readonly membersByDept: ReadonlyMap<string, RawDeptMemberRow[]>;
  readonly userDeptMap: ReadonlyMap<string, string[]>;
}): ReminderCandidateTaskRecord | null {
  if (!params.row.dueAt) return null;
  const { assigneeIds, recipients } = collectTaskRecipients(params);
  return {
    id: params.row.id,
    boardId: params.row.boardId,
    boardName: params.row.boardName,
    columnId: params.row.columnId,
    columnName: params.row.columnName,
    title: params.row.title,
    dueAt: params.row.dueAt,
    priority: toPriority(params.row.priority),
    isHidden: params.row.isHidden,
    createdBy: params.row.createdBy,
    assigneeIds,
    assignedDepartmentIds: [...params.deptIds],
    recipients,
  };
}

function groupByTaskId<T extends { readonly taskId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.taskId);
    if (list) list.push(row);
    else map.set(row.taskId, [row]);
  }
  return map;
}

export class DrizzleRemindersRepository implements RemindersRepository {
  constructor(private readonly db: DbExecutor) {}

  async getSettings(tx?: TransactionContext): Promise<ReminderSettingsRecord> {
    const executor = tx ?? this.db;
    const [row] = await executor
      .select({ value: appSettings.value, updatedAt: appSettings.updatedAt, updatedBy: appSettings.updatedBy })
      .from(appSettings).where(eq(appSettings.key, REMINDERS_APP_SETTING_KEY)).limit(1);
    if (!row) return { ...parseStoredReminderSettings(null), updatedAt: null, updatedBy: null };
    const updatedBy = row.updatedBy ? await this.loadUserSummary(executor, row.updatedBy) : null;
    return { ...parseStoredReminderSettings(row.value), updatedAt: row.updatedAt, updatedBy };
  }

  async upsertSettings(input: UpsertReminderSettingsParams, tx: TransactionContext): Promise<UpsertReminderSettingsResult> {
    const previous = await this.getSettings(tx);
    const value = { daysBefore: [...input.daysBefore], remindOverdue: input.remindOverdue, sendHourVn: input.sendHourVn };
    await tx.insert(appSettings)
      .values({ key: REMINDERS_APP_SETTING_KEY, value, updatedBy: input.actorId, createdAt: input.now, updatedAt: input.now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: input.actorId, updatedAt: input.now } });
    return { previousDaysBefore: previous.daysBefore, previousRemindOverdue: previous.remindOverdue, current: await this.getSettings(tx) };
  }

  async findCandidateTasks(): Promise<ReminderCandidateTaskRecord[]> {
    const taskRows = await this.loadActiveCandidateTaskRows();
    if (taskRows.length === 0) return [];
    const taskIds = taskRows.map((row) => row.id);
    const [directRows, taskDeptRows] = await Promise.all([
      this.loadDirectAssignees(taskIds),
      this.loadTaskDepartments(taskIds),
    ]);
    const uniqueDeptIds = Array.from(new Set(taskDeptRows.map((row) => row.departmentId)));
    const deptMemberRows = await this.loadDepartmentMembers(uniqueDeptIds);
    return this.assembleCandidates({ taskRows, directRows, taskDeptRows, deptMemberRows });
  }

  async findSentReminderKeys(taskIds: readonly string[]): Promise<ReminderSentKeyRecord[]> {
    if (taskIds.length === 0) return [];
    return this.db
      .select({ taskId: reminders.taskId, userId: reminders.userId, kind: reminders.kind })
      .from(reminders).where(inArray(reminders.taskId, [...taskIds]));
  }

  async insertSentReminders(rows: readonly RecordReminderSentInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insert(reminders)
      .values(rows.map((row) => ({ taskId: row.taskId, userId: row.userId, kind: row.kind, sentAt: row.sentAt })))
      .onConflictDoNothing({ target: [reminders.taskId, reminders.userId, reminders.kind] })
      .returning({ id: reminders.id });
    return inserted.length;
  }

  private async loadUserSummary(executor: DbExecutor, userId: string): Promise<TaskMemberSummaryRecord | null> {
    const [profileRows, deptRows] = await Promise.all([
      executor.select({
        id: profiles.id, fullName: profiles.fullName, avatarUpdatedAt: profiles.avatarUpdatedAt,
        isActive: profiles.isActive, leftAt: profiles.leftAt,
      }).from(profiles).where(eq(profiles.id, userId)).limit(1),
      executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name })
        .from(memberDepartments).innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
        .where(eq(memberDepartments.userId, userId)).orderBy(asc(departments.name), asc(departments.id)),
    ]);
    return buildUserSummariesMap(profileRows, deptRows).get(userId) ?? null;
  }

  private loadActiveCandidateTaskRows(): Promise<RawCandidateTaskRow[]> {
    return this.db.select({
      id: tasks.id, boardId: tasks.boardId, boardName: boards.name, columnId: tasks.columnId, columnName: columns.name,
      title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, isHidden: tasks.isHidden, createdBy: tasks.createdBy,
    }).from(tasks).innerJoin(boards, eq(tasks.boardId, boards.id)).leftJoin(columns, eq(tasks.columnId, columns.id))
      .where(and(
        isNull(tasks.deletedAt), isNull(tasks.purgedAt), isNotNull(tasks.dueAt),
        isNull(boards.archivedAt), isNull(boards.purgedAt), notDoneColumnSqlCondition(this.db),
      ));
  }

  private loadDirectAssignees(taskIds: readonly string[]): Promise<RawDirectAssigneeRow[]> {
    return this.db.select({ taskId: taskAssignees.taskId, ...RECIPIENT_PROFILE_COLS })
      .from(taskAssignees).innerJoin(profiles, eq(taskAssignees.userId, profiles.id))
      .where(and(inArray(taskAssignees.taskId, [...taskIds]), eq(profiles.isActive, true), isNull(profiles.purgedAt)));
  }

  private loadTaskDepartments(taskIds: readonly string[]) {
    return this.db.select({ taskId: taskDepartments.taskId, departmentId: taskDepartments.departmentId })
      .from(taskDepartments).where(inArray(taskDepartments.taskId, [...taskIds]));
  }

  private async loadDepartmentMembers(departmentIds: readonly string[]): Promise<RawDeptMemberRow[]> {
    if (departmentIds.length === 0) return [];
    return this.db.select({ departmentId: memberDepartments.departmentId, ...RECIPIENT_PROFILE_COLS })
      .from(memberDepartments).innerJoin(profiles, eq(memberDepartments.userId, profiles.id))
      .where(and(inArray(memberDepartments.departmentId, [...departmentIds]), eq(profiles.isActive, true), isNull(profiles.purgedAt)));
  }

  private assembleCandidates(params: {
    readonly taskRows: readonly RawCandidateTaskRow[];
    readonly directRows: readonly RawDirectAssigneeRow[];
    readonly taskDeptRows: ReadonlyArray<{ readonly taskId: string; readonly departmentId: string }>;
    readonly deptMemberRows: readonly RawDeptMemberRow[];
  }): ReminderCandidateTaskRecord[] {
    const directByTask = groupByTaskId(params.directRows);
    const deptByTask = groupByTaskId(params.taskDeptRows);
    const membersByDept = buildMembersByDeptMap(params.deptMemberRows);
    const userDeptMap = buildUserDeptIdsMap(params.deptMemberRows);
    const result: ReminderCandidateTaskRecord[] = [];
    for (const row of params.taskRows) {
      const candidate = assembleCandidateTask({
        row, directRows: directByTask.get(row.id) ?? [],
        deptIds: (deptByTask.get(row.id) ?? []).map((d) => d.departmentId),
        membersByDept, userDeptMap,
      });
      if (candidate) result.push(candidate);
    }
    return result;
  }
}
