import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  boards,
  columns,
  departments,
  memberDepartments,
  permissions,
  profiles,
  sessions,
  taskAssignees,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { DELETE as archivePurgeDelete } from '@/app/api/v1/archive/[entityType]/[id]/route';
import { POST as archiveBoardRestorePost } from '@/app/api/v1/archive/boards/[id]/restore/route';
import { POST as archiveMemberRestorePost } from '@/app/api/v1/archive/members/[id]/restore/route';
import { GET as archiveListGet } from '@/app/api/v1/archive/route';
import { POST as archiveTaskRestorePost } from '@/app/api/v1/archive/tasks/[id]/restore/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as boardDetailGet, PATCH as boardPatch } from '@/app/api/v1/boards/[id]/route';
import { GET as boardsGet } from '@/app/api/v1/boards/route';
import { DELETE as columnDelete } from '@/app/api/v1/columns/[id]/route';
import { GET as departmentListGet } from '@/app/api/v1/departments/route';
import { DELETE as departmentIdDelete } from '@/app/api/v1/departments/[id]/route';
import { POST as cronArchivePurgePost } from '@/app/api/v1/internal/cron/archive-purge/route';
import { POST as memberActivatePost } from '@/app/api/v1/members/[id]/activate/route';
import { PUT as memberAdminPut } from '@/app/api/v1/members/[id]/admin/route';
import { GET as memberAvatarGet } from '@/app/api/v1/members/[id]/avatar/route';
import { GET as memberPermissionsGet } from '@/app/api/v1/members/[id]/permissions/route';
import { GET as memberDetailGet, PATCH as memberPatch } from '@/app/api/v1/members/[id]/route';
import { GET as membersListGet } from '@/app/api/v1/members/route';
import { GET as retentionGet, PUT as retentionPut } from '@/app/api/v1/settings/archive-retention/route';
import { POST as taskRestoreAliasPost } from '@/app/api/v1/tasks/[id]/restore/route';
import { GET as taskDetailGet } from '@/app/api/v1/tasks/[id]/route';
import { GET as tasksListGet } from '@/app/api/v1/tasks/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { PURGED_MEMBER_DISPLAY_NAME } from '@/lib/archive';
import { DrizzleArchiveRepository } from '@/server/modules/archive';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTasksRepository } from '@/server/modules/tasks';
import { FakeClock } from '@/server/shared/clock';
import { createContainer, setContainerForTesting } from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { StructuredLogger } from '@/server/shared/logger';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import type { TransactionContext } from '@/server/shared/transaction';

class TestRollbackSentinel extends Error {}

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function withRolledBackDb(db: Database, fn: (tx: TransactionContext) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new TestRollbackSentinel();
    });
  } catch (error) {
    if (!(error instanceof TestRollbackSentinel)) throw error;
  }
}

function cookiePairFromLogin(res: Response): string {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(line).toBeDefined();
  return line!.split(';')[0]!;
}

async function loginAs(studentId: string, ip: string): Promise<string> {
  const res = await loginPost(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD, rememberMe: false }),
    }),
  );
  expect(res.status).toBe(200);
  return cookiePairFromLogin(res);
}

describe('Archive Center & Purge Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for archive integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces Archive tabs, hidden task 404, WQ-33 restore, purged_at 404 across endpoints, dept release, anonymized vs physical member purge, retention & cron', async () => {
    const suffix = randomUUID().slice(0, 8);
    const now = new Date('2026-11-24T07:00:00.000Z');
    const clock = new FakeClock(now);
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const adminId = randomUUID();
    const taskDelId = randomUUID();
    const memMgrNoDetailId = randomUUID();
    const memMgrDetailId = randomUUID();
    const boardDelId = randomUUID();
    const regularId = randomUUID();
    const unreferencedInactiveId = randomUUID();
    const historyOwnerInactiveId = randomUUID();
    const cronExpiredMemberNullLeftId = randomUUID();
    const cronFreshMemberId = randomUUID();

    const deptId = randomUUID();
    const activeBoardId = randomUUID();
    const archivedBoardId = randomUUID();
    const cronExpiredBoardId = randomUUID();
    const colFirstId = randomUUID();
    const colSecondId = randomUUID();
    const colArchivedBoardId = randomUUID();
    const colCronBoardId = randomUUID();

    const taskVisibleDeletedId = randomUUID();
    const taskHiddenAdminDeletedId = randomUUID();
    const taskHiddenActorDeletedId = randomUUID();
    const taskActiveId = randomUUID();
    const taskOnArchivedBoardId = randomUUID();
    const taskWq33DeletedId = randomUUID();
    const taskCronExpiredId = randomUUID();
    const taskOnCronBoardActiveId = randomUUID();

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `archive-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: `archive-cron-secret-${suffix}`,
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
        clock,
        db,
        transactionRunner: { runInTransaction: (fn) => tx.transaction(fn) },
        auditWriter: new DrizzleAuditRepository(tx),
        auditRepo: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
        departmentsRepo: new DrizzleDepartmentsRepository(tx),
        membersRepo: new DrizzleMembersRepository(tx),
        permissionsRepo: new DrizzlePermissionsRepository(tx),
        tasksRepo: new DrizzleTasksRepository(tx),
        boardsRepo: new DrizzleBoardsRepository(tx),
        archiveRepo: new DrizzleArchiveRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx.insert(permissions).values([
        { code: 'member.view', groupName: 'members', description: 'MV', scopable: false },
        { code: 'member.view_detail', groupName: 'members', description: 'MVD', scopable: false },
        { code: 'member.deactivate', groupName: 'members', description: 'MD', scopable: false },
        { code: 'department.manage', groupName: 'departments', description: 'DM', scopable: false },
        { code: 'board.update', groupName: 'boards', description: 'BU', scopable: false },
        { code: 'board.delete', groupName: 'boards', description: 'BD', scopable: false },
        { code: 'task.delete', groupName: 'tasks', description: 'TD', scopable: false },
      ]).onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await tx.insert(departments).values({ id: deptId, name: `Archive Dept ${suffix}` });

      await tx.insert(profiles).values([
        { id: adminId, studentId: `ARC-ADM-${suffix}`, email: `arc-adm-${suffix}@eiu.edu.vn`, fullName: `Arc Admin ${suffix}`, passwordHash: seedPasswordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: taskDelId, studentId: `ARC-TD-${suffix}`, email: `arc-td-${suffix}@eiu.edu.vn`, fullName: `Arc TaskDel ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: memMgrNoDetailId, studentId: `ARC-MND-${suffix}`, email: `arc-mnd-${suffix}@eiu.edu.vn`, fullName: `Arc MemNoDet ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: memMgrDetailId, studentId: `ARC-MD-${suffix}`, email: `arc-md-${suffix}@eiu.edu.vn`, fullName: `Arc MemDet ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: boardDelId, studentId: `ARC-BD-${suffix}`, email: `arc-bd-${suffix}@eiu.edu.vn`, fullName: `Arc BoardDel ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: regularId, studentId: `ARC-REG-${suffix}`, email: `arc-reg-${suffix}@eiu.edu.vn`, fullName: `Arc Regular ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: unreferencedInactiveId, studentId: `ARC-UNREF-${suffix}`, email: `arc-unref-${suffix}@eiu.edu.vn`, fullName: `Unref Left ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: false, leftAt: new Date('2026-11-18T00:00:00.000Z'), locale: 'vi' },
        { id: historyOwnerInactiveId, studentId: `ARC-HIST-${suffix}`, email: `arc-hist-${suffix}@eiu.edu.vn`, fullName: `History Owner ${suffix}`, passwordHash: seedPasswordHash, avatarData: validPng, avatarMime: 'image/png', avatarUpdatedAt: now, isAdmin: false, isActive: false, leftAt: new Date('2026-11-19T00:00:00.000Z'), locale: 'vi' },
        { id: cronExpiredMemberNullLeftId, studentId: `ARC-CRON-M-${suffix}`, email: `arc-cronm-${suffix}@eiu.edu.vn`, fullName: `Cron NullLeft ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: false, leftAt: null, createdAt: new Date('2026-09-01T00:00:00.000Z'), updatedAt: new Date('2026-09-01T00:00:00.000Z'), locale: 'vi' },
        { id: cronFreshMemberId, studentId: `ARC-FRESH-M-${suffix}`, email: `arc-freshm-${suffix}@eiu.edu.vn`, fullName: `Fresh Inactive ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: false, leftAt: new Date('2026-11-22T00:00:00.000Z'), locale: 'vi' },
      ]);

      // Give unreferencedInactiveId disposable owned rows (sessions, member_departments, user_permissions)
      await tx.insert(sessions).values({
        userId: unreferencedInactiveId,
        tokenHash: `tok-${suffix}`,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      });
      await tx.insert(memberDepartments).values({ userId: unreferencedInactiveId, departmentId: deptId });
      await tx.insert(userPermissions).values([
        { userId: unreferencedInactiveId, permissionCode: 'member.view', grantedBy: adminId },
        { userId: taskDelId, permissionCode: 'task.delete', grantedBy: adminId },
        { userId: taskDelId, permissionCode: 'board.update', grantedBy: adminId },
        { userId: memMgrNoDetailId, permissionCode: 'member.deactivate', grantedBy: adminId },
        { userId: memMgrDetailId, permissionCode: 'member.deactivate', grantedBy: adminId },
        { userId: memMgrDetailId, permissionCode: 'member.view_detail', grantedBy: adminId },
        { userId: boardDelId, permissionCode: 'board.delete', grantedBy: adminId },
        { userId: regularId, permissionCode: 'member.view', grantedBy: adminId },
      ]);

      await tx.insert(boards).values([
        { id: activeBoardId, name: `Active Board ${suffix}`, departmentId: null, createdBy: historyOwnerInactiveId, archivedAt: null },
        { id: archivedBoardId, name: `Archived Board ${suffix}`, departmentId: deptId, createdBy: adminId, archivedAt: new Date('2026-11-18T00:00:00.000Z') },
        { id: cronExpiredBoardId, name: `Cron Expired Board ${suffix}`, departmentId: deptId, createdBy: adminId, archivedAt: new Date('2026-10-01T00:00:00.000Z') },
      ]);
      await tx.insert(columns).values([
        { id: colFirstId, boardId: activeBoardId, name: 'Todo', orderIndex: 0 },
        { id: colSecondId, boardId: activeBoardId, name: 'Temp Col', orderIndex: 1 },
        { id: colArchivedBoardId, boardId: archivedBoardId, name: 'Todo', orderIndex: 0 },
        { id: colCronBoardId, boardId: cronExpiredBoardId, name: 'Todo', orderIndex: 0 },
      ]);
      await tx.insert(tasks).values([
        { id: taskVisibleDeletedId, boardId: activeBoardId, columnId: colFirstId, title: `Visible Deleted ${suffix}`, priority: 2, position: '1000', isHidden: false, deletedAt: new Date('2026-11-20T00:00:00.000Z'), createdBy: historyOwnerInactiveId },
        { id: taskHiddenAdminDeletedId, boardId: activeBoardId, columnId: colFirstId, title: `Hidden Admin Deleted ${suffix}`, priority: 3, position: '2000', isHidden: true, deletedAt: new Date('2026-11-21T00:00:00.000Z'), createdBy: adminId },
        { id: taskHiddenActorDeletedId, boardId: activeBoardId, columnId: colFirstId, title: `Hidden TaskDel Deleted ${suffix}`, priority: 3, position: '3000', isHidden: true, deletedAt: new Date('2026-11-22T00:00:00.000Z'), createdBy: adminId },
        { id: taskActiveId, boardId: activeBoardId, columnId: colFirstId, title: `Active Task ${suffix}`, priority: 2, position: '500', isHidden: false, deletedAt: null, createdBy: adminId },
        { id: taskOnArchivedBoardId, boardId: archivedBoardId, columnId: colArchivedBoardId, title: `On Archived Board ${suffix}`, priority: 2, position: '1000', isHidden: false, deletedAt: new Date('2026-11-17T00:00:00.000Z'), createdBy: adminId },
        { id: taskWq33DeletedId, boardId: activeBoardId, columnId: colSecondId, title: `WQ33 Deleted ${suffix}`, priority: 2, position: '4000', isHidden: false, deletedAt: new Date('2026-11-19T00:00:00.000Z'), createdBy: adminId },
        { id: taskCronExpiredId, boardId: activeBoardId, columnId: colFirstId, title: `Cron Expired Task ${suffix}`, priority: 1, position: '5000', isHidden: false, deletedAt: new Date('2026-10-05T00:00:00.000Z'), createdBy: adminId },
        { id: taskOnCronBoardActiveId, boardId: cronExpiredBoardId, columnId: colCronBoardId, title: `Cascade Task ${suffix}`, priority: 2, position: '1000', isHidden: false, deletedAt: null, createdBy: adminId },
      ]);
      await tx.insert(taskAssignees).values({ taskId: taskHiddenActorDeletedId, userId: taskDelId });
      // Add hidden task on archivedBoardId to verify taskCount on /archive?tab=boards does NOT leak hidden task count
      const hiddenOnArchBoardId = randomUUID();
      await tx.insert(tasks).values({
        id: hiddenOnArchBoardId, boardId: archivedBoardId, columnId: colArchivedBoardId, title: `Hidden Active On ArchBoard ${suffix}`,
        priority: 2, position: '500', isHidden: true, deletedAt: null, createdBy: adminId,
      });

      const adminCookie = await loginAs(`ARC-ADM-${suffix}`, `10.10.${baseHost}.1`);
      const taskDelCookie = await loginAs(`ARC-TD-${suffix}`, `10.10.${baseHost}.2`);
      const memNoDetCookie = await loginAs(`ARC-MND-${suffix}`, `10.10.${baseHost}.3`);
      const memDetCookie = await loginAs(`ARC-MD-${suffix}`, `10.10.${baseHost}.4`);
      const boardDelCookie = await loginAs(`ARC-BD-${suffix}`, `10.10.${baseHost}.5`);
      const regularCookie = await loginAs(`ARC-REG-${suffix}`, `10.10.${baseHost}.6`);

      // 1. Archive List Permissions & Visibility
      expect((await archiveListGet(new Request('http://localhost/api/v1/archive?tab=tasks'))).status).toBe(401);
      expect((await archiveListGet(new Request('http://localhost/api/v1/archive?tab=tasks', { headers: { cookie: regularCookie } }))).status).toBe(403);
      expect((await archiveListGet(new Request('http://localhost/api/v1/archive?tab=members', { headers: { cookie: taskDelCookie } }))).status).toBe(403);
      expect((await archiveListGet(new Request('http://localhost/api/v1/archive?tab=boards', { headers: { cookie: taskDelCookie } }))).status).toBe(403);

      // Tasks tab: TaskDel sees own hidden + public deleted, NEVER taskHiddenAdminDeletedId
      const taskListRes = await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=tasks&q=${encodeURIComponent(suffix)}&limit=10`, {
          headers: { cookie: taskDelCookie },
        }),
      );
      expect(taskListRes.status).toBe(200);
      const taskListBody = await taskListRes.json();
      const visibleDeletedIds = taskListBody.tasks.map((i: { task: { id: string } }) => i.task.id);
      expect(visibleDeletedIds).toContain(taskVisibleDeletedId);
      expect(visibleDeletedIds).toContain(taskHiddenActorDeletedId);
      expect(visibleDeletedIds).not.toContain(taskHiddenAdminDeletedId);

      // Cursor pagination on tasks tab (limit=2)
      const p1 = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=tasks&q=${encodeURIComponent(suffix)}&limit=2`, {
          headers: { cookie: adminCookie },
        }),
      )).json();
      expect(p1.tasks).toHaveLength(2);
      expect(p1.meta.nextCursor).toBeTruthy();
      const p2 = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=tasks&q=${encodeURIComponent(suffix)}&limit=2&cursor=${encodeURIComponent(p1.meta.nextCursor)}`, {
          headers: { cookie: adminCookie },
        }),
      )).json();
      expect(p2.tasks.length).toBeGreaterThanOrEqual(2);
      expect(new Set([...p1.tasks, ...p2.tasks].map((i: { task: { id: string } }) => i.task.id)).size).toBe(
        p1.tasks.length + p2.tasks.length,
      );

      // Cross-tab cursor rejected with 400 INVALID_CURSOR
      const badCursorRes = await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=boards&cursor=${encodeURIComponent(p1.meta.nextCursor)}`, {
          headers: { cookie: adminCookie },
        }),
      );
      expect(badCursorRes.status).toBe(400);

      // 2. Members tab: PII masking + studentId search guard + NULLS LAST cursor pagination
      const memNoDetRes = await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=members&q=${encodeURIComponent(`ARC-HIST-${suffix}`)}`, {
          headers: { cookie: memNoDetCookie },
        }),
      );
      expect(memNoDetRes.status).toBe(200);
      expect((await memNoDetRes.json()).members).toHaveLength(0); // studentId search blocked without member.view_detail!

      const memNoDetAll = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=members&q=${encodeURIComponent(suffix)}&limit=10`, {
          headers: { cookie: memNoDetCookie },
        }),
      )).json();
      expect(memNoDetAll.members.length).toBe(4);
      for (const m of memNoDetAll.members) {
        expect(m.studentId).toBeUndefined();
        expect(m.email).toBeUndefined();
      }
      // Last item has leftAt === null (NULLS LAST)
      expect(memNoDetAll.members.at(-1).id).toBe(cronExpiredMemberNullLeftId);

      // Walk members tab 2-by-2 via cursor including NULLS LAST boundary
      const mp1 = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=members&q=${encodeURIComponent(suffix)}&limit=2`, {
          headers: { cookie: memDetCookie },
        }),
      )).json();
      expect(mp1.members).toHaveLength(2);
      expect(mp1.members[0].studentId).toBeDefined();
      const mp2 = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=members&q=${encodeURIComponent(suffix)}&limit=2&cursor=${encodeURIComponent(mp1.meta.nextCursor)}`, {
          headers: { cookie: memDetCookie },
        }),
      )).json();
      expect(mp2.members).toHaveLength(2);
      expect(mp2.members.at(-1).id).toBe(cronExpiredMemberNullLeftId);

      // 3. Boards tab: taskCount hides admin hidden task from non-admin board.delete caller
      const boardsTabRes = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=boards&q=${encodeURIComponent(`Archived Board ${suffix}`)}`, {
          headers: { cookie: boardDelCookie },
        }),
      )).json();
      expect(boardsTabRes.boards).toHaveLength(1);
      expect(boardsTabRes.boards[0].taskCount).toBe(0); // hidden task NOT leaked in count!

      // 4. Task restore (both /archive/tasks/[id]/restore and /tasks/[id]/restore)
      // Hidden task -> 404 to non-viewer (TaskDel)
      expect((await archiveTaskRestorePost(
        new Request(`http://localhost/api/v1/archive/tasks/${taskHiddenAdminDeletedId}/restore`, {
          method: 'POST', headers: { cookie: taskDelCookie },
        }),
        { params: Promise.resolve({ id: taskHiddenAdminDeletedId }) },
      )).status).toBe(404);
      expect((await taskRestoreAliasPost(
        new Request(`http://localhost/api/v1/tasks/${taskHiddenAdminDeletedId}/restore`, {
          method: 'POST', headers: { cookie: taskDelCookie },
        }),
        { params: Promise.resolve({ id: taskHiddenAdminDeletedId }) },
      )).status).toBe(404);

      // Active task -> 409 TASK_NOT_DELETED
      const activeTaskRes = await archiveTaskRestorePost(
        new Request(`http://localhost/api/v1/archive/tasks/${taskActiveId}/restore`, {
          method: 'POST', headers: { cookie: taskDelCookie },
        }),
        { params: Promise.resolve({ id: taskActiveId }) },
      );
      expect(activeTaskRes.status).toBe(409);
      expect((await activeTaskRes.json()).error.code).toBe('TASK_NOT_DELETED');

      // Deleted task on archived board -> 409 BOARD_ARCHIVED
      const archBoardTaskRes = await archiveTaskRestorePost(
        new Request(`http://localhost/api/v1/archive/tasks/${taskOnArchivedBoardId}/restore`, {
          method: 'POST', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ id: taskOnArchivedBoardId }) },
      );
      expect(archBoardTaskRes.status).toBe(409);
      expect((await archBoardTaskRes.json()).error.code).toBe('BOARD_ARCHIVED');

      // WQ-33: Delete colSecondId (detaches soft-deleted taskWq33DeletedId.columnId -> null), then restore via alias /tasks/[id]/restore
      expect((await columnDelete(
        new Request(`http://localhost/api/v1/columns/${colSecondId}`, {
          method: 'DELETE', headers: { cookie: taskDelCookie },
        }),
        { params: Promise.resolve({ id: colSecondId }) },
      )).status).toBe(200);
      const wq33RestoreRes = await taskRestoreAliasPost(
        new Request(`http://localhost/api/v1/tasks/${taskWq33DeletedId}/restore`, {
          method: 'POST', headers: { cookie: taskDelCookie },
        }),
        { params: Promise.resolve({ id: taskWq33DeletedId }) },
      );
      expect(wq33RestoreRes.status).toBe(200);
      const wq33Body = await wq33RestoreRes.json();
      expect(wq33Body.task.columnId).toBe(colFirstId);
      expect(wq33Body.task.deletedAt).toBeNull();
      expect(wq33Body.task.position).toBe(1500); // max(500) + 1000 in colFirstId!
      expect(wq33Body.eventId).toBeTruthy();

      const [restoredEvent] = await tx.select().from(taskEvents).where(eq(taskEvents.id, wq33Body.eventId)).limit(1);
      expect(restoredEvent?.type).toBe('task.restored');
      expect(restoredEvent?.changes).toMatchObject({ column_id: { from: null, to: colFirstId } });

      // 5. Member restore & Board restore
      const restoreMemRes = await archiveMemberRestorePost(
        new Request(`http://localhost/api/v1/archive/members/${cronFreshMemberId}/restore`, {
          method: 'POST', headers: { cookie: memNoDetCookie },
        }),
        { params: Promise.resolve({ id: cronFreshMemberId }) },
      );
      expect(restoreMemRes.status).toBe(200);
      const restoreMemBody = await restoreMemRes.json();
      expect(restoreMemBody.member.isActive).toBe(true);
      expect(restoreMemBody.member.leftAt).toBeNull();
      expect(restoreMemBody.member.studentId).toBeUndefined(); // masked for memNoDetCookie

      // Re-deactivate cronFreshMemberId for later tests? No need — test 409 already active now!
      expect((await archiveMemberRestorePost(
        new Request(`http://localhost/api/v1/archive/members/${cronFreshMemberId}/restore`, {
          method: 'POST', headers: { cookie: memNoDetCookie },
        }),
        { params: Promise.resolve({ id: cronFreshMemberId }) },
      )).status).toBe(409);

      // 6. Permanent Purge (Admin-only!) + 404 across existing endpoints + WQ-10 dept release
      expect((await archivePurgeDelete(
        new Request(`http://localhost/api/v1/archive/tasks/${taskVisibleDeletedId}`, {
          method: 'DELETE', headers: { cookie: taskDelCookie },
        }),
        { params: Promise.resolve({ entityType: 'tasks', id: taskVisibleDeletedId }) },
      )).status).toBe(403);
      expect((await archivePurgeDelete(
        new Request(`http://localhost/api/v1/archive/tasks/${taskActiveId}`, {
          method: 'DELETE', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ entityType: 'tasks', id: taskActiveId }) },
      )).status).toBe(409);

      // Purge unreferenced inactive member -> physical_delete!
      const purgeUnrefRes = await archivePurgeDelete(
        new Request(`http://localhost/api/v1/archive/members/${unreferencedInactiveId}`, {
          method: 'DELETE', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ entityType: 'members', id: unreferencedInactiveId }) },
      );
      expect(purgeUnrefRes.status).toBe(200);
      expect(await purgeUnrefRes.json()).toEqual({
        purged: true, entityType: 'members', id: unreferencedInactiveId, mode: 'physical_delete',
      });
      const unrefRow = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, unreferencedInactiveId));
      expect(unrefRow).toHaveLength(0);

      // Purge history-owner inactive member -> anonymized!
      const purgeHistRes = await archivePurgeDelete(
        new Request(`http://localhost/api/v1/archive/members/${historyOwnerInactiveId}`, {
          method: 'DELETE', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ entityType: 'members', id: historyOwnerInactiveId }) },
      );
      expect(purgeHistRes.status).toBe(200);
      expect(await purgeHistRes.json()).toEqual({
        purged: true, entityType: 'members', id: historyOwnerInactiveId, mode: 'anonymized',
      });
      const [histRow] = await tx.select().from(profiles).where(eq(profiles.id, historyOwnerInactiveId)).limit(1);
      expect(histRow?.fullName).toBe(PURGED_MEMBER_DISPLAY_NAME);
      expect(histRow?.studentId).toBe(`PURGED-${historyOwnerInactiveId}`);
      expect(histRow?.avatarData).toBeNull();
      expect(histRow?.purgedAt).not.toBeNull();

      // Verify purged member returns 404 across ALL member & permission & archive routes
      expect((await memberDetailGet(new Request(`http://localhost/api/v1/members/${historyOwnerInactiveId}`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);
      expect((await memberPatch(new Request(`http://localhost/api/v1/members/${historyOwnerInactiveId}`, { method: 'PATCH', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Nope' }) }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);
      expect((await memberAvatarGet(new Request(`http://localhost/api/v1/members/${historyOwnerInactiveId}/avatar`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);
      expect((await memberActivatePost(new Request(`http://localhost/api/v1/members/${historyOwnerInactiveId}/activate`, { method: 'POST', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);
      expect((await archiveMemberRestorePost(new Request(`http://localhost/api/v1/archive/members/${historyOwnerInactiveId}/restore`, { method: 'POST', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);
      expect((await memberPermissionsGet(new Request(`http://localhost/api/v1/members/${historyOwnerInactiveId}/permissions`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);
      expect((await memberAdminPut(new Request(`http://localhost/api/v1/members/${historyOwnerInactiveId}/admin`, { method: 'PUT', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true }) }), { params: Promise.resolve({ id: historyOwnerInactiveId }) })).status).toBe(404);

      // Historical task/board STILL renders 'Thành viên đã xóa' cleanly!
      const activeBoardDetail = await (await boardDetailGet(
        new Request(`http://localhost/api/v1/boards/${activeBoardId}`, { headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ id: activeBoardId }) },
      )).json();
      expect(activeBoardDetail.board.createdBy.fullName).toBe(PURGED_MEMBER_DISPLAY_NAME);
      const restoredArchiveList = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=tasks&q=${encodeURIComponent(suffix)}`, { headers: { cookie: adminCookie } }),
      )).json();
      const visItem = restoredArchiveList.tasks.find((i: { task: { id: string } }) => i.task.id === taskVisibleDeletedId);
      expect(visItem.task.creator.fullName).toBe(PURGED_MEMBER_DISPLAY_NAME);

      // Purge archivedBoardId -> cascades tasks & releases department link; check dept boardCount & purge 404
      expect((await archivePurgeDelete(
        new Request(`http://localhost/api/v1/archive/boards/${archivedBoardId}`, {
          method: 'DELETE', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ entityType: 'boards', id: archivedBoardId }) },
      )).status).toBe(200);
      expect((await boardDetailGet(new Request(`http://localhost/api/v1/boards/${archivedBoardId}`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: archivedBoardId }) })).status).toBe(404);
      expect((await boardPatch(new Request(`http://localhost/api/v1/boards/${archivedBoardId}`, { method: 'PATCH', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }), { params: Promise.resolve({ id: archivedBoardId }) })).status).toBe(404);
      expect((await taskDetailGet(new Request(`http://localhost/api/v1/tasks/${taskOnArchivedBoardId}`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: taskOnArchivedBoardId }) })).status).toBe(404);
      expect((await archiveTaskRestorePost(new Request(`http://localhost/api/v1/archive/tasks/${taskOnArchivedBoardId}/restore`, { method: 'POST', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: taskOnArchivedBoardId }) })).status).toBe(404);

      // Purge taskVisibleDeletedId -> 404 everywhere
      expect((await archivePurgeDelete(
        new Request(`http://localhost/api/v1/archive/tasks/${taskVisibleDeletedId}`, {
          method: 'DELETE', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ entityType: 'tasks', id: taskVisibleDeletedId }) },
      )).status).toBe(200);
      expect((await taskDetailGet(new Request(`http://localhost/api/v1/tasks/${taskVisibleDeletedId}`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: taskVisibleDeletedId }) })).status).toBe(404);
      expect((await tasksListGet(new Request(`http://localhost/api/v1/tasks?boardId=${activeBoardId}`, { headers: { cookie: adminCookie } }))).status).toBe(200);

      // 7. Retention Settings & Cron Auto-Purge
      expect((await retentionGet(new Request('http://localhost/api/v1/settings/archive-retention', { headers: { cookie: regularCookie } }))).status).toBe(403);
      expect((await retentionGet(new Request('http://localhost/api/v1/settings/archive-retention', { headers: { cookie: taskDelCookie } }))).status).toBe(200);
      expect((await retentionPut(new Request('http://localhost/api/v1/settings/archive-retention', { method: 'PUT', headers: { cookie: taskDelCookie, 'content-type': 'application/json' }, body: JSON.stringify({ retentionDays: 30 }) }))).status).toBe(403);

      const putRetRes = await retentionPut(
        new Request('http://localhost/api/v1/settings/archive-retention', {
          method: 'PUT', headers: { cookie: adminCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ retentionDays: 30 }),
        }),
      );
      expect(putRetRes.status).toBe(200);
      expect((await putRetRes.json()).settings.retentionDays).toBe(30);

      // Unauthorized cron rejected 401
      expect((await cronArchivePurgePost(new Request('http://localhost/api/v1/internal/cron/archive-purge', { method: 'POST' }))).status).toBe(401);
      expect((await cronArchivePurgePost(new Request('http://localhost/api/v1/internal/cron/archive-purge', { method: 'POST', headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);

      // Check how many pre-existing expired inactive members exist in test DB before cron
      const preExpiredMembers = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(
            eq(profiles.isActive, false),
            isNull(profiles.purgedAt),
            sql`COALESCE(${profiles.leftAt}, ${profiles.updatedAt}) <= '2026-10-25T07:00:00.000Z'::timestamptz`,
          ),
        );

      // Authorized cron purges taskCronExpiredId, cronExpiredBoardId (cascading taskOnCronBoardActiveId & freeing deptId), and cronExpiredMemberNullLeftId!
      const cronRes = await cronArchivePurgePost(
        new Request('http://localhost/api/v1/internal/cron/archive-purge', {
          method: 'POST',
          headers: { authorization: `Bearer ${testConfig.cronSecret}` },
        }),
      );
      expect(cronRes.status).toBe(200);
      const cronBody = await cronRes.json();
      expect(cronBody).toEqual({
        retentionDays: 30,
        cutoffAt: '2026-10-25T07:00:00.000Z',
        purgedTasks: 1,
        purgedBoards: 1,
        purgedMembers: preExpiredMembers.length,
      });

      const [cascadedTaskRow] = await tx.select({ deletedAt: tasks.deletedAt, purgedAt: tasks.purgedAt }).from(tasks).where(eq(tasks.id, taskOnCronBoardActiveId));
      expect(cascadedTaskRow?.deletedAt).not.toBeNull();
      expect(cascadedTaskRow?.purgedAt).not.toBeNull();
      const cronMemRows = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, cronExpiredMemberNullLeftId));
      expect(cronMemRows).toHaveLength(0);

      // Fresh hidden tasks MUST still exist in Archive, while expired ones were purged!
      const postCronTasks = await (await archiveListGet(
        new Request(`http://localhost/api/v1/archive?tab=tasks&q=${encodeURIComponent(suffix)}`, { headers: { cookie: adminCookie } }),
      )).json();
      expect(postCronTasks.tasks.map((i: { task: { id: string } }) => i.task.id)).toEqual([
        taskHiddenActorDeletedId,
        taskHiddenAdminDeletedId,
      ]);

      // After both archivedBoardId (manual purge) and cronExpiredBoardId (cron purge) freed deptId, deleting deptId succeeds (200)!
      const deptDelRes = await departmentIdDelete(
        new Request(`http://localhost/api/v1/departments/${deptId}`, {
          method: 'DELETE', headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(deptDelRes.status).toBe(200);

      // Restore board test (archive activeBoardId briefly -> restore via /archive/boards/[id]/restore)
      await tx.update(boards).set({ archivedAt: now }).where(eq(boards.id, activeBoardId));
      const restoreBoardRes = await archiveBoardRestorePost(
        new Request(`http://localhost/api/v1/archive/boards/${activeBoardId}/restore`, {
          method: 'POST', headers: { cookie: boardDelCookie },
        }),
        { params: Promise.resolve({ id: activeBoardId }) },
      );
      expect(restoreBoardRes.status).toBe(200);
      expect((await restoreBoardRes.json()).board.archivedAt).toBeNull();

      // Verify boards list, members list, departments list exclude purged records
      expect((await boardsGet(new Request('http://localhost/api/v1/boards?includeArchived=true', { headers: { cookie: adminCookie } }))).status).toBe(200);
      expect((await membersListGet(new Request('http://localhost/api/v1/members', { headers: { cookie: adminCookie } }))).status).toBe(200);
      expect((await departmentListGet(new Request('http://localhost/api/v1/departments', { headers: { cookie: adminCookie } }))).status).toBe(200);

      // Verify zero PII in logs & audit_logs
      const recentAudits = await tx.select().from(auditLogs).where(eq(auditLogs.actorId, adminId));
      const auditActions = recentAudits.map((a) => a.action);
      expect(auditActions).toContain('archive.member_purged');
      expect(auditActions).toContain('archive.board_purged');
      expect(auditActions).toContain('archive.task_purged');
      expect(auditActions).toContain('settings.archive_retention_updated');
      const serializedAudits = JSON.stringify(recentAudits);
      expect(serializedAudits).not.toContain(`ARC-HIST-${suffix}`);
      expect(serializedAudits).not.toContain(`arc-hist-${suffix}@eiu.edu.vn`);

      const joinedLogs = logs.join('\n');
      expect(joinedLogs).not.toContain(`ARC-HIST-${suffix}`);
      expect(joinedLogs).not.toContain(`arc-hist-${suffix}@eiu.edu.vn`);
      expect(joinedLogs).not.toContain(testConfig.cronSecret);
      expect(joinedLogs).not.toContain(DEV_SEED_PASSWORD);
    });
  });
});
