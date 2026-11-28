import { asc, eq, inArray } from 'drizzle-orm';
import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import {
  departments,
  memberDepartments,
  profiles,
  schema,
  type AppSchema,
} from '@db/schema';

export type Database = NodePgDatabase<AppSchema>;
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, AppSchema>;

export interface DatabaseClient {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

export interface RawUserSummaryProfileRow {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
}

export interface RawUserSummaryDepartmentRow {
  readonly userId: string;
  readonly departmentId: string;
  readonly departmentName: string;
}

export function isTransactionExecutor(executor: DbExecutor): boolean {
  return (
    'rollback' in executor &&
    typeof (executor as { rollback?: unknown }).rollback === 'function'
  );
}

/**
 * Executes queries concurrently against a Pool-backed `db`, but strictly
 * sequentially against a transaction `tx` whose underlying pg PoolClient
 * deprecates overlapping client.query() calls in pg@8.23+.
 */
export async function runExecutorQueries<
  const T extends readonly (() => Promise<unknown>)[],
>(
  executor: DbExecutor,
  queries: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (isTransactionExecutor(executor)) {
    const results: unknown[] = [];
    for (const run of queries) {
      results.push(await run());
    }
    return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
  }
  return (await Promise.all(queries.map((run) => run()))) as {
    -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
  };
}

function selectSummaryProfiles(executor: DbExecutor, uniqueUserIds: string[]) {
  return executor
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      avatarUpdatedAt: profiles.avatarUpdatedAt,
      isActive: profiles.isActive,
      leftAt: profiles.leftAt,
    })
    .from(profiles)
    .where(inArray(profiles.id, uniqueUserIds));
}

function selectSummaryDepartments(executor: DbExecutor, uniqueUserIds: string[]) {
  return executor
    .select({
      userId: memberDepartments.userId,
      departmentId: departments.id,
      departmentName: departments.name,
    })
    .from(memberDepartments)
    .innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
    .where(inArray(memberDepartments.userId, uniqueUserIds))
    .orderBy(asc(departments.name), asc(departments.id));
}

export async function queryUserSummaryRows(
  executor: DbExecutor,
  userIds: readonly string[],
): Promise<
  readonly [
    readonly RawUserSummaryProfileRow[],
    readonly RawUserSummaryDepartmentRow[],
  ]
> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) {
    return [[], []];
  }
  return runExecutorQueries(executor, [
    () => selectSummaryProfiles(executor, uniqueUserIds),
    () => selectSummaryDepartments(executor, uniqueUserIds),
  ]);
}

export function createDbPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export function createDb(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = createDbPool(connectionString);
  const db = createDb(pool);
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
