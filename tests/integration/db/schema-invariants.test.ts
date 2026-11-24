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
  taskEvents,
  tasks,
  userPermissions,
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

  it('has all 19 Drizzle domain tables synced with PostgreSQL', async () => {
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
      comments,
      taskEvents,
      reminders,
    ];

    const tableNames = await Promise.all(
      tables.map(async (table) => {
        await db.select().from(table).limit(1);
        return getTableName(table);
      }),
    );

    expect(tableNames).toHaveLength(19);
    expect(new Set(tableNames).size).toBe(19);
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
});
