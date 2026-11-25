import { and, asc, count, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, lt, ne, notExists, or, type SQL, sql } from 'drizzle-orm';
import { boards, columns, comments, departments, memberDepartments, profiles, taskAssignees, taskDepartments, taskEvents, tasks } from '@db/schema';
import { badRequest, conflict, notFound } from '@/lib/errors';
import type { TaskDueStatus, TaskSortBy, TaskSortOrder } from '@/lib/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { escapeLikePattern, type TaskListCursor } from './policy';
import { assembleTaskRecords, buildAssigneesDiffChanges, buildCreateTaskEventChanges, buildTaskUpdatePatch, buildUserSummariesMap, groupTaskIdStrings, type RawTaskRow } from './repository-helpers';
import { executeMoveTaskWithEvent, type RawMoveSibling } from './repository-move';
import type { CreateTaskRepoParams, ListMyTasksParams, ListVisibleTasksParams, MoveTaskRepoParams, ReplaceAssigneesRepoParams, SoftDeleteTaskRepoParams, TaskMemberSummaryRecord, TaskMutationResult, TaskOptionalEventMutationResult, TaskRecord, TasksRepository, UpdateTaskHiddenRepoParams, UpdateTaskRepoParams } from './types';

function boardNotPurgedSql(db: DbExecutor): SQL {
  return exists(db.select({ one: sql`1` }).from(boards).where(and(eq(boards.id, tasks.boardId), isNull(boards.purgedAt))));
}

function assignedDepartmentExistsSql(db: DbExecutor, departmentIds: readonly string[]): SQL {
  return exists(db.select({ one: sql`1` }).from(taskDepartments).where(and(eq(taskDepartments.taskId, tasks.id), inArray(taskDepartments.departmentId, [...departmentIds]))));
}

export function taskAccessSqlCondition(db: DbExecutor, actor: AuthActor): SQL {
  if (!actor.isActive) return sql`false`;
  if (actor.isAdmin) return sql`true`;
  const clauses: SQL[] = [
    eq(tasks.isHidden, false),
    eq(tasks.createdBy, actor.id),
    exists(db.select({ one: sql`1` }).from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, actor.id)))),
  ];
  const deptIds = actor.departmentIds ?? [];
  if (deptIds.length > 0) clauses.push(assignedDepartmentExistsSql(db, deptIds));
  return or(...clauses) ?? sql`false`;
}

export function visibleTaskSqlCondition(db: DbExecutor, actor: AuthActor): SQL {
  if (!actor.isActive) return sql`false`;
  return and(isNull(tasks.deletedAt), isNull(tasks.purgedAt), taskAccessSqlCondition(db, actor))!;
}

export function notDoneColumnSqlCondition(db: DbExecutor): SQL {
  return notExists(
    db.select({ one: sql`1` }).from(columns).where(
      and(
        eq(columns.id, tasks.columnId),
        or(
          sql`lower(btrim(${columns.name})) = 'done'`,
          eq(columns.orderIndex, sql`(SELECT max(c2.order_index) FROM columns c2 WHERE c2.board_id = ${tasks.boardId})`),
        ),
      ),
    ),
  );
}

function buildDueStatusCondition(db: DbExecutor, dueStatus: TaskDueStatus, now: Date): SQL | undefined {
  if (dueStatus === 'overdue') return and(isNotNull(tasks.dueAt), lt(tasks.dueAt, now), notDoneColumnSqlCondition(db));
  if (dueStatus === 'upcoming') return and(isNotNull(tasks.dueAt), gte(tasks.dueAt, now));
  return isNull(tasks.dueAt);
}

function buildTaskCursorCondition(cursor: TaskListCursor): SQL | undefined {
  const isAsc = cursor.sortOrder === 'asc';
  const tie = isAsc ? gt(tasks.id, cursor.id) : lt(tasks.id, cursor.id);
  if (cursor.sortBy === 'dueAt') {
    if (cursor.value === null) return and(isNull(tasks.dueAt), tie);
    const dt = new Date(String(cursor.value));
    return or(isNull(tasks.dueAt), isAsc ? gt(tasks.dueAt, dt) : lt(tasks.dueAt, dt), and(eq(tasks.dueAt, dt), tie));
  }
  if (cursor.sortBy === 'position') {
    const val = String(cursor.value);
    return or(isAsc ? gt(tasks.position, val) : lt(tasks.position, val), and(eq(tasks.position, val), tie));
  }
  if (cursor.sortBy === 'priority') {
    const val = Number(cursor.value);
    return or(isAsc ? gt(tasks.priority, val) : lt(tasks.priority, val), and(eq(tasks.priority, val), tie));
  }
  const dt = new Date(String(cursor.value));
  return or(isAsc ? gt(tasks.createdAt, dt) : lt(tasks.createdAt, dt), and(eq(tasks.createdAt, dt), tie));
}

function buildTaskOrderBy(sortBy: TaskSortBy, sortOrder: TaskSortOrder): SQL[] {
  const isAsc = sortOrder === 'asc';
  const tie = isAsc ? asc(tasks.id) : desc(tasks.id);
  if (sortBy === 'position') return [isAsc ? asc(tasks.position) : desc(tasks.position), tie];
  if (sortBy === 'priority') return [isAsc ? asc(tasks.priority) : desc(tasks.priority), tie];
  if (sortBy === 'createdAt') return [isAsc ? asc(tasks.createdAt) : desc(tasks.createdAt), tie];
  return [isAsc ? sql`${tasks.dueAt} ASC NULLS LAST` : sql`${tasks.dueAt} DESC NULLS LAST`, tie];
}

function buildSearchCond(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const pattern = `%${escapeLikePattern(q)}%`;
  return or(ilike(tasks.title, pattern), ilike(tasks.description, pattern));
}

function appendCommonVisibleFilters(db: DbExecutor, filters: SQL[], params: ListVisibleTasksParams): void {
  if (params.dueStatus) {
    const dueCond = buildDueStatusCondition(db, params.dueStatus, params.now);
    if (dueCond) filters.push(dueCond);
  }
  const searchCond = buildSearchCond(params.q);
  if (searchCond) filters.push(searchCond);
  if (params.cursor) {
    const cursorCond = buildTaskCursorCondition(params.cursor);
    if (cursorCond) filters.push(cursorCond);
  }
}

function buildVisibleTaskFilters(db: DbExecutor, actor: AuthActor, params: ListVisibleTasksParams): SQL {
  const filters: SQL[] = [visibleTaskSqlCondition(db, actor), boardNotPurgedSql(db)];
  if (params.boardId) filters.push(eq(tasks.boardId, params.boardId));
  if (params.columnId) filters.push(eq(tasks.columnId, params.columnId));
  if (params.assigneeId) {
    filters.push(exists(db.select({ one: sql`1` }).from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, params.assigneeId)))));
  }
  if (params.departmentId) filters.push(assignedDepartmentExistsSql(db, [params.departmentId]));
  if (params.priority !== undefined) filters.push(eq(tasks.priority, params.priority));
  appendCommonVisibleFilters(db, filters, params);
  return and(...filters) ?? sql`true`;
}

function buildMyAssignedCondition(db: DbExecutor, actor: AuthActor): SQL {
  const directAssign = exists(db.select({ one: sql`1` }).from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, actor.id))));
  const deptIds = actor.departmentIds ?? [];
  if (deptIds.length === 0) return directAssign;
  return or(directAssign, assignedDepartmentExistsSql(db, deptIds)) ?? directAssign;
}

function appendMyTasksCursorFilter(filters: SQL[], cursor: ListMyTasksParams['cursor']): void {
  if (!cursor) return;
  const { dueAt, priority, id } = cursor;
  const tie = or(lt(tasks.priority, priority), and(eq(tasks.priority, priority), gt(tasks.id, id)));
  const cond = dueAt === null ? and(isNull(tasks.dueAt), tie) : or(isNull(tasks.dueAt), gt(tasks.dueAt, dueAt), and(eq(tasks.dueAt, dueAt), tie));
  if (cond) filters.push(cond);
}

function buildMyTasksFilters(db: DbExecutor, actor: AuthActor, params: ListMyTasksParams): SQL {
  const filters: SQL[] = [isNull(tasks.deletedAt), isNull(tasks.purgedAt), boardNotPurgedSql(db), buildMyAssignedCondition(db, actor)];
  if (params.boardId) filters.push(eq(tasks.boardId, params.boardId));
  if (params.departmentId) filters.push(assignedDepartmentExistsSql(db, [params.departmentId]));
  if (params.priority !== undefined) filters.push(eq(tasks.priority, params.priority));
  const searchCond = buildSearchCond(params.q);
  if (searchCond) filters.push(searchCond);
  if (!params.includeDone) filters.push(notDoneColumnSqlCondition(db));
  appendMyTasksCursorFilter(filters, params.cursor);
  return and(...filters) ?? sql`true`;
}

export class DrizzleTasksRepository implements TasksRepository {
  constructor(private readonly db: DbExecutor) {}

  async listVisibleByBoardId(boardId: string, actor: AuthActor, tx?: TransactionContext): Promise<TaskRecord[]> {
    const executor = tx ?? this.db;
    const rows = await executor.select().from(tasks).where(and(eq(tasks.boardId, boardId), visibleTaskSqlCondition(executor, actor), boardNotPurgedSql(executor))).orderBy(asc(tasks.position), asc(tasks.id));
    return this.hydrateTasks(executor, rows);
  }

  async listVisibleTasks(actor: AuthActor, params: ListVisibleTasksParams): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db.select().from(tasks).where(buildVisibleTaskFilters(this.db, actor, params)).orderBy(...buildTaskOrderBy(params.sortBy, params.sortOrder)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    return { rows: await this.hydrateTasks(this.db, hasMore ? fetched.slice(0, params.limit) : fetched), hasMore };
  }

  async listMyTasks(actor: AuthActor, params: ListMyTasksParams): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db.select().from(tasks).where(buildMyTasksFilters(this.db, actor, params)).orderBy(sql`${tasks.dueAt} ASC NULLS LAST`, desc(tasks.priority), asc(tasks.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    return { rows: await this.hydrateTasks(this.db, hasMore ? fetched.slice(0, params.limit) : fetched), hasMore };
  }

  async findActiveById(taskId: string, tx?: TransactionContext): Promise<TaskRecord | null> {
    const executor = tx ?? this.db;
    const cond = and(eq(tasks.id, taskId), isNull(tasks.deletedAt), isNull(tasks.purgedAt), boardNotPurgedSql(executor));
    const rows = tx ? await executor.select().from(tasks).where(cond).for('update').limit(1) : await executor.select().from(tasks).where(cond).limit(1);
    if (!rows[0]) return null;
    return (await this.hydrateTasks(executor, rows))[0] ?? null;
  }

  async createTaskWithEvent(input: CreateTaskRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    await this.assertBoardAndColumnMatch(input.boardId, input.columnId, tx);
    await this.assertAssignableUsers({ nextUserIds: input.assigneeIds }, tx);
    await this.assertValidDepartments(input.departmentIds, tx);
    const maxPosRows = await tx.select({ maxPos: sql<string | null>`max(${tasks.position})` }).from(tasks).where(and(eq(tasks.columnId, input.columnId), isNull(tasks.deletedAt)));
    const nextPos = String(Number(maxPosRows[0]?.maxPos ?? 0) + 1000);
    const [created] = await tx.insert(tasks).values({
      boardId: input.boardId, columnId: input.columnId, title: input.title, description: input.description ?? null, dueAt: input.dueAt ?? null,
      priority: input.priority, position: nextPos, isHidden: input.isHidden, version: 1, createdBy: input.actorId, createdAt: input.now, updatedAt: input.now,
    }).returning();
    if (!created) throw new Error('Failed to insert task');
    if (input.assigneeIds.length > 0) await tx.insert(taskAssignees).values(input.assigneeIds.map((userId) => ({ taskId: created.id, userId, createdAt: input.now })));
    if (input.departmentIds.length > 0) await tx.insert(taskDepartments).values(input.departmentIds.map((departmentId) => ({ taskId: created.id, departmentId, createdAt: input.now })));
    const eventId = await this.insertTaskEvent({ taskId: created.id, boardId: input.boardId, actorId: input.actorId, type: 'task.created', changes: buildCreateTaskEventChanges(input), now: input.now }, tx);
    return { task: (await this.hydrateTasks(tx, [created]))[0]!, eventId };
  }

  async updateTaskWithEvent(input: UpdateTaskRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    const patch = buildTaskUpdatePatch(input);
    const [updated] = await tx.update(tasks).set({ ...patch, version: sql`${tasks.version} + 1` }).where(and(eq(tasks.id, input.id), eq(tasks.version, input.version), isNull(tasks.deletedAt))).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    const eventId = await this.insertTaskEvent({ taskId: updated.id, boardId: input.boardId, actorId: input.actorId, type: 'task.updated', changes: { ...input.changes }, now: input.now }, tx);
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId };
  }

  async moveTaskWithEvent(input: MoveTaskRepoParams, tx: TransactionContext): Promise<TaskOptionalEventMutationResult> {
    return executeMoveTaskWithEvent(input, tx, {
      lockDestinationColumn: (boardId, colId, txn) => this.lockColumnForBoard(boardId, colId, txn),
      loadColumnSiblings: (colId, excludeId, txn) => this.loadMoveSiblings(colId, excludeId, txn),
      applySiblingRebalance: (updates, txn) => this.applySiblingPositions(updates, txn),
      persistMovedTaskAndEvent: (p, txn) => this.persistMoveAndEvent(p, txn),
    });
  }

  async replaceAssigneesWithEvent(input: ReplaceAssigneesRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    const diff = buildAssigneesDiffChanges(input);
    if (diff.assigneesChanged) await this.assertAssignableUsers({ nextUserIds: input.nextAssigneeIds, preservedUserIds: input.currentAssigneeIds }, tx);
    if (diff.departmentsChanged) await this.assertValidDepartments(input.nextDepartmentIds, tx);
    const cond = input.expectedVersion !== undefined ? and(eq(tasks.id, input.id), eq(tasks.version, input.expectedVersion), isNull(tasks.deletedAt)) : and(eq(tasks.id, input.id), isNull(tasks.deletedAt));
    const [updated] = await tx.update(tasks).set({ version: sql`${tasks.version} + 1`, updatedAt: input.now }).where(cond).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    await this.syncTaskAssignments(input, diff, tx);
    const eventId = await this.insertTaskEvent({ taskId: input.id, boardId: input.boardId, actorId: input.actorId, type: 'task.assignees_changed', changes: diff.changes, now: input.now }, tx);
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId };
  }

  async softDeleteTaskWithEvent(input: SoftDeleteTaskRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    const [updated] = await tx.update(tasks).set({ deletedAt: input.now, version: sql`${tasks.version} + 1`, updatedAt: input.now }).where(and(eq(tasks.id, input.id), eq(tasks.version, input.version), isNull(tasks.deletedAt))).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    const eventId = await this.insertTaskEvent({ taskId: input.id, boardId: input.boardId, actorId: input.actorId, type: 'task.deleted', changes: { deleted_at: { from: null, to: input.now.toISOString() } }, now: input.now }, tx);
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId };
  }

  async updateTaskHiddenWithEvent(input: UpdateTaskHiddenRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    const cond = input.expectedVersion !== undefined ? and(eq(tasks.id, input.id), eq(tasks.version, input.expectedVersion), isNull(tasks.deletedAt)) : and(eq(tasks.id, input.id), isNull(tasks.deletedAt));
    const [updated] = await tx.update(tasks).set({ isHidden: input.nextIsHidden, version: sql`${tasks.version} + 1`, updatedAt: input.now }).where(cond).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    const eventId = await this.insertTaskEvent({ taskId: input.id, boardId: input.boardId, actorId: input.actorId, type: 'task.hidden_changed', changes: { is_hidden: { from: input.currentIsHidden, to: input.nextIsHidden } }, now: input.now }, tx);
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId };
  }

  private async syncTaskAssignments(input: ReplaceAssigneesRepoParams, diff: { readonly assigneesChanged: boolean; readonly departmentsChanged: boolean }, tx: TransactionContext): Promise<void> {
    if (diff.assigneesChanged) {
      await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, input.id));
      if (input.nextAssigneeIds.length > 0) await tx.insert(taskAssignees).values(input.nextAssigneeIds.map((userId) => ({ taskId: input.id, userId, createdAt: input.now })));
    }
    if (diff.departmentsChanged) {
      await tx.delete(taskDepartments).where(eq(taskDepartments.taskId, input.id));
      if (input.nextDepartmentIds.length > 0) await tx.insert(taskDepartments).values(input.nextDepartmentIds.map((departmentId) => ({ taskId: input.id, departmentId, createdAt: input.now })));
    }
  }

  private async lockColumnForBoard(boardId: string, columnId: string, tx: TransactionContext): Promise<void> {
    const colRows = await tx.select({ id: columns.id, boardId: columns.boardId }).from(columns).where(eq(columns.id, columnId)).for('update').limit(1);
    if (!colRows[0]) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    if (colRows[0].boardId !== boardId) throw badRequest('errors.boardColumnMismatch', {}, 'BOARD_COLUMN_MISMATCH');
  }

  private async assertBoardAndColumnMatch(boardId: string, columnId: string, tx: TransactionContext): Promise<void> {
    const boardRows = await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.id, boardId), isNull(boards.purgedAt))).limit(1);
    if (!boardRows[0]) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    await this.lockColumnForBoard(boardId, columnId, tx);
  }

  private async loadMoveSiblings(columnId: string, excludeTaskId: string, tx: TransactionContext): Promise<RawMoveSibling[]> {
    const rows = await tx.select({ id: tasks.id, position: tasks.position, isHidden: tasks.isHidden, createdBy: tasks.createdBy }).from(tasks)
      .where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), ne(tasks.id, excludeTaskId))).orderBy(asc(tasks.position), asc(tasks.id));
    if (rows.length === 0) return [];
    const taskIds = rows.map((r) => r.id);
    const [assignRows, deptRows] = await Promise.all([
      tx.select({ taskId: taskAssignees.taskId, value: taskAssignees.userId }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
      tx.select({ taskId: taskDepartments.taskId, value: taskDepartments.departmentId }).from(taskDepartments).where(inArray(taskDepartments.taskId, taskIds)),
    ]);
    const assignMap = groupTaskIdStrings(assignRows);
    const deptMap = groupTaskIdStrings(deptRows);
    return rows.map((r) => ({ id: r.id, position: Number(r.position), isHidden: r.isHidden, createdBy: r.createdBy, assigneeIds: assignMap.get(r.id) ?? [], assignedDepartmentIds: deptMap.get(r.id) ?? [] }));
  }

  private async applySiblingPositions(updates: ReadonlyArray<{ readonly id: string; readonly position: number }>, tx: TransactionContext): Promise<void> {
    for (const u of updates) await tx.update(tasks).set({ position: String(u.position) }).where(and(eq(tasks.id, u.id), isNull(tasks.deletedAt)));
  }

  private async persistMoveAndEvent(p: { readonly id: string; readonly boardId: string; readonly actorId: string; readonly fromColumnId: string | null; readonly fromPosition: number; readonly toColumnId: string; readonly toPosition: number; readonly expectedVersion: number; readonly now: Date }, tx: TransactionContext): Promise<TaskMutationResult> {
    const [updated] = await tx.update(tasks).set({ columnId: p.toColumnId, position: String(p.toPosition), version: sql`${tasks.version} + 1`, updatedAt: p.now })
      .where(and(eq(tasks.id, p.id), eq(tasks.version, p.expectedVersion), isNull(tasks.deletedAt))).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    const eventId = await this.insertTaskEvent({ taskId: p.id, boardId: p.boardId, actorId: p.actorId, type: 'task.moved', changes: { column_id: { from: p.fromColumnId, to: p.toColumnId }, position: { from: p.fromPosition, to: p.toPosition } }, now: p.now }, tx);
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId };
  }

  private async assertAssignableUsers(params: { readonly nextUserIds: readonly string[]; readonly preservedUserIds?: readonly string[] }, tx: TransactionContext): Promise<void> {
    if (params.nextUserIds.length === 0) return;
    const rows = await tx.select({ id: profiles.id, isActive: profiles.isActive }).from(profiles).where(inArray(profiles.id, [...params.nextUserIds]));
    if (rows.length !== params.nextUserIds.length) throw badRequest('errors.invalidAssigneeIds', {}, 'INVALID_ASSIGNEE_IDS');
    const preservedSet = new Set(params.preservedUserIds ?? []);
    if (rows.some((row) => !row.isActive && !preservedSet.has(row.id))) throw badRequest('errors.invalidAssigneeIds', {}, 'INVALID_ASSIGNEE_IDS');
  }

  private async assertValidDepartments(departmentIds: readonly string[], tx: TransactionContext): Promise<void> {
    if (departmentIds.length === 0) return;
    const rows = await tx.select({ id: departments.id }).from(departments).where(inArray(departments.id, [...departmentIds]));
    if (rows.length !== departmentIds.length) throw badRequest('errors.invalidDepartmentIds', {}, 'INVALID_DEPARTMENT_IDS');
  }

  private async insertTaskEvent(input: { readonly taskId: string; readonly boardId: string; readonly actorId: string; readonly type: string; readonly changes: Record<string, unknown>; readonly now: Date }, tx: TransactionContext): Promise<string> {
    const [evt] = await tx.insert(taskEvents).values({ taskId: input.taskId, boardId: input.boardId, actorId: input.actorId, type: input.type, changes: input.changes, createdAt: input.now }).returning({ id: taskEvents.id });
    if (!evt) throw new Error('Failed to record task event');
    return evt.id;
  }

  private async hydrateTasks(executor: DbExecutor, taskRows: readonly RawTaskRow[]): Promise<TaskRecord[]> {
    if (taskRows.length === 0) return [];
    const taskIds = taskRows.map((row) => row.id);
    const [assigneeRows, departmentRows, commentCountRows] = await Promise.all([
      executor.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
      executor.select({ taskId: taskDepartments.taskId, id: departments.id, name: departments.name }).from(taskDepartments).innerJoin(departments, eq(taskDepartments.departmentId, departments.id)).where(inArray(taskDepartments.taskId, taskIds)).orderBy(asc(departments.name), asc(departments.id)),
      executor.select({ taskId: comments.taskId, total: count() }).from(comments).where(inArray(comments.taskId, taskIds)).groupBy(comments.taskId),
    ]);
    const userMap = await this.loadUserSummaries(executor, Array.from(new Set([...taskRows.map((r) => r.createdBy), ...assigneeRows.map((a) => a.userId)])));
    return assembleTaskRecords({ taskRows, assigneeRows, departmentRows, commentCountRows, userMap });
  }

  private async loadUserSummaries(executor: DbExecutor, userIds: readonly string[]): Promise<Map<string, TaskMemberSummaryRecord>> {
    if (userIds.length === 0) return new Map();
    const [profileRows, deptRows] = await Promise.all([
      executor.select({ id: profiles.id, fullName: profiles.fullName, avatarUpdatedAt: profiles.avatarUpdatedAt, isActive: profiles.isActive, leftAt: profiles.leftAt }).from(profiles).where(inArray(profiles.id, [...userIds])),
      executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name }).from(memberDepartments).innerJoin(departments, eq(memberDepartments.departmentId, departments.id)).where(inArray(memberDepartments.userId, [...userIds])).orderBy(asc(departments.name), asc(departments.id)),
    ]);
    return buildUserSummariesMap(profileRows, deptRows);
  }
}
