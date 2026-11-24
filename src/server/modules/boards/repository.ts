import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { boards, columns, departments, memberDepartments, profiles, tasks } from '@db/schema';
import { notFound } from '@/lib/errors';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { assertColumnCanBeDeleted, assertColumnOrderMatches, type BoardListCursor } from './policy';

export interface BoardDepartmentSummaryRecord { readonly id: string; readonly name: string }
export interface BoardMemberSummaryRecord {
  readonly id: string;
  readonly fullName: string;
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
  readonly departmentId?: string;
  readonly includeArchived: boolean;
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
  const filters: SQL[] = [];
  if (!params.includeArchived) filters.push(isNull(boards.archivedAt));
  if (params.departmentId) filters.push(eq(boards.departmentId, params.departmentId));
  if (params.cursor) {
    const { createdAt, id } = params.cursor;
    const cond = or(lt(boards.createdAt, createdAt), and(eq(boards.createdAt, createdAt), lt(boards.id, id)));
    if (cond) filters.push(cond);
  }
  return filters.length > 0 ? and(...filters) : undefined;
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
    return { rows: await this.hydrateBoards(this.db, pageRows), hasMore };
  }

  async findBoardById(boardId: string, tx?: TransactionContext): Promise<BoardSummaryRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor.select().from(boards).where(eq(boards.id, boardId)).limit(1);
    if (!rows[0]) return null;
    return (await this.hydrateBoards(executor, rows))[0] ?? null;
  }

  async findColumnsByBoardId(boardId: string, tx?: TransactionContext): Promise<ColumnRecord[]> {
    const executor = tx ?? this.db;
    return executor.select().from(columns).where(eq(columns.boardId, boardId)).orderBy(asc(columns.orderIndex), asc(columns.id));
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
    const locked = await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, input.boardId)).for('update').limit(1);
    if (!locked[0]) return null;
    if (typeof input.departmentId === 'string') await this.assertDepartmentExists(input.departmentId, tx);
    const patch: Partial<typeof boards.$inferInsert> = { updatedAt: input.now };
    if (input.name !== undefined) patch.name = input.name;
    if (input.departmentId !== undefined) patch.departmentId = input.departmentId;
    if (input.unarchive === true) patch.archivedAt = null;
    const [updated] = await tx.update(boards).set(patch).where(eq(boards.id, input.boardId)).returning();
    if (!updated) return null;
    return (await this.hydrateBoards(tx, [updated]))[0] ?? null;
  }

  async archiveBoard(input: { readonly boardId: string; readonly now: Date }, tx: TransactionContext): Promise<{ readonly board: BoardSummaryRecord; readonly wasAlreadyArchived: boolean } | null> {
    const locked = await tx.select().from(boards).where(eq(boards.id, input.boardId)).for('update').limit(1);
    const existing = locked[0];
    if (!existing) return null;
    const wasAlreadyArchived = existing.archivedAt !== null;
    const [updated] = await tx
      .update(boards)
      .set({ archivedAt: existing.archivedAt ?? input.now, updatedAt: input.now })
      .where(eq(boards.id, input.boardId))
      .returning();
    if (!updated) return null;
    return { board: (await this.hydrateBoards(tx, [updated]))[0]!, wasAlreadyArchived };
  }

  async createColumn(input: { readonly boardId: string; readonly name: string; readonly orderIndex?: number; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord | null> {
    const locked = await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, input.boardId)).for('update').limit(1);
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
    const [updated] = await tx.update(columns).set({ name: input.name, updatedAt: input.now }).where(eq(columns.id, input.columnId)).returning();
    return updated ?? null;
  }

  async deleteColumnSafely(columnId: string, tx: TransactionContext): Promise<{ readonly id: string; readonly boardId: string } | null> {
    const locked = await tx.select({ id: columns.id, boardId: columns.boardId }).from(columns).where(eq(columns.id, columnId)).for('update').limit(1);
    const col = locked[0];
    if (!col) return null;
    const countRows = await tx.select({ value: count() }).from(tasks).where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt)));
    assertColumnCanBeDeleted(Number(countRows[0]?.value ?? 0));
    await tx.update(tasks).set({ columnId: null }).where(and(eq(tasks.columnId, columnId), isNotNull(tasks.deletedAt)));
    await tx.delete(columns).where(eq(columns.id, columnId));
    return col;
  }

  async reorderColumns(input: { readonly boardId: string; readonly columnIds: readonly string[]; readonly now: Date }, tx: TransactionContext): Promise<ColumnRecord[] | null> {
    const lockedBoard = await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, input.boardId)).for('update').limit(1);
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

  private async hydrateBoards(executor: DbExecutor, boardRows: readonly BoardRow[]): Promise<BoardSummaryRecord[]> {
    if (boardRows.length === 0) return [];
    const deptIds = Array.from(new Set(boardRows.map((b) => b.departmentId).filter((id): id is string => id !== null)));
    const creatorIds = Array.from(new Set(boardRows.map((b) => b.createdBy)));
    const [deptMap, userMap] = await Promise.all([this.loadDepartmentsByIds(executor, deptIds), this.loadUserSummaries(executor, creatorIds)]);
    return boardRows.map((row) => ({
      id: row.id,
      name: row.name,
      department: row.departmentId ? (deptMap.get(row.departmentId) ?? null) : null,
      archivedAt: row.archivedAt,
      createdBy: userMap.get(row.createdBy)!,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  private async loadDepartmentsByIds(executor: DbExecutor, deptIds: readonly string[]): Promise<Map<string, BoardDepartmentSummaryRecord>> {
    if (deptIds.length === 0) return new Map();
    const rows = await executor.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...deptIds]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async loadUserSummaries(executor: DbExecutor, userIds: readonly string[]): Promise<Map<string, BoardMemberSummaryRecord>> {
    const map = new Map<string, BoardMemberSummaryRecord>();
    if (userIds.length === 0) return map;
    const [profileRows, deptRows] = await Promise.all([
      executor.select({ id: profiles.id, fullName: profiles.fullName, isActive: profiles.isActive, leftAt: profiles.leftAt }).from(profiles).where(inArray(profiles.id, [...userIds])),
      executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name }).from(memberDepartments).innerJoin(departments, eq(memberDepartments.departmentId, departments.id)).where(inArray(memberDepartments.userId, [...userIds])).orderBy(asc(departments.name), asc(departments.id)),
    ]);
    const deptMap = new Map<string, BoardDepartmentSummaryRecord[]>();
    for (const row of deptRows) {
      const list = deptMap.get(row.userId);
      const dept = { id: row.id, name: row.name };
      if (list) list.push(dept);
      else deptMap.set(row.userId, [dept]);
    }
    for (const row of profileRows) map.set(row.id, { ...row, departments: deptMap.get(row.id) ?? [] });
    return map;
  }
}
