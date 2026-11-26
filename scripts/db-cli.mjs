import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatSafeDbTarget,
  isLocalDatabaseUrl,
  loadEnvFiles,
} from './load-env.mjs';

export const VALID_DB_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/;
const DEFAULT_DOCKER_CONTAINER = 'beam-postgres';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MAX_STDERR_BYTES = 65_536;

export function parseCliOptions(argv = process.argv.slice(2)) {
  const options = {
    useTest: false,
    allowRemoteDev: false,
    outputPath: undefined,
    filePath: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--test') {
      options.useTest = true;
      continue;
    }
    if (arg === '--allow-remote-dev') {
      options.allowRemoteDev = true;
      continue;
    }
    if (arg === '--output' || arg === '--file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      if (arg === '--output') options.outputPath = next;
      else options.filePath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.outputPath = arg.slice('--output='.length);
      continue;
    }
    if (arg.startsWith('--file=')) {
      options.filePath = arg.slice('--file='.length);
      continue;
    }
    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  return options;
}

export function assertDatabaseOperationAllowed(params) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to run ${params.operation} when NODE_ENV=production.`,
    );
  }
  if (!params.connectionString || typeof params.connectionString !== 'string') {
    throw new Error(params.missingMessage);
  }
  if (!isLocalDatabaseUrl(params.connectionString) && !params.allowRemoteDev) {
    throw new Error(
      `Refusing to run ${params.operation} against non-local database (${formatSafeDbTarget(params.connectionString)}) without --allow-remote-dev.`,
    );
  }
}

export function resolveBackupConnectionString(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  loadEnvFiles(cwd);

  const connectionString =
    options.connectionString ??
    (options.useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL);

  assertDatabaseOperationAllowed({
    operation: options.operation ?? 'db:backup',
    connectionString: connectionString?.trim(),
    allowRemoteDev: Boolean(options.allowRemoteDev),
    missingMessage: options.useTest
      ? 'TEST_DATABASE_URL is required when --test is specified.'
      : 'DATABASE_URL is required.',
  });

  return connectionString.trim();
}

export function resolveRestoreVerifyConnectionString(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  loadEnvFiles(cwd);

  const connectionString =
    options.connectionString ??
    (options.useTest
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);

  assertDatabaseOperationAllowed({
    operation: options.operation ?? 'db:restore:verify',
    connectionString: connectionString?.trim(),
    allowRemoteDev: Boolean(options.allowRemoteDev),
    missingMessage: options.useTest
      ? 'TEST_DATABASE_URL is required when --test is specified.'
      : 'DATABASE_URL or TEST_DATABASE_URL is required.',
  });

  return connectionString.trim();
}

export function parsePgConnection(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Invalid PostgreSQL connection URL.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!VALID_DB_NAME_RE.test(database)) {
    throw new Error(`Invalid PostgreSQL database name "${database}".`);
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = parsed.port || '5432';
  const user = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');
  const sslmode = parsed.searchParams.get('sslmode') || undefined;

  return { host, port, user, password, database, sslmode };
}

export function buildDatabaseUrlWithName(connectionString, dbName) {
  if (!VALID_DB_NAME_RE.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name "${dbName}".`);
  }
  const parsed = new URL(connectionString);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export function resolvePgToolRunner(toolName) {
  try {
    execFileSync(toolName, ['--version'], { stdio: 'pipe' });
    return { mode: 'host', binary: toolName };
  } catch (hostError) {
    const code =
      hostError && typeof hostError === 'object' && 'code' in hostError
        ? String(hostError.code)
        : '';
    if (code && code !== 'ENOENT') {
      throw new Error(`Failed checking host ${toolName} (${code}).`);
    }
  }

  const container =
    process.env.BEAM_PG_DOCKER_CONTAINER?.trim() || DEFAULT_DOCKER_CONTAINER;
  try {
    execFileSync('docker', ['--version'], { stdio: 'pipe' });
  } catch (dockerError) {
    const msg =
      dockerError instanceof Error ? dockerError.message : String(dockerError);
    throw new Error(
      `Host "${toolName}" is not installed and Docker CLI is unavailable (${msg}).`,
    );
  }

  return { mode: 'docker', binary: toolName, container };
}

function buildToolConnectionArgs(conn, mode) {
  const effectiveHost =
    mode === 'docker' && LOOPBACK_HOSTS.has(conn.host) ? '127.0.0.1' : conn.host;
  const effectivePort =
    mode === 'docker' && LOOPBACK_HOSTS.has(conn.host) ? '5432' : conn.port;

  const args = ['-h', effectiveHost, '-p', effectivePort];
  if (conn.user) {
    args.push('-U', conn.user);
  }
  args.push('-d', conn.database);
  return args;
}

function buildToolInvocation(params) {
  const { runner, conn, toolArgs, allowStdin } = params;
  const connArgs = buildToolConnectionArgs(conn, runner.mode);

  if (runner.mode === 'host') {
    const env = { ...process.env };
    if (conn.password) env.PGPASSWORD = conn.password;
    if (conn.sslmode) env.PGSSLMODE = conn.sslmode;
    return {
      command: runner.binary,
      args: [...toolArgs, ...connArgs],
      env,
    };
  }

  const dockerArgs = ['exec'];
  if (allowStdin) dockerArgs.push('-i');
  if (conn.password) dockerArgs.push('-e', `PGPASSWORD=${conn.password}`);
  if (conn.sslmode) dockerArgs.push('-e', `PGSSLMODE=${conn.sslmode}`);
  dockerArgs.push(runner.container, runner.binary, ...toolArgs, ...connArgs);
  return {
    command: 'docker',
    args: dockerArgs,
    env: process.env,
  };
}

function appendBoundedStderr(current, chunk) {
  if (current.length >= MAX_STDERR_BYTES) return current;
  return (current + chunk.toString('utf8')).slice(0, MAX_STDERR_BYTES);
}

export async function runPgDumpToFile({ runner, connectionString, outputPath }) {
  const conn = parsePgConnection(connectionString);
  const invocation = buildToolInvocation({
    runner,
    conn,
    toolArgs: ['--no-owner', '--no-privileges', '--format=plain', '--encoding=UTF8'],
    allowStdin: false,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  await new Promise((resolve, reject) => {
    let stderrText = '';
    let settled = false;
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const fail = (err) => {
      if (settled) return;
      settled = true;
      writeStream.destroy();
      fs.rmSync(outputPath, { force: true });
      reject(err);
    };

    const writeDone = new Promise((res, rej) => {
      writeStream.on('finish', res);
      writeStream.on('error', rej);
    });

    child.stderr.on('data', (chunk) => {
      stderrText = appendBoundedStderr(stderrText, chunk);
    });
    child.on('error', (err) => fail(err));
    child.stdout.pipe(writeStream);

    child.on('close', async (code) => {
      if (settled) return;
      try {
        await writeDone;
      } catch (streamErr) {
        fail(streamErr);
        return;
      }
      if (code !== 0) {
        const detail = stderrText.trim() || `exit code ${code}`;
        fail(
          new Error(
            `pg_dump failed for ${formatSafeDbTarget(connectionString)}: ${detail}`,
          ),
        );
        return;
      }
      settled = true;
      resolve();
    });
  });

  const stats = fs.statSync(outputPath);
  if (stats.size === 0) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(
      `pg_dump produced an empty file for ${formatSafeDbTarget(connectionString)}.`,
    );
  }
  return stats.size;
}

export async function runPsqlFromFile({ runner, connectionString, inputPath }) {
  if (!fs.existsSync(inputPath) || fs.statSync(inputPath).size === 0) {
    throw new Error(`Backup SQL file is missing or empty: ${inputPath}`);
  }
  const conn = parsePgConnection(connectionString);
  const invocation = buildToolInvocation({
    runner,
    conn,
    toolArgs: ['-X', '-v', 'ON_ERROR_STOP=1'],
    allowStdin: true,
  });

  const readStream = fs.createReadStream(inputPath);

  await new Promise((resolve, reject) => {
    let stderrText = '';
    let settled = false;
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const fail = (err) => {
      if (settled) return;
      settled = true;
      readStream.destroy();
      reject(err);
    };

    readStream.on('error', (err) => fail(err));
    child.stdin.on('error', () => undefined);
    child.stderr.on('data', (chunk) => {
      stderrText = appendBoundedStderr(stderrText, chunk);
    });
    child.stdout.resume();
    child.on('error', (err) => fail(err));

    readStream.pipe(child.stdin);

    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderrText.trim() || `exit code ${code}`;
        fail(
          new Error(
            `psql restore failed for ${formatSafeDbTarget(connectionString)}: ${detail}`,
          ),
        );
        return;
      }
      settled = true;
      resolve();
    });
  });
}

export function formatUtcFileTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('');
}
