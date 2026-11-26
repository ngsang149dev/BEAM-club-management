import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import pg from 'pg';
import {
  formatSafeDbTarget,
  isLocalDatabaseUrl,
  loadEnvFiles,
} from './load-env.mjs';

export const VALID_DB_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/;
export const PG17_SERVER_VERSION_NUM = 170_000;

const VALID_SNAPSHOT_ID_RE = /^[0-9a-fA-F-]+$/;
const DEFAULT_DOCKER_CONTAINER = 'beam-postgres';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MAX_STDERR_BYTES = 65_536;
const PG_TOOL_VERSION_RE = /\(PostgreSQL\)\s*(\d+)(?:\.\d+|(?:alpha|beta|rc)\d*)?\b/i;
const COPY_FROM_STDIN_RE = /^\s*COPY\b.+\bFROM\s+stdin(?:\s+[^;]*)?;\s*$/i;
const UNSUPPORTED_PG17_PREAMBLE_RE = /^\s*SET\s+transaction_timeout\s*=\s*0\s*;\s*$/i;

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

export async function queryServerVersionNum(connectionString) {
  parsePgConnection(connectionString);
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query(
      "SELECT current_setting('server_version_num')::int AS ver",
    );
    const ver = res.rows[0]?.ver;
    return typeof ver === 'number' && Number.isInteger(ver) && ver > 0 ? ver : null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed querying PostgreSQL server version for ${formatSafeDbTarget(connectionString)}: ${detail}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function parsePgToolMajorVersion(rawVersionOutput) {
  if (typeof rawVersionOutput !== 'string' || rawVersionOutput.length === 0) {
    return null;
  }
  const match = PG_TOOL_VERSION_RE.exec(rawVersionOutput);
  if (!match) {
    return null;
  }
  const major = Number.parseInt(match[1], 10);
  return Number.isInteger(major) && major > 0 ? major : null;
}

export function getHostPgToolCandidates(
  toolName,
  preferredMajorVersion,
  platform = process.platform,
) {
  const hasPreferredMajor =
    typeof preferredMajorVersion === 'number' &&
    Number.isInteger(preferredMajorVersion) &&
    preferredMajorVersion > 0;

  if (!hasPreferredMajor) {
    return [toolName];
  }

  if (platform === 'linux') {
    return [`/usr/lib/postgresql/${preferredMajorVersion}/bin/${toolName}`, toolName];
  }

  if (platform === 'darwin') {
    return [
      `/opt/homebrew/opt/postgresql@${preferredMajorVersion}/bin/${toolName}`,
      `/usr/local/opt/postgresql@${preferredMajorVersion}/bin/${toolName}`,
      toolName,
    ];
  }

  return [toolName];
}

export function resolvePgToolRunner(toolName, options = {}) {
  const preferredMajorVersion = options.preferredMajorVersion ?? null;
  const platform = options.platform ?? process.platform;
  const execFn = options.execFileSyncFn ?? execFileSync;
  const candidates = getHostPgToolCandidates(
    toolName,
    preferredMajorVersion,
    platform,
  );

  for (const candidate of candidates) {
    try {
      const versionOut = execFn(candidate, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
      const text = Buffer.isBuffer(versionOut)
        ? versionOut.toString('utf8')
        : String(versionOut ?? '');
      const majorVersion = parsePgToolMajorVersion(text);
      return {
        mode: 'host',
        binary: candidate,
        ...(majorVersion !== null ? { majorVersion } : {}),
      };
    } catch (hostError) {
      const code =
        hostError && typeof hostError === 'object' && 'code' in hostError
          ? String(hostError.code)
          : '';
      if (code && code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new Error(`Failed checking host ${candidate} (${code}).`);
      }
    }
  }

  const container =
    process.env.BEAM_PG_DOCKER_CONTAINER?.trim() || DEFAULT_DOCKER_CONTAINER;
  try {
    execFn('docker', ['--version'], { stdio: 'pipe' });
  } catch (dockerError) {
    const msg =
      dockerError instanceof Error ? dockerError.message : String(dockerError);
    throw new Error(
      `Host "${toolName}" is not installed and Docker CLI is unavailable (${msg}).`,
    );
  }

  let dockerMajorVersion = null;
  try {
    const dockerOut = execFn('docker', ['exec', container, toolName, '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    const text = Buffer.isBuffer(dockerOut)
      ? dockerOut.toString('utf8')
      : String(dockerOut ?? '');
    dockerMajorVersion = parsePgToolMajorVersion(text);
  } catch {
    // Container may not be running yet; majorVersion stays omitted until runtime
  }

  return {
    mode: 'docker',
    binary: toolName,
    container,
    ...(dockerMajorVersion !== null ? { majorVersion: dockerMajorVersion } : {}),
  };
}

export function stripUnsupportedRestorePreambles(sqlContent, targetServerVersionNum) {
  if (typeof sqlContent !== 'string' || sqlContent.length === 0) {
    return sqlContent;
  }
  if (
    typeof targetServerVersionNum !== 'number' ||
    !Number.isFinite(targetServerVersionNum) ||
    targetServerVersionNum <= 0 ||
    targetServerVersionNum >= PG17_SERVER_VERSION_NUM
  ) {
    return sqlContent;
  }

  const keptChunks = [];
  let inCopyBlock = false;
  let cursor = 0;

  while (cursor < sqlContent.length) {
    const nlIdx = sqlContent.indexOf('\n', cursor);
    const rawLineWithEnding =
      nlIdx === -1 ? sqlContent.slice(cursor) : sqlContent.slice(cursor, nlIdx + 1);
    cursor = nlIdx === -1 ? sqlContent.length : nlIdx + 1;

    const lineWithoutEnding = rawLineWithEnding.endsWith('\r\n')
      ? rawLineWithEnding.slice(0, -2)
      : rawLineWithEnding.endsWith('\n')
        ? rawLineWithEnding.slice(0, -1)
        : rawLineWithEnding;

    if (inCopyBlock) {
      keptChunks.push(rawLineWithEnding);
      if (lineWithoutEnding === '\\.') {
        inCopyBlock = false;
      }
      continue;
    }

    if (COPY_FROM_STDIN_RE.test(lineWithoutEnding)) {
      inCopyBlock = true;
      keptChunks.push(rawLineWithEnding);
      continue;
    }

    if (UNSUPPORTED_PG17_PREAMBLE_RE.test(lineWithoutEnding)) {
      continue;
    }

    keptChunks.push(rawLineWithEnding);
  }

  return keptChunks.join('');
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

export async function runPgDumpToFile({
  runner,
  connectionString,
  outputPath,
  snapshotId,
  serverVersionNum,
}) {
  if (
    snapshotId !== undefined &&
    snapshotId !== null &&
    (typeof snapshotId !== 'string' || !VALID_SNAPSHOT_ID_RE.test(snapshotId))
  ) {
    throw new Error('Invalid PostgreSQL snapshot identifier.');
  }

  const effectiveServerVersionNum =
    serverVersionNum === undefined
      ? await queryServerVersionNum(connectionString)
      : serverVersionNum;

  const conn = parsePgConnection(connectionString);
  const toolArgs = [
    '--no-owner',
    '--no-privileges',
    '--format=plain',
    '--encoding=UTF8',
    ...(snapshotId ? [`--snapshot=${snapshotId}`] : []),
  ];
  const invocation = buildToolInvocation({
    runner,
    conn,
    toolArgs,
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

  if (
    typeof effectiveServerVersionNum === 'number' &&
    effectiveServerVersionNum > 0 &&
    effectiveServerVersionNum < PG17_SERVER_VERSION_NUM
  ) {
    const rawSql = fs.readFileSync(outputPath, 'utf8');
    const sanitizedSql = stripUnsupportedRestorePreambles(
      rawSql,
      effectiveServerVersionNum,
    );
    if (sanitizedSql !== rawSql) {
      fs.writeFileSync(outputPath, sanitizedSql, 'utf8');
    }
  }

  const stats = fs.statSync(outputPath);
  if (stats.size === 0) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(
      `pg_dump produced an empty file for ${formatSafeDbTarget(connectionString)}.`,
    );
  }
  return stats.size;
}

export async function runPsqlFromFile({
  runner,
  connectionString,
  inputPath,
  serverVersionNum,
}) {
  if (!fs.existsSync(inputPath) || fs.statSync(inputPath).size === 0) {
    throw new Error(`Backup SQL file is missing or empty: ${inputPath}`);
  }

  const effectiveServerVersionNum =
    serverVersionNum === undefined
      ? await queryServerVersionNum(connectionString)
      : serverVersionNum;

  const conn = parsePgConnection(connectionString);
  const invocation = buildToolInvocation({
    runner,
    conn,
    toolArgs: ['-X', '-v', 'ON_ERROR_STOP=1'],
    allowStdin: true,
  });

  const needsPreambleStrip =
    typeof effectiveServerVersionNum === 'number' &&
    effectiveServerVersionNum > 0 &&
    effectiveServerVersionNum < PG17_SERVER_VERSION_NUM;

  const inputStream = needsPreambleStrip
    ? Readable.from([
        Buffer.from(
          stripUnsupportedRestorePreambles(
            fs.readFileSync(inputPath, 'utf8'),
            effectiveServerVersionNum,
          ),
          'utf8',
        ),
      ])
    : fs.createReadStream(inputPath);

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
      inputStream.destroy();
      reject(err);
    };

    inputStream.on('error', (err) => fail(err));
    child.stdin.on('error', () => undefined);
    child.stderr.on('data', (chunk) => {
      stderrText = appendBoundedStderr(stderrText, chunk);
    });
    child.stdout.resume();
    child.on('error', (err) => fail(err));

    inputStream.pipe(child.stdin);

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
