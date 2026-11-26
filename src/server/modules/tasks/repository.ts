import { and, asc, count, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, lt, ne, not, notExists, or, type SQL, sql } from 'drizzle-orm';
import { boards, columns, comments, departments, memberDepartments, profiles, taskAssignees, taskDeliverables, taskDepartments, taskEvents, tasks } from '@db/schema';
import { badRequest, conflict, notFound } from '@/lib/errors';
import type { TaskDeadlineStatus, TaskDueStatus, TaskSortBy, TaskSortOrder } from '@/lib/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { escapeLikePattern, type TaskListCursor } from './policy';
import { executeAddDeliverableWithEvent, executeRemoveDeliverableWithEvent, executeSetAcceptanceWithEvent, type TaskDeliverablesPersistence } from './repository-deliverables';
import { assembleTaskRecords, buildAssigneesDiffChanges, buildCreateTaskEventChanges, buildTaskUpdatePatch, buildUserSummariesMap, computeAssigneeSyncPlan, type RawTaskRow } from './repository-helpers';
import { assembleMoveSiblings, executeMoveTaskWithEvent, type RawMoveSibling } from './repository-move';
import type { AddTaskDeliverableRepoParams, CreateTaskRepoParams, ListMyTasksParams, ListVisibleTasksParams, MoveTaskRepoParams, RemoveTaskDeliverableRepoParams, ReplaceAssigneesRepoParams, SetTaskAcceptanceRepoParams, SoftDeleteTaskRepoParams, TaskMemberSummaryRecord, TaskMutationResult, TaskOptionalEventMutationResult, TaskRecord, TasksRepository, UpdateTaskHiddenRepoParams, UpdateTaskRepoParams } from './types';

const DEFAULT_WORKSPACE_BOARD_NAME = 'BEAM Workspace';
const TASK_SORT_COLS = { position: tasks.position, priority: tasks.priority, createdAt: tasks.createdAt } as const;
const compactSql = (parts: ReadonlyArray<SQL | false | '' | undefined>): SQL[] => parts.filter((part): part is SQL => Boolean(part));

const boardNotPurgedSql = (db: DbExecutor): SQL => exists(db.select({ one: sql`1` }).from(boards).where(and(eq(boards.id, tasks.boardId), isNull(boards.purgedAt))));
const assignedDepartmentExistsSql = (db: DbExecutor, departmentIds: readonly string[]): SQL =>
  exists(db.select({ one: sql`1` }).from(taskDepartments).where(and(eq(taskDepartments.taskId, tasks.id), inArray(taskDepartments.departmentId, [...departmentIds]))));

export function taskAccessSqlCondition(db: DbExecutor, actor: AuthActor): SQL {
  if (!actor.isActive) return sql`false`;
  if (actor.isAdmin) return sql`true`;
  const deptIds = actor.departmentIds ?? [];
  return or(...compactSql([
    eq(tasks.isHidden, false),
    eq(tasks.createdBy, actor.id),
    exists(db.select({ one: sql`1` }).from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, actor.id)))),
    deptIds.length > 0 && assignedDepartmentExistsSql(db, deptIds),
  ])) ?? sql`false`;
}

export function visibleTaskSqlCondition(db: DbExecutor, actor: AuthActor): SQL {
  return actor.isActive ? and(isNull(tasks.deletedAt), isNull(tasks.purgedAt), taskAccessSqlCondition(db, actor))! : sql`false`;
}

export function notDoneColumnSqlCondition(db: DbExecutor): SQL {
  return and(
    eq(tasks.isCompleted, false),
    notExists(db.select({ one: sql`1` }).from(columns).where(and(eq(columns.id, tasks.columnId), or(sql`lower(btrim(${columns.name})) = 'done'`, eq(columns.orderIndex, sql`(SELECT max(c2.order_index) FROM columns c2 WHERE c2.board_id = ${tasks.boardId})`))))),
  )!;
}

function buildDueStatusCondition(db: DbExecutor, dueStatus: TaskDueStatus, now: Date): SQL {
  if (dueStatus === 'overdue') return and(isNotNull(tasks.dueAt), lt(tasks.dueAt, now), notDoneColumnSqlCondition(db))!;
  return dueStatus === 'upcoming' ? and(isNotNull(tasks.dueAt), gte(tasks.dueAt, now))! : isNull(tasks.dueAt);
}

function buildDeadlineStatusCondition(db: DbExecutor, status: TaskDeadlineStatus, now: Date): SQL {
  if (status === 'done') return not(notDoneColumnSqlCondition(db));
  const dToday = sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
  const dDue = sql`(${tasks.dueAt} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
  const base = and(notDoneColumnSqlCondition(db), isNotNull(tasks.dueAt));
  if (status === 'overdue') return and(base, sql`${dDue} < ${dToday}`)!;
  if (status === 'urgent') return and(base, sql`(${dDue} - ${dToday}) BETWEEN 0 AND 1`)!;
  return status === 'soon' ? and(base, sql`(${dDue} - ${dToday}) BETWEEN 2 AND 3`)! : and(base, sql`(${dDue} - ${dToday}) > 3`)!;
}

function buildDateWindowCondition(from?: Date, to?: Date): SQL | undefined {
  if (!from && !to) return undefined;
  const bounds = compactSql([
    to && sql`COALESCE(${tasks.startAt}, ${tasks.dueAt}) <= ${to.toISOString()}::timestamptz`,
    from && sql`COALESCE(${tasks.dueAt}, ${tasks.startAt}) >= ${from.toISOString()}::timestamptz`,
  ]);
  return or(and(isNull(tasks.startAt), isNull(tasks.dueAt)), and(...bounds));
}

function buildTaskCursorCondition(cursor: TaskListCursor): SQL | undefined {
  const isAsc = cursor.sortOrder === 'asc';
  const tie = isAsc ? gt(tasks.id, cursor.id) : lt(tasks.id, cursor.id);
  if (cursor.sortBy === 'dueAt') {
    if (cursor.value === null) return and(isNull(tasks.dueAt), tie);
    const dt = new Date(String(cursor.value));
    return or(isNull(tasks.dueAt), isAsc ? gt(tasks.dueAt, dt) : lt(tasks.dueAt, dt), and(eq(tasks.dueAt, dt), tie));
  }
  const col = TASK_SORT_COLS[cursor.sortBy];
  const val = cursor.sortBy === 'priority' ? Number(cursor.value) : cursor.sortBy === 'createdAt' ? new Date(String(cursor.value)) : String(cursor.value);
  return or(isAsc ? gt(col, val) : lt(col, val), and(eq(col, val), tie));
}

function buildTaskOrderBy(sortBy: TaskSortBy, sortOrder: TaskSortOrder): SQL[] {
  const isAsc = sortOrder === 'asc';
  const tie = isAsc ? asc(tasks.id) : desc(tasks.id);
  if (sortBy === 'dueAt') return [isAsc ? sql`${tasks.dueAt} ASC NULLS LAST` : sql`${tasks.dueAt} DESC NULLS LAST`, tie];
  return [isAsc ? asc(TASK_SORT_COLS[sortBy]) : desc(TASK_SORT_COLS[sortBy]), tie];
}

function buildSearchCond(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const pattern = `%${escapeLikePattern(q)}%`;
  return or(ilike(tasks.title, pattern), ilike(tasks.description, pattern));
}

function buildVisibleTaskFilters(db: DbExecutor, actor: AuthActor, params: ListVisibleTasksParams): SQL {
  return and(...compactSql([
    visibleTaskSqlCondition(db, actor), boardNotPurgedSql(db),
    params.boardId && eq(tasks.boardId, params.boardId),
    params.columnId && eq(tasks.columnId, params.columnId),
    params.assigneeId && exists(db.select({ one: sql`1` }).from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, params.assigneeId)))),
    params.departmentId && assignedDepartmentExistsSql(db, [params.departmentId]),
    params.priority !== undefined && eq(tasks.priority, params.priority),
    buildSearchCond(params.q),
    params.dueStatus && buildDueStatusCondition(db, params.dueStatus, params.now),
    params.deadlineStatus && buildDeadlineStatusCondition(db, params.deadlineStatus, params.now),
    buildDateWindowCondition(params.from, params.to),
    params.cursor && buildTaskCursorCondition(params.cursor),
  ])) ?? sql`true`;
}

function buildMyAssignedCondition(db: DbExecutor, actor: AuthActor): SQL {
  const direct = exists(db.select({ one: sql`1` }).from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, actor.id))));
  const deptIds = actor.departmentIds ?? [];
  return deptIds.length === 0 ? direct : (or(direct, assignedDepartmentExistsSql(db, deptIds)) ?? direct);
}

function buildMyTasksFilters(db: DbExecutor, actor: AuthActor, params: ListMyTasksParams): SQL {
  const tie = params.cursor ? or(lt(tasks.priority, params.cursor.priority), and(eq(tasks.priority, params.cursor.priority), gt(tasks.id, params.cursor.id))) : undefined;
  const cursorCond = params.cursor ? (params.cursor.dueAt === null ? and(isNull(tasks.dueAt), tie) : or(isNull(tasks.dueAt), gt(tasks.dueAt, params.cursor.dueAt), and(eq(tasks.dueAt, params.cursor.dueAt), tie))) : undefined;
  return and(...compactSql([
    isNull(tasks.deletedAt), isNull(tasks.purgedAt), boardNotPurgedSql(db), buildMyAssignedCondition(db, actor),
    params.boardId && eq(tasks.boardId, params.boardId),
    params.departmentId && assignedDepartmentExistsSql(db, [params.departmentId]),
    params.priority !== undefined && eq(tasks.priority, params.priority),
    buildSearchCond(params.q),
    !params.includeDone && notDoneColumnSqlCondition(db),
    cursorCond,
  ])) ?? sql`true`;
}

export class DrizzleTasksRepository implements TasksRepository {
  private readonly deliverablesStore: TaskDeliverablesPersistence;

  constructor(private readonly db: DbExecutor) {
    this.deliverablesStore = {
      upsertTaskAssigneeAcceptance: async (p, tx) => { await tx.insert(taskAssignees).values({ taskId: p.taskId, userId: p.userId, acceptedAt: p.acceptedAt, createdAt: p.now }).onConflictDoUpdate({ target: [taskAssignees.taskId, taskAssignees.userId], set: { acceptedAt: p.acceptedAt } }); },
      countDeliverablesForTask: async (taskId, tx) => Number((await tx.select({ total: count() }).from(taskDeliverables).where(eq(taskDeliverables.taskId, taskId)))[0]?.total ?? 0),
      insertDeliverable: async (p, tx) => (await tx.insert(taskDeliverables).values({ taskId: p.taskId, title: p.title, url: p.url, submittedBy: p.submittedBy, createdAt: p.now }).returning({ id: taskDeliverables.id }))[0]!.id,
      deleteDeliverable: async (p, tx) => (await tx.delete(taskDeliverables).where(and(eq(taskDeliverables.id, p.deliverableId), eq(taskDeliverables.taskId, p.taskId))).returning({ id: taskDeliverables.id })).length > 0,
      bumpTaskVersion: async (p, tx) => (await tx.update(tasks).set({ version: sql`${tasks.version} + 1`, updatedAt: p.now }).where(and(eq(tasks.id, p.taskId), isNull(tasks.deletedAt))).returning({ id: tasks.id })).length > 0,
      insertTaskEvent: (p, tx) => this.insertTaskEvent(p, tx),
      loadHydratedTask: async (taskId, tx) => (await this.hydrateTasks(tx, await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)))[0]!,
    };
  }

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
    return rows[0] ? ((await this.hydrateTasks(executor, rows))[0] ?? null) : null;
  }

  async createTaskWithEvent(input: CreateTaskRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    const target = await this.resolveTargetBoardAndColumn(input, tx);
    await this.assertAssignableUsers({ nextUserIds: input.assigneeIds }, tx);
    await this.assertValidDepartments(input.departmentIds, tx);
    const maxPosRows = await tx.select({ maxPos: sql<string | null>`max(${tasks.position})` }).from(tasks).where(and(eq(tasks.columnId, target.columnId), isNull(tasks.deletedAt)));
    const [created] = await tx.insert(tasks).values({
      boardId: target.boardId, columnId: target.columnId, title: input.title, description: input.description ?? null,
      startAt: input.startAt ?? null, dueAt: input.dueAt ?? null, priority: input.priority,
      position: String(Number(maxPosRows[0]?.maxPos ?? 0) + 1000), isHidden: input.isHidden, version: 1,
      createdBy: input.actorId, createdAt: input.now, updatedAt: input.now,
    }).returning();
    if (!created) throw new Error('Failed to insert task');
    if (input.assigneeIds.length > 0) await tx.insert(taskAssignees).values(input.assigneeIds.map((userId) => ({ taskId: created.id, userId, createdAt: input.now })));
    if (input.departmentIds.length > 0) await tx.insert(taskDepartments).values(input.departmentIds.map((departmentId) => ({ taskId: created.id, departmentId, createdAt: input.now })));
    const eventId = await this.insertTaskEvent({ taskId: created.id, boardId: target.boardId, actorId: input.actorId, type: 'task.created', changes: buildCreateTaskEventChanges(input, target.columnId), now: input.now }, tx);
    return { task: (await this.hydrateTasks(tx, [created]))[0]!, eventId };
  }

  updateTaskWithEvent(input: UpdateTaskRepoParams, tx: TransactionContext) {
    return this.mutateTaskWithEvent({ id: input.id, boardId: input.boardId, actorId: input.actorId, expectedVersion: input.version, patch: buildTaskUpdatePatch(input), type: 'task.updated', changes: { ...input.changes }, now: input.now }, tx);
  }

  moveTaskWithEvent(input: MoveTaskRepoParams, tx: TransactionContext): Promise<TaskOptionalEventMutationResult> {
    return executeMoveTaskWithEvent(input, tx, {
      lockDestinationColumn: (boardId, colId, txn) => this.lockColumnForBoard(boardId, colId, txn),
      loadColumnSiblings: (colId, excludeId, txn) => this.loadMoveSiblings(colId, excludeId, txn),
      applySiblingRebalance: (updates, txn) => this.applySiblingPositions(updates, txn),
      persistMovedTaskAndEvent: (p, txn) => this.mutateTaskWithEvent({ id: p.id, boardId: p.boardId, actorId: p.actorId, expectedVersion: p.expectedVersion, patch: { columnId: p.toColumnId, position: String(p.toPosition) }, type: 'task.moved', changes: { column_id: { from: p.fromColumnId, to: p.toColumnId }, position: { from: p.fromPosition, to: p.toPosition } }, now: p.now }, txn),
    });
  }

  async replaceAssigneesWithEvent(input: ReplaceAssigneesRepoParams, tx: TransactionContext): Promise<TaskMutationResult> {
    const diff = buildAssigneesDiffChanges(input);
    if (diff.assigneesChanged) await this.assertAssignableUsers({ nextUserIds: input.nextAssigneeIds, preservedUserIds: input.currentAssigneeIds }, tx);
    if (diff.departmentsChanged) await this.assertValidDepartments(input.nextDepartmentIds, tx);
    return this.mutateTaskWithEvent({ id: input.id, boardId: input.boardId, actorId: input.actorId, expectedVersion: input.expectedVersion, patch: {}, type: 'task.assignees_changed', changes: diff.changes, now: input.now, afterUpdate: () => this.syncTaskAssignments(input, diff, tx) }, tx);
  }

  softDeleteTaskWithEvent(input: SoftDeleteTaskRepoParams, tx: TransactionContext) {
    return this.mutateTaskWithEvent({ id: input.id, boardId: input.boardId, actorId: input.actorId, expectedVersion: input.version, patch: { deletedAt: input.now }, type: 'task.deleted', changes: { deleted_at: { from: null, to: input.now.toISOString() } }, now: input.now }, tx);
  }

  updateTaskHiddenWithEvent(input: UpdateTaskHiddenRepoParams, tx: TransactionContext) {
    return this.mutateTaskWithEvent({ id: input.id, boardId: input.boardId, actorId: input.actorId, expectedVersion: input.expectedVersion, patch: { isHidden: input.nextIsHidden }, type: 'task.hidden_changed', changes: { is_hidden: { from: input.currentIsHidden, to: input.nextIsHidden } }, now: input.now }, tx);
  }

  setAcceptanceWithEvent = (input: SetTaskAcceptanceRepoParams, tx: TransactionContext) => executeSetAcceptanceWithEvent(input, tx, this.deliverablesStore);
  addDeliverableWithEvent = (input: AddTaskDeliverableRepoParams, tx: TransactionContext) => executeAddDeliverableWithEvent(input, tx, this.deliverablesStore);
  removeDeliverableWithEvent = (input: RemoveTaskDeliverableRepoParams, tx: TransactionContext) => executeRemoveDeliverableWithEvent(input, tx, this.deliverablesStore);

  private async mutateTaskWithEvent(p: { readonly id: string; readonly boardId: string; readonly actorId: string; readonly expectedVersion?: number; readonly patch: Record<string, unknown>; readonly type: string; readonly changes: Record<string, unknown>; readonly now: Date; readonly afterUpdate?: () => Promise<void> }, tx: TransactionContext): Promise<TaskMutationResult> {
    const cond = p.expectedVersion !== undefined ? and(eq(tasks.id, p.id), eq(tasks.version, p.expectedVersion), isNull(tasks.deletedAt)) : and(eq(tasks.id, p.id), isNull(tasks.deletedAt));
    const [updated] = await tx.update(tasks).set({ ...p.patch, version: sql`${tasks.version} + 1`, updatedAt: p.now }).where(cond).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    if (p.afterUpdate) await p.afterUpdate();
    const eventId = await this.insertTaskEvent({ taskId: p.id, boardId: p.boardId, actorId: p.actorId, type: p.type, changes: p.changes, now: p.now }, tx);
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId };
  }

  private async resolveTargetBoardAndColumn(input: CreateTaskRepoParams, tx: TransactionContext): Promise<{ boardId: string; columnId: string }> {
    if (input.boardId && input.columnId) {
      const boardRows = await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).limit(1);
      if (!boardRows[0]) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      await this.lockColumnForBoard(input.boardId, input.columnId, tx);
      return { boardId: input.boardId, columnId: input.columnId };
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('beam_default_workspace'))`);
    const existing = await tx.select({ id: boards.id }).from(boards)
      .where(and(eq(boards.name, DEFAULT_WORKSPACE_BOARD_NAME), isNull(boards.archivedAt), isNull(boards.purgedAt), exists(tx.select({ one: sql`1` }).from(columns).where(eq(columns.boardId, boards.id)))))
      .orderBy(asc(boards.createdAt), asc(boards.id)).for('update').limit(1);
    if (existing[0]) {
      const [firstCol] = await tx.select({ id: columns.id }).from(columns).where(eq(columns.boardId, existing[0].id)).orderBy(asc(columns.orderIndex), asc(columns.id)).limit(1);
      return { boardId: existing[0].id, columnId: firstCol!.id };
    }
    const [board] = await tx.insert(boards).values({ name: DEFAULT_WORKSPACE_BOARD_NAME, departmentId: null, createdBy: input.actorId, createdAt: input.now, updatedAt: input.now }).returning({ id: boards.id });
    const cols = await tx.insert(columns).values([
      { boardId: board!.id, name: 'Đang thực hiện', orderIndex: 0, createdAt: input.now, updatedAt: input.now },
      { boardId: board!.id, name: 'Done', orderIndex: 1, createdAt: input.now, updatedAt: input.now },
    ]).returning({ id: columns.id, orderIndex: columns.orderIndex });
    return { boardId: board!.id, columnId: cols.find((c) => c.orderIndex === 0)!.id };
  }

  private async syncTaskAssignments(input: ReplaceAssigneesRepoParams, diff: { readonly assigneesChanged: boolean; readonly departmentsChanged: boolean }, tx: TransactionContext): Promise<void> {
    if (diff.assigneesChanged) {
      const { toRemove, toAdd } = computeAssigneeSyncPlan(input.currentAssigneeIds, input.nextAssigneeIds);
      if (toRemove.length > 0) await tx.delete(taskAssignees).where(and(eq(taskAssignees.taskId, input.id), inArray(taskAssignees.userId, toRemove)));
      if (toAdd.length > 0) await tx.insert(taskAssignees).values(toAdd.map((userId) => ({ taskId: input.id, userId, createdAt: input.now }))).onConflictDoNothing();
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

  private async loadMoveSiblings(columnId: string, excludeTaskId: string, tx: TransactionContext): Promise<RawMoveSibling[]> {
    const rows = await tx.select({ id: tasks.id, position: tasks.position, isHidden: tasks.isHidden, createdBy: tasks.createdBy }).from(tasks).where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), ne(tasks.id, excludeTaskId))).orderBy(asc(tasks.position), asc(tasks.id));
    if (rows.length === 0) return [];
    const taskIds = rows.map((r) => r.id);
    const [assignRows, deptRows] = await Promise.all([
      tx.select({ taskId: taskAssignees.taskId, value: taskAssignees.userId }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
      tx.select({ taskId: taskDepartments.taskId, value: taskDepartments.departmentId }).from(taskDepartments).where(inArray(taskDepartments.taskId, taskIds)),
    ]);
    return assembleMoveSiblings({ rows, assignRows, deptRows });
  }

  private async applySiblingPositions(updates: ReadonlyArray<{ readonly id: string; readonly position: number }>, tx: TransactionContext): Promise<void> {
    for (const u of updates) await tx.update(tasks).set({ position: String(u.position) }).where(and(eq(tasks.id, u.id), isNull(tasks.deletedAt)));
  }

  private async assertAssignableUsers(params: { readonly nextUserIds: readonly string[]; readonly preservedUserIds?: readonly string[] }, tx: TransactionContext): Promise<void> {
    if (params.nextUserIds.length === 0) return;
    const rows = await tx.select({ id: profiles.id, isActive: profiles.isActive }).from(profiles).where(inArray(profiles.id, [...params.nextUserIds]));
    const preservedSet = new Set(params.preservedUserIds ?? []);
    if (rows.length !== params.nextUserIds.length || rows.some((row) => !row.isActive && !preservedSet.has(row.id))) {
      throw badRequest('errors.invalidAssigneeIds', {}, 'INVALID_ASSIGNEE_IDS');
    }
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
    const [assigneeRows, departmentRows, deliverableRows, commentCountRows] = await Promise.all([
      executor.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, acceptedAt: taskAssignees.acceptedAt }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
      executor.select({ taskId: taskDepartments.taskId, id: departments.id, name: departments.name }).from(taskDepartments).innerJoin(departments, eq(taskDepartments.departmentId, departments.id)).where(inArray(taskDepartments.taskId, taskIds)).orderBy(asc(departments.name), asc(departments.id)),
      executor.select({ id: taskDeliverables.id, taskId: taskDeliverables.taskId, title: taskDeliverables.title, url: taskDeliverables.url, submittedBy: taskDeliverables.submittedBy, createdAt: taskDeliverables.createdAt }).from(taskDeliverables).where(inArray(taskDeliverables.taskId, taskIds)).orderBy(desc(taskDeliverables.createdAt), desc(taskDeliverables.id)),
      executor.select({ taskId: comments.taskId, total: count() }).from(comments).where(inArray(comments.taskId, taskIds)).groupBy(comments.taskId),
    ]);
    const userIds = Array.from(new Set([...taskRows.map((r) => r.createdBy), ...assigneeRows.map((a) => a.userId), ...deliverableRows.map((d) => d.submittedBy)]));
    return assembleTaskRecords({ taskRows, assigneeRows, departmentRows, deliverableRows, commentCountRows, userMap: await this.loadUserSummaries(executor, userIds) });
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
