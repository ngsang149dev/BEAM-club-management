import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parsePgConnection } from './db-cli.mjs';
import { formatSafeDbTarget, loadEnvFiles } from './load-env.mjs';

const PG_URI_REDACT_RE = /postgres(?:ql)?:\/\/[^\s'"]+/gi;

function extractSafeErrorDetail(error) {
  const rawMsg =
    error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  const errCode =
    error && typeof error === 'object' && 'code' in error && error.code
      ? String(error.code)
      : '';
  const combined = rawMsg || errCode || 'database error';
  return combined.replace(PG_URI_REDACT_RE, '[REDACTED_DB_URL]');
}

export function parseMigrateCliOptions(argv = process.argv.slice(2)) {
  const options = { useTest: false };

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--test') {
      options.useTest = true;
      continue;
    }
    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  return options;
}

export async function runDbMigrate(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (!options.connectionString) {
    loadEnvFiles(cwd);
  }

  const useTest = Boolean(options.useTest);
  const rawConnectionString =
    options.connectionString ??
    (useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL);
  const connectionString = rawConnectionString?.trim();

  if (!connectionString) {
    throw new Error(
      useTest ? 'TEST_DATABASE_URL is required.' : 'DATABASE_URL is required.',
    );
  }

  parsePgConnection(connectionString);
  const target = formatSafeDbTarget(connectionString);
  const writeOut = options.writeOut ?? console.log;

  const resolvedMigrationsDir =
    options.migrationsDir ?? path.resolve(cwd, 'db/migrations');
  const files = fs
    .readdirSync(resolvedMigrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = options.createClient
    ? options.createClient(connectionString)
    : new pg.Client({ connectionString });

  const applied = [];
  const skipped = [];

  try {
    await client.connect();

    const regRes = await client.query(
      "SELECT to_regclass('public.schema_migrations') AS table_oid",
    );
    const appliedVersions = new Set();

    if (regRes.rows[0]?.table_oid) {
      const existingRes = await client.query(
        'SELECT version FROM "public"."schema_migrations"',
      );
      for (const row of existingRes.rows) {
        if (typeof row.version === 'string' && row.version.length > 0) {
          appliedVersions.add(row.version);
        }
      }
    }

    for (const file of files) {
      const version = path.basename(file, '.sql');
      if (appliedVersions.has(version)) {
        skipped.push(file);
        continue;
      }

      const sql = fs.readFileSync(path.join(resolvedMigrationsDir, file), 'utf8');
      await client.query(sql);
      applied.push(file);
      appliedVersions.add(version);

      if (!options.quiet) {
        writeOut(`[db:migrate] Applied ${file} on ${target}`);
      }
    }

    if (!options.quiet) {
      writeOut(
        `[db:migrate] Completed on ${target} (applied=${applied.length}, skipped=${skipped.length})`,
      );
    }

    return { target, applied, skipped };
  } catch (error) {
    throw new Error(
      `Migration failed for ${target}: ${extractSafeErrorDetail(error)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    const cli = parseMigrateCliOptions();
    runDbMigrate(cli).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
