import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { boards, columns, comments, departments, memberDepartments, profiles, taskAssignees, taskDeliverables, taskDepartments, taskEvents, tasks } from '@db/schema';
import { conflict } from '@/lib/errors';
import { dedupeSortedUuids } from '@/lib/tasks';
import { assembleTaskRecords, buildUserSummariesMap, computeAssigneeSyncPlan, type RawTaskRow, taskAccessSqlCondition, type TaskMemberSummaryRecord, type TaskRecord } from '@/server/modules/tasks';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import type { ApplyRevertRepoParams, ListBoardTrashRepoParams, ListTaskEventsRepoParams, RevertColumnLookup, RevertResolvedColumn, RevertResolvedTargets, RevertTargetIntent, TaskEventContext, TaskEventRecord, TaskEventsRepository } from './types';

function buildEventsListWhere(params: ListTaskEventsRepoParams): SQL {
  if (!params.cursor) return eq(taskEvents.taskId, params.taskId);
  const { createdAt, id } = params.cursor;
  return and(
    eq(taskEvents.taskId, params.taskId),
    or(lt(taskEvents.createdAt, createdAt), and(eq(taskEvents.createdAt, createdAt), lt(taskEvents.id, id))),
  )!;
}

function buildBoardTrashWhere(db: DbExecutor, params: ListBoardTrashRepoParams): SQL {
  const filters: SQL[] = [
    eq(tasks.boardId, params.boardId),
    isNotNull(tasks.deletedAt),
    isNull(tasks.purgedAt),
    taskAccessSqlCondition(db, params.actor),
  ];
  if (params.cursor) {
    const { deletedAt, id } = params.cursor;
    filters.push(or(lt(tasks.deletedAt, deletedAt), and(eq(tasks.deletedAt, deletedAt), lt(tasks.id, id)))!);
  }
  return and(...filters)!;
}

async function computeAppendPosition(columnId: string, excludeTaskId: string, tx: TransactionContext): Promise<number> {
  const [row] = await tx
    .select({ maxPos: sql<string | null>`max(${tasks.position})` })
    .from(tasks)
    .where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), isNull(tasks.purgedAt), ne(tasks.id, excludeTaskId)));
  return Number(row?.maxPos ?? 0) + 1000;
}

async function resolveColumnTarget(
  boardId: string,
  taskId: string,
  lookup: RevertColumnLookup,
  tx: TransactionContext,
): Promise<RevertResolvedColumn> {
  if (lookup.desiredColumnId) {
    const existing = await tx.select({ id: columns.id }).from(columns)
      .where(and(eq(columns.id, lookup.desiredColumnId), eq(columns.boardId, boardId)))
      .for('update').limit(1);
    if (existing[0]) {
      const position = lookup.desiredPosition ?? (await computeAppendPosition(existing[0].id, taskId, tx));
      return { columnId: existing[0].id, position };
    }
  }
  await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, boardId)).for('update').limit(1);
  const [firstCol] = await tx.select({ id: columns.id }).from(columns)
    .where(eq(columns.boardId, boardId)).orderBy(asc(columns.orderIndex), asc(columns.id)).for('update').limit(1);
  if (!firstCol) throw conflict('errors.boardHasNoColumns', {}, 'BOARD_HAS_NO_COLUMNS');
  return { columnId: firstCol.id, position: await computeAppendPosition(firstCol.id, taskId, tx) };
}

async function filterNonPurgedProfileIds(ids: readonly string[], tx: TransactionContext): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: profiles.id }).from(profiles)
    .where(and(inArray(profiles.id, [...ids]), isNull(profiles.purgedAt)));
  return dedupeSortedUuids(rows.map((r) => r.id));
}

async function filterExistingDepartmentIds(ids: readonly string[], tx: TransactionContext): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: departments.id }).from(departments).where(inArray(departments.id, [...ids]));
  return dedupeSortedUuids(rows.map((r) => r.id));
}

export class DrizzleTaskEventsRepository implements TaskEventsRepository {
  constructor(private readonly db: DbExecutor) {}

  async findTaskContext(taskId: string, tx?: TransactionContext): Promise<TaskEventContext | null> {
    const executor = tx ?? this.db;
    const base = executor.select().from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.purgedAt)));
    const taskRows = tx ? await base.for('update').limit(1) : await base.limit(1);
    const taskRow = taskRows[0];
    if (!taskRow) return null;
    const [boardRow] = await executor.select({ archivedAt: boards.archivedAt }).from(boards)
      .where(and(eq(boards.id, taskRow.boardId), isNull(boards.purgedAt))).limit(1);
    if (!boardRow) return null;
    const hydrated = await this.hydrateTasks(executor, [taskRow]);
    return hydrated[0] ? { task: hydrated[0], boardArchivedAt: boardRow.archivedAt } : null;
  }

  async listByTaskId(params: ListTaskEventsRepoParams): Promise<{ readonly rows: TaskEventRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db.select().from(taskEvents).where(buildEventsListWhere(params))
      .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    return { rows: await this.hydrateEvents(this.db, pageRows), hasMore };
  }

  async findEventByIdForTask(
    params: { readonly taskId: string; readonly eventId: string },
    tx: TransactionContext,
  ): Promise<TaskEventRecord | null> {
    const rows = await tx.select().from(taskEvents)
      .where(and(eq(taskEvents.id, params.eventId), eq(taskEvents.taskId, params.taskId))).limit(1);
    if (!rows[0]) return null;
    return (await this.hydrateEvents(tx, rows))[0] ?? null;
  }

  async resolveRevertTargets(
    params: { readonly boardId: string; readonly taskId: string; readonly intent: RevertTargetIntent },
    tx: TransactionContext,
  ): Promise<RevertResolvedTargets> {
    const [column, validAssigneeIds, validDepartmentIds] = await Promise.all([
      params.intent.columnLookup ? resolveColumnTarget(params.boardId, params.taskId, params.intent.columnLookup, tx) : Promise.resolve(undefined),
      params.intent.desiredAssigneeIds !== undefined ? filterNonPurgedProfileIds(params.intent.desiredAssigneeIds, tx) : Promise.resolve(undefined),
      params.intent.desiredDepartmentIds !== undefined ? filterExistingDepartmentIds(params.intent.desiredDepartmentIds, tx) : Promise.resolve(undefined),
    ]);
    return { column, validAssigneeIds, validDepartmentIds };
  }

  async applyRevertAndInsertEvent(
    params: ApplyRevertRepoParams,
    tx: TransactionContext,
  ): Promise<{ readonly task: TaskRecord; readonly eventId: string }> {
    const [updated] = await tx.update(tasks).set({ ...params.plan.taskPatch, version: sql`${tasks.version} + 1`, updatedAt: params.now })
      .where(and(eq(tasks.id, params.taskId), eq(tasks.version, params.expectedVersion), isNull(tasks.purgedAt))).returning();
    if (!updated) throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
    await this.syncRevertedAssignments(params, tx);
    const [evt] = await tx.insert(taskEvents).values({
      taskId: params.taskId, boardId: params.boardId, actorId: params.actorId, type: params.plan.compensatingType,
      changes: params.plan.compensatingChanges, revertsEventId: params.revertsEventId, forced: params.forced, createdAt: params.now,
    }).returning({ id: taskEvents.id });
    if (!evt) throw new Error('Failed to record compensating task event');
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId: evt.id };
  }

  async boardExists(boardId: string): Promise<boolean> {
    const rows = await this.db.select({ id: boards.id }).from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.purgedAt))).limit(1);
    return rows.length > 0;
  }

  async listBoardTrash(params: ListBoardTrashRepoParams): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db.select().from(tasks).where(buildBoardTrashWhere(this.db, params))
      .orderBy(desc(tasks.deletedAt), desc(tasks.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    return { rows: await this.hydrateTasks(this.db, pageRows), hasMore };
  }

  private async syncRevertedAssignments(params: ApplyRevertRepoParams, tx: TransactionContext): Promise<void> {
    if (params.plan.replaceAssigneeIds !== undefined) {
      const existingRows = await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, params.taskId));
      const { toRemove, toAdd } = computeAssigneeSyncPlan(existingRows.map((row) => row.userId), params.plan.replaceAssigneeIds);
      if (toRemove.length > 0) {
        await tx.delete(taskAssignees).where(and(eq(taskAssignees.taskId, params.taskId), inArray(taskAssignees.userId, toRemove)));
      }
      if (toAdd.length > 0) {
        await tx.insert(taskAssignees).values(toAdd.map((userId) => ({ taskId: params.taskId, userId, acceptedAt: null, createdAt: params.now })));
      }
    }
    if (params.plan.replaceDepartmentIds !== undefined) {
      await tx.delete(taskDepartments).where(eq(taskDepartments.taskId, params.taskId));
      if (params.plan.replaceDepartmentIds.length > 0) {
        await tx.insert(taskDepartments).values(params.plan.replaceDepartmentIds.map((departmentId) => ({ taskId: params.taskId, departmentId, createdAt: params.now })));
      }
    }
  }

  private async hydrateEvents(executor: DbExecutor, rows: ReadonlyArray<typeof taskEvents.$inferSelect>): Promise<TaskEventRecord[]> {
    if (rows.length === 0) return [];
    const userMap = await this.loadUserSummaries(executor, Array.from(new Set(rows.map((r) => r.actorId))));
    return rows.map((row) => {
      const actor = userMap.get(row.actorId);
      if (!actor) throw new Error('Missing event actor profile');
      return { ...row, actor };
    });
  }

  private async hydrateTasks(executor: DbExecutor, taskRows: readonly RawTaskRow[]): Promise<TaskRecord[]> {
    if (taskRows.length === 0) return [];
    const taskIds = taskRows.map((row) => row.id);
    const [assigneeRows, departmentRows, deliverableRows, commentCountRows] = await Promise.all([
      executor.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, acceptedAt: taskAssignees.acceptedAt }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
      executor.select({ taskId: taskDepartments.taskId, id: departments.id, name: departments.name }).from(taskDepartments)
        .innerJoin(departments, eq(taskDepartments.departmentId, departments.id)).where(inArray(taskDepartments.taskId, taskIds)).orderBy(asc(departments.name), asc(departments.id)),
      executor.select({ id: taskDeliverables.id, taskId: taskDeliverables.taskId, title: taskDeliverables.title, url: taskDeliverables.url, submittedBy: taskDeliverables.submittedBy, createdAt: taskDeliverables.createdAt })
        .from(taskDeliverables).where(inArray(taskDeliverables.taskId, taskIds)).orderBy(desc(taskDeliverables.createdAt), desc(taskDeliverables.id)),
      executor.select({ taskId: comments.taskId, total: count() }).from(comments).where(inArray(comments.taskId, taskIds)).groupBy(comments.taskId),
    ]);
    const userIds = Array.from(new Set([...taskRows.map((r) => r.createdBy), ...assigneeRows.map((a) => a.userId), ...deliverableRows.map((d) => d.submittedBy)]));
    const userMap = await this.loadUserSummaries(executor, userIds);
    return assembleTaskRecords({ taskRows, assigneeRows, departmentRows, deliverableRows, commentCountRows, userMap });
  }

  private async loadUserSummaries(executor: DbExecutor, userIds: readonly string[]): Promise<Map<string, TaskMemberSummaryRecord>> {
    if (userIds.length === 0) return new Map();
    const [profileRows, deptRows] = await Promise.all([
      executor.select({ id: profiles.id, fullName: profiles.fullName, avatarUpdatedAt: profiles.avatarUpdatedAt, isActive: profiles.isActive, leftAt: profiles.leftAt })
        .from(profiles).where(inArray(profiles.id, [...userIds])),
      executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name }).from(memberDepartments)
        .innerJoin(departments, eq(memberDepartments.departmentId, departments.id)).where(inArray(memberDepartments.userId, [...userIds])).orderBy(asc(departments.name), asc(departments.id)),
    ]);
    return buildUserSummariesMap(profileRows, deptRows);
  }
}
