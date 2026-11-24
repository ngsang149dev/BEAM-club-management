import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  boards,
  columns,
  permissions,
  profiles,
  taskAssignees,
  taskEvents,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as myTasksGet } from '@/app/api/v1/me/tasks/route';
import { PUT as taskAssigneesPut } from '@/app/api/v1/tasks/[id]/assignees/route';
import {
  DELETE as taskDelete,
  GET as taskGet,
  PATCH as taskPatch,
} from '@/app/api/v1/tasks/[id]/route';
import { GET as tasksGet, POST as tasksPost } from '@/app/api/v1/tasks/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
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

describe('Tasks, Assignees & My Tasks Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for tasks integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces AC-06, taskVisibilityPolicy 404s, optimistic lock 409, WQ-03 /me/tasks, cursor pagination, append-only task_events, and zero PII', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const creatorOnlyId = randomUUID();
    const assignedOnlyId = randomUUID();
    const anyEditorId = randomUUID();
    const deleterId = randomUUID();
    const assignerId = randomUUID();
    const inactiveUserId = randomUUID();

    const adminSid = `MSSV-TADMIN-${suffix}`;
    const creatorSid = `MSSV-TCRE-${suffix}`;
    const assignedSid = `MSSV-TASS-${suffix}`;
    const anyEditorSid = `MSSV-TANY-${suffix}`;
    const deleterSid = `MSSV-TDEL-${suffix}`;
    const assignerSid = `MSSV-TASG-${suffix}`;
    const inactiveSid = `MSSV-TINACT-${suffix}`;
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `tasks-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'tasks-cron-secret',
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
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx.insert(permissions).values([
        { code: 'task.create', groupName: 'tasks', description: 'TC', scopable: false },
        { code: 'task.assign', groupName: 'tasks', description: 'TA', scopable: false },
        { code: 'task.update_any', groupName: 'tasks', description: 'TUA', scopable: false },
        { code: 'task.update_assigned', groupName: 'tasks', description: 'TUAS', scopable: false },
        { code: 'task.delete', groupName: 'tasks', description: 'TD', scopable: false },
      ]).onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `t-adm-${suffix}@eiu.edu.vn`, fullName: `Task Admin ${suffix}`, passwordHash: seedPasswordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: creatorOnlyId, studentId: creatorSid, email: `t-cre-${suffix}@eiu.edu.vn`, fullName: `Task Creator ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: assignedOnlyId, studentId: assignedSid, email: `t-ass-${suffix}@eiu.edu.vn`, fullName: `Task Assignee ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'en' },
        { id: anyEditorId, studentId: anyEditorSid, email: `t-any-${suffix}@eiu.edu.vn`, fullName: `Task AnyEditor ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deleterId, studentId: deleterSid, email: `t-del-${suffix}@eiu.edu.vn`, fullName: `Task Deleter ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: assignerId, studentId: assignerSid, email: `t-asg-${suffix}@eiu.edu.vn`, fullName: `Task Assigner ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: inactiveUserId, studentId: inactiveSid, email: `t-ina-${suffix}@eiu.edu.vn`, fullName: `Task Left ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: false, leftAt: new Date('2026-10-01T00:00:00.000Z'), locale: 'vi' },
      ]);
      await tx.insert(userPermissions).values([
        { userId: creatorOnlyId, permissionCode: 'task.create', grantedBy: null },
        { userId: assignedOnlyId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: anyEditorId, permissionCode: 'task.update_any', grantedBy: null },
        { userId: deleterId, permissionCode: 'task.delete', grantedBy: null },
        { userId: assignerId, permissionCode: 'task.assign', grantedBy: null },
      ]);

      const boardId = randomUUID();
      const otherBoardId = randomUUID();
      const todoColId = randomUUID();
      const doneColId = randomUUID();
      const otherColId = randomUUID();
      await tx.insert(boards).values([
        { id: boardId, name: `Tasks Board ${suffix}`, createdBy: adminId },
        { id: otherBoardId, name: `Other Board ${suffix}`, createdBy: adminId },
      ]);
      await tx.insert(columns).values([
        { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
        { id: doneColId, boardId, name: 'Done', orderIndex: 1 },
        { id: otherColId, boardId: otherBoardId, name: 'Todo', orderIndex: 0 },
      ]);

      const loginAs = async (studentId: string, hostOffset: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + hostOffset}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const adminCookie = await loginAs(adminSid, 0);
      const creatorCookie = await loginAs(creatorSid, 1);
      const assignedCookie = await loginAs(assignedSid, 2);
      const anyEditorCookie = await loginAs(anyEditorSid, 3);
      const deleterCookie = await loginAs(deleterSid, 4);
      const assignerCookie = await loginAs(assignerSid, 5);

      // 1. 401 & AC-06 create permission gating & 400 validation
      expect((await tasksGet(new Request('http://localhost:3000/api/v1/tasks'))).status).toBe(401);
      expect((await myTasksGet(new Request('http://localhost:3000/api/v1/me/tasks'))).status).toBe(401);
      expect((await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: assignedCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: 'Deny' }),
      }))).status).toBe(403);
      expect((await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: 'AC06 Deny', assigneeIds: [assignedOnlyId] }),
      }))).status).toBe(403);
      const mismatchRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ boardId, columnId: otherColId, title: 'Mismatch' }),
      }));
      expect(mismatchRes.status).toBe(400);
      expect(((await mismatchRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'BOARD_COLUMN_MISMATCH',
        messageKey: 'errors.boardColumnMismatch',
      });

      const inactiveCreateRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: 'Inactive Assignee', assigneeIds: [inactiveUserId] }),
      }));
      expect(inactiveCreateRes.status).toBe(400);
      expect(((await inactiveCreateRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'INVALID_ASSIGNEE_IDS',
        messageKey: 'errors.invalidAssigneeIds',
      });

      // 2. Create tasks: public Todo, hidden assigned to assignedOnlyId, public Done assigned to assignedOnlyId
      const tPublicRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: `Public ${suffix}`, dueAt: '2026-11-28T00:00:00.000Z', priority: 2 }),
      }));
      expect(tPublicRes.status).toBe(201);
      const tPublicBody = (await tPublicRes.json()) as { task: { id: string; position: number; version: number }; eventId: string };
      expect(tPublicBody.task.position).toBe(1000);
      expect(tPublicBody.eventId).toBeTruthy();
      const publicId = tPublicBody.task.id;

      const tHiddenRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: `Hidden ${suffix}`,
          dueAt: '2026-11-20T00:00:00.000Z',
          priority: 4,
          assigneeIds: [assignedOnlyId],
          isHidden: true,
        }),
      }));
      expect(tHiddenRes.status).toBe(201);
      const hiddenId = ((await tHiddenRes.json()) as { task: { id: string } }).task.id;

      const tDoneRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: doneColId,
          title: `Done ${suffix}`,
          dueAt: null,
          priority: 1,
          assigneeIds: [assignedOnlyId],
        }),
      }));
      expect(tDoneRes.status).toBe(201);
      const doneId = ((await tDoneRes.json()) as { task: { id: string } }).task.id;

      // 3. taskVisibilityPolicy 404 for non-viewer (even task.update_any / task.assign / task.delete!)
      expect((await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenId}`, { headers: { cookie: anyEditorCookie } }), { params: Promise.resolve({ id: hiddenId }) })).status).toBe(404);
      expect((await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${hiddenId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: anyEditorCookie }, body: JSON.stringify({ title: 'Steal', version: 1 }) }), { params: Promise.resolve({ id: hiddenId }) })).status).toBe(404);
      expect((await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenId}/assignees`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: assignerCookie }, body: JSON.stringify({ assigneeIds: [] }) }), { params: Promise.resolve({ id: hiddenId }) })).status).toBe(404);
      expect((await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${hiddenId}`, { method: 'DELETE', headers: { cookie: deleterCookie } }), { params: Promise.resolve({ id: hiddenId }) })).status).toBe(404);

      // Hidden task excluded from search & list for non-viewer, visible for assignee & admin
      const hiddenSearchOther = (await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${boardId}&q=${encodeURIComponent(`Hidden ${suffix}`)}`, { headers: { cookie: anyEditorCookie } }))).json()) as { items: unknown[] };
      expect(hiddenSearchOther.items).toHaveLength(0);
      const hiddenSearchAssignee = (await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${boardId}&q=${encodeURIComponent(`Hidden ${suffix}`)}`, { headers: { cookie: assignedCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(hiddenSearchAssignee.items.map((i) => i.id)).toEqual([hiddenId]);

      // 4. Cursor pagination with dueAt NULLS LAST across 2 pages
      const page1 = (await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${boardId}&sortBy=dueAt&sortOrder=asc&limit=2`, { headers: { cookie: adminCookie } }))).json()) as { items: Array<{ id: string }>; meta: { nextCursor: string | null } };
      expect(page1.items.map((i) => i.id)).toEqual([hiddenId, publicId]);
      expect(page1.meta.nextCursor).toBeTruthy();

      const page2 = (await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${boardId}&sortBy=dueAt&sortOrder=asc&limit=2&cursor=${encodeURIComponent(page1.meta.nextCursor!)}`, { headers: { cookie: adminCookie } }))).json()) as { items: Array<{ id: string }>; meta: { nextCursor: string | null } };
      expect(page2.items.map((i) => i.id)).toEqual([doneId]);
      expect(page2.meta.nextCursor).toBeNull();

      // 5. PATCH optimistic locking + no-op + task.update_assigned vs task.update_any
      expect((await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: assignedCookie }, body: JSON.stringify({ title: 'Denied', version: 1 }) }), { params: Promise.resolve({ id: publicId }) })).status).toBe(403);
      const patchedPublic = await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
        body: JSON.stringify({ title: `Public Updated ${suffix}`, priority: 4, version: 1 }),
      }), { params: Promise.resolve({ id: publicId }) });
      expect(patchedPublic.status).toBe(200);
      expect(((await patchedPublic.json()) as { task: { version: number }; eventId: string }).task.version).toBe(2);

      // Stale version -> 409 TASK_VERSION_CONFLICT
      const stalePatch = await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
        body: JSON.stringify({ title: 'Stale', version: 1 }),
      }), { params: Promise.resolve({ id: publicId }) });
      expect(stalePatch.status).toBe(409);
      expect(((await stalePatch.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'TASK_VERSION_CONFLICT',
        messageKey: 'errors.taskVersionConflict',
      });

      // Assigned holder updates hidden task assigned to them
      expect((await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${hiddenId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: assignedCookie },
        body: JSON.stringify({ description: 'Progress note', version: 1 }),
      }), { params: Promise.resolve({ id: hiddenId }) })).status).toBe(200);

      // 6. PUT /tasks/[id]/assignees writes task.assignees_changed with IDs only
      const assignRes = await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${publicId}/assignees`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assignerCookie },
        body: JSON.stringify({ assigneeIds: [assignedOnlyId], version: 2 }),
      }), { params: Promise.resolve({ id: publicId }) });
      expect(assignRes.status).toBe(200);
      expect(((await assignRes.json()) as { task: { version: number } }).task.version).toBe(3);

      // 7. GET /me/tasks (WQ-03 Done exclusion & includeDone=true)
      const myDefault = (await (await myTasksGet(new Request(`http://localhost:3000/api/v1/me/tasks?boardId=${boardId}`, { headers: { cookie: assignedCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(myDefault.items.map((i) => i.id)).toEqual([hiddenId, publicId]);

      const myWithDone = (await (await myTasksGet(new Request(`http://localhost:3000/api/v1/me/tasks?boardId=${boardId}&includeDone=true`, { headers: { cookie: assignedCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(myWithDone.items.map((i) => i.id)).toEqual([hiddenId, publicId, doneId]);

      // 7b. Inactive assignee guard: reject adding new inactive member, allow keeping or removing already-assigned inactive member
      const addInactiveRes = await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${doneId}/assignees`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assignerCookie },
        body: JSON.stringify({ assigneeIds: [assignedOnlyId, inactiveUserId], version: 1 }),
      }), { params: Promise.resolve({ id: doneId }) });
      expect(addInactiveRes.status).toBe(400);
      expect(((await addInactiveRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'INVALID_ASSIGNEE_IDS',
        messageKey: 'errors.invalidAssigneeIds',
      });

      await tx.insert(taskAssignees).values({ taskId: doneId, userId: inactiveUserId });
      const keepInactiveSwapActive = await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${doneId}/assignees`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assignerCookie },
        body: JSON.stringify({ assigneeIds: [inactiveUserId, creatorOnlyId], version: 1 }),
      }), { params: Promise.resolve({ id: doneId }) });
      expect(keepInactiveSwapActive.status).toBe(200);

      const removeInactiveRes = await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${doneId}/assignees`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assignerCookie },
        body: JSON.stringify({ assigneeIds: [assignedOnlyId], version: 2 }),
      }), { params: Promise.resolve({ id: doneId }) });
      expect(removeInactiveRes.status).toBe(200);

      const reAddInactiveRes = await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${doneId}/assignees`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assignerCookie },
        body: JSON.stringify({ assigneeIds: [assignedOnlyId, inactiveUserId], version: 3 }),
      }), { params: Promise.resolve({ id: doneId }) });
      expect(reAddInactiveRes.status).toBe(400);
      expect(((await reAddInactiveRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'INVALID_ASSIGNEE_IDS',
        messageKey: 'errors.invalidAssigneeIds',
      });

      // 8. Soft-delete: 403 without task.delete (even for task.update_any / assigned), 404 on hidden for non-viewer, 200 for task.delete
      const denyDeleteAny = await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, {
        method: 'DELETE',
        headers: { cookie: anyEditorCookie },
      }), { params: Promise.resolve({ id: publicId }) });
      expect(denyDeleteAny.status).toBe(403);
      expect(((await denyDeleteAny.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

      const denyDeleteAssigned = await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, {
        method: 'DELETE',
        headers: { cookie: assignedCookie },
      }), { params: Promise.resolve({ id: publicId }) });
      expect(denyDeleteAssigned.status).toBe(403);
      expect(((await denyDeleteAssigned.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

      const hiddenNoDeleteRes = await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${hiddenId}`, {
        method: 'DELETE',
        headers: { cookie: anyEditorCookie },
      }), { params: Promise.resolve({ id: hiddenId }) });
      expect(hiddenNoDeleteRes.status).toBe(404);

      const delRes = await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, {
        method: 'DELETE',
        headers: { cookie: deleterCookie },
      }), { params: Promise.resolve({ id: publicId }) });
      expect(delRes.status).toBe(200);
      expect((await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${publicId}`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: publicId }) })).status).toBe(404);

      // 9. Verify append-only task_events and ZERO PII in DB/API/logs
      const events = await tx.select().from(taskEvents).where(eq(taskEvents.taskId, publicId));
      expect(events.map((e) => e.type).sort()).toEqual([
        'task.assignees_changed',
        'task.created',
        'task.deleted',
        'task.updated',
      ]);
      const serialized = JSON.stringify([events, myWithDone, page1, page2, logs]);
      for (const pii of [adminSid, creatorSid, assignedSid, anyEditorSid, deleterSid, assignerSid, inactiveSid, `t-adm-${suffix}`]) {
        expect(serialized).not.toContain(pii);
      }
    });
  });
});
