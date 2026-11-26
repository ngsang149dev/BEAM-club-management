import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatUtcFileTimestamp,
  parseCliOptions,
  parsePgConnection,
  queryServerVersionNum,
  resolveBackupConnectionString,
  resolvePgToolRunner,
  runPgDumpToFile,
} from './db-cli.mjs';
import { formatSafeDbTarget } from './load-env.mjs';

export function buildDefaultBackupPath(connectionString, cwd = process.cwd(), now = new Date()) {
  const { database } = parsePgConnection(connectionString);
  const stamp = formatUtcFileTimestamp(now);
  return path.resolve(cwd, 'backups', `beam-${database}-${stamp}.sql`);
}

export async function runDbBackup(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const connectionString = resolveBackupConnectionString({
    ...options,
    cwd,
    operation: 'db:backup',
  });
  const target = formatSafeDbTarget(connectionString);
  const rawOutput = options.outputPath ?? options.filePath;
  const outputPath = rawOutput
    ? path.resolve(cwd, rawOutput)
    : buildDefaultBackupPath(connectionString, cwd);

  const serverVersionNum = await queryServerVersionNum(connectionString);
  const preferredMajorVersion = serverVersionNum
    ? Math.floor(serverVersionNum / 10_000)
    : null;
  const runner = resolvePgToolRunner('pg_dump', { preferredMajorVersion });
  const bytes = await runPgDumpToFile({
    runner,
    connectionString,
    outputPath,
    serverVersionNum,
  });

  if (!options.quiet) {
    console.log(
      `[db:backup] Exported ${target} (${bytes} bytes, mode=${runner.mode}) -> ${outputPath}`,
    );
  }

  return {
    outputPath,
    target,
    bytes,
    runnerMode: runner.mode,
  };
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const cli = parseCliOptions();
  runDbBackup(cli).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
