import type { ArchivePurgeMode } from '@/lib/archive';
import { conflict, notFound } from '@/lib/errors';
import type { TaskPriority } from '@/lib/tasks';
import type { BoardSummaryRecord } from '@/server/modules/boards';
import type { MemberProfileRecord } from '@/server/modules/members';
import type { TaskDepartmentSummaryRecord, TaskRecord } from '@/server/modules/tasks';
import type { TransactionContext } from '@/server/shared/transaction';
import { type AnonymizedProfilePatch, buildAnonymizedProfilePatch } from './policy';
import type {
  ArchiveUserSummaryRecord,
  ArchivedBoardItemRecord,
  ArchivedTaskItemRecord,
  AutoPurgeExecutionResult,
  PurgeEntityResult,
} from './types';

export interface ArchivePurgeStore {
  lockTaskForPurge(
    taskId: string,
    tx: TransactionContext,
  ): Promise<{ readonly id: string; readonly boardId: string; readonly deletedAt: Date | null } | null>;
  markTaskPurged(taskId: string, now: Date, tx: TransactionContext): Promise<void>;
  lockBoardForPurge(
    boardId: string,
    tx: TransactionContext,
  ): Promise<{ readonly id: string; readonly archivedAt: Date | null } | null>;
  markBoardAndCascadeTasksPurged(boardId: string, now: Date, tx: TransactionContext): Promise<number>;
  lockMemberForPurge(
    memberId: string,
    tx: TransactionContext,
  ): Promise<{ readonly id: string; readonly isActive: boolean } | null>;
  deleteDisposableMemberRows(memberId: string, tx: TransactionContext): Promise<void>;
  hasProfileHistoryReferences(memberId: string, tx: TransactionContext): Promise<boolean>;
  deleteProfilePhysically(memberId: string, tx: TransactionContext): Promise<void>;
  anonymizeProfile(memberId: string, patch: AnonymizedProfilePatch, tx: TransactionContext): Promise<void>;
  purgeExpiredTasks(cutoff: Date, now: Date, tx: TransactionContext): Promise<number>;
  purgeExpiredBoardsAndCascade(cutoff: Date, now: Date, tx: TransactionContext): Promise<number>;
  findExpiredInactiveMemberIds(cutoff: Date, tx: TransactionContext): Promise<string[]>;
}

export interface RawArchiveUserRow {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
}

export interface RawArchiveDepartmentRow {
  readonly userId: string;
  readonly id: string;
  readonly name: string;
}

export interface RawTaskRowBase {
  readonly id: string;
  readonly boardId: string;
  readonly columnId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: Date | null;
  readonly priority: number;
  readonly position: string;
  readonly isHidden: boolean;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RawArchiveTaskRow extends RawTaskRowBase {
  readonly boardName: string;
  readonly boardArchivedAt: Date | null;
  readonly columnName: string | null;
}

export interface RawArchiveBoardRow {
  readonly id: string;
  readonly name: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly archivedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RawArchiveMemberRow {
  readonly id: string;
  readonly studentId: string;
  readonly email: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly locale: string;
  readonly mustChangePassword: boolean;
}

const toPriority = (raw: number): TaskPriority =>
  raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 2;

export function groupArchiveDepartments(
  rows: readonly RawArchiveDepartmentRow[],
): Map<string, TaskDepartmentSummaryRecord[]> {
  const map = new Map<string, TaskDepartmentSummaryRecord[]>();
  for (const row of rows) {
    const list = map.get(row.userId);
    const dept = { id: row.id, name: row.name };
    if (list) list.push(dept);
    else map.set(row.userId, [dept]);
  }
  return map;
}

export function buildArchiveUserSummaryMap(
  profileRows: readonly RawArchiveUserRow[],
  deptRows: readonly RawArchiveDepartmentRow[],
): Map<string, ArchiveUserSummaryRecord> {
  const deptMap = groupArchiveDepartments(deptRows);
  const map = new Map<string, ArchiveUserSummaryRecord>();
  for (const row of profileRows) {
    map.set(row.id, { ...row, departments: deptMap.get(row.id) ?? [] });
  }
  return map;
}

export function assembleTaskRecords(params: {
  readonly taskRows: readonly RawTaskRowBase[];
  readonly assigneeRows: ReadonlyArray<{ readonly taskId: string; readonly userId: string }>;
  readonly departmentRows: ReadonlyArray<{ readonly taskId: string; readonly id: string; readonly name: string }>;
  readonly commentCountRows: ReadonlyArray<{ readonly taskId: string; readonly total: number }>;
  readonly userMap: ReadonlyMap<string, ArchiveUserSummaryRecord>;
}): TaskRecord[] {
  const countMap = new Map(params.commentCountRows.map((r) => [r.taskId, Number(r.total)]));
  const assigneeMap = new Map<string, ArchiveUserSummaryRecord[]>();
  for (const row of params.assigneeRows) {
    const user = params.userMap.get(row.userId);
    if (!user) continue;
    const list = assigneeMap.get(row.taskId);
    if (list) list.push(user);
    else assigneeMap.set(row.taskId, [user]);
  }
  const deptMap = new Map<string, TaskDepartmentSummaryRecord[]>();
  for (const row of params.departmentRows) {
    const list = deptMap.get(row.taskId);
    const dept = { id: row.id, name: row.name };
    if (list) list.push(dept);
    else deptMap.set(row.taskId, [dept]);
  }
  return params.taskRows.map((row) => {
    const creator = params.userMap.get(row.createdBy);
    if (!creator) throw new Error('Missing creator profile');
    const assignees = (assigneeMap.get(row.id) ?? []).sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
    const assignedDepartments = (deptMap.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { ...row, priority: toPriority(row.priority), assignees, assignedDepartments, creator, commentCount: countMap.get(row.id) ?? 0 };
  });
}

export function assembleArchiveTaskItems(
  rawRows: readonly RawArchiveTaskRow[],
  hydratedTasks: readonly TaskRecord[],
): ArchivedTaskItemRecord[] {
  const taskMap = new Map(hydratedTasks.map((t) => [t.id, t]));
  return rawRows.map((row) => ({
    task: taskMap.get(row.id)!,
    boardName: row.boardName,
    boardArchived: row.boardArchivedAt !== null,
    columnName: row.columnName,
  }));
}

export function assembleArchiveBoardItems(params: {
  readonly boardRows: readonly RawArchiveBoardRow[];
  readonly userMap: ReadonlyMap<string, ArchiveUserSummaryRecord>;
  readonly taskCountMap: ReadonlyMap<string, number>;
}): ArchivedBoardItemRecord[] {
  return params.boardRows.map((row) => {
    const creator = params.userMap.get(row.createdBy);
    if (!creator) throw new Error('Missing board creator profile');
    const board: BoardSummaryRecord = {
      id: row.id,
      name: row.name,
      department: row.departmentId && row.departmentName ? { id: row.departmentId, name: row.departmentName } : null,
      archivedAt: row.archivedAt,
      createdBy: creator,
      visibleTaskCount: 0,
      overdueTaskCount: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return { board, taskCount: params.taskCountMap.get(row.id) ?? 0 };
  });
}

export function assembleArchiveMembers(
  rows: readonly RawArchiveMemberRow[],
  deptRows: readonly RawArchiveDepartmentRow[],
): MemberProfileRecord[] {
  const deptMap = groupArchiveDepartments(deptRows);
  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    email: row.email,
    fullName: row.fullName,
    avatarUpdatedAt: row.avatarUpdatedAt,
    isAdmin: row.isAdmin,
    isActive: row.isActive,
    leftAt: row.leftAt,
    locale: row.locale === 'en' ? 'en' : 'vi',
    mustChangePassword: row.mustChangePassword,
    departments: deptMap.get(row.id) ?? [],
  }));
}

export async function purgeInactiveMemberTx(
  memberId: string,
  now: Date,
  tx: TransactionContext,
  store: ArchivePurgeStore,
): Promise<ArchivePurgeMode> {
  await store.deleteDisposableMemberRows(memberId, tx);
  const hasReferences = await store.hasProfileHistoryReferences(memberId, tx);
  if (!hasReferences) {
    await store.deleteProfilePhysically(memberId, tx);
    return 'physical_delete';
  }
  await store.anonymizeProfile(memberId, buildAnonymizedProfilePatch(memberId, now), tx);
  return 'anonymized';
}

export async function executePurgeTaskTx(
  taskId: string,
  now: Date,
  tx: TransactionContext,
  store: ArchivePurgeStore,
): Promise<PurgeEntityResult> {
  const target = await store.lockTaskForPurge(taskId, tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (target.deletedAt === null) {
    throw conflict('errors.entityNotArchived', {}, 'ENTITY_NOT_ARCHIVED');
  }
  await store.markTaskPurged(taskId, now, tx);
  return {
    entityType: 'tasks',
    id: taskId,
    mode: 'marked_purged',
    detail: { taskId, boardId: target.boardId, purgeMode: 'marked_purged' },
    targetUserId: null,
  };
}

export async function executePurgeBoardTx(
  boardId: string,
  now: Date,
  tx: TransactionContext,
  store: ArchivePurgeStore,
): Promise<PurgeEntityResult> {
  const target = await store.lockBoardForPurge(boardId, tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (target.archivedAt === null) {
    throw conflict('errors.entityNotArchived', {}, 'ENTITY_NOT_ARCHIVED');
  }
  const cascadedTasks = await store.markBoardAndCascadeTasksPurged(boardId, now, tx);
  return {
    entityType: 'boards',
    id: boardId,
    mode: 'marked_purged',
    detail: { boardId, purgeMode: 'marked_purged', cascadedTasks },
    targetUserId: null,
  };
}

export async function executePurgeMemberTx(
  memberId: string,
  now: Date,
  tx: TransactionContext,
  store: ArchivePurgeStore,
): Promise<PurgeEntityResult> {
  const target = await store.lockMemberForPurge(memberId, tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (target.isActive) {
    throw conflict('errors.entityNotArchived', {}, 'ENTITY_NOT_ARCHIVED');
  }
  const mode = await purgeInactiveMemberTx(memberId, now, tx, store);
  return {
    entityType: 'members',
    id: memberId,
    mode,
    detail: { purgedMemberId: memberId, purgeMode: mode },
    targetUserId: mode === 'anonymized' ? memberId : null,
  };
}

export async function executeAutoPurgeTx(
  cutoff: Date,
  now: Date,
  tx: TransactionContext,
  store: ArchivePurgeStore,
): Promise<AutoPurgeExecutionResult> {
  const purgedTasks = await store.purgeExpiredTasks(cutoff, now, tx);
  const purgedBoards = await store.purgeExpiredBoardsAndCascade(cutoff, now, tx);
  const memberIds = await store.findExpiredInactiveMemberIds(cutoff, tx);
  for (const memberId of memberIds) {
    await purgeInactiveMemberTx(memberId, now, tx, store);
  }
  return {
    purgedTasks,
    purgedBoards,
    purgedMembers: memberIds.length,
  };
}
