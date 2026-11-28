import fs from 'node:fs';
import path from 'node:path';
import { getTableName } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appSettings,
  auditLogs,
  boards,
  clubAssets,
  columns,
  comments,
  departments,
  loginAttempts,
  memberDepartments,
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  reminders,
  sessions,
  taskAssignees,
  taskDeliverables,
  taskDepartments,
  taskEvents,
  tasks,
  userPermissions,
  notifications,
} from '@db/schema';
import { createDb, createDbPool } from '@/server/shared/db';

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

interface PgErrorShape {
  code?: string;
  hint?: string;
}

async function expectPgError(
  client: PoolClient,
  savepointName: string,
  fn: () => Promise<unknown>,
  expected: { code?: string; hint?: string },
): Promise<void> {
  await client.query(`SAVEPOINT ${savepointName}`);
  let caught: PgErrorShape | null = null;
  try {
    await fn();
  } catch (error) {
    caught = error as PgErrorShape;
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    await client.query(`RELEASE SAVEPOINT ${savepointName}`);
  }
  expect(caught).not.toBeNull();
  if (expected.code) {
    expect(caught?.code).toBe(expected.code);
  }
  if (expected.hint) {
    expect(caught?.hint).toBe(expected.hint);
  }
}

async function withRollbackTransaction(
  pool: Pool,
  fn: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

describe('PostgreSQL schema & trigger invariants', () => {
  let pool: Pool;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for DB integration tests');
    }
    pool = createDbPool(testDbUrl);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('has all 21 Drizzle domain tables synced with PostgreSQL', async () => {
    const db = createDb(pool);
    const tables = [
      profiles,
      sessions,
      loginAttempts,
      appSettings,
      clubAssets,
      departments,
      memberDepartments,
      permissions,
      userPermissions,
      permissionPresets,
      presetPermissions,
      auditLogs,
      boards,
      columns,
      tasks,
      taskAssignees,
      taskDepartments,
      taskDeliverables,
      comments,
      taskEvents,
      reminders,
      notifications,
    ];

    const tableNames = await Promise.all(
      tables.map(async (table) => {
        await db.select().from(table).limit(1);
        return getTableName(table);
      }),
    );

    expect(tableNames).toHaveLength(22);
    expect(new Set(tableNames).size).toBe(22);
  });

  it('enforces APPEND_ONLY_TABLE, STUDENT_ID_IMMUTABLE, LAST_ACTIVE_ADMIN, and unique/check constraints', async () => {
    await withRollbackTransaction(pool, async (client) => {
      // Seed isolated synthetic records inside the rolled-back transaction
      const admin1 = '90000000-0000-4000-8000-000000000001';
      const admin2 = '90000000-0000-4000-8000-000000000002';
      const member1 = '90000000-0000-4000-8000-000000000003';
      const boardId = '91000000-0000-4000-8000-000000000001';
      const colId = '92000000-0000-4000-8000-000000000001';
      const taskId = '93000000-0000-4000-8000-000000000001';
      const eventId = '94000000-0000-4000-8000-000000000001';
      const auditId = '95000000-0000-4000-8000-000000000001';

      // Create our test admins first, then demote any pre-existing admins in this tx
      await client.query(
        `INSERT INTO profiles (id, student_id, email, full_name, is_admin, is_active)
         VALUES
           ($1, 'INV-ADMIN-01', 'inv-admin-01@eiu.edu.vn', 'Inv Admin 1', true, true),
           ($2, 'INV-ADMIN-02', 'inv-admin-02@eiu.edu.vn', 'Inv Admin 2', true, true),
           ($3, 'INV-MEM-01',   'inv-mem-01@eiu.edu.vn',   'Inv Member 1', false, true)`,
        [admin1, admin2, member1],
      );
      await client.query(
        `UPDATE profiles SET is_admin = false WHERE id NOT IN ($1, $2) AND is_admin = true`,
        [admin1, admin2],
      );

      await client.query(
        `INSERT INTO boards (id, name, created_by) VALUES ($1, 'Inv Board', $2)`,
        [boardId, member1],
      );
      await client.query(
        `INSERT INTO columns (id, board_id, name, order_index) VALUES ($1, $2, 'Todo', 0)`,
        [colId, boardId],
      );
      await client.query(
        `INSERT INTO tasks (id, board_id, column_id, title, priority, position, created_by)
         VALUES ($1, $2, $3, 'Inv Task', 2, 1000, $4)`,
        [taskId, boardId, colId, member1],
      );
      await client.query(
        `INSERT INTO task_events (id, task_id, board_id, actor_id, type, changes)
         VALUES ($1, $2, $3, $4, 'task.created', '{}'::jsonb)`,
        [eventId, taskId, boardId, member1],
      );
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_user_id, detail)
         VALUES ($1, $2, 'member.created', $3, '{}'::jsonb)`,
        [auditId, member1, member1],
      );

      // 1. APPEND_ONLY_TABLE on task_events & audit_logs
      await expectPgError(
        client,
        'sp_te_upd',
        () => client.query(`UPDATE task_events SET forced = true WHERE id = $1`, [eventId]),
        { hint: 'APPEND_ONLY_TABLE' },
      );
      await expectPgError(
        client,
        'sp_te_del',
        () => client.query(`DELETE FROM task_events WHERE id = $1`, [eventId]),
        { hint: 'APPEND_ONLY_TABLE' },
      );
      await expectPgError(
        client,
        'sp_al_upd',
        () => client.query(`UPDATE audit_logs SET action = 'edited' WHERE id = $1`, [auditId]),
        { hint: 'APPEND_ONLY_TABLE' },
      );
      await expectPgError(
        client,
        'sp_al_del',
        () => client.query(`DELETE FROM audit_logs WHERE id = $1`, [auditId]),
        { hint: 'APPEND_ONLY_TABLE' },
      );

      // 2. STUDENT_ID_IMMUTABLE on profiles
      await expectPgError(
        client,
        'sp_sid',
        () =>
          client.query(`UPDATE profiles SET student_id = 'INV-CHANGED' WHERE id = $1`, [
            member1,
          ]),
        { hint: 'STUDENT_ID_IMMUTABLE' },
      );

      // 3. LAST_ACTIVE_ADMIN — multi-row single-statement guard (2 active admins)
      await expectPgError(
        client,
        'sp_multi_upd',
        () => client.query(`UPDATE profiles SET is_admin = false WHERE is_admin = true`),
        { hint: 'LAST_ACTIVE_ADMIN' },
      );
      await expectPgError(
        client,
        'sp_multi_del',
        () =>
          client.query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [admin1, admin2]),
        { hint: 'LAST_ACTIVE_ADMIN' },
      );

      // Demote 1 of 2 active admins -> succeeds, leaving admin1 as sole active admin
      await client.query(`UPDATE profiles SET is_admin = false WHERE id = $1`, [admin2]);

      // Updating non-admin fields on sole active admin succeeds
      await client.query(`UPDATE profiles SET full_name = 'Inv Admin 1 Renamed' WHERE id = $1`, [
        admin1,
      ]);

      // Single-row demotion, deactivation, and deletion of sole active admin fail
      await expectPgError(
        client,
        'sp_last_demote',
        () => client.query(`UPDATE profiles SET is_admin = false WHERE id = $1`, [admin1]),
        { hint: 'LAST_ACTIVE_ADMIN' },
      );
      await expectPgError(
        client,
        'sp_last_deact',
        () => client.query(`UPDATE profiles SET is_active = false WHERE id = $1`, [admin1]),
        { hint: 'LAST_ACTIVE_ADMIN' },
      );
      await expectPgError(
        client,
        'sp_last_del',
        () => client.query(`DELETE FROM profiles WHERE id = $1`, [admin1]),
        { hint: 'LAST_ACTIVE_ADMIN' },
      );

      // 4. reminders unique (task_id, user_id, kind) with flexible kind
      await client.query(
        `INSERT INTO reminders (task_id, user_id, kind) VALUES ($1, $2, 'd3')`,
        [taskId, member1],
      );
      await expectPgError(
        client,
        'sp_rem_dup',
        () =>
          client.query(
            `INSERT INTO reminders (task_id, user_id, kind) VALUES ($1, $2, 'd3')`,
            [taskId, member1],
          ),
        { code: '23505' },
      );

      // 5. tasks.priority CHECK (1..4)
      await expectPgError(
        client,
        'sp_prio_low',
        () =>
          client.query(
            `INSERT INTO tasks (board_id, column_id, title, priority, position, created_by)
             VALUES ($1, $2, 'Bad Prio 0', 0, 2000, $3)`,
            [boardId, colId, member1],
          ),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_prio_high',
        () =>
          client.query(
            `INSERT INTO tasks (board_id, column_id, title, priority, position, created_by)
             VALUES ($1, $2, 'Bad Prio 5', 5, 3000, $3)`,
            [boardId, colId, member1],
          ),
        { code: '23514' },
      );

      // 6. departments case-insensitive & trimmed unique index
      await client.query(`INSERT INTO departments (name) VALUES ('Ban Invariant Test')`);
      await expectPgError(
        client,
        'sp_dept_dup',
        () => client.query(`INSERT INTO departments (name) VALUES ('  ban invariant test  ')`),
        { code: '23505' },
      );

      // 7. club_assets & profiles.avatar_* CHECK constraints (> 256 KB, SVG disallowed, pair invariant)
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const oversizedBytes = Buffer.alloc(262_145, 0x01);

      await expectPgError(
        client,
        'sp_asset_svg',
        () =>
          client.query(
            `INSERT INTO club_assets (key, mime_type, data, updated_by) VALUES ('club_logo', 'image/svg+xml', $1, $2)`,
            [validPng, admin1],
          ),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_asset_empty',
        () =>
          client.query(
            `INSERT INTO club_assets (key, mime_type, data, updated_by) VALUES ('club_logo', 'image/png', $1, $2)`,
            [Buffer.alloc(0), admin1],
          ),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_asset_big',
        () =>
          client.query(
            `INSERT INTO club_assets (key, mime_type, data, updated_by) VALUES ('club_logo', 'image/png', $1, $2)`,
            [oversizedBytes, admin1],
          ),
        { code: '23514' },
      );
      await client.query(
        `INSERT INTO club_assets (key, mime_type, data, updated_by) VALUES ('club_logo', 'image/png', $1, $2)
         ON CONFLICT (key) DO UPDATE SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data`,
        [validPng, admin1],
      );

      await expectPgError(
        client,
        'sp_avatar_svg',
        () =>
          client.query(
            `UPDATE profiles SET avatar_data = $1, avatar_mime = 'image/svg+xml' WHERE id = $2`,
            [validPng, member1],
          ),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_avatar_big',
        () =>
          client.query(
            `UPDATE profiles SET avatar_data = $1, avatar_mime = 'image/png' WHERE id = $2`,
            [oversizedBytes, member1],
          ),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_avatar_pair',
        () =>
          client.query(
            `UPDATE profiles SET avatar_data = $1, avatar_mime = NULL WHERE id = $2`,
            [validPng, member1],
          ),
        { code: '23514' },
      );
      await client.query(
        `UPDATE profiles SET avatar_data = $1, avatar_mime = 'image/webp', avatar_updated_at = now() WHERE id = $2`,
        [validPng, member1],
      );
    });
  });

  it('enforces 0004 archive CHECK constraints, prevent_student_id_change anonymization exception, and ALREADY_PURGED triggers', async () => {
    await withRollbackTransaction(pool, async (client) => {
      const actorId = '96000000-0000-4000-8000-000000000001';
      const inactiveId = '96000000-0000-4000-8000-000000000002';
      const boardId = '96000000-0000-4000-8000-000000000010';
      const colId = '96000000-0000-4000-8000-000000000020';
      const taskId = '96000000-0000-4000-8000-000000000030';

      await client.query(
        `INSERT INTO profiles (id, student_id, email, full_name, is_admin, is_active)
         VALUES
           ($1, 'INV04-ACT', 'inv04-act@eiu.edu.vn', 'Inv04 Actor', false, true),
           ($2, 'INV04-INACT', 'inv04-inact@eiu.edu.vn', 'Inv04 Inactive', false, false)`,
        [actorId, inactiveId],
      );
      await client.query(
        `INSERT INTO boards (id, name, created_by) VALUES ($1, 'Inv04 Board', $2)`,
        [boardId, actorId],
      );
      await client.query(
        `INSERT INTO columns (id, board_id, name, order_index) VALUES ($1, $2, 'Todo', 0)`,
        [colId, boardId],
      );
      await client.query(
        `INSERT INTO tasks (id, board_id, column_id, title, priority, position, created_by)
         VALUES ($1, $2, $3, 'Inv04 Task', 2, 1000, $4)`,
        [taskId, boardId, colId, actorId],
      );

      // 1. Seeded app_settings('archive_retention') exists
      const settingRes = await client.query<{ key: string; value: { retentionDays: number | null } }>(
        `SELECT key, value FROM app_settings WHERE key = 'archive_retention'`,
      );
      expect(settingRes.rows[0]?.key).toBe('archive_retention');

      // 2. CHECK constraints: purged_at requires inactive/archived/deleted
      await expectPgError(
        client,
        'sp_prof_purged_active',
        () => client.query(`UPDATE profiles SET purged_at = now() WHERE id = $1`, [actorId]),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_board_purged_active',
        () => client.query(`UPDATE boards SET purged_at = now() WHERE id = $1`, [boardId]),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_task_purged_active',
        () => client.query(`UPDATE tasks SET purged_at = now() WHERE id = $1`, [taskId]),
        { code: '23514' },
      );

      // 3. prevent_student_id_change blocks normal changes even when inactive without purged_at
      await expectPgError(
        client,
        'sp_sid_inact_no_purge',
        () =>
          client.query(`UPDATE profiles SET student_id = 'INV04-MUTATED' WHERE id = $1`, [
            inactiveId,
          ]),
        { hint: 'STUDENT_ID_IMMUTABLE' },
      );

      // 4. One-way anonymization exception succeeds on inactive -> purged_at transition
      await client.query(
        `UPDATE profiles
         SET student_id = $2,
             email = $3,
             full_name = 'Thành viên đã xóa',
             purged_at = now(),
             is_active = false
         WHERE id = $1`,
        [inactiveId, `PURGED-${inactiveId}`, `purged+${inactiveId}@redacted.local`],
      );

      // 5. Un-purging profile or mutating student_id afterwards is blocked
      await expectPgError(
        client,
        'sp_prof_unpurge',
        () => client.query(`UPDATE profiles SET purged_at = NULL WHERE id = $1`, [inactiveId]),
        { hint: 'ALREADY_PURGED' },
      );
      await expectPgError(
        client,
        'sp_prof_sid_after_purge',
        () =>
          client.query(`UPDATE profiles SET student_id = 'INV04-AGAIN' WHERE id = $1`, [
            inactiveId,
          ]),
        { hint: 'STUDENT_ID_IMMUTABLE' },
      );

      // 6. prevent_entity_unpurge on tasks & boards
      await client.query(
        `UPDATE tasks SET deleted_at = now(), purged_at = now() WHERE id = $1`,
        [taskId],
      );
      await expectPgError(
        client,
        'sp_task_unpurge',
        () => client.query(`UPDATE tasks SET purged_at = NULL WHERE id = $1`, [taskId]),
        { hint: 'ALREADY_PURGED' },
      );

      await client.query(
        `UPDATE boards SET archived_at = now(), purged_at = now() WHERE id = $1`,
        [boardId],
      );
      await expectPgError(
        client,
        'sp_board_unpurge',
        () => client.query(`UPDATE boards SET purged_at = NULL WHERE id = $1`, [boardId]),
        { hint: 'ALREADY_PURGED' },
      );
    });
  });

  it('enforces 0005 task_departments and notifications PK, FK RESTRICT/SET NULL/CASCADE, and CHECK constraints', async () => {
    await withRollbackTransaction(pool, async (client) => {
      const actorId = '97000000-0000-4000-8000-000000000001';
      const recipientId = '97000000-0000-4000-8000-000000000002';
      const deptId = '97000000-0000-4000-8000-000000000010';
      const boardId = '97000000-0000-4000-8000-000000000020';
      const colId = '97000000-0000-4000-8000-000000000030';
      const taskId = '97000000-0000-4000-8000-000000000040';
      const notifId = '97000000-0000-4000-8000-000000000050';

      await client.query(
        `INSERT INTO profiles (id, student_id, email, full_name, is_admin, is_active)
         VALUES
           ($1, 'INV05-ACT', 'inv05-act@eiu.edu.vn', 'Inv05 Actor', false, true),
           ($2, 'INV05-REC', 'inv05-rec@eiu.edu.vn', 'Inv05 Recipient', false, true)`,
        [actorId, recipientId],
      );
      await client.query(`INSERT INTO departments (id, name) VALUES ($1, 'Inv05 Dept')`, [deptId]);
      await client.query(`INSERT INTO boards (id, name, created_by) VALUES ($1, 'Inv05 Board', $2)`, [boardId, actorId]);
      await client.query(`INSERT INTO columns (id, board_id, name, order_index) VALUES ($1, $2, 'Todo', 0)`, [colId, boardId]);
      await client.query(
        `INSERT INTO tasks (id, board_id, column_id, title, priority, position, created_by)
         VALUES ($1, $2, $3, 'Inv05 Task', 2, 1000, $4)`,
        [taskId, boardId, colId, actorId],
      );

      // 1. task_departments PK + RESTRICT on department delete + CASCADE on task delete
      await client.query(`INSERT INTO task_departments (task_id, department_id) VALUES ($1, $2)`, [taskId, deptId]);
      await expectPgError(
        client,
        'sp_td_dup',
        () => client.query(`INSERT INTO task_departments (task_id, department_id) VALUES ($1, $2)`, [taskId, deptId]),
        { code: '23505' },
      );
      await expectPgError(
        client,
        'sp_td_dept_restrict',
        () => client.query(`DELETE FROM departments WHERE id = $1`, [deptId]),
        { code: '23503' },
      );

      // 2. notifications type CHECK + RESTRICT on user_id/actor_id + SET NULL on department delete
      await expectPgError(
        client,
        'sp_notif_type',
        () =>
          client.query(
            `INSERT INTO notifications (user_id, type, task_id, board_id, department_id, actor_id)
             VALUES ($1, 'invalid.type', $2, $3, $4, $5)`,
            [recipientId, taskId, boardId, deptId, actorId],
          ),
        { code: '23514' },
      );

      await client.query(
        `INSERT INTO notifications (id, user_id, type, task_id, board_id, department_id, actor_id, is_hidden_task, payload)
         VALUES ($1, $2, 'task.department_assigned', $3, $4, $5, $6, false, '{"boardName":"Inv05 Board"}'::jsonb)`,
        [notifId, recipientId, taskId, boardId, deptId, actorId],
      );
      await expectPgError(
        client,
        'sp_notif_user_restrict',
        () => client.query(`DELETE FROM profiles WHERE id = $1`, [recipientId]),
        { code: '23503' },
      );
      await expectPgError(
        client,
        'sp_notif_actor_restrict',
        () => client.query(`DELETE FROM profiles WHERE id = $1`, [actorId]),
        { code: '23503' },
      );

      // Remove task_departments link -> deleting department succeeds and sets notifications.department_id = NULL
      await client.query(`DELETE FROM task_departments WHERE task_id = $1`, [taskId]);
      await client.query(`DELETE FROM departments WHERE id = $1`, [deptId]);
      const afterDeptDel = await client.query<{ department_id: string | null }>(
        `SELECT department_id FROM notifications WHERE id = $1`,
        [notifId],
      );
      expect(afterDeptDel.rows[0]?.department_id).toBeNull();

      // Deleting task cascades notifications
      await client.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
      const afterTaskDel = await client.query(`SELECT id FROM notifications WHERE id = $1`, [notifId]);
      expect(afterTaskDel.rows).toHaveLength(0);
    });
  });

  it('seeds 0007_system_catalog_defaults and 0008_calendar_tasks_leads_deliverables constraints idempotently', async () => {
    await withRollbackTransaction(pool, async (client) => {
      const migRes = await client.query<{ version: string }>(
        `SELECT version FROM schema_migrations ORDER BY version ASC`,
      );
      const versions = migRes.rows.map((row) => row.version);
      expect(versions.length).toBeGreaterThanOrEqual(9);
      expect(versions).toContain('0007_system_catalog_defaults');
      expect(versions).toContain('0008_calendar_tasks_leads_deliverables');
      expect(versions).toContain('0009_require_task_dates');

      const permCountRes = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM permissions`,
      );
      expect(permCountRes.rows[0]?.cnt).toBe(18);

      const presetCountsRes = await client.query<{ code: string; cnt: number }>(
        `SELECT p.code, count(pp.permission_code)::int AS cnt
         FROM permission_presets p
         LEFT JOIN preset_permissions pp ON pp.preset_id = p.id
         WHERE p.code IN ('basic_member', 'department_lead', 'hr_manager')
         GROUP BY p.code
         ORDER BY p.code ASC`,
      );
      expect(presetCountsRes.rows).toEqual([
        { code: 'basic_member', cnt: 3 },
        { code: 'department_lead', cnt: 9 },
        { code: 'hr_manager', cnt: 7 },
      ]);

      const remindersSettingRes = await client.query<{ key: string }>(
        `SELECT key FROM app_settings WHERE key = 'reminders'`,
      );
      expect(remindersSettingRes.rows[0]?.key).toBe('reminders');

      // 0008 DDL constraints: departments.lead_user_id ON DELETE SET NULL, tasks_start_before_due_chk, task_deliverables CHECKs & FKs, notifications types
      const leadId = '98000000-0000-4000-8000-000000000001';
      const deptId = '98000000-0000-4000-8000-000000000002';
      const boardId = '98000000-0000-4000-8000-000000000003';
      const colId = '98000000-0000-4000-8000-000000000004';
      const taskId = '98000000-0000-4000-8000-000000000005';
      await client.query(
        `INSERT INTO profiles (id, student_id, email, full_name, is_admin, is_active)
         VALUES ($1, 'INV08-LEAD', 'inv08-lead@eiu.edu.vn', 'Lead Eight', false, true)`,
        [leadId],
      );
      await client.query(
        `INSERT INTO departments (id, name, lead_user_id) VALUES ($1, 'Dept Inv08', $2)`,
        [deptId, leadId],
      );
      await client.query(
        `INSERT INTO boards (id, name, created_by) VALUES ($1, 'Board Inv08', $2)`,
        [boardId, leadId],
      );
      await client.query(
        `INSERT INTO columns (id, board_id, name, order_index) VALUES ($1, $2, 'Todo', 0)`,
        [colId, boardId],
      );

      // tasks_start_before_due_chk rejects start_at > due_at
      await expectPgError(
        client,
        'sp_0008_date_range',
        () =>
          client.query(
            `INSERT INTO tasks (id, board_id, column_id, title, position, start_at, due_at, created_by)
             VALUES ($1, $2, $3, 'Bad Range', '1000', '2026-12-05T00:00:00Z', '2026-12-01T00:00:00Z', $4)`,
            [taskId, boardId, colId, leadId],
          ),
        { code: '23514' },
      );

      await client.query(
        `INSERT INTO tasks (id, board_id, column_id, title, position, start_at, due_at, is_completed, created_by)
         VALUES ($1, $2, $3, 'Valid Range', '1000', '2026-12-01T00:00:00Z', '2026-12-05T00:00:00Z', false, $4)`,
        [taskId, boardId, colId, leadId],
      );
      await client.query(
        `INSERT INTO task_assignees (task_id, user_id, accepted_at) VALUES ($1, $2, now())`,
        [taskId, leadId],
      );

      // task_deliverables CHECKs (blank title, javascript: url) and submitted_by RESTRICT
      await expectPgError(
        client,
        'sp_0008_deliv_title',
        () =>
          client.query(
            `INSERT INTO task_deliverables (task_id, title, url, submitted_by)
             VALUES ($1, '   ', 'https://example.com/ok', $2)`,
            [taskId, leadId],
          ),
        { code: '23514' },
      );
      await expectPgError(
        client,
        'sp_0008_deliv_url',
        () =>
          client.query(
            `INSERT INTO task_deliverables (task_id, title, url, submitted_by)
             VALUES ($1, 'Valid Title', 'javascript:alert(1)', $2)`,
            [taskId, leadId],
          ),
        { code: '23514' },
      );
      await client.query(
        `INSERT INTO task_deliverables (task_id, title, url, submitted_by)
         VALUES ($1, 'Valid Deck', 'https://example.com/deck', $2)`,
        [taskId, leadId],
      );
      await expectPgError(
        client,
        'sp_0008_deliv_submitter_restrict',
        () => client.query(`DELETE FROM profiles WHERE id = $1`, [leadId]),
        { code: '23503' },
      );

      // notifications accepts CR-09 types
      await client.query(
        `INSERT INTO notifications (user_id, type, task_id, board_id, actor_id, is_hidden_task)
         VALUES ($1, 'task.accepted', $2, $3, $1, false),
                ($1, 'task.deliverable_submitted', $2, $3, $1, false)`,
        [leadId, taskId, boardId],
      );

      // Deleting task cascades task_deliverables; deleting lead profile sets departments.lead_user_id = NULL when unblocked
      await client.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
      const delivCount = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM task_deliverables WHERE task_id = $1`,
        [taskId],
      );
      expect(delivCount.rows[0]?.cnt).toBe(0);

      // 0009 DDL constraints: NOT NULL start_at/due_at, BEFORE INSERT normalization trigger, NOT NULL on UPDATE, CHECK start_at <= due_at
      const taskColsRes = await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name IN ('start_at', 'due_at')
         ORDER BY column_name ASC`,
      );
      expect(taskColsRes.rows).toEqual([
        { column_name: 'due_at', is_nullable: 'NO' },
        { column_name: 'start_at', is_nullable: 'NO' },
      ]);

      const triggerTaskBothNullId = '98000000-0000-4000-8000-000000000006';
      const triggerTaskStartNullId = '98000000-0000-4000-8000-000000000007';
      const normalizedBothNull = await client.query<{ start_at: Date; due_at: Date }>(
        `INSERT INTO tasks (id, board_id, column_id, title, position, start_at, due_at, created_by)
         VALUES ($1, $2, $3, 'Normalized Both Null', '2000', NULL, NULL, $4)
         RETURNING start_at, due_at`,
        [triggerTaskBothNullId, boardId, colId, leadId],
      );
      expect(normalizedBothNull.rows[0]?.start_at).toBeInstanceOf(Date);
      expect(normalizedBothNull.rows[0]?.due_at).toBeInstanceOf(Date);
      expect(normalizedBothNull.rows[0]!.start_at.getTime()).toBeLessThanOrEqual(
        normalizedBothNull.rows[0]!.due_at.getTime(),
      );

      const normalizedStartNull = await client.query<{ start_at: Date; due_at: Date }>(
        `INSERT INTO tasks (id, board_id, column_id, title, position, start_at, due_at, created_at, created_by)
         VALUES ($1, $2, $3, 'Normalized Start Null', '3000', NULL, '2026-12-01T00:00:00Z', '2026-11-25T00:00:00Z', $4)
         RETURNING start_at, due_at`,
        [triggerTaskStartNullId, boardId, colId, leadId],
      );
      expect(normalizedStartNull.rows[0]!.start_at.toISOString()).toBe('2026-11-25T00:00:00.000Z');
      expect(normalizedStartNull.rows[0]!.due_at.toISOString()).toBe('2026-12-01T00:00:00.000Z');

      await expectPgError(
        client,
        'sp_0009_update_start_null',
        () => client.query(`UPDATE tasks SET start_at = NULL WHERE id = $1`, [triggerTaskBothNullId]),
        { code: '23502' },
      );
      await expectPgError(
        client,
        'sp_0009_update_due_null',
        () => client.query(`UPDATE tasks SET due_at = NULL WHERE id = $1`, [triggerTaskBothNullId]),
        { code: '23502' },
      );
      await expectPgError(
        client,
        'sp_0009_update_range_chk',
        () =>
          client.query(
            `UPDATE tasks SET start_at = '2026-12-10T00:00:00Z', due_at = '2026-12-01T00:00:00Z' WHERE id = $1`,
            [triggerTaskBothNullId],
          ),
        { code: '23514' },
      );
      await client.query(`DELETE FROM tasks WHERE id IN ($1, $2)`, [
        triggerTaskBothNullId,
        triggerTaskStartNullId,
      ]);

      await client.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
      await client.query(`DELETE FROM profiles WHERE id = $1`, [leadId]);
      const deptAfter = await client.query<{ lead_user_id: string | null }>(
        `SELECT lead_user_id FROM departments WHERE id = $1`,
        [deptId],
      );
      expect(deptAfter.rows[0]?.lead_user_id).toBeNull();
    });
  });
});
