import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface DbBackupResult {
  readonly outputPath: string;
  readonly target: string;
  readonly bytes: number;
  readonly runnerMode: 'host' | 'docker';
}

interface DbRestoreVerifyResult {
  readonly sourceTarget: string;
  readonly tempDbName: string;
  readonly dumpPath: string;
  readonly createdTempDump: boolean;
  readonly tableCount: number;
  readonly tables: string[];
  readonly counts: Record<string, number>;
  readonly sourceCounts: Record<string, number> | null;
  readonly runnerMode: 'host' | 'docker';
}

interface DbBackupModule {
  runDbBackup(options?: {
    useTest?: boolean;
    allowRemoteDev?: boolean;
    outputPath?: string;
    connectionString?: string;
    quiet?: boolean;
  }): Promise<DbBackupResult>;
}

interface DbRestoreVerifyModule {
  EXPECTED_PUBLIC_TABLES: readonly string[];
  runDbRestoreVerify(options?: {
    useTest?: boolean;
    allowRemoteDev?: boolean;
    filePath?: string;
    connectionString?: string;
    quiet?: boolean;
  }): Promise<DbRestoreVerifyResult>;
}

function loadEnvLocalIfMissing(): void {
  if (process.env.TEST_DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function importScriptModule<T>(relativePath: string): Promise<T> {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return (await import(pathToFileURL(fullPath).href)) as T;
}

function buildMaintenanceUrl(connectionString: string): string {
  const parsed = new URL(connectionString);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

describe('Database backup & restore verification scripts (NFR-06)', () => {
  let testDbUrl: string;
  let backupModule: DbBackupModule;
  let restoreVerifyModule: DbRestoreVerifyModule;

  beforeAll(async () => {
    loadEnvLocalIfMissing();
    const configured = process.env.TEST_DATABASE_URL?.trim();
    if (!configured) {
      throw new Error('TEST_DATABASE_URL is required for backup/restore integration tests');
    }
    testDbUrl = configured;
    backupModule = await importScriptModule<DbBackupModule>('scripts/db-backup.mjs');
    restoreVerifyModule = await importScriptModule<DbRestoreVerifyModule>(
      'scripts/db-restore-verify.mjs',
    );
  });

  afterAll(() => {
    // No persistent resources held across tests
  });

  it('blocks NODE_ENV=production and non-local URLs without --allow-remote-dev while redacting credentials', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const writableEnv = process.env as Record<string, string | undefined>;
    try {
      writableEnv.NODE_ENV = 'production';
      await expect(
        backupModule.runDbBackup({ useTest: true, quiet: true }),
      ).rejects.toThrow(/NODE_ENV=production/);
      await expect(
        restoreVerifyModule.runDbRestoreVerify({ useTest: true, quiet: true }),
      ).rejects.toThrow(/NODE_ENV=production/);
    } finally {
      writableEnv.NODE_ENV = previousNodeEnv;
    }

    expect(() =>
      execFileSync('node', ['scripts/db-backup.mjs', '--test'], {
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      }),
    ).toThrow();

    expect(() =>
      execFileSync('node', ['scripts/db-restore-verify.mjs', '--test'], {
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      }),
    ).toThrow();

    const secretRemoteUrl =
      'postgresql://neon_admin:TopSecretPass99@ep-demo.us-east-2.aws.neon.tech:5432/beam_prod?sslmode=require';

    let backupErrMessage = '';
    try {
      await backupModule.runDbBackup({
        connectionString: secretRemoteUrl,
        quiet: true,
      });
    } catch (error) {
      backupErrMessage = error instanceof Error ? error.message : String(error);
    }
    expect(backupErrMessage).toContain('ep-demo.us-east-2.aws.neon.tech:5432/beam_prod');
    expect(backupErrMessage).toContain('--allow-remote-dev');
    expect(backupErrMessage).not.toContain('TopSecretPass99');
    expect(backupErrMessage).not.toContain('postgresql://');

    let verifyErrMessage = '';
    try {
      await restoreVerifyModule.runDbRestoreVerify({
        connectionString: secretRemoteUrl,
        quiet: true,
      });
    } catch (error) {
      verifyErrMessage = error instanceof Error ? error.message : String(error);
    }
    expect(verifyErrMessage).toContain('ep-demo.us-east-2.aws.neon.tech:5432/beam_prod');
    expect(verifyErrMessage).toContain('--allow-remote-dev');
    expect(verifyErrMessage).not.toContain('TopSecretPass99');
    expect(verifyErrMessage).not.toContain('postgresql://');
  });

  it('dumps TEST_DATABASE_URL cleanly, verifies schema/counts/triggers in an isolated temp DB, and cleans up temp DB & files', async () => {
    const tempManualDumpPath = path.join(
      os.tmpdir(),
      `beam-test-manual-backup-${randomUUID().slice(0, 8)}.sql`,
    );
    const createdTempDbNames: string[] = [];

    try {
      const backupRes = await backupModule.runDbBackup({
        useTest: true,
        outputPath: tempManualDumpPath,
        quiet: true,
      });
      expect(backupRes.outputPath).toBe(tempManualDumpPath);
      expect(backupRes.bytes).toBeGreaterThan(1000);
      expect(['host', 'docker']).toContain(backupRes.runnerMode);
      expect(backupRes.target).not.toContain('password');
      expect(fs.existsSync(tempManualDumpPath)).toBe(true);

      const dumpContent = fs.readFileSync(tempManualDumpPath, 'utf8');
      expect(dumpContent).toContain('CREATE TABLE public.profiles');
      expect(dumpContent).toContain('prevent_append_only_mutation');
      expect(dumpContent).not.toContain(testDbUrl);
      if (process.env.SESSION_SECRET) {
        expect(dumpContent).not.toContain(process.env.SESSION_SECRET);
      }

      // 1. Self-contained dump + restore verification (creates & cleans temp dump + temp DB)
      const autoVerify = await restoreVerifyModule.runDbRestoreVerify({
        useTest: true,
        quiet: true,
      });
      createdTempDbNames.push(autoVerify.tempDbName);

      expect(autoVerify.createdTempDump).toBe(true);
      expect(fs.existsSync(autoVerify.dumpPath)).toBe(false);
      expect(autoVerify.tableCount).toBe(
        restoreVerifyModule.EXPECTED_PUBLIC_TABLES.length,
      );
      expect(autoVerify.tables).toEqual([
        ...restoreVerifyModule.EXPECTED_PUBLIC_TABLES,
      ]);
      expect(autoVerify.counts.permissions).toBe(18);
      expect(autoVerify.counts.permission_presets).toBeGreaterThanOrEqual(3);
      expect(autoVerify.counts.schema_migrations).toBeGreaterThanOrEqual(6);
      expect(autoVerify.sourceCounts).toEqual(autoVerify.counts);

      // 2. Verify existing dump via --file without deleting caller's dump file
      const fileVerify = await restoreVerifyModule.runDbRestoreVerify({
        useTest: true,
        filePath: tempManualDumpPath,
        quiet: true,
      });
      createdTempDbNames.push(fileVerify.tempDbName);

      expect(fileVerify.createdTempDump).toBe(false);
      expect(fs.existsSync(tempManualDumpPath)).toBe(true);
      expect(fileVerify.tableCount).toBe(
        restoreVerifyModule.EXPECTED_PUBLIC_TABLES.length,
      );
      expect(fileVerify.counts.permissions).toBe(18);
      expect(fileVerify.counts.permission_presets).toBeGreaterThanOrEqual(3);

      // 3. Confirm no temporary restore-verify databases linger in pg_database
      const adminClient = new pg.Client({
        connectionString: buildMaintenanceUrl(testDbUrl),
      });
      await adminClient.connect();
      try {
        const res = await adminClient.query<{ datname: string }>(
          'SELECT datname FROM pg_database WHERE datname = ANY($1::text[])',
          [createdTempDbNames],
        );
        expect(res.rows).toHaveLength(0);
      } finally {
        await adminClient.end();
      }
    } finally {
      fs.rmSync(tempManualDumpPath, { force: true });
    }
  }, 60_000);
});
