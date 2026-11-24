import { asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import { boards, departments, memberDepartments } from '@db/schema';
import { conflict } from '@/lib/errors';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';

export interface DepartmentRecord {
  readonly id: string;
  readonly name: string;
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
  create(
    input: { readonly name: string; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord>;
  rename(
    input: { readonly id: string; readonly name: string; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord | null>;
  deleteById(id: string, tx?: TransactionContext): Promise<boolean>;
}

interface PgErrorInfo {
  readonly code?: string;
  readonly constraint?: string;
}

function extractPgErrorInfo(error: unknown): PgErrorInfo {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        constraint:
          typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
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
    throw conflict(
      'errors.departmentInUse',
      { memberCount: 0, boardCount: 0 },
      'DEPARTMENT_IN_USE',
    );
  }
  throw error;
}

export class DrizzleDepartmentsRepository implements DepartmentsRepository {
  constructor(private readonly db: DbExecutor) {}

  async listWithCounts(): Promise<DepartmentRecord[]> {
    return this.selectWithCounts(this.db);
  }

  async findByIdWithCounts(
    id: string,
    tx?: TransactionContext,
  ): Promise<DepartmentRecord | null> {
    const executor = tx ?? this.db;
    const rows = await this.selectWithCounts(executor, id);
    return rows[0] ?? null;
  }

  async lockAndFindByIdWithCounts(
    id: string,
    tx: TransactionContext,
  ): Promise<DepartmentRecord | null> {
    const locked = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, id))
      .for('update')
      .limit(1);
    if (!locked[0]) {
      return null;
    }
    return this.findByIdWithCounts(id, tx);
  }

  async create(
    input: { readonly name: string; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord> {
    const executor = tx ?? this.db;
    try {
      const rows = await executor
        .insert(departments)
        .values({
          name: input.name,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      const created = rows[0];
      if (!created) {
        throw new Error('Failed to create department');
      }
      return {
        id: created.id,
        name: created.name,
        memberCount: 0,
        boardCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    } catch (error) {
      rethrowDepartmentWriteError(error);
    }
  }

  async rename(
    input: { readonly id: string; readonly name: string; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<DepartmentRecord | null> {
    const executor = tx ?? this.db;
    try {
      const rows = await executor
        .update(departments)
        .set({
          name: input.name,
          updatedAt: input.now,
        })
        .where(eq(departments.id, input.id))
        .returning({ id: departments.id });
      if (!rows[0]) {
        return null;
      }
      return this.findByIdWithCounts(input.id, executor);
    } catch (error) {
      rethrowDepartmentWriteError(error);
    }
  }

  async deleteById(id: string, tx?: TransactionContext): Promise<boolean> {
    const executor = tx ?? this.db;
    try {
      const deleted = await executor
        .delete(departments)
        .where(eq(departments.id, id))
        .returning({ id: departments.id });
      return deleted.length > 0;
    } catch (error) {
      rethrowDepartmentWriteError(error);
    }
  }

  private async selectWithCounts(
    executor: DbExecutor,
    filterId?: string,
  ): Promise<DepartmentRecord[]> {
    const memberCounts = executor
      .select({
        departmentId: memberDepartments.departmentId,
        cnt: count().as('member_cnt'),
      })
      .from(memberDepartments)
      .groupBy(memberDepartments.departmentId)
      .as('mc');

    const boardCounts = executor
      .select({
        departmentId: boards.departmentId,
        cnt: count().as('board_cnt'),
      })
      .from(boards)
      .where(isNotNull(boards.departmentId))
      .groupBy(boards.departmentId)
      .as('bc');

    const baseQuery = executor
      .select({
        id: departments.id,
        name: departments.name,
        createdAt: departments.createdAt,
        updatedAt: departments.updatedAt,
        memberCount: sql<number>`coalesce(${memberCounts.cnt}, 0)::int`,
        boardCount: sql<number>`coalesce(${boardCounts.cnt}, 0)::int`,
      })
      .from(departments)
      .leftJoin(memberCounts, eq(departments.id, memberCounts.departmentId))
      .leftJoin(boardCounts, eq(departments.id, boardCounts.departmentId));

    if (filterId) {
      return baseQuery.where(eq(departments.id, filterId)).limit(1);
    }

    return baseQuery.orderBy(asc(departments.name), asc(departments.id));
  }
}
