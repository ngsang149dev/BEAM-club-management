import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  boards,
  columns,
  departments,
  memberDepartments,
  permissions,
  profiles,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as boardColumnsPost } from '@/app/api/v1/boards/[id]/columns/route';
import { DELETE as boardArchive } from '@/app/api/v1/boards/[id]/route';
import { GET as boardTrashGet } from '@/app/api/v1/boards/[id]/trash/route';
import { DELETE as columnDelete } from '@/app/api/v1/columns/[id]/route';
import { PUT as taskAssigneesPut } from '@/app/api/v1/tasks/[id]/assignees/route';
import { POST as taskCommentsPost } from '@/app/api/v1/tasks/[id]/comments/route';
import { POST as taskEventRevertPost } from '@/app/api/v1/tasks/[id]/events/[eventId]/revert/route';
import { GET as taskEventsGet } from '@/app/api/v1/tasks/[id]/events/route';
import { PUT as taskHiddenPut } from '@/app/api/v1/tasks/[id]/hidden/route';
import { POST as taskMovePost } from '@/app/api/v1/tasks/[id]/move/route';
import { DELETE as taskDelete, PATCH as taskPatch } from '@/app/api/v1/tasks/[id]/route';
import { POST as tasksPost } from '@/app/api/v1/tasks/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleCommentsRepository } from '@/server/modules/comments';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTaskEventsRepository } from '@/server/modules/task-events';
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function withRolledBackDb(
  db: Database,
  fn: (tx: TransactionContext) => Promise<void>,
): Promise<void> {
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
  const line = res.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(line).toBeDefined();
  return line!.split(';')[0]!;
}

describe('Task Events History, Revert & Board Trash Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for task-events integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces AC-16..AC-20, AC-22, WQ-17, WQ-33, optional body revert, and zero PII across routes', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const creatorId = randomUUID();
    const assigneeId = randomUUID();
    const deptMemberId = randomUUID();
    const anyEditorId = randomUUID();
    const assignerId = randomUUID();
    const deleterId = randomUUID();
    const plainId = randomUUID();
    const inactiveId = randomUUID();
    const deptId = randomUUID();

    const adminSid = `MSSV-TEADM-${suffix}`;
    const creatorSid = `MSSV-TECRE-${suffix}`;
    const assigneeSid = `MSSV-TEASS-${suffix}`;
    const deptMemberSid = `MSSV-TEDEP-${suffix}`;
    const anyEditorSid = `MSSV-TEANY-${suffix}`;
    const assignerSid = `MSSV-TEASG-${suffix}`;
    const deleterSid = `MSSV-TEDEL-${suffix}`;
    const plainSid = `MSSV-TEPLN-${suffix}`;
    const inactiveSid = `MSSV-TEINA-${suffix}`;
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `task-events-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'task-events-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
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
        taskEventsRepo: new DrizzleTaskEventsRepository(tx),
        commentsRepo: new DrizzleCommentsRepository(tx),
        boardsRepo: new DrizzleBoardsRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([
          { code: 'board.update', groupName: 'boards', description: 'BU', scopable: false },
          { code: 'board.delete', groupName: 'boards', description: 'BD', scopable: false },
          { code: 'task.create', groupName: 'tasks', description: 'TC', scopable: false },
          { code: 'task.assign', groupName: 'tasks', description: 'TA', scopable: false },
          { code: 'task.update_any', groupName: 'tasks', description: 'TUA', scopable: false },
          { code: 'task.update_assigned', groupName: 'tasks', description: 'TUAS', scopable: false },
          { code: 'task.delete', groupName: 'tasks', description: 'TD', scopable: false },
          { code: 'comment.create', groupName: 'comments', description: 'CC', scopable: false },
        ])
        .onConflictDoNothing();

      await tx.insert(departments).values({ id: deptId, name: `Dept TE ${suffix}` });
      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `te-adm-${suffix}@eiu.edu.vn`, fullName: `TE Admin ${suffix}`, passwordHash: seedPasswordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: creatorId, studentId: creatorSid, email: `te-cre-${suffix}@eiu.edu.vn`, fullName: `TE Creator ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: assigneeId, studentId: assigneeSid, email: `te-ass-${suffix}@eiu.edu.vn`, fullName: `TE Assignee ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deptMemberId, studentId: deptMemberSid, email: `te-dep-${suffix}@eiu.edu.vn`, fullName: `TE DeptMem ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: anyEditorId, studentId: anyEditorSid, email: `te-any-${suffix}@eiu.edu.vn`, fullName: `TE AnyEditor ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: assignerId, studentId: assignerSid, email: `te-asg-${suffix}@eiu.edu.vn`, fullName: `TE Assigner ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deleterId, studentId: deleterSid, email: `te-del-${suffix}@eiu.edu.vn`, fullName: `TE Deleter ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: plainId, studentId: plainSid, email: `te-pln-${suffix}@eiu.edu.vn`, fullName: `TE Plain ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: inactiveId, studentId: inactiveSid, email: `te-ina-${suffix}@eiu.edu.vn`, fullName: `TE Former ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: false, leftAt: new Date('2026-10-01T00:00:00.000Z'), locale: 'vi' },
      ]);
      await tx.insert(memberDepartments).values({ userId: deptMemberId, departmentId: deptId });
      await tx.insert(userPermissions).values([
        { userId: creatorId, permissionCode: 'task.create', grantedBy: null },
        { userId: creatorId, permissionCode: 'task.assign', grantedBy: null },
        { userId: creatorId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: creatorId, permissionCode: 'comment.create', grantedBy: null },
        { userId: assigneeId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: deptMemberId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: anyEditorId, permissionCode: 'task.update_any', grantedBy: null },
        { userId: assignerId, permissionCode: 'task.assign', grantedBy: null },
        { userId: assignerId, permissionCode: 'task.update_any', grantedBy: null },
        { userId: deleterId, permissionCode: 'task.delete', grantedBy: null },
        { userId: deleterId, permissionCode: 'task.update_any', grantedBy: null },
      ]);

      const boardId = randomUUID();
      const todoColId = randomUUID();
      const doingColId = randomUUID();
      await tx.insert(boards).values({ id: boardId, name: `TE Board ${suffix}`, createdBy: adminId });
      await tx.insert(columns).values([
        { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
        { id: doingColId, boardId, name: 'Doing', orderIndex: 1 },
      ]);

      const loginAs = async (studentId: string, hostOffset: number) =>
        cookiePairFromLogin(
          await loginPost(
            new Request('http://localhost:3000/api/v1/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + hostOffset}` },
              body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
            }),
          ),
        );

      const adminCookie = await loginAs(adminSid, 0);
      const creatorCookie = await loginAs(creatorSid, 1);
      const assigneeCookie = await loginAs(assigneeSid, 2);
      const deptMemberCookie = await loginAs(deptMemberSid, 3);
      const anyEditorCookie = await loginAs(anyEditorSid, 4);
      const assignerCookie = await loginAs(assignerSid, 5);
      const deleterCookie = await loginAs(deleterSid, 6);
      const plainCookie = await loginAs(plainSid, 7);

      const createRes = await tasksPost(
        new Request('http://localhost:3000/api/v1/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({
            boardId,
            columnId: todoColId,
            title: `Task History ${suffix}`,
            startAt: '2026-11-26T00:00:00.000Z',
            dueAt: '2026-11-28T00:00:00.000Z',
            priority: 2,
            assigneeIds: [assigneeId],
            departmentIds: [deptId],
          }),
        }),
      );
      expect(createRes.status).toBe(201);
      const taskId = ((await createRes.json()) as { task: { id: string } }).task.id;

      // 1. 401 checks
      expect((await taskEventsGet(new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events`), { params: Promise.resolve({ id: taskId }) })).status).toBe(401);
      expect((await boardTrashGet(new Request(`http://localhost:3000/api/v1/boards/${boardId}/trash`), { params: Promise.resolve({ id: boardId }) })).status).toBe(401);

      // 2. Patch priority & title -> AC-17 immediate revert with empty POST body
      const patchPrioRes = await taskPatch(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
          body: JSON.stringify({ priority: 4, version: 1 }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(patchPrioRes.status).toBe(200);
      const prioEventId = ((await patchPrioRes.json()) as { eventId: string }).eventId;

      // Bad JSON -> 400 INVALID_JSON
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${prioEventId}/revert`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
              body: '{invalid-json',
            }),
            { params: Promise.resolve({ id: taskId, eventId: prioEventId }) },
          )
        ).status,
      ).toBe(400);

      // Empty POST body -> reverts priority 4 back to 2 (AC-17)
      const revertPrioRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${prioEventId}/revert`, {
          method: 'POST',
          headers: { cookie: anyEditorCookie },
        }),
        { params: Promise.resolve({ id: taskId, eventId: prioEventId }) },
      );
      expect(revertPrioRes.status).toBe(200);
      const revertPrioBody = (await revertPrioRes.json()) as { task: { priority: number; version: number }; eventId: string; revertedEventId: string };
      expect(revertPrioBody.task.priority).toBe(2);
      expect(revertPrioBody.revertedEventId).toBe(prioEventId);

      // 3. AC-18 Conflict & force=true
      const title1Res = await taskPatch(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
          body: JSON.stringify({ title: 'Title V2', version: revertPrioBody.task.version }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      const title1Body = (await title1Res.json()) as { task: { version: number }; eventId: string };
      await taskPatch(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
          body: JSON.stringify({ title: 'Title V3', version: title1Body.task.version }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );

      const conflictRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${title1Body.eventId}/revert`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: assigneeCookie },
          body: JSON.stringify({ force: false }),
        }),
        { params: Promise.resolve({ id: taskId, eventId: title1Body.eventId }) },
      );
      expect(conflictRes.status).toBe(409);
      expect((await conflictRes.json()) as { error: { code: string; details: { conflictingFields: string[] } } }).toMatchObject({
        error: { code: 'REVERT_CONFLICT', details: { conflictingFields: ['title'] } },
      });

      const forceRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${title1Body.eventId}/revert`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: deptMemberCookie },
          body: JSON.stringify({ force: true }),
        }),
        { params: Promise.resolve({ id: taskId, eventId: title1Body.eventId }) },
      );
      expect(forceRes.status).toBe(200);
      const forceBody = (await forceRes.json()) as { task: { title: string; version: number } };
      expect(forceBody.task.title).toBe(`Task History ${suffix}`);

      // 4. AC-16 Move task to Doing & revert after creating+deleting temp column (WQ-33)
      const tempColRes = await boardColumnsPost(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}/columns`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ name: 'TempCol' }),
        }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(tempColRes.status).toBe(201);
      const tempColId = ((await tempColRes.json()) as { column: { id: string } }).column.id;

      const moveToTempRes = await taskMovePost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/move`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
          body: JSON.stringify({ columnId: tempColId, version: forceBody.task.version }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      const moveToTempBody = (await moveToTempRes.json()) as { task: { version: number } };

      const moveToDoingRes = await taskMovePost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/move`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
          body: JSON.stringify({ columnId: doingColId, version: moveToTempBody.task.version }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      const moveToDoingBody = (await moveToDoingRes.json()) as { task: { version: number }; eventId: string };

      expect(
        (
          await columnDelete(
            new Request(`http://localhost:3000/api/v1/columns/${tempColId}`, {
              method: 'DELETE',
              headers: { cookie: adminCookie },
            }),
            { params: Promise.resolve({ id: tempColId }) },
          )
        ).status,
      ).toBe(200);

      // Revert move from deleted TempCol -> falls back to first column (Todo)
      const revertMoveRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${moveToDoingBody.eventId}/revert`, {
          method: 'POST',
          headers: { cookie: anyEditorCookie },
        }),
        { params: Promise.resolve({ id: taskId, eventId: moveToDoingBody.eventId }) },
      );
      expect(revertMoveRes.status).toBe(200);
      const revertMoveBody = (await revertMoveRes.json()) as { task: { columnId: string; version: number } };
      expect(revertMoveBody.task.columnId).toBe(todoColId);

      // 5. Assignees change + comment + inactive actor event + AC-19 403 checks
      const assignRes = await taskAssigneesPut(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/assignees`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: assignerCookie },
          body: JSON.stringify({ assigneeIds: [], version: revertMoveBody.task.version }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      const assignEventId = ((await assignRes.json()) as { eventId: string }).eventId;
      // anyEditor lacks task.assign -> 403
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${assignEventId}/revert`, {
              method: 'POST',
              headers: { cookie: anyEditorCookie },
            }),
            { params: Promise.resolve({ id: taskId, eventId: assignEventId }) },
          )
        ).status,
      ).toBe(403);
      // assigner reverts -> 200
      const revertAssignRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${assignEventId}/revert`, {
          method: 'POST',
          headers: { cookie: assignerCookie },
        }),
        { params: Promise.resolve({ id: taskId, eventId: assignEventId }) },
      );
      expect(revertAssignRes.status).toBe(200);
      const afterAssignVersion = ((await revertAssignRes.json()) as { task: { version: number } }).task.version;

      const commentRes = await taskCommentsPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({ body: 'Audit note' }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      const commentEventId = ((await commentRes.json()) as { eventId: string }).eventId;
      // Non-revertable -> 400
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${commentEventId}/revert`, {
              method: 'POST',
              headers: { cookie: adminCookie },
            }),
            { params: Promise.resolve({ id: taskId, eventId: commentEventId }) },
          )
        ).status,
      ).toBe(400);

      // Seed historical event by inactive member
      await tx.insert(taskEvents).values({
        taskId,
        boardId,
        actorId: inactiveId,
        type: 'task.updated',
        changes: { description: { from: null, to: 'legacy' } },
        createdAt: new Date('2026-11-20T01:00:00.000Z'),
      });

      // 6. AC-20 hidden task 404 before 403/400 on GET events & POST revert
      const hideRes = await taskHiddenPut(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({ isHidden: true, version: afterAssignVersion }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      const hideEventId = ((await hideRes.json()) as { eventId: string }).eventId;

      expect(
        (
          await taskEventsGet(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events`, { headers: { cookie: anyEditorCookie } }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${commentEventId}/revert`, {
              method: 'POST',
              headers: { cookie: deleterCookie },
            }),
            { params: Promise.resolve({ id: taskId, eventId: commentEventId }) },
          )
        ).status,
      ).toBe(404);
      // Assignee can view hidden task, but lacks creator/admin -> 403 on task.hidden_changed revert
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${hideEventId}/revert`, {
              method: 'POST',
              headers: { cookie: assigneeCookie },
            }),
            { params: Promise.resolve({ id: taskId, eventId: hideEventId }) },
          )
        ).status,
      ).toBe(403);
      // Creator unhides via revert -> 200
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${hideEventId}/revert`, {
              method: 'POST',
              headers: { cookie: creatorCookie },
            }),
            { params: Promise.resolve({ id: taskId, eventId: hideEventId }) },
          )
        ).status,
      ).toBe(200);

      // 7. Paginate GET /events and verify inactive actor & revertable flags
      const evtPage1Res = await taskEventsGet(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events?limit=5`, {
          headers: { cookie: plainCookie },
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(evtPage1Res.status).toBe(200);
      const evtPage1 = (await evtPage1Res.json()) as {
        items: Array<{ id: string; type: string; revertable: boolean; actor: Record<string, unknown> }>;
        meta: { nextCursor: string | null };
      };
      expect(evtPage1.items).toHaveLength(5);
      expect(evtPage1.meta.nextCursor).toBeTruthy();

      const evtPage2Res = await taskEventsGet(
        new Request(
          `http://localhost:3000/api/v1/tasks/${taskId}/events?limit=20&cursor=${encodeURIComponent(evtPage1.meta.nextCursor!)}`,
          { headers: { cookie: plainCookie } },
        ),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(evtPage2Res.status).toBe(200);
      const evtPage2 = (await evtPage2Res.json()) as {
        items: Array<{ id: string; type: string; revertable: boolean; actor: Record<string, unknown> }>;
        meta: { nextCursor: string | null };
      };
      expect(evtPage2.meta.nextCursor).toBeNull();
      const allEventsResponse = [...evtPage1.items, ...evtPage2.items];
      const legacyEvt = allEventsResponse.find((e) => e.actor.id === inactiveId);
      expect(legacyEvt?.actor).toMatchObject({ isActive: false, fullName: `TE Former ${suffix}` });
      expect(legacyEvt?.actor.leftAt).toBeTruthy();

      // 8. Soft-delete tasks & Board Trash (WQ-17) + revert task.deleted & task.restored
      const hiddenTaskCreateRes = await tasksPost(
        new Request('http://localhost:3000/api/v1/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ boardId, columnId: todoColId, title: `Hidden Trash ${suffix}`, startAt: '2026-11-26T00:00:00.000Z', dueAt: '2026-11-28T00:00:00.000Z', isHidden: true }),
        }),
      );
      const hiddenTaskId = ((await hiddenTaskCreateRes.json()) as { task: { id: string } }).task.id;
      await taskDelete(
        new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { method: 'DELETE', headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ id: hiddenTaskId }) },
      );

      const delPublicRes = await taskDelete(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, { method: 'DELETE', headers: { cookie: deleterCookie } }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(delPublicRes.status).toBe(200);
      const delPublicEventId = ((await delPublicRes.json()) as { eventId: string }).eventId;

      // Without task.delete -> 403
      expect(
        (
          await boardTrashGet(
            new Request(`http://localhost:3000/api/v1/boards/${boardId}/trash`, { headers: { cookie: anyEditorCookie } }),
            { params: Promise.resolve({ id: boardId }) },
          )
        ).status,
      ).toBe(403);

      // Deleter sees only public soft-deleted task, NEVER hiddenTask (WQ-17)
      const deleterTrashRes = await boardTrashGet(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}/trash`, { headers: { cookie: deleterCookie } }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(deleterTrashRes.status).toBe(200);
      const deleterTrash = (await deleterTrashRes.json()) as { items: Array<{ id: string }> };
      expect(deleterTrash.items.map((t) => t.id)).toEqual([taskId]);

      // Admin paginates across both
      const adminTrashP1 = await boardTrashGet(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}/trash?limit=1`, { headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ id: boardId }) },
      );
      const adminTrashP1Body = (await adminTrashP1.json()) as { items: Array<{ id: string }>; meta: { nextCursor: string | null } };
      expect(adminTrashP1Body.items).toHaveLength(1);
      expect(adminTrashP1Body.meta.nextCursor).toBeTruthy();

      // Revert task.deleted -> compensating task.restored; then revert task.restored -> compensating task.deleted
      const restoreViaRevertRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${delPublicEventId}/revert`, {
          method: 'POST',
          headers: { cookie: deleterCookie },
        }),
        { params: Promise.resolve({ id: taskId, eventId: delPublicEventId }) },
      );
      expect(restoreViaRevertRes.status).toBe(200);
      const restoreViaRevertBody = (await restoreViaRevertRes.json()) as { task: { deletedAt: string | null }; eventId: string };
      expect(restoreViaRevertBody.task.deletedAt).toBeNull();

      const reDeleteViaRevertRes = await taskEventRevertPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${restoreViaRevertBody.eventId}/revert`, {
          method: 'POST',
          headers: { cookie: deleterCookie },
        }),
        { params: Promise.resolve({ id: taskId, eventId: restoreViaRevertBody.eventId }) },
      );
      expect(reDeleteViaRevertRes.status).toBe(200);
      expect(((await reDeleteViaRevertRes.json()) as { task: { deletedAt: string | null } }).task.deletedAt).not.toBeNull();

      // Archived board blocks reverting task.deleted -> 409 BOARD_ARCHIVED
      await boardArchive(
        new Request(`http://localhost:3000/api/v1/boards/${boardId}`, { method: 'DELETE', headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ id: boardId }) },
      );
      expect(
        (
          await taskEventRevertPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/events/${delPublicEventId}/revert`, {
              method: 'POST',
              headers: { cookie: deleterCookie },
            }),
            { params: Promise.resolve({ id: taskId, eventId: delPublicEventId }) },
          )
        ).status,
      ).toBe(409);

      // 9. AC-22 append-only task_events trigger & zero PII
      const dbEvents = await tx
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.createdAt));
      expect(dbEvents.length).toBeGreaterThanOrEqual(10);

      let updateTriggerErr: unknown = null;
      try {
        await tx.transaction((subTx) =>
          subTx.update(taskEvents).set({ forced: true }).where(eq(taskEvents.id, delPublicEventId)),
        );
      } catch (err) {
        updateTriggerErr = err;
      }
      let deleteTriggerErr: unknown = null;
      try {
        await tx.transaction((subTx) =>
          subTx.delete(taskEvents).where(eq(taskEvents.id, delPublicEventId)),
        );
      } catch (err) {
        deleteTriggerErr = err;
      }
      for (const rawErr of [updateTriggerErr, deleteTriggerErr]) {
        expect(rawErr).not.toBeNull();
        let pgCause: unknown = rawErr;
        for (let i = 0; i < 4 && typeof pgCause === 'object' && pgCause !== null; i += 1) {
          if ('code' in pgCause && typeof (pgCause as { code?: unknown }).code === 'string') break;
          pgCause = (pgCause as { cause?: unknown }).cause;
        }
        expect(pgCause).toMatchObject({ code: 'P0001', hint: 'APPEND_ONLY_TABLE' });
      }

      const serialized = JSON.stringify([dbEvents, logs, allEventsResponse, deleterTrash]);
      for (const pii of [
        adminSid,
        creatorSid,
        assigneeSid,
        deptMemberSid,
        anyEditorSid,
        assignerSid,
        deleterSid,
        plainSid,
        inactiveSid,
        `te-adm-${suffix}`,
        `te-ina-${suffix}`,
        'Audit note',
      ]) {
        expect(serialized).not.toContain(pii);
      }

      // 10. Historical task.updated event with null start_at/due_at cannot be reverted even with force=true (409 REVERT_CONFLICT)
      const legacyBoardId = randomUUID();
      const legacyColId = randomUUID();
      const legacyTaskId = randomUUID();
      const legacyEventId = randomUUID();
      await tx.insert(boards).values({ id: legacyBoardId, name: `Legacy Board ${suffix}`, createdBy: adminId });
      await tx.insert(columns).values({ id: legacyColId, boardId: legacyBoardId, name: 'Todo', orderIndex: 0 });
      await tx.insert(tasks).values({
        id: legacyTaskId,
        boardId: legacyBoardId,
        columnId: legacyColId,
        title: `Legacy Task ${suffix}`,
        position: '1000',
        startAt: new Date('2026-11-26T00:00:00.000Z'),
        dueAt: new Date('2026-11-28T00:00:00.000Z'),
        createdBy: adminId,
      });
      await tx.insert(taskEvents).values({
        id: legacyEventId,
        taskId: legacyTaskId,
        boardId: legacyBoardId,
        actorId: adminId,
        type: 'task.updated',
        changes: {
          start_at: { from: null, to: '2026-11-26T00:00:00.000Z' },
          due_at: { from: null, to: '2026-11-28T00:00:00.000Z' },
        },
      });

      for (const force of [false, true]) {
        const legacyRevertRes = await taskEventRevertPost(
          new Request(
            `http://localhost:3000/api/v1/tasks/${legacyTaskId}/events/${legacyEventId}/revert`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: adminCookie },
              body: JSON.stringify({ force }),
            },
          ),
          { params: Promise.resolve({ id: legacyTaskId, eventId: legacyEventId }) },
        );
        expect(legacyRevertRes.status).toBe(409);
        const legacyRevertBody = (await legacyRevertRes.json()) as {
          error: { code: string; details?: { conflictingFields?: string[] } };
        };
        expect(legacyRevertBody.error.code).toBe('REVERT_CONFLICT');
        expect(legacyRevertBody.error.details?.conflictingFields).toEqual([
          'start_at',
          'due_at',
        ]);
      }
    });
  });
});
