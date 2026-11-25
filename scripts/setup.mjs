import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ensureDatabases } from './db-ensure.mjs';
import { getPostgresRemediationLines, runDoctor } from './doctor.mjs';
import { ensureLocalEnv } from './env-setup.mjs';
import {
  formatSafeDbTarget,
  isLocalDatabaseUrl,
  loadEnvFiles,
} from './load-env.mjs';

async function isPostgresReachable(connectionString) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 2500,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    return code === '3D000';
  } finally {
    await client.end().catch(() => undefined);
  }
}

function isDockerDaemonRunning() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForPostgres(connectionString, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPostgresReachable(connectionString)) {
      return true;
    }
    await delay(1000);
  }
  return false;
}

function runNodeScript(scriptRelativePath, args = []) {
  execFileSync(process.execPath, [scriptRelativePath, ...args], {
    stdio: 'inherit',
  });
}

async function ensurePostgresRunning(databaseUrl) {
  if (await isPostgresReachable(databaseUrl)) {
    return;
  }

  const target = formatSafeDbTarget(databaseUrl);
  if (!isLocalDatabaseUrl(databaseUrl)) {
    throw new Error(
      `Cannot connect to non-local PostgreSQL at ${target}. Please start or verify your database server.`,
    );
  }

  if (!isDockerDaemonRunning()) {
    console.error(
      `PostgreSQL is not reachable at ${target} and Docker daemon is not running.`,
    );
    console.error('\nStart a local database using one of:');
    for (const line of getPostgresRemediationLines()) {
      console.error(line);
    }
    process.exit(1);
  }

  console.log(
    `PostgreSQL not reachable at ${target}; starting Docker Compose service...`,
  );
  execFileSync('docker', ['compose', 'up', '-d'], { stdio: 'inherit' });

  const ready = await waitForPostgres(databaseUrl, 30_000);
  if (!ready) {
    throw new Error(
      `Docker Compose started, but PostgreSQL did not become ready at ${target} within 30s.`,
    );
  }
}

async function main() {
  ensureLocalEnv();
  loadEnvFiles();

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be configured in .env.local or environment.');
  }

  await ensurePostgresRunning(databaseUrl);
  await ensureDatabases();
  runNodeScript('scripts/db-migrate.mjs');
  runNodeScript('scripts/db-seed.mjs');
  if (process.env.TEST_DATABASE_URL?.trim()) {
    runNodeScript('scripts/db-migrate.mjs', ['--test']);
    runNodeScript('scripts/db-seed.mjs', ['--test']);
  }

  console.log('\nRunning environment doctor...');
  const ok = await runDoctor();
  if (!ok) {
    process.exit(1);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
