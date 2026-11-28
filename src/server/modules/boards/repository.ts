import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { boards, columns, departments, tasks } from '@db/schema';
import { notFound } from '@/lib/errors';
import { escapeLikePattern, notDoneColumnSqlCondition, visibleTaskSqlCondition } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import { type DbExecutor, runExecutorQueries } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { loadUserSummariesMap } from '@/server/shared/user-summaries';
import { assertColumnCanBeDeleted, assertColumnOrderMatches, type BoardListCursor } from './policy';

export interface BoardTaskCounts {
  readonly visibleTaskCount: number;
  readonly overdueTaskCount: number;
}
export interface BoardDepartmentSummaryRecord { readonly id: string; readonly name: string }
export interface BoardMemberSummaryRecord {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly departments: readonly BoardDepartmentSummaryRecord[];
}
export interface BoardSummaryRecord {
  readonly id: string;
  readonly name: string;
  readonly department: BoardDepartmentSummaryRecord | null;
  readonly archivedAt: Date | null;
  readonly createdBy: BoardMemberSummaryRecord;
  readonly visibleTaskCount?: number;
  readonly overdueTaskCount?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface ColumnRecord {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface ListBoardsRepoParams {
  readonly actor: AuthActor;
  readonly now: Date;
  readonly departmentId?: string;
  readonly includeArchived: boolean;
  readonly q?: string;
  readonly cursor?: BoardListCursor;
  readonly limit: number;
}
export interface CreateBoardRepoParams {
  readonly name: string;
  readonly departmentId: string | null;
  readonly createdBy: string;
  readonly defaultColumnNames: readonly string[];
  readonly now: Date;
}
export interface UpdateBoardRepoParams {
  readonly boardId: string;
  readonly name?: string;
  readonly departmentId?: string | null;
  readonly unarchive?: boolean;
  readonly now: Date;
}

export interface BoardsRepository {
  listBoards(params: ListBoardsRepoParams): Promise<{ readonly rows: BoardSummaryRecord[]; readonly hasMore: boolean }>;
  findBoardById(boardId: string, tx?: TransactionContext): Promise<BoardSummaryRecord | null>;
  countBoardTaskStats(params: { readonly boardIds: readonly string[]; readonly actor: AuthActor; readonly now: Date }, tx?: TransactionContext): Promise<Map<string, BoardTaskCounts>>;
  findColumnsByBoardId(boardId: string, tx?: TransactionContext): Promise<ColumnRecord[]>;
  createBoardWithDefaultColumns(input: CreateBoardRepoParams, tx: TransactionContext): Promise<{ readonly board: BoardSummaryRecord; readonly columns: ColumnRecord[] }>;
  updateBoard(input: UpdateBoardRepoParams, tx: TransactionContext): Promise<BoardSummaryRecord | null>;
  archiveBoard(input: { readonly boardId: string; readonly now: Date }, tx: TransactionContext): Promise<{ readonly board: BoardSummaryRecord; readonly wasAlreadyArchived: boolean } | null>;
  createColumn(input: { readonly boardId: string; readonly name: string; readonly orderIndex?: number; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord | null>;
  renameColumn(input: { readonly columnId: string; readonly name: string; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord | null>;
  deleteColumnSafely(columnId: string, tx: TransactionContext): Promise<{ readonly id: string; readonly boardId: string } | null>;
  reorderColumns(input: { readonly boardId: string; readonly columnIds: readonly string[]; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord[] | null>;
}

type BoardRow = typeof boards.$inferSelect;

function buildBoardListConditions(params: ListBoardsRepoParams): SQL | undefined {
  const filters: SQL[] = [isNull(boards.purgedAt)];
  if (!params.includeArchived) filters.push(isNull(boards.archivedAt));
  if (params.departmentId) filters.push(eq(boards.departmentId, params.departmentId));
  if (params.q) filters.push(ilike(boards.name, `%${escapeLikePattern(params.q)}%`));
  if (params.cursor) {
    const { createdAt, id } = params.cursor;
    const cond = or(lt(boards.createdAt, createdAt), and(eq(boards.createdAt, createdAt), lt(boards.id, id)));
    if (cond) filters.push(cond);
  }
  return and(...filters);
}

export class DrizzleBoardsRepository implements BoardsRepository {
  constructor(private readonly db: DbExecutor) {}

  async listBoards(params: ListBoardsRepoParams): Promise<{ readonly rows: BoardSummaryRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db
      .select()
      .from(boards)
      .where(buildBoardListConditions(params))
      .orderBy(desc(boards.createdAt), desc(boards.id))
      .limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    return { rows: await this.hydrateBoards(this.db, pageRows, { actor: params.actor, now: params.now }), hasMore };
  }

  async findBoardById(boardId: string, tx?: TransactionContext): Promise<BoardSummaryRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor.select().from(boards).where(and(eq(boards.id, boardId), isNull(boards.purgedAt))).limit(1);
    if (!rows[0]) return null;
    return (await this.hydrateBoards(executor, rows))[0] ?? null;
  }

  async countBoardTaskStats(params: { readonly boardIds: readonly string[]; readonly actor: AuthActor; readonly now: Date }, tx?: TransactionContext): Promise<Map<string, BoardTaskCounts>> {
    return this.queryBoardTaskStats(tx ?? this.db, params);
  }

  async findColumnsByBoardId(boardId: string, tx?: TransactionContext): Promise<ColumnRecord[]> {
    const executor = tx ?? this.db;
    return executor
      .select({
        id: columns.id,
        boardId: columns.boardId,
        name: columns.name,
        orderIndex: columns.orderIndex,
        createdAt: columns.createdAt,
        updatedAt: columns.updatedAt,
      })
      .from(columns)
      .innerJoin(boards, eq(columns.boardId, boards.id))
      .where(and(eq(columns.boardId, boardId), isNull(boards.purgedAt)))
      .orderBy(asc(columns.orderIndex), asc(columns.id));
  }

  async createBoardWithDefaultColumns(input: CreateBoardRepoParams, tx: TransactionContext): Promise<{ readonly board: BoardSummaryRecord; readonly columns: ColumnRecord[] }> {
    if (input.departmentId) await this.assertDepartmentExists(input.departmentId, tx);
    const [created] = await tx
      .insert(boards)
      .values({ name: input.name, departmentId: input.departmentId, createdBy: input.createdBy, createdAt: input.now, updatedAt: input.now })
      .returning();
    if (!created) throw new Error('Failed to create board');
    const createdColumns = await tx
      .insert(columns)
      .values(input.defaultColumnNames.map((name, orderIndex) => ({ boardId: created.id, name, orderIndex, createdAt: input.now, updatedAt: input.now })))
      .returning();
    createdColumns.sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
    return { board: (await this.hydrateBoards(tx, [created]))[0]!, columns: createdColumns };
  }

  async updateBoard(input: UpdateBoardRepoParams, tx: TransactionContext): Promise<BoardSummaryRecord | null> {
    const locked = await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).for('update').limit(1);
    if (!locked[0]) return null;
    if (typeof input.departmentId === 'string') await this.assertDepartmentExists(input.departmentId, tx);
    const patch: Partial<typeof boards.$inferInsert> = { updatedAt: input.now };
    if (input.name !== undefined) patch.name = input.name;
    if (input.departmentId !== undefined) patch.departmentId = input.departmentId;
    if (input.unarchive === true) patch.archivedAt = null;
    const [updated] = await tx.update(boards).set(patch).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).returning();
    if (!updated) return null;
    return (await this.hydrateBoards(tx, [updated]))[0] ?? null;
  }

  async archiveBoard(input: { readonly boardId: string; readonly now: Date }, tx: TransactionContext): Promise<{ readonly board: BoardSummaryRecord; readonly wasAlreadyArchived: boolean } | null> {
    const locked = await tx.select().from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).for('update').limit(1);
    const existing = locked[0];
    if (!existing) return null;
    const wasAlreadyArchived = existing.archivedAt !== null;
    const [updated] = await tx
      .update(boards)
      .set({ archivedAt: existing.archivedAt ?? input.now, updatedAt: input.now })
      .where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt)))
      .returning();
    if (!updated) return null;
    return { board: (await this.hydrateBoards(tx, [updated]))[0]!, wasAlreadyArchived };
  }

  async createColumn(input: { readonly boardId: string; readonly name: string; readonly orderIndex?: number; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord | null> {
    const locked = await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).for('update').limit(1);
    if (!locked[0]) return null;
    const existing = await tx.select().from(columns).where(eq(columns.boardId, input.boardId)).orderBy(asc(columns.orderIndex), asc(columns.id));
    const appendOrder = (existing.at(-1)?.orderIndex ?? -1) + 1;
    const insertAt = input.orderIndex !== undefined ? Math.min(input.orderIndex, existing.length) : appendOrder;
    const [created] = await tx.insert(columns).values({ boardId: input.boardId, name: input.name, orderIndex: insertAt, createdAt: input.now, updatedAt: input.now }).returning();
    if (!created) throw new Error('Failed to create column');
    if (input.orderIndex !== undefined && insertAt < existing.length) {
      const reordered = [...existing.slice(0, insertAt), created, ...existing.slice(insertAt)];
      await this.persistColumnOrder(reordered.map((c) => c.id), input.now, tx);
    }
    return created;
  }

  async renameColumn(input: { readonly columnId: string; readonly name: string; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord | null> {
    const locked = await tx.select({ id: columns.id }).from(columns).innerJoin(boards, eq(columns.boardId, boards.id)).where(and(eq(columns.id, input.columnId), isNull(boards.purgedAt))).for('update').limit(1);
    if (!locked[0]) return null;
    const [updated] = await tx.update(columns).set({ name: input.name, updatedAt: input.now }).where(eq(columns.id, input.columnId)).returning();
    return updated ?? null;
  }

  async deleteColumnSafely(columnId: string, tx: TransactionContext): Promise<{ readonly id: string; readonly boardId: string } | null> {
    const locked = await tx.select({ id: columns.id, boardId: columns.boardId }).from(columns).innerJoin(boards, eq(columns.boardId, boards.id)).where(and(eq(columns.id, columnId), isNull(boards.purgedAt))).for('update').limit(1);
    const col = locked[0];
    if (!col) return null;
    const countRows = await tx.select({ value: count() }).from(tasks).where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), isNull(tasks.purgedAt)));
    assertColumnCanBeDeleted(Number(countRows[0]?.value ?? 0));
    await tx.update(tasks).set({ columnId: null }).where(and(eq(tasks.columnId, columnId), isNotNull(tasks.deletedAt)));
    await tx.delete(columns).where(eq(columns.id, columnId));
    return col;
  }

  async reorderColumns(input: { readonly boardId: string; readonly columnIds: readonly string[]; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord[] | null> {
    const lockedBoard = await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).for('update').limit(1);
    if (!lockedBoard[0]) return null;
    const existing = await tx.select().from(columns).where(eq(columns.boardId, input.boardId)).for('update');
    assertColumnOrderMatches(existing.map((c) => c.id), input.columnIds);
    await this.persistColumnOrder(input.columnIds, input.now, tx);
    return this.findColumnsByBoardId(input.boardId, tx);
  }

  private async persistColumnOrder(orderedIds: readonly string[], now: Date, tx: TransactionContext): Promise<void> {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx.update(columns).set({ orderIndex: index, updatedAt: now }).where(eq(columns.id, orderedIds[index]!));
    }
  }

  private async assertDepartmentExists(departmentId: string, tx: TransactionContext): Promise<void> {
    const rows = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).limit(1);
    if (!rows[0]) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }

  private async queryBoardTaskStats(executor: DbExecutor, params: { readonly boardIds: readonly string[]; readonly actor: AuthActor; readonly now: Date }): Promise<Map<string, BoardTaskCounts>> {
    const map = new Map<string, BoardTaskCounts>();
    if (params.boardIds.length === 0) return map;
    const overdueFilter = and(isNotNull(tasks.dueAt), lt(tasks.dueAt, params.now), notDoneColumnSqlCondition(executor));
    const rows = await executor
      .select({
        boardId: tasks.boardId,
        visibleCount: count(),
        overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${overdueFilter})::int`,
      })
      .from(tasks)
      .where(and(inArray(tasks.boardId, [...params.boardIds]), visibleTaskSqlCondition(executor, params.actor)))
      .groupBy(tasks.boardId);
    for (const row of rows) {
      map.set(row.boardId, { visibleTaskCount: Number(row.visibleCount), overdueTaskCount: Number(row.overdueCount) });
    }
    return map;
  }

  private async hydrateBoards(executor: DbExecutor, boardRows: readonly BoardRow[], viewer?: { readonly actor: AuthActor; readonly now: Date }): Promise<BoardSummaryRecord[]> {
    if (boardRows.length === 0) return [];
    const deptIds = Array.from(new Set(boardRows.map((b) => b.departmentId).filter((id): id is string => id !== null)));
    const creatorIds = Array.from(new Set(boardRows.map((b) => b.createdBy)));
    const [deptMap, userMap, statsMap] = await runExecutorQueries(executor, [
      () => this.loadDepartmentsByIds(executor, deptIds),
      () => loadUserSummariesMap(executor, creatorIds),
      () => viewer ? this.queryBoardTaskStats(executor, { boardIds: boardRows.map((b) => b.id), actor: viewer.actor, now: viewer.now }) : Promise.resolve(new Map<string, BoardTaskCounts>()),
    ]);
    return boardRows.map((row) => {
      const stats = statsMap.get(row.id);
      return {
        id: row.id,
        name: row.name,
        department: row.departmentId ? (deptMap.get(row.departmentId) ?? null) : null,
        archivedAt: row.archivedAt,
        createdBy: userMap.get(row.createdBy)!,
        visibleTaskCount: stats?.visibleTaskCount ?? 0,
        overdueTaskCount: stats?.overdueTaskCount ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private async loadDepartmentsByIds(executor: DbExecutor, deptIds: readonly string[]): Promise<Map<string, BoardDepartmentSummaryRecord>> {
    if (deptIds.length === 0) return new Map();
    const rows = await executor.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...deptIds]));
    return new Map(rows.map((r) => [r.id, r]));
  }
}
