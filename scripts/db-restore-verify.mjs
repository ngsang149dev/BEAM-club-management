import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buildDatabaseUrlWithName,
  formatUtcFileTimestamp,
  parseCliOptions,
  parsePgConnection,
  queryServerVersionNum,
  resolvePgToolRunner,
  resolveRestoreVerifyConnectionString,
  runPgDumpToFile,
  runPsqlFromFile,
  VALID_DB_NAME_RE,
} from './db-cli.mjs';
import { formatSafeDbTarget } from './load-env.mjs';

export const EXPECTED_PUBLIC_TABLES = [
  'app_settings',
  'audit_logs',
  'boards',
  'club_assets',
  'columns',
  'comments',
  'departments',
  'login_attempts',
  'login_gallery_items',
  'member_departments',
  'notifications',
  'permission_presets',
  'permissions',
  'preset_permissions',
  'profiles',
  'reminders',
  'schema_migrations',
  'sessions',
  'task_assignees',
  'task_deliverables',
  'task_departments',
  'task_events',
  'tasks',
  'user_permissions',
];

export const KEY_ROW_COUNT_TABLES = EXPECTED_PUBLIC_TABLES;

export const EXPECTED_CRITICAL_TRIGGERS = [
  { table: 'task_events', trigger: 'prevent_append_only_mutation' },
  { table: 'audit_logs', trigger: 'prevent_append_only_mutation' },
  { table: 'profiles', trigger: 'prevent_last_active_admin_update' },
  { table: 'profiles', trigger: 'prevent_last_active_admin_delete' },
  { table: 'profiles', trigger: 'prevent_student_id_change' },
  { table: 'boards', trigger: 'prevent_entity_unpurge' },
  { table: 'tasks', trigger: 'prevent_entity_unpurge' },
];

function buildTempDbName() {
  const stamp = formatUtcFileTimestamp().toLowerCase();
  const rand = randomBytes(4).toString('hex');
  const candidate = `beam_restore_verify_${stamp}_${rand}`;
  if (!VALID_DB_NAME_RE.test(candidate)) {
    throw new Error(`Generated invalid temp database name: ${candidate}`);
  }
  return candidate;
}

async function queryTableRowCounts(connectionString, tableNames) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await queryTableRowCountsWithClient(client, tableNames);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function assertPublicSchemaTables(client) {
  const res = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const actual = res.rows.map((r) => r.table_name);
  const expectedSet = new Set(EXPECTED_PUBLIC_TABLES);
  const actualSet = new Set(actual);

  const missing = EXPECTED_PUBLIC_TABLES.filter((t) => !actualSet.has(t));
  const extra = actual.filter((t) => !expectedSet.has(t));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Restored schema table mismatch. Missing=[${missing.join(', ')}] Extra=[${extra.join(', ')}]`,
    );
  }
  return actual;
}

async function assertSystemRowsAndCounts(client, restoredCounts, sourceCounts) {
  const permissionsCount = restoredCounts.permissions ?? 0;
  const presetsCount = restoredCounts.permission_presets ?? 0;
  const migrationsCount = restoredCounts.schema_migrations ?? 0;

  if (permissionsCount !== 18) {
    throw new Error(
      `Expected 18 rows in permissions after restore, got ${permissionsCount}.`,
    );
  }
  if (presetsCount < 3) {
    throw new Error(
      `Expected at least 3 rows in permission_presets after restore, got ${presetsCount}.`,
    );
  }
  if (migrationsCount < 6) {
    throw new Error(
      `Expected at least 6 rows in schema_migrations after restore, got ${migrationsCount}.`,
    );
  }

  if (!sourceCounts) return;
  const mismatches = [];
  for (const table of KEY_ROW_COUNT_TABLES) {
    if (sourceCounts[table] !== restoredCounts[table]) {
      mismatches.push(
        `${table} (source=${sourceCounts[table]}, restored=${restoredCounts[table]})`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Row count mismatch after restore: ${mismatches.join('; ')}`);
  }
}

async function assertTriggerCatalog(client) {
  const res = await client.query(
    `SELECT c.relname AS table_name, t.tgname AS trigger_name
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
  );
  const present = new Set(res.rows.map((r) => `${r.table_name}.${r.trigger_name}`));
  const missing = EXPECTED_CRITICAL_TRIGGERS.filter(
    (entry) => !present.has(`${entry.table}.${entry.trigger}`),
  );
  if (missing.length > 0) {
    const names = missing.map((m) => `${m.table}.${m.trigger}`).join(', ');
    throw new Error(`Missing required triggers after restore: ${names}`);
  }
}

async function expectTriggerHint(client, savepoint, fn, expectedHint) {
  await client.query(`SAVEPOINT ${savepoint}`);
  let caughtHint = null;
  let caughtMessage = null;
  try {
    await fn();
  } catch (error) {
    caughtHint =
      error && typeof error === 'object' && 'hint' in error
        ? String(error.hint)
        : '';
    caughtMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }

  if (caughtHint !== expectedHint) {
    throw new Error(
      `Expected PostgreSQL trigger hint "${expectedHint}", got "${caughtHint ?? 'none'}" (${caughtMessage ?? 'no error'}).`,
    );
  }
}

async function assertRuntimeTriggerBehavior(client) {
  await client.query('BEGIN');
  try {
    await expectTriggerHint(
      client,
      'sp_verify_te_upd',
      () => client.query('UPDATE "public"."task_events" SET forced = forced WHERE false'),
      'APPEND_ONLY_TABLE',
    );
    await expectTriggerHint(
      client,
      'sp_verify_te_del',
      () => client.query('DELETE FROM "public"."task_events" WHERE false'),
      'APPEND_ONLY_TABLE',
    );
    await expectTriggerHint(
      client,
      'sp_verify_al_upd',
      () => client.query('UPDATE "public"."audit_logs" SET action = action WHERE false'),
      'APPEND_ONLY_TABLE',
    );
    await expectTriggerHint(
      client,
      'sp_verify_al_del',
      () => client.query('DELETE FROM "public"."audit_logs" WHERE false'),
      'APPEND_ONLY_TABLE',
    );

    const tempAdminRes = await client.query(
      `INSERT INTO "public"."profiles" (student_id, email, full_name, is_admin, is_active)
       VALUES ('VERIFY-ADM-TMP', 'verify-adm-tmp@eiu.edu.vn', 'Verify Temp Admin', true, true)
       RETURNING id`,
    );
    const tempAdminId = tempAdminRes.rows[0]?.id;
    if (!tempAdminId) {
      throw new Error('Failed to create temporary verification admin profile.');
    }
    await client.query(
      'UPDATE "public"."profiles" SET is_admin = false WHERE is_admin = true AND id <> $1',
      [tempAdminId],
    );

    await expectTriggerHint(
      client,
      'sp_verify_student_id_immutable',
      () =>
        client.query(
          `UPDATE "public"."profiles" SET student_id = 'VERIFY-MUTATED' WHERE id = $1`,
          [tempAdminId],
        ),
      'STUDENT_ID_IMMUTABLE',
    );
    await expectTriggerHint(
      client,
      'sp_verify_last_admin_upd',
      () =>
        client.query(
          'UPDATE "public"."profiles" SET is_admin = false WHERE id = $1',
          [tempAdminId],
        ),
      'LAST_ACTIVE_ADMIN',
    );
    await expectTriggerHint(
      client,
      'sp_verify_last_admin_del',
      () =>
        client.query(
          'DELETE FROM "public"."profiles" WHERE id = $1',
          [tempAdminId],
        ),
      'LAST_ACTIVE_ADMIN',
    );

    const tempBoardRes = await client.query(
      `INSERT INTO "public"."boards" (name, created_by, archived_at, purged_at)
       VALUES ('Verify Temp Board', $1, now(), now())
       RETURNING id`,
      [tempAdminId],
    );
    const tempBoardId = tempBoardRes.rows[0]?.id;
    if (!tempBoardId) {
      throw new Error('Failed to create temporary verification board.');
    }
    await expectTriggerHint(
      client,
      'sp_verify_board_unpurge',
      () =>
        client.query(
          'UPDATE "public"."boards" SET purged_at = NULL WHERE id = $1',
          [tempBoardId],
        ),
      'ALREADY_PURGED',
    );

    const tempTaskRes = await client.query(
      `INSERT INTO "public"."tasks" (board_id, column_id, title, position, deleted_at, purged_at, created_by)
       VALUES ($1, NULL, 'Verify Temp Task', '1000', now(), now(), $2)
       RETURNING id`,
      [tempBoardId, tempAdminId],
    );
    const tempTaskId = tempTaskRes.rows[0]?.id;
    if (!tempTaskId) {
      throw new Error('Failed to create temporary verification task.');
    }
    await expectTriggerHint(
      client,
      'sp_verify_task_unpurge',
      () =>
        client.query(
          'UPDATE "public"."tasks" SET purged_at = NULL WHERE id = $1',
          [tempTaskId],
        ),
      'ALREADY_PURGED',
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
}

async function createTempDatabase(maintenanceUrl, tempDbName) {
  const adminClient = new pg.Client({ connectionString: maintenanceUrl });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE "${tempDbName}"`);
  } finally {
    await adminClient.end().catch(() => undefined);
  }
}

async function dropTempDatabase(maintenanceUrl, tempDbName) {
  const adminClient = new pg.Client({ connectionString: maintenanceUrl });
  await adminClient.connect();
  try {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [tempDbName],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
  } finally {
    await adminClient.end().catch(() => undefined);
  }
}

async function inspectRestoredDatabase(tempDbUrl, sourceCounts) {
  const counts = await queryTableRowCounts(tempDbUrl, KEY_ROW_COUNT_TABLES);
  const client = new pg.Client({ connectionString: tempDbUrl });
  await client.connect();
  try {
    const tables = await assertPublicSchemaTables(client);
    await assertSystemRowsAndCounts(client, counts, sourceCounts);
    await assertTriggerCatalog(client);
    await assertRuntimeTriggerBehavior(client);
    return { tables, counts };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function queryTableRowCountsWithClient(client, tableNames) {
  const counts = {};
  for (const table of tableNames) {
    const res = await client.query(`SELECT count(*)::int AS cnt FROM "public"."${table}"`);
    counts[table] = res.rows[0]?.cnt ?? 0;
  }
  return counts;
}

async function captureConsistentDumpAndCounts({
  dumpRunner,
  connectionString,
  dumpPath,
  serverVersionNum,
}) {
  const sourceClient = new pg.Client({ connectionString });
  await sourceClient.connect();
  try {
    await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const snapRes = await sourceClient.query('SELECT pg_export_snapshot() AS snapshot_id');
    const snapshotId = snapRes.rows[0]?.snapshot_id;
    if (!snapshotId) {
      throw new Error('Failed to export PostgreSQL snapshot for consistent restore verification.');
    }
    const counts = await queryTableRowCountsWithClient(sourceClient, KEY_ROW_COUNT_TABLES);
    await runPgDumpToFile({
      runner: dumpRunner,
      connectionString,
      outputPath: dumpPath,
      snapshotId,
      serverVersionNum,
    });
    await sourceClient.query('COMMIT');
    return counts;
  } catch (error) {
    await sourceClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await sourceClient.end().catch(() => undefined);
  }
}

export async function runDbRestoreVerify(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const connectionString = resolveRestoreVerifyConnectionString({
    ...options,
    cwd,
    operation: 'db:restore:verify',
  });
  const sourceConn = parsePgConnection(connectionString);
  const tempDbName = buildTempDbName();
  if (tempDbName === sourceConn.database) {
    throw new Error('Temp database name collided with source database.');
  }

  const maintenanceUrl = buildDatabaseUrlWithName(connectionString, 'postgres');
  const tempDbUrl = buildDatabaseUrlWithName(connectionString, tempDbName);

  const callerFilePath = options.filePath
    ? path.resolve(cwd, options.filePath)
    : undefined;
  const createdTempDump = !callerFilePath;
  const dumpPath =
    callerFilePath ??
    path.join(os.tmpdir(), `${tempDbName}.sql`);

  if (callerFilePath) {
    if (!fs.existsSync(callerFilePath) || fs.statSync(callerFilePath).size === 0) {
      throw new Error(`Backup SQL file is missing or empty: ${callerFilePath}`);
    }
  }

  const serverVersionNum = await queryServerVersionNum(connectionString);
  const preferredMajorVersion = serverVersionNum
    ? Math.floor(serverVersionNum / 10_000)
    : null;
  const dumpRunner = createdTempDump
    ? resolvePgToolRunner('pg_dump', { preferredMajorVersion })
    : null;
  const psqlRunner = resolvePgToolRunner('psql', { preferredMajorVersion });
  let sourceCounts = null;

  try {
    if (createdTempDump) {
      sourceCounts = await captureConsistentDumpAndCounts({
        dumpRunner,
        connectionString,
        dumpPath,
        serverVersionNum,
      });
    }

    await createTempDatabase(maintenanceUrl, tempDbName);
    await runPsqlFromFile({
      runner: psqlRunner,
      connectionString: tempDbUrl,
      inputPath: dumpPath,
      serverVersionNum,
    });

    const { tables, counts } = await inspectRestoredDatabase(tempDbUrl, sourceCounts);
    const result = {
      sourceTarget: formatSafeDbTarget(connectionString),
      tempDbName,
      dumpPath,
      createdTempDump,
      tableCount: tables.length,
      tables,
      counts,
      sourceCounts,
      runnerMode: psqlRunner.mode,
    };

    if (!options.quiet) {
      console.log(
        `[db:restore:verify] Verified ${result.tableCount} tables, ${counts.permissions} permissions, ${counts.permission_presets} presets, and all append-only/last-admin triggers on temp DB "${tempDbName}" (mode=${psqlRunner.mode}).`,
      );
    }

    return result;
  } finally {
    await dropTempDatabase(maintenanceUrl, tempDbName).catch(() => undefined);
    if (createdTempDump && fs.existsSync(dumpPath)) {
      fs.rmSync(dumpPath, { force: true });
    }
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const cli = parseCliOptions();
  runDbRestoreVerify(cli).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
