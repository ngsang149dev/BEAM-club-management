import { and, asc, count, desc, eq, exists, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { boards, departments, memberDepartments, notifications, profiles, taskAssignees, taskDeliverables, taskDepartments, tasks } from '@db/schema';
import { visibleTaskSqlCondition } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import { type DbExecutor, runExecutorQueries } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { loadUserSummariesMap } from '@/server/shared/user-summaries';
import { assembleTaskActivityContext, mapSelectedNotificationRows, type SelectedNotificationRow } from './repository-helpers';
import type { CreateNotificationRowInput, DepartmentAssignmentContextRecord, DepartmentRecipientRecord, DirectAssigneeRecipientRecord, ListNotificationsRepoParams, NotificationDepartmentSummaryRecord, NotificationRecord, NotificationsRepository, TaskActivityNotificationContextRecord } from './types';

function visibleNotificationWhere(db: DbExecutor, actor: AuthActor): SQL {
  return and(eq(notifications.userId, actor.id), isNull(boards.purgedAt), visibleTaskSqlCondition(db, actor))!;
}

function buildListWhere(db: DbExecutor, actor: AuthActor, params: ListNotificationsRepoParams): SQL {
  const filters: SQL[] = [visibleNotificationWhere(db, actor)];
  if (params.unreadOnly) filters.push(isNull(notifications.readAt));
  if (params.cursor) {
    const { createdAt, id } = params.cursor;
    filters.push(or(lt(notifications.createdAt, createdAt), and(eq(notifications.createdAt, createdAt), lt(notifications.id, id)))!);
  }
  return and(...filters)!;
}

export class DrizzleNotificationsRepository implements NotificationsRepository {
  constructor(private readonly db: DbExecutor) {}

  async loadDepartmentAssignmentContext(input: {
    readonly taskId: string; readonly boardId: string; readonly actorId: string;
    readonly departmentIds: readonly string[]; readonly assigneeIds?: readonly string[];
  }): Promise<DepartmentAssignmentContextRecord | null> {
    const assigneeIds = input.assigneeIds ?? [];
    if (input.departmentIds.length === 0 && assigneeIds.length === 0) return null;
    const [[taskRow], [boardRow], [actorRow], deptRows, memberRows, directRows] = await runExecutorQueries(this.db, [
      () => this.db.select({ id: tasks.id, title: tasks.title, description: tasks.description, startAt: tasks.startAt, dueAt: tasks.dueAt, isCompleted: tasks.isCompleted, isHidden: tasks.isHidden }).from(tasks).where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt), isNull(tasks.purgedAt))).limit(1),
      () => this.db.select({ id: boards.id, name: boards.name }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).limit(1),
      () => this.db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, input.actorId)).limit(1),
      () => this.loadAssignedDepartments(input.departmentIds),
      () => this.loadDepartmentMembers(input.departmentIds, input.actorId),
      () => this.loadDirectAssignees(assigneeIds, input.actorId),
    ]);
    if (!taskRow || !boardRow || !actorRow) return null;
    return { task: taskRow, board: boardRow, actor: actorRow, departments: deptRows, members: memberRows, directAssignees: directRows };
  }

  async loadTaskActivityContext(input: {
    readonly taskId: string; readonly boardId: string; readonly actorId: string; readonly deliverableId?: string;
  }): Promise<TaskActivityNotificationContextRecord | null> {
    const [[taskRow], [boardRow], [actorRow], taskDepts, assigneeRows, deliverableRows] = await runExecutorQueries(this.db, [
      () => this.db.select({ id: tasks.id, title: tasks.title, description: tasks.description, startAt: tasks.startAt, dueAt: tasks.dueAt, isCompleted: tasks.isCompleted, isHidden: tasks.isHidden, createdBy: tasks.createdBy }).from(tasks).where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt), isNull(tasks.purgedAt))).limit(1),
      () => this.db.select({ id: boards.id, name: boards.name }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).limit(1),
      () => this.db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, input.actorId)).limit(1),
      () => this.db.select({ id: departments.id, name: departments.name, leadUserId: departments.leadUserId }).from(taskDepartments).innerJoin(departments, eq(taskDepartments.departmentId, departments.id)).where(eq(taskDepartments.taskId, input.taskId)),
      () => this.db.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, input.taskId)),
      () => input.deliverableId ? this.db.select({ id: taskDeliverables.id, title: taskDeliverables.title, url: taskDeliverables.url }).from(taskDeliverables).where(and(eq(taskDeliverables.id, input.deliverableId), eq(taskDeliverables.taskId, input.taskId))).limit(1) : Promise.resolve([]),
    ]);
    if (!taskRow || !boardRow || !actorRow) return null;
    const candidateIds = Array.from(new Set([taskRow.createdBy, ...taskDepts.map((d) => d.leadUserId).filter((id): id is string => id !== null)])).filter((id) => id !== input.actorId);
    const candidateProfiles = candidateIds.length > 0
      ? await this.db.select({ userId: profiles.id, email: profiles.email, fullName: profiles.fullName, locale: profiles.locale, isAdmin: profiles.isAdmin }).from(profiles).where(and(inArray(profiles.id, candidateIds), eq(profiles.isActive, true), isNull(profiles.purgedAt)))
      : [];
    const activeIds = candidateProfiles.map((p) => p.userId);
    const candidateMemberDepts = activeIds.length > 0
      ? await this.db.select({ userId: memberDepartments.userId, departmentId: memberDepartments.departmentId }).from(memberDepartments).where(inArray(memberDepartments.userId, activeIds))
      : [];
    return assembleTaskActivityContext({
      task: taskRow, board: boardRow, actor: actorRow, taskDepts,
      taskAssigneeIds: assigneeRows.map((r) => r.userId),
      deliverable: deliverableRows[0] ?? null, candidateProfiles, candidateMemberDepts,
    });
  }

  private async loadAssignedDepartments(departmentIds: readonly string[]): Promise<NotificationDepartmentSummaryRecord[]> {
    if (departmentIds.length === 0) return [];
    return this.db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...departmentIds])).orderBy(asc(departments.name), asc(departments.id));
  }

  private async loadDepartmentMembers(departmentIds: readonly string[], actorId: string): Promise<DepartmentRecipientRecord[]> {
    if (departmentIds.length === 0) return [];
    const rows = await this.db.select({ userId: profiles.id, email: profiles.email, fullName: profiles.fullName, locale: profiles.locale, departmentId: memberDepartments.departmentId })
      .from(memberDepartments).innerJoin(profiles, eq(memberDepartments.userId, profiles.id))
      .where(and(inArray(memberDepartments.departmentId, [...departmentIds]), eq(profiles.isActive, true), isNull(profiles.purgedAt), ne(profiles.id, actorId)));
    return rows.map((m) => ({ ...m, locale: m.locale === 'en' ? 'en' : 'vi' }));
  }

  private async loadDirectAssignees(assigneeIds: readonly string[], actorId: string): Promise<DirectAssigneeRecipientRecord[]> {
    if (assigneeIds.length === 0) return [];
    const rows = await this.db.select({ userId: profiles.id, email: profiles.email, fullName: profiles.fullName, locale: profiles.locale })
      .from(profiles).where(and(inArray(profiles.id, [...assigneeIds]), eq(profiles.isActive, true), isNull(profiles.purgedAt), ne(profiles.id, actorId)));
    return rows.map((m) => ({ ...m, locale: m.locale === 'en' ? 'en' : 'vi' }));
  }

  async insertNotifications(rows: readonly CreateNotificationRowInput[], tx?: TransactionContext): Promise<ReadonlyArray<{ readonly id: string; readonly userId: string }>> {
    if (rows.length === 0) return [];
    const executor = tx ?? this.db;
    return executor.insert(notifications).values(rows.map((row) => ({
      userId: row.userId, type: row.type, taskId: row.taskId, boardId: row.boardId, departmentId: row.departmentId,
      actorId: row.actorId, isHiddenTask: row.isHiddenTask, payload: { ...row.payload }, createdAt: row.createdAt,
    }))).returning({ id: notifications.id, userId: notifications.userId });
  }

  async listVisibleForUser(actor: AuthActor, params: ListNotificationsRepoParams): Promise<{ readonly rows: NotificationRecord[]; readonly unreadCount: number; readonly hasMore: boolean }> {
    const [fetched, unreadCount] = await runExecutorQueries(this.db, [
      () => this.selectNotificationRows(this.db).where(buildListWhere(this.db, actor, params)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(params.limit + 1),
      () => this.countUnread(actor, this.db),
    ]);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    return { rows: await this.hydrateRows(this.db, pageRows), unreadCount, hasMore };
  }

  async markReadForUser(actor: AuthActor, notificationId: string, now: Date, tx: TransactionContext): Promise<{ readonly notification: NotificationRecord; readonly unreadCount: number } | null> {
    const [locked] = await tx.select({ id: notifications.id, readAt: notifications.readAt }).from(notifications).where(and(eq(notifications.id, notificationId), eq(notifications.userId, actor.id))).for('update').limit(1);
    if (!locked) return null;
    const [visibleCheck] = await tx.select({ id: notifications.id }).from(notifications).innerJoin(tasks, eq(notifications.taskId, tasks.id)).innerJoin(boards, eq(notifications.boardId, boards.id)).where(and(eq(notifications.id, notificationId), visibleNotificationWhere(tx, actor))).limit(1);
    if (!visibleCheck) return null;
    if (locked.readAt === null) await tx.update(notifications).set({ readAt: now }).where(eq(notifications.id, notificationId));
    const [rows, unreadCount] = await runExecutorQueries(tx, [
      () => this.selectNotificationRows(tx).where(eq(notifications.id, notificationId)).limit(1),
      () => this.countUnread(actor, tx),
    ]);
    const hydrated = await this.hydrateRows(tx, rows);
    return hydrated[0] ? { notification: hydrated[0], unreadCount } : null;
  }

  async markAllReadForUser(actor: AuthActor, now: Date, tx: TransactionContext): Promise<{ readonly updatedCount: number; readonly unreadCount: number }> {
    const updated = await tx.update(notifications).set({ readAt: now }).where(and(
      eq(notifications.userId, actor.id), isNull(notifications.readAt),
      exists(tx.select({ one: sql`1` }).from(tasks).innerJoin(boards, eq(tasks.boardId, boards.id)).where(and(eq(tasks.id, notifications.taskId), eq(boards.id, notifications.boardId), isNull(boards.purgedAt), visibleTaskSqlCondition(tx, actor)))),
    )).returning({ id: notifications.id });
    return { updatedCount: updated.length, unreadCount: await this.countUnread(actor, tx) };
  }

  private selectNotificationRows(executor: DbExecutor) {
    return executor.select({
      id: notifications.id, type: notifications.type, taskId: notifications.taskId, boardId: notifications.boardId,
      departmentId: notifications.departmentId, actorId: notifications.actorId, isHiddenTask: notifications.isHiddenTask,
      payload: notifications.payload, readAt: notifications.readAt, createdAt: notifications.createdAt,
      liveTaskTitle: tasks.title, liveTaskIsHidden: tasks.isHidden, liveBoardName: boards.name, liveDepartmentName: departments.name,
    }).from(notifications).innerJoin(tasks, eq(notifications.taskId, tasks.id)).innerJoin(boards, eq(notifications.boardId, boards.id)).leftJoin(departments, eq(notifications.departmentId, departments.id));
  }

  private async countUnread(actor: AuthActor, executor: DbExecutor): Promise<number> {
    const [row] = await executor.select({ total: count() }).from(notifications).innerJoin(tasks, eq(notifications.taskId, tasks.id)).innerJoin(boards, eq(notifications.boardId, boards.id)).where(and(visibleNotificationWhere(executor, actor), isNull(notifications.readAt)));
    return Number(row?.total ?? 0);
  }

  private async hydrateRows(executor: DbExecutor, rows: readonly SelectedNotificationRow[]): Promise<NotificationRecord[]> {
    if (rows.length === 0) return [];
    const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
    const actorMap = await loadUserSummariesMap(executor, actorIds);
    return mapSelectedNotificationRows(rows, actorMap);
  }
}
