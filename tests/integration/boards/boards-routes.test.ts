import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  departments,
  memberDepartments,
  permissions,
  profiles,
  taskAssignees,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as columnsPost } from '@/app/api/v1/boards/[id]/columns/route';
import { PUT as columnsOrderPut } from '@/app/api/v1/boards/[id]/columns/order/route';
import {
  DELETE as boardDelete,
  GET as boardGet,
  PATCH as boardPatch,
} from '@/app/api/v1/boards/[id]/route';
import { GET as boardsGet, POST as boardsPost } from '@/app/api/v1/boards/route';
import { DELETE as columnDelete, PATCH as columnPatch } from '@/app/api/v1/columns/[id]/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DEFAULT_BOARD_COLUMN_NAMES } from '@/lib/boards';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTasksRepository } from '@/server/modules/tasks';
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

describe('Boards & Columns Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for boards integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces authz, WQ-01 archive, WQ-05 hidden active task delete block, WQ-33 soft-delete detach, and zero hidden count/PII leaks', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const updaterId = randomUUID();
    const viewerId = randomUUID();
    const deptId = randomUUID();

    const adminSid = `MSSV-BADMIN-${suffix}`;
    const updaterSid = `MSSV-BUPD-${suffix}`;
    const viewerSid = `MSSV-BVIEW-${suffix}`;
    const baseHost = Math.floor(Math.random() * 140) + 10;

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `boards-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'boards-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
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
        logger: new StructuredLogger({ writeOut: () => undefined, writeErr: () => undefined }),
      });
      setContainerForTesting(container);

      await tx.insert(permissions).values([
        { code: 'board.create', groupName: 'boards', description: 'BC', scopable: false },
        { code: 'board.update', groupName: 'boards', description: 'BU', scopable: false },
        { code: 'board.delete', groupName: 'boards', description: 'BD', scopable: false },
        { code: 'member.view', groupName: 'members', description: 'MV', scopable: false },
      ]).onConflictDoNothing();

      await tx.insert(departments).values({ id: deptId, name: `Boards Dept ${suffix}` });
      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `b-admin-${suffix}@eiu.edu.vn`, fullName: `Board Admin ${suffix}`, passwordHash: seedPasswordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: updaterId, studentId: updaterSid, email: `b-upd-${suffix}@eiu.edu.vn`, fullName: `Board Updater ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'en' },
        { id: viewerId, studentId: viewerSid, email: `b-view-${suffix}@eiu.edu.vn`, fullName: `Board Viewer ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
      ]);
      await tx.insert(memberDepartments).values({ userId: adminId, departmentId: deptId });
      await tx.insert(userPermissions).values([
        { userId: updaterId, permissionCode: 'board.create', grantedBy: null },
        { userId: updaterId, permissionCode: 'board.update', grantedBy: null },
        { userId: viewerId, permissionCode: 'member.view', grantedBy: null },
      ]);

      const loginAs = async (studentId: string, hostOffset: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + hostOffset}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const adminCookie = await loginAs(adminSid, 0);
      const updaterCookie = await loginAs(updaterSid, 1);
      const viewerCookie = await loginAs(viewerSid, 2);

      // 401 & 403 checks
      expect((await boardsGet(new Request('http://localhost:3000/api/v1/boards'))).status).toBe(401);
      expect((await boardsPost(new Request('http://localhost:3000/api/v1/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }))).status).toBe(401);
      expect((await boardsGet(new Request('http://localhost:3000/api/v1/boards?includeArchived=true', { headers: { cookie: viewerCookie } }))).status).toBe(403);
      expect((await boardsPost(new Request('http://localhost:3000/api/v1/boards', { method: 'POST', headers: { 'content-type': 'application/json', cookie: viewerCookie }, body: JSON.stringify({ name: 'X' }) }))).status).toBe(403);

      // Create board with departmentId -> 4 default columns
      const createRes = await boardsPost(new Request('http://localhost:3000/api/v1/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: updaterCookie },
        body: JSON.stringify({ name: `Board ${suffix}`, departmentId: deptId }),
      }));
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        board: { id: string; columns: Array<{ id: string; name: string }>; createdBy: Record<string, unknown> };
      };
      expect(created.board.columns.map((c) => c.name)).toEqual([...DEFAULT_BOARD_COLUMN_NAMES]);
      expect('studentId' in created.board.createdBy).toBe(false);
      expect('email' in created.board.createdBy).toBe(false);
      const boardId = created.board.id;
      const todoColId = created.board.columns[0]!.id;

      // Hidden task inserted into Todo (created by admin, assigned to admin only)
      const hiddenTaskId = randomUUID();
      await tx.insert(tasks).values({
        id: hiddenTaskId,
        boardId,
        columnId: todoColId,
        title: `Secret Col Task ${suffix}`,
        priority: 3,
        position: '1000',
        isHidden: true,
        createdBy: adminId,
      });
      await tx.insert(taskAssignees).values({ taskId: hiddenTaskId, userId: adminId });

      // Non-viewer updater sees taskCount=0, admin sees taskCount=1
      const detailUpdater = (await (await boardGet(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}`, { headers: { cookie: updaterCookie } }),
        { params: Promise.resolve({ id: boardId }) },
      )).json()) as { board: { columns: Array<{ taskCount: number }>; tasks: unknown[] } };
      expect(detailUpdater.board.tasks).toHaveLength(0);
      expect(detailUpdater.board.columns[0]!.taskCount).toBe(0);

      const detailAdmin = (await (await boardGet(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}`, { headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ id: boardId }) },
      )).json()) as { board: { columns: Array<{ taskCount: number }>; tasks: unknown[] } };
      expect(detailAdmin.board.tasks).toHaveLength(1);
      expect(detailAdmin.board.columns[0]!.taskCount).toBe(1);

      // WQ-05: hidden active task blocks DELETE /columns/[id] with 409 COLUMN_NOT_EMPTY
      const deleteBusyCol = await columnDelete(
        new Request(`http://localhost:3000/api/v1/columns/${todoColId}`, { method: 'DELETE', headers: { cookie: updaterCookie } }),
        { params: Promise.resolve({ id: todoColId }) },
      );
      expect(deleteBusyCol.status).toBe(409);
      expect(((await deleteBusyCol.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'COLUMN_NOT_EMPTY',
        messageKey: 'errors.columnNotEmpty',
      });

      // WQ-33: once hidden task is soft-deleted, column deletes and detaches trashed task column_id = NULL
      await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, hiddenTaskId));
      const deleteOkCol = await columnDelete(
        new Request(`http://localhost:3000/api/v1/columns/${todoColId}`, { method: 'DELETE', headers: { cookie: updaterCookie } }),
        { params: Promise.resolve({ id: todoColId }) },
      );
      expect(deleteOkCol.status).toBe(200);
      expect(await deleteOkCol.json()).toEqual({ deleted: true, id: todoColId });
      const [detachedTask] = await tx.select({ columnId: tasks.columnId }).from(tasks).where(eq(tasks.id, hiddenTaskId));
      expect(detachedTask?.columnId).toBeNull();

      // Add & rename & reorder remaining columns
      const addColRes = await columnsPost(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}/columns`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: updaterCookie },
          body: JSON.stringify({ name: 'Backlog', orderIndex: 0 }),
        }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(addColRes.status).toBe(201);
      const newColId = ((await addColRes.json()) as { column: { id: string } }).column.id;

      const renameColRes = await columnPatch(
        new Request(`http://localhost:3000/api/v1/columns/${newColId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: updaterCookie },
          body: JSON.stringify({ name: 'Triage' }),
        }),
        { params: Promise.resolve({ id: newColId }) },
      );
      expect(renameColRes.status).toBe(200);

      const remainingIds = [
        created.board.columns[1]!.id,
        created.board.columns[2]!.id,
        created.board.columns[3]!.id,
        newColId,
      ];
      const badOrderRes = await columnsOrderPut(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}/columns/order`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: updaterCookie },
          body: JSON.stringify({ columnIds: [newColId] }),
        }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(badOrderRes.status).toBe(400);
      expect(((await badOrderRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'INVALID_COLUMN_ORDER',
        messageKey: 'errors.invalidColumnOrder',
      });

      const goodOrderRes = await columnsOrderPut(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}/columns/order`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: updaterCookie },
          body: JSON.stringify({ columnIds: remainingIds }),
        }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(goodOrderRes.status).toBe(200);
      expect(
        ((await goodOrderRes.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id),
      ).toEqual(remainingIds);

      // Verify 403 FORBIDDEN on all 5 board.update endpoints for member lacking board.update
      for (const denyRes of [
        await boardPatch(
          new Request(`http://localhost:3000/api/v1/boards/${boardId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', cookie: viewerCookie },
            body: JSON.stringify({ name: 'Deny Patch' }),
          }),
          { params: Promise.resolve({ id: boardId }) },
        ),
        await columnsPost(
          new Request(`http://localhost:3000/api/v1/boards/${boardId}/columns`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: viewerCookie },
            body: JSON.stringify({ name: 'Deny Col' }),
          }),
          { params: Promise.resolve({ id: boardId }) },
        ),
        await columnPatch(
          new Request(`http://localhost:3000/api/v1/columns/${newColId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', cookie: viewerCookie },
            body: JSON.stringify({ name: 'Deny Rename' }),
          }),
          { params: Promise.resolve({ id: newColId }) },
        ),
        await columnDelete(
          new Request(`http://localhost:3000/api/v1/columns/${newColId}`, {
            method: 'DELETE',
            headers: { cookie: viewerCookie },
          }),
          { params: Promise.resolve({ id: newColId }) },
        ),
        await columnsOrderPut(
          new Request(`http://localhost:3000/api/v1/boards/${boardId}/columns/order`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', cookie: viewerCookie },
            body: JSON.stringify({ columnIds: remainingIds }),
          }),
          { params: Promise.resolve({ id: boardId }) },
        ),
      ]) {
        expect(denyRes.status).toBe(403);
        expect(((await denyRes.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
      }

      // Archive board requires board.delete; admin succeeds; WQ-01 includeArchived=true shows it to admin
      expect((await boardDelete(new Request(`http://localhost:3000/api/v1/boards/${boardId}`, { method: 'DELETE', headers: { cookie: updaterCookie } }), { params: Promise.resolve({ id: boardId }) })).status).toBe(403);
      expect((await boardDelete(new Request(`http://localhost:3000/api/v1/boards/${boardId}`, { method: 'DELETE', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: boardId }) })).status).toBe(200);

      const archivedList = (await (await boardsGet(new Request(`http://localhost:3000/api/v1/boards?departmentId=${deptId}&includeArchived=true`, { headers: { cookie: adminCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(archivedList.items.some((b) => b.id === boardId)).toBe(true);

      const unarchiveRes = await boardPatch(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: updaterCookie },
          body: JSON.stringify({ name: `Board Renamed ${suffix}`, unarchive: true }),
        }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(unarchiveRes.status).toBe(200);
      expect(((await unarchiveRes.json()) as { board: { archivedAt: string | null } }).board.archivedAt).toBeNull();

      // Verify audit_logs and zero PII
      const audits = await tx.select().from(auditLogs).where(eq(auditLogs.actorId, updaterId));
      expect(audits.map((a) => a.action)).toContain('board.created');
      expect(audits.map((a) => a.action)).toContain('board.updated');

      // Ensure test rollback doesn't leave task_events referencing task without cleanup if any
      const eventsCount = await tx.select().from(taskEvents).where(eq(taskEvents.boardId, boardId));
      expect(eventsCount).toHaveLength(0);
    });
  });
});
