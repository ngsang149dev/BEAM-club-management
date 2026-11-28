import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buildDatabaseUrlWithName,
  parsePgConnection,
  VALID_DB_NAME_RE,
} from './db-cli.mjs';
import {
  formatSafeDbTarget,
  isLocalDatabaseUrl,
  loadEnvFiles,
} from './load-env.mjs';

const DB_CONNECT_TIMEOUT_MS = 3000;

async function tryConnectDirect(connectionString) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { connected: true };
  } catch (error) {
    const pgCode =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return { connected: false, code: pgCode, message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createLocalDatabaseIfMissing(connectionString, dbName) {
  if (!isLocalDatabaseUrl(connectionString)) {
    throw new Error(
      `Database "${dbName}" does not exist on non-local host (${formatSafeDbTarget(connectionString)}). Refusing to auto-create on remote server; please provision it manually.`,
    );
  }

  if (!VALID_DB_NAME_RE.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name "${dbName}".`);
  }

  const adminClient = new pg.Client({
    connectionString: buildDatabaseUrlWithName(connectionString, 'postgres'),
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
  });

  try {
    await adminClient.connect();
    const existing = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if ((existing.rowCount ?? 0) === 0) {
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(
        `Created local database "${dbName}" (${formatSafeDbTarget(connectionString)}).`,
      );
    } else {
      console.log(
        `Database "${dbName}" is ready (${formatSafeDbTarget(connectionString)}).`,
      );
    }
  } finally {
    await adminClient.end().catch(() => undefined);
  }
}

export async function ensureSingleDatabase(connectionString) {
  const target = formatSafeDbTarget(connectionString);
  const { database: dbName } = parsePgConnection(connectionString);
  const direct = await tryConnectDirect(connectionString);

  if (direct.connected) {
    console.log(`Database "${dbName}" is ready (${target}).`);
    return;
  }

  if (direct.code === '3D000') {
    await createLocalDatabaseIfMissing(connectionString, dbName);
    return;
  }

  throw new Error(
    `Cannot connect to PostgreSQL at ${target} (${direct.code || direct.message}).`,
  );
}

export async function ensureDatabases(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  loadEnvFiles(cwd);

  const devOnly = options.devOnly ?? process.argv.includes('--dev-only');
  const testOnly = options.testOnly ?? process.argv.includes('--test-only');

  const candidates = [];
  if (!testOnly && process.env.DATABASE_URL) {
    candidates.push(process.env.DATABASE_URL.trim());
  }
  if (!devOnly && process.env.TEST_DATABASE_URL) {
    candidates.push(process.env.TEST_DATABASE_URL.trim());
  }

  const targets = Array.from(new Set(candidates.filter(Boolean)));
  if (targets.length === 0) {
    throw new Error(
      'DATABASE_URL or TEST_DATABASE_URL must be configured before running db:ensure.',
    );
  }

  for (const url of targets) {
    await ensureSingleDatabase(url);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  ensureDatabases().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
