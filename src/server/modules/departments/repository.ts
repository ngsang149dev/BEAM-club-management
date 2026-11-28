import { and, asc, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { boards, departments, memberDepartments, profiles } from '@db/schema';
import { conflict } from '@/lib/errors';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { loadUserSummariesMap } from '@/server/shared/user-summaries';

export interface DepartmentLeadSummaryRecord {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly departments: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface DepartmentRecord {
  readonly id: string;
  readonly name: string;
  readonly lead: DepartmentLeadSummaryRecord | null;
  readonly memberCount: number;
  readonly boardCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DepartmentsRepository {
  listWithCounts(): Promise<DepartmentRecord[]>;
  findByIdWithCounts(
    id: string,
    tx?: TransactionContext,
  ): Promise<DepartmentRecord | null>;
  lockAndFindByIdWithCounts(
    id: string,
    tx: TransactionContext,
  ): Promise<DepartmentRecord | null>;
  isActiveLeadCandidate(userId: string, tx?: TransactionContext): Promise<boolean>;
  create(
    input: {
      readonly name: string;
      readonly leadUserId?: string | null;
      readonly now: Date;
    },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord>;
  rename(
    input: {
      readonly id: string;
      readonly name: string;
      readonly leadUserId?: string | null;
      readonly now: Date;
    },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord | null>;
  deleteById(id: string, tx?: TransactionContext): Promise<boolean>;
}

interface RawDepartmentCountRow {
  readonly id: string;
  readonly name: string;
  readonly leadUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly memberCount: number;
  readonly boardCount: number;
}

function extractPgErrorInfo(error: unknown): { readonly code?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return { code: candidate.code };
    current = candidate.cause;
  }
  return {};
}

function rethrowDepartmentWriteError(error: unknown): never {
  const pgErr = extractPgErrorInfo(error);
  if (pgErr.code === '23505') {
    throw conflict('errors.departmentNameExists', {}, 'DEPARTMENT_NAME_EXISTS');
  }
  if (pgErr.code === '23503') {
    throw conflict('errors.departmentInUse', { memberCount: 0, boardCount: 0 }, 'DEPARTMENT_IN_USE');
  }
  throw error;
}

export class DrizzleDepartmentsRepository implements DepartmentsRepository {
  constructor(private readonly db: DbExecutor) {}

  async listWithCounts(): Promise<DepartmentRecord[]> {
    return this.selectWithCounts(this.db);
  }

  async findByIdWithCounts(id: string, tx?: TransactionContext): Promise<DepartmentRecord | null> {
    const rows = await this.selectWithCounts(tx ?? this.db, id);
    return rows[0] ?? null;
  }

  async lockAndFindByIdWithCounts(id: string, tx: TransactionContext): Promise<DepartmentRecord | null> {
    const locked = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).for('update').limit(1);
    if (!locked[0]) return null;
    return this.findByIdWithCounts(id, tx);
  }

  async isActiveLeadCandidate(userId: string, tx?: TransactionContext): Promise<boolean> {
    const executor = tx ?? this.db;
    const cond = and(eq(profiles.id, userId), eq(profiles.isActive, true), isNull(profiles.purgedAt));
    const rows = tx
      ? await executor.select({ id: profiles.id }).from(profiles).where(cond).for('share').limit(1)
      : await executor.select({ id: profiles.id }).from(profiles).where(cond).limit(1);
    return rows.length > 0;
  }

  async create(
    input: { readonly name: string; readonly leadUserId?: string | null; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord> {
    const executor = tx ?? this.db;
    try {
      const [created] = await executor
        .insert(departments)
        .values({
          name: input.name,
          leadUserId: input.leadUserId ?? null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: departments.id });
      if (!created) throw new Error('Failed to create department');
      return (await this.findByIdWithCounts(created.id, executor as TransactionContext))!;
    } catch (error) {
      rethrowDepartmentWriteError(error);
    }
  }

  async rename(
    input: { readonly id: string; readonly name: string; readonly leadUserId?: string | null; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord | null> {
    const executor = tx ?? this.db;
    const patch: Partial<typeof departments.$inferInsert> = {
      name: input.name,
      updatedAt: input.now,
    };
    if (input.leadUserId !== undefined) {
      patch.leadUserId = input.leadUserId;
    }
    try {
      const rows = await executor.update(departments).set(patch).where(eq(departments.id, input.id)).returning({ id: departments.id });
      if (!rows[0]) return null;
      return this.findByIdWithCounts(input.id, executor as TransactionContext);
    } catch (error) {
      rethrowDepartmentWriteError(error);
    }
  }

  async deleteById(id: string, tx?: TransactionContext): Promise<boolean> {
    const executor = tx ?? this.db;
    try {
      const deleted = await executor.delete(departments).where(eq(departments.id, id)).returning({ id: departments.id });
      return deleted.length > 0;
    } catch (error) {
      rethrowDepartmentWriteError(error);
    }
  }

  private async selectWithCounts(executor: DbExecutor, filterId?: string): Promise<DepartmentRecord[]> {
    const memberCounts = executor
      .select({ departmentId: memberDepartments.departmentId, cnt: count().as('member_cnt') })
      .from(memberDepartments).groupBy(memberDepartments.departmentId).as('mc');
    const boardCounts = executor
      .select({ departmentId: boards.departmentId, cnt: count().as('board_cnt') })
      .from(boards).where(and(isNotNull(boards.departmentId), isNull(boards.purgedAt)))
      .groupBy(boards.departmentId).as('bc');
    const baseQuery = executor
      .select({
        id: departments.id,
        name: departments.name,
        leadUserId: departments.leadUserId,
        createdAt: departments.createdAt,
        updatedAt: departments.updatedAt,
        memberCount: sql<number>`coalesce(${memberCounts.cnt}, 0)::int`,
        boardCount: sql<number>`coalesce(${boardCounts.cnt}, 0)::int`,
      })
      .from(departments)
      .leftJoin(memberCounts, eq(departments.id, memberCounts.departmentId))
      .leftJoin(boardCounts, eq(departments.id, boardCounts.departmentId));
    const rawRows: RawDepartmentCountRow[] = filterId
      ? await baseQuery.where(eq(departments.id, filterId)).limit(1)
      : await baseQuery.orderBy(asc(departments.name), asc(departments.id));
    return this.hydrateLeads(executor, rawRows);
  }

  private async hydrateLeads(executor: DbExecutor, rows: readonly RawDepartmentCountRow[]): Promise<DepartmentRecord[]> {
    const leadIds = Array.from(new Set(rows.map((r) => r.leadUserId).filter((id): id is string => id !== null)));
    const leadMap = await loadUserSummariesMap(executor, leadIds);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      lead: row.leadUserId ? (leadMap.get(row.leadUserId) ?? null) : null,
      memberCount: row.memberCount,
      boardCount: row.boardCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
