import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  boards,
  columns,
  departments,
  memberDepartments,
  notifications,
  permissions,
  profiles,
  taskDeliverables,
  taskEvents,
  userPermissions,
} from '@db/schema';
import { DELETE as archivePurgeDelete } from '@/app/api/v1/archive/[entityType]/[id]/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as boardDetailGet } from '@/app/api/v1/boards/[id]/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';
import { PUT as taskAcceptancePut } from '@/app/api/v1/tasks/[id]/acceptance/route';
import { PUT as taskAssigneesPut } from '@/app/api/v1/tasks/[id]/assignees/route';
import { DELETE as deliverableDelete } from '@/app/api/v1/tasks/[id]/deliverables/[deliverableId]/route';
import {
  GET as deliverablesGet,
  POST as deliverablesPost,
} from '@/app/api/v1/tasks/[id]/deliverables/route';
import { POST as taskEventRevertPost } from '@/app/api/v1/tasks/[id]/events/[eventId]/revert/route';
import { GET as taskEventsGet } from '@/app/api/v1/tasks/[id]/events/route';
import {
  DELETE as taskDelete,
  GET as taskGet,
  PATCH as taskPatch,
} from '@/app/api/v1/tasks/[id]/route';
import { GET as tasksGet, POST as tasksPost } from '@/app/api/v1/tasks/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DrizzleArchiveRepository } from '@/server/modules/archive';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleCommentsRepository } from '@/server/modules/comments';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzleNotificationsRepository } from '@/server/modules/notifications';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTaskEventsRepository } from '@/server/modules/task-events';
import { DrizzleTasksRepository } from '@/server/modules/tasks';
import { FakeClock } from '@/server/shared/clock';
import { createContainer, setContainerForTesting } from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { StructuredLogger } from '@/server/shared/logger';
import type { Mailer, MailMessage } from '@/server/shared/mailer';
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

describe('CR-09 Calendar, Workspace Board, Acceptance, Deliverables & Archive integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for CR-09 integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('auto-provisions BEAM Workspace, validates calendar filters/revert, acceptance, deliverables, WQ-27 lead notifications, and purge', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const creatorId = randomUUID();
    const assigneeId = randomUUID();
    const deptLeadId = randomUUID();
    const blockedLeadId = randomUUID();
    const otherDeptMemberId = randomUUID();

    const adminSid = `CR09-ADM-${suffix}`;
    const creatorSid = `CR09-CRE-${suffix}`;
    const assigneeSid = `CR09-ASN-${suffix}`;
    const leadSid = `CR09-LED-${suffix}`;
    const blockedLeadSid = `CR09-BLK-${suffix}`;
    const otherMemberSid = `CR09-OTH-${suffix}`;

    const sentEmails: MailMessage[] = [];
    const logs: string[] = [];
    const clock = new FakeClock('2026-11-26T00:00:00.000Z'); // 2026-11-26 07:00 UTC+7
    const fakeMailer: Mailer = {
      send: async (msg) => {
        sentEmails.push(msg);
      },
    };
    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `cr09-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: `cr09-cron-secret-${suffix}`,
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
        clock,
        db,
        mailer: fakeMailer,
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
        notificationsRepo: new DrizzleNotificationsRepository(tx),
        boardsRepo: new DrizzleBoardsRepository(tx),
        archiveRepo: new DrizzleArchiveRepository(tx),
        logger: new StructuredLogger({ writeOut: (l) => logs.push(l), writeErr: (l) => logs.push(l) }),
      });
      setContainerForTesting(container);

      await tx.insert(permissions).values([
        { code: 'task.create', groupName: 'tasks', description: 'TC', scopable: false },
        { code: 'task.assign', groupName: 'tasks', description: 'TA', scopable: false },
        { code: 'task.update_any', groupName: 'tasks', description: 'TUA', scopable: false },
        { code: 'task.update_assigned', groupName: 'tasks', description: 'TUAS', scopable: false },
        { code: 'task.delete', groupName: 'tasks', description: 'TD', scopable: false },
      ]).onConflictDoNothing();

      const pwHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `cr09-adm-${suffix}@eiu.edu.vn`, fullName: `Admin ${suffix}`, passwordHash: pwHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: creatorId, studentId: creatorSid, email: `cr09-cre-${suffix}@eiu.edu.vn`, fullName: `Creator ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'en' },
        { id: assigneeId, studentId: assigneeSid, email: `cr09-asn-${suffix}@eiu.edu.vn`, fullName: `Assignee ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deptLeadId, studentId: leadSid, email: `cr09-led-${suffix}@eiu.edu.vn`, fullName: `DeptLead ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: blockedLeadId, studentId: blockedLeadSid, email: `cr09-blk-${suffix}@eiu.edu.vn`, fullName: `BlockedLead ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: otherDeptMemberId, studentId: otherMemberSid, email: `cr09-oth-${suffix}@eiu.edu.vn`, fullName: `OtherMem ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
      ]);
      await tx.insert(userPermissions).values([
        { userId: creatorId, permissionCode: 'task.create', grantedBy: adminId },
        { userId: creatorId, permissionCode: 'task.assign', grantedBy: adminId },
        { userId: creatorId, permissionCode: 'task.update_any', grantedBy: adminId },
        { userId: assigneeId, permissionCode: 'task.update_assigned', grantedBy: adminId },
      ]);

      // Rename any pre-existing BEAM Workspace inside this rolled-back tx so creation is deterministic
      await tx.update(boards).set({ name: `Pre-${suffix}` }).where(eq(boards.name, 'BEAM Workspace'));

      const dept1Id = randomUUID();
      const dept2Id = randomUUID();
      await tx.insert(departments).values([
        { id: dept1Id, name: `Media-${suffix}`, leadUserId: deptLeadId },
        { id: dept2Id, name: `Ops-${suffix}`, leadUserId: blockedLeadId },
      ]);
      await tx.insert(memberDepartments).values([
        { userId: deptLeadId, departmentId: dept1Id },
        { userId: otherDeptMemberId, departmentId: dept1Id },
      ]);

      const baseHost = Math.floor(Math.random() * 120) + 20;
      const loginAs = async (studentId: string, idx: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${baseHost + idx}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const adminCookie = await loginAs(adminSid, 0);
      const creatorCookie = await loginAs(creatorSid, 1);
      const assigneeCookie = await loginAs(assigneeSid, 2);
      const leadCookie = await loginAs(leadSid, 3);
      const blockedLeadCookie = await loginAs(blockedLeadSid, 4);
      const otherMemberCookie = await loginAs(otherMemberSid, 5);

      // 1. Boardless POST /tasks auto-provisions ONE 'BEAM Workspace' board with 2 columns ('Đang thực hiện', 'Done')
      const badPairCreate = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ title: 'Bad Pair', boardId: randomUUID() }),
      }));
      expect(badPairCreate.status).toBe(400);

      const badRangeCreate = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({
          title: 'Bad Range',
          startAt: '2026-11-29T00:00:00.000Z',
          dueAt: '2026-11-27T00:00:00.000Z',
        }),
      }));
      expect(badRangeCreate.status).toBe(400);
      expect(((await badRangeCreate.json()) as { error: { code: string } }).error.code).toBe('INVALID_DATE_RANGE');

      // Task 1: Overdue public (2026-11-25 23:59:59 UTC+7)
      const t1Res = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({
          title: `CR09 Overdue ${suffix}`,
          startAt: '2026-11-24T00:00:00.000Z',
          dueAt: '2026-11-25T16:59:59.000Z',
          priority: 4,
        }),
      }));
      expect(t1Res.status).toBe(201);
      const t1Body = (await t1Res.json()) as { task: { id: string; boardId: string; columnId: string; startAt: string; isCompleted: boolean; completedAt: null; deliverables: unknown[]; deliverableCount: number } };
      const workspaceBoardId = t1Body.task.boardId;
      const workspaceTodoColId = t1Body.task.columnId;
      expect(t1Body.task.startAt).toBe('2026-11-24T00:00:00.000Z');
      expect(t1Body.task.isCompleted).toBe(false);
      expect(t1Body.task.completedAt).toBeNull();
      expect(t1Body.task.deliverables).toEqual([]);
      expect(t1Body.task.deliverableCount).toBe(0);

      const wsCols = await tx.select({ name: columns.name, orderIndex: columns.orderIndex }).from(columns).where(eq(columns.boardId, workspaceBoardId));
      expect(wsCols.sort((a, b) => a.orderIndex - b.orderIndex)).toEqual([
        { name: 'Đang thực hiện', orderIndex: 0 },
        { name: 'Done', orderIndex: 1 },
      ]);

      // Second boardless POST reuses exact same BEAM Workspace & Todo column
      // Task 2: Urgent at midnight 00:00 UTC+7 on 2026-11-26 (2026-11-25T17:00:00Z), public
      const t2Res = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({
          title: `CR09 Urgent ${suffix}`,
          dueAt: '2026-11-25T17:00:00.000Z',
          priority: 3,
        }),
      }));
      expect(t2Res.status).toBe(201);
      const t2Body = (await t2Res.json()) as { task: { id: string; boardId: string; columnId: string } };
      expect(t2Body.task.boardId).toBe(workspaceBoardId);
      expect(t2Body.task.columnId).toBe(workspaceTodoColId);

      // Task 3: Hidden task with dept1 (deptLeadId is member -> can view) + dept2 (blockedLeadId NOT member/assignee/creator -> CANNOT view!)
      // Spanning calendar dates: startAt 2026-11-20, dueAt 2026-11-28 (+2 days => soon)
      const hiddenTitle = `SECRET_CR09_${suffix}`;
      const t3Res = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({
          boardId: workspaceBoardId,
          columnId: workspaceTodoColId,
          title: hiddenTitle,
          startAt: '2026-11-20T00:00:00.000Z',
          dueAt: '2026-11-28T05:00:00.000Z',
          assigneeIds: [assigneeId],
          departmentIds: [dept1Id, dept2Id],
          notifyDepartmentMembers: false,
          isHidden: true,
        }),
      }));
      expect(t3Res.status).toBe(201);
      const hiddenTaskId = ((await t3Res.json()) as { task: { id: string } }).task.id;

      // Task 4: Undated + Safe out-of-window tasks for [from, to] & deadlineStatus tests
      const tUndatedRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ title: `Undated ${suffix}`, priority: 1 }),
      }));
      const tUndatedId = ((await tUndatedRes.json()) as { task: { id: string } }).task.id;

      const tSafeRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({
          title: `Safe Future ${suffix}`,
          startAt: '2026-12-05T00:00:00.000Z',
          dueAt: '2026-12-10T00:00:00.000Z',
        }),
      }));
      const tSafeId = ((await tSafeRes.json()) as { task: { id: string } }).task.id;

      // 2. Verify deadlineStatus buckets + [from, to] overlap + undated + limit=200
      const urgentList = await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${workspaceBoardId}&deadlineStatus=urgent&limit=200`, { headers: { cookie: creatorCookie } }))).json() as { items: Array<{ id: string }> };
      expect(urgentList.items.map((i) => i.id)).toEqual([t2Body.task.id]);

      const soonList = await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${workspaceBoardId}&deadlineStatus=soon`, { headers: { cookie: creatorCookie } }))).json() as { items: Array<{ id: string }> };
      expect(soonList.items.map((i) => i.id)).toEqual([hiddenTaskId]);

      const safeList = await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${workspaceBoardId}&deadlineStatus=safe`, { headers: { cookie: creatorCookie } }))).json() as { items: Array<{ id: string }> };
      expect(safeList.items.map((i) => i.id)).toEqual([tSafeId]);

      // Window [2026-11-25..2026-11-27] matches t1 (24..25), t2 (25T17), t3 (20..28 spanning!), tUndated, excludes tSafe (Dec 5..10)
      const windowList = await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${workspaceBoardId}&from=2026-11-25T00:00:00.000Z&to=2026-11-27T23:59:59.000Z&limit=200`, { headers: { cookie: creatorCookie } }))).json() as { items: Array<{ id: string }> };
      expect(windowList.items.map((i) => i.id).sort()).toEqual([t1Body.task.id, t2Body.task.id, hiddenTaskId, tUndatedId].sort());

      const badLimit = await tasksGet(new Request('http://localhost:3000/api/v1/tasks?limit=201', { headers: { cookie: creatorCookie } }));
      expect(badLimit.status).toBe(400);

      // 3. PATCH isCompleted: true -> sets completedAt, updates deadlineStatus=done & board.overdueTaskCount, then revert via task-events!
      const badPartialPatch = await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${t1Body.task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ startAt: '2026-11-26T00:00:00.000Z', version: 1 }),
      }), { params: Promise.resolve({ id: t1Body.task.id }) });
      expect(badPartialPatch.status).toBe(400);
      expect(((await badPartialPatch.json()) as { error: { code: string } }).error.code).toBe('INVALID_DATE_RANGE');

      const boardBefore = await (await boardDetailGet(new Request(`http://localhost:3000/api/v1/boards/${workspaceBoardId}`, { headers: { cookie: creatorCookie } }), { params: Promise.resolve({ id: workspaceBoardId }) })).json() as { board: { overdueTaskCount: number } };
      expect(boardBefore.board.overdueTaskCount).toBe(2);

      const completeRes = await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${t1Body.task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ isCompleted: true, version: 1 }),
      }), { params: Promise.resolve({ id: t1Body.task.id }) });
      expect(completeRes.status).toBe(200);
      const completeJson = (await completeRes.json()) as { task: { isCompleted: boolean; completedAt: string | null }; eventId: string };
      expect(completeJson.task.isCompleted).toBe(true);
      expect(completeJson.task.completedAt).toBe('2026-11-26T00:00:00.000Z');

      const doneList = await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?boardId=${workspaceBoardId}&deadlineStatus=done`, { headers: { cookie: creatorCookie } }))).json() as { items: Array<{ id: string }> };
      expect(doneList.items.map((i) => i.id)).toEqual([t1Body.task.id]);

      const boardDetail = await (await boardDetailGet(new Request(`http://localhost:3000/api/v1/boards/${workspaceBoardId}`, { headers: { cookie: creatorCookie } }), { params: Promise.resolve({ id: workspaceBoardId }) })).json() as { board: { overdueTaskCount: number } };
      expect(boardDetail.board.overdueTaskCount).toBe(1);

      // Revert task.updated (is_completed) -> sets isCompleted=false, completedAt=null
      const revertRes = await taskEventRevertPost(new Request(`http://localhost:3000/api/v1/tasks/${t1Body.task.id}/events/${completeJson.eventId}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ force: false }),
      }), { params: Promise.resolve({ id: t1Body.task.id, eventId: completeJson.eventId }) });
      expect(revertRes.status).toBe(200);
      const revertedBody = (await revertRes.json()) as { task: { isCompleted: boolean; completedAt: null } };
      expect(revertedBody.task.isCompleted).toBe(false);
      expect(revertedBody.task.completedAt).toBeNull();

      const boardAfterRevert = await (await boardDetailGet(new Request(`http://localhost:3000/api/v1/boards/${workspaceBoardId}`, { headers: { cookie: creatorCookie } }), { params: Promise.resolve({ id: workspaceBoardId }) })).json() as { board: { overdueTaskCount: number } };
      expect(boardAfterRevert.board.overdueTaskCount).toBe(2);

      // 4. Acceptance workflow (403 unassigned admin, 404 blocked hidden, Lead + Creator notifications & WQ-27, idempotent repeat, preserve acceptedAt on PUT /assignees)
      const adminUnassignedAcc = await taskAcceptancePut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/acceptance`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ accepted: true }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(adminUnassignedAcc.status).toBe(403);

      const blockedHiddenAcc = await taskAcceptancePut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/acceptance`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: blockedLeadCookie },
        body: JSON.stringify({ accepted: true }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(blockedHiddenAcc.status).toBe(404);

      sentEmails.length = 0;
      const acceptRes = await taskAcceptancePut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/acceptance`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assigneeCookie },
        body: JSON.stringify({ accepted: true }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(acceptRes.status).toBe(200);
      const acceptJson = (await acceptRes.json()) as { task: { version: number; assignees: Array<{ id: string; acceptedAt: string | null }> }; eventId: string | null };
      expect(acceptJson.eventId).toBeTruthy();
      expect(acceptJson.task.assignees.find((a) => a.id === assigneeId)?.acceptedAt).toBeTruthy();

      // Creator (en) + deptLeadId (vi) got notifications & emails WITHOUT hiddenTitle; blockedLeadId got ZERO
      const leadNotifs = await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications', { headers: { cookie: leadCookie } }))).json() as { items: Array<{ type: string; isHiddenTask: boolean; taskTitle: string | null }> };
      expect(leadNotifs.items[0]).toMatchObject({ type: 'task.accepted', isHiddenTask: true, taskTitle: null });
      const blockedNotifs = await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications', { headers: { cookie: blockedLeadCookie } }))).json() as { items: unknown[] };
      expect(blockedNotifs.items).toHaveLength(0);
      expect(sentEmails.map((m) => m.to).sort()).toEqual([`cr09-cre-${suffix}@eiu.edu.vn`, `cr09-led-${suffix}@eiu.edu.vn`].sort());
      expect(sentEmails.every((m) => !m.subject.includes(hiddenTitle) && !m.text.includes(hiddenTitle))).toBe(true);

      // Idempotent repeat -> eventId: null, 0 new emails
      const repeatAcc = await taskAcceptancePut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/acceptance`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: assigneeCookie },
        body: JSON.stringify({ accepted: true }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(((await repeatAcc.json()) as { eventId: null }).eventId).toBeNull();
      expect(sentEmails).toHaveLength(2);

      // Dept member (assigned via dept1) accepts -> upserts row in task_assignees
      const deptAcc = await taskAcceptancePut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/acceptance`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: otherMemberCookie },
        body: JSON.stringify({ accepted: true }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(deptAcc.status).toBe(200);
      const afterDeptAcc = (await deptAcc.json()) as { task: { version: number; assignees: Array<{ id: string; acceptedAt: string | null }> } };
      expect(afterDeptAcc.task.assignees.find((a) => a.id === otherDeptMemberId)?.acceptedAt).toBeTruthy();

      // Retaining assigneeId via PUT /assignees preserves acceptedAt; removing otherDeptMemberId deletes their row cleanly
      const syncAssigneesRes = await taskAssigneesPut(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/assignees`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ assigneeIds: [assigneeId], notifyDepartmentMembers: false }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(syncAssigneesRes.status).toBe(200);
      const syncedAssignees = ((await syncAssigneesRes.json()) as { task: { assignees: Array<{ id: string; acceptedAt: string | null }> } }).task.assignees;
      expect(syncedAssignees.map((a) => a.id)).toEqual([assigneeId]);
      expect(syncedAssignees[0]?.acceptedAt).toBeTruthy();

      // 5. Deliverables CRUD + WQ-27 redaction + cap=30 409 + non-revertable task_events
      const badUrlRes = await deliverablesPost(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/deliverables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: assigneeCookie },
        body: JSON.stringify({ title: 'Bad Link', url: 'javascript:alert(1)' }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(badUrlRes.status).toBe(400);
      expect(((await badUrlRes.json()) as { error: { code: string } }).error.code).toBe('INVALID_DELIVERABLE_URL');

      sentEmails.length = 0;
      const secretDelivTitle = `SECRET_DOC_${suffix}`;
      const secretDelivUrl = `https://docs.example.com/secret-${suffix}`;
      const addDelivRes = await deliverablesPost(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/deliverables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: assigneeCookie },
        body: JSON.stringify({ title: secretDelivTitle, url: secretDelivUrl }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(addDelivRes.status).toBe(201);
      const addDelivJson = (await addDelivRes.json()) as { deliverable: { id: string }; task: { deliverableCount: number } };
      expect(addDelivJson.task.deliverableCount).toBe(1);
      // WQ-27: Hidden deliverable email omits hiddenTitle, secretDelivTitle, and secretDelivUrl
      expect(sentEmails).toHaveLength(2);
      expect(sentEmails.every((m) => !m.text.includes(secretDelivTitle) && !m.text.includes(secretDelivUrl) && !(m.html ?? '').includes(secretDelivUrl))).toBe(true);

      // GET /deliverables & task_events revertable=false check
      const listDelivRes = await (await deliverablesGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/deliverables`, { headers: { cookie: leadCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) })).json() as { items: Array<{ id: string }> };
      expect(listDelivRes.items.map((d) => d.id)).toEqual([addDelivJson.deliverable.id]);

      const eventsRes = await (await taskEventsGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/events`, { headers: { cookie: creatorCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) })).json() as { items: Array<{ type: string; revertable: boolean }> };
      const cr09Evts = eventsRes.items.filter((e) => e.type === 'task.accepted' || e.type === 'task.deliverable_added');
      expect(cr09Evts.length).toBeGreaterThanOrEqual(2);
      expect(cr09Evts.every((e) => e.revertable === false)).toBe(true);

      // Other dept assignee cannot delete someone else's deliverable without task.update_any
      const otherDelRes = await deliverableDelete(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/deliverables/${addDelivJson.deliverable.id}`, {
        method: 'DELETE',
        headers: { cookie: otherMemberCookie },
      }), { params: Promise.resolve({ id: hiddenTaskId, deliverableId: addDelivJson.deliverable.id }) });
      expect(otherDelRes.status).toBe(403);

      const delDelivRes = await deliverableDelete(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/deliverables/${addDelivJson.deliverable.id}`, {
        method: 'DELETE',
        headers: { cookie: assigneeCookie },
      }), { params: Promise.resolve({ id: hiddenTaskId, deliverableId: addDelivJson.deliverable.id }) });
      expect(delDelivRes.status).toBe(200);

      // Public task deliverable includes taskTitle + deliverableTitle + deliverableUrl in Lead/Creator email
      sentEmails.length = 0;
      const publicDelivRes = await deliverablesPost(new Request(`http://localhost:3000/api/v1/tasks/${t1Body.task.id}/deliverables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ title: 'Public Slides', url: 'https://example.com/public-slides' }),
      }), { params: Promise.resolve({ id: t1Body.task.id }) });
      expect(publicDelivRes.status).toBe(201);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe(`cr09-cre-${suffix}@eiu.edu.vn`);
      expect(sentEmails[0]!.text).toContain(`CR09 Overdue ${suffix}`);
      expect(sentEmails[0]!.text).toContain('Public Slides');
      expect(sentEmails[0]!.text).toContain('https://example.com/public-slides');

      // 30 deliverable cap -> 31st returns 409 DELIVERABLE_LIMIT_REACHED (seed 30 fast via DB)
      await tx.insert(taskDeliverables).values(
        Array.from({ length: 30 }, (_, idx) => ({
          taskId: hiddenTaskId,
          title: `Seeded ${idx}`,
          url: `https://example.com/seeded/${idx}`,
          submittedBy: assigneeId,
        })),
      );
      const capRes = await deliverablesPost(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/deliverables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: assigneeCookie },
        body: JSON.stringify({ title: 'Over 30', url: 'https://example.com/31' }),
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(capRes.status).toBe(409);
      expect(((await capRes.json()) as { error: { code: string } }).error.code).toBe('DELIVERABLE_LIMIT_REACHED');

      // 6. Archive purge clears departments.lead_user_id and anonymizes deliverable submitter; task purge cleans up deliverables
      await tx.insert(taskDeliverables).values({
        taskId: t1Body.task.id,
        title: 'Lead Deliverable',
        url: 'https://example.com/lead-work',
        submittedBy: deptLeadId,
      });
      await tx.update(profiles).set({ isActive: false, leftAt: new Date('2026-10-01T00:00:00Z') }).where(eq(profiles.id, deptLeadId));

      const purgeMemberRes = await archivePurgeDelete(new Request(`http://localhost:3000/api/v1/archive/members/${deptLeadId}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }), { params: Promise.resolve({ entityType: 'members', id: deptLeadId }) });
      expect(purgeMemberRes.status).toBe(200);
      expect(((await purgeMemberRes.json()) as { mode: string }).mode).toBe('anonymized');
      const [deptAfterPurge] = await tx.select({ leadUserId: departments.leadUserId }).from(departments).where(eq(departments.id, dept1Id));
      expect(deptAfterPurge?.leadUserId).toBeNull();

      // Soft delete & purge task -> deletes its task_deliverables cleanly
      await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }), { params: Promise.resolve({ id: hiddenTaskId }) });
      const purgeTaskRes = await archivePurgeDelete(new Request(`http://localhost:3000/api/v1/archive/tasks/${hiddenTaskId}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }), { params: Promise.resolve({ entityType: 'tasks', id: hiddenTaskId }) });
      expect(purgeTaskRes.status).toBe(200);
      const delivsAfterPurge = await tx.select({ id: taskDeliverables.id }).from(taskDeliverables).where(eq(taskDeliverables.taskId, hiddenTaskId));
      expect(delivsAfterPurge).toHaveLength(0);

      // Verify zero PII in task_events & logs
      const serialized = JSON.stringify([logs, await tx.select({ changes: taskEvents.changes }).from(taskEvents).where(eq(taskEvents.taskId, hiddenTaskId))]);
      for (const pii of [adminSid, creatorSid, assigneeSid, leadSid, '@eiu.edu.vn']) {
        expect(serialized).not.toContain(pii);
      }
      // taskGet returns 404 after purge
      const afterPurgeGet = await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) });
      expect(afterPurgeGet.status).toBe(404);
      expect(await tx.select().from(notifications).where(eq(notifications.taskId, hiddenTaskId))).toHaveLength(0);
    });
  }, 60_000);
});
