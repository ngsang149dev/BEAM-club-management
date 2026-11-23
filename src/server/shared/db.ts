import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { schema, type AppSchema } from '@db/schema';

export type Database = NodePgDatabase<AppSchema>;
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, AppSchema>;

export interface DatabaseClient {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
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
