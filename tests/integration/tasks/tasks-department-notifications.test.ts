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
  taskDepartments,
  taskEvents,
  userPermissions,
} from '@db/schema';
import { DELETE as archivePurgeDelete } from '@/app/api/v1/archive/[entityType]/[id]/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { DELETE as departmentDelete } from '@/app/api/v1/departments/[id]/route';
import { GET as myTasksGet } from '@/app/api/v1/me/tasks/route';
import { PATCH as memberPatch } from '@/app/api/v1/members/[id]/route';
import { POST as notificationReadPost } from '@/app/api/v1/notifications/[id]/read/route';
import { POST as notificationReadAllPost } from '@/app/api/v1/notifications/read-all/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';
import { PUT as taskAssigneesPut } from '@/app/api/v1/tasks/[id]/assignees/route';
import { POST as taskMovePost } from '@/app/api/v1/tasks/[id]/move/route';
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
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzleNotificationsRepository } from '@/server/modules/notifications';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTasksRepository } from '@/server/modules/tasks';
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

describe('Department Task Assignment & Notifications integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for CR-03 integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces task_departments visibility, WQ-27 redaction, bilingual deduplicated emails, read tracking, immediate revocation, and purge cleanup', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const creatorOnlyId = randomUUID();
    const deptMemberViId = randomUUID();
    const deptMemberEnId = randomUUID();
    const outsiderId = randomUUID();
    const inactiveDeptMemberId = randomUUID();
    const disposableRecipientId = randomUUID();

    const adminSid = `MSSV-CR03-ADM-${suffix}`;
    const creatorSid = `MSSV-CR03-CRE-${suffix}`;
    const viMemberSid = `MSSV-CR03-MVI-${suffix}`;
    const enMemberSid = `MSSV-CR03-MEN-${suffix}`;
    const outsiderSid = `MSSV-CR03-OUT-${suffix}`;
    const inactiveSid = `MSSV-CR03-INA-${suffix}`;
    const disposableSid = `MSSV-CR03-DIS-${suffix}`;

    const baseHost = Math.floor(Math.random() * 120) + 20;
    const logs: string[] = [];
    const sentEmails: MailMessage[] = [];
    const fakeMailer: Mailer = {
      send: async (msg) => {
        sentEmails.push(msg);
      },
    };

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `cr03-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: `cr03-cron-secret-${suffix}`,
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
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
        notificationsRepo: new DrizzleNotificationsRepository(tx),
        boardsRepo: new DrizzleBoardsRepository(tx),
        archiveRepo: new DrizzleArchiveRepository(tx),
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
        { code: 'member.update', groupName: 'members', description: 'MU', scopable: false },
        { code: 'department.manage', groupName: 'departments', description: 'DM', scopable: false },
      ]).onConflictDoNothing();

      const pwHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `cr03-adm-${suffix}@eiu.edu.vn`, fullName: `Admin ${suffix}`, passwordHash: pwHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: creatorOnlyId, studentId: creatorSid, email: `cr03-cre-${suffix}@eiu.edu.vn`, fullName: `Creator ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deptMemberViId, studentId: viMemberSid, email: `cr03-mvi-${suffix}@eiu.edu.vn`, fullName: `ViMember ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deptMemberEnId, studentId: enMemberSid, email: `cr03-men-${suffix}@eiu.edu.vn`, fullName: `EnMember ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'en' },
        { id: outsiderId, studentId: outsiderSid, email: `cr03-out-${suffix}@eiu.edu.vn`, fullName: `Outsider ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: inactiveDeptMemberId, studentId: inactiveSid, email: `cr03-ina-${suffix}@eiu.edu.vn`, fullName: `Inactive ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: false, leftAt: new Date('2026-10-01T00:00:00Z'), locale: 'vi' },
        { id: disposableRecipientId, studentId: disposableSid, email: `cr03-dis-${suffix}@eiu.edu.vn`, fullName: `Disposable ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: true, locale: 'en' },
      ]);

      await tx.insert(userPermissions).values([
        { userId: creatorOnlyId, permissionCode: 'task.create', grantedBy: null },
        { userId: deptMemberViId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: deptMemberEnId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: outsiderId, permissionCode: 'task.update_any', grantedBy: null },
        { userId: outsiderId, permissionCode: 'task.delete', grantedBy: null },
      ]);

      const deptMediaId = randomUUID();
      const deptEventId = randomUUID();
      const deptTempId = randomUUID();
      await tx.insert(departments).values([
        { id: deptMediaId, name: `Ban Truyền thông ${suffix}` },
        { id: deptEventId, name: `Ban Sự kiện ${suffix}` },
        { id: deptTempId, name: `Ban Tạm ${suffix}` },
      ]);
      await tx.insert(memberDepartments).values([
        { userId: adminId, departmentId: deptMediaId },
        { userId: deptMemberViId, departmentId: deptMediaId },
        { userId: deptMemberViId, departmentId: deptEventId },
        { userId: deptMemberEnId, departmentId: deptEventId },
        { userId: inactiveDeptMemberId, departmentId: deptMediaId },
        { userId: disposableRecipientId, departmentId: deptTempId },
      ]);

      const boardId = randomUUID();
      const todoColId = randomUUID();
      const doingColId = randomUUID();
      await tx.insert(boards).values({ id: boardId, name: `Board CR03 ${suffix}`, createdBy: adminId });
      await tx.insert(columns).values([
        { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
        { id: doingColId, boardId, name: 'Doing', orderIndex: 1 },
      ]);

      const loginAs = async (studentId: string, offset: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + offset}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const adminCookie = await loginAs(adminSid, 0);
      const creatorCookie = await loginAs(creatorSid, 1);
      const viMemberCookie = await loginAs(viMemberSid, 2);
      const enMemberCookie = await loginAs(enMemberSid, 3);
      const outsiderCookie = await loginAs(outsiderSid, 4);

      // 1. Permission & validation checks on POST /tasks
      expect((await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: creatorCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: 'Deny Dept', departmentIds: [deptMediaId] }),
      }))).status).toBe(403);

      const badDeptRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: 'Bad Dept', departmentIds: [randomUUID()] }),
      }));
      expect(badDeptRes.status).toBe(400);
      expect(((await badDeptRes.json()) as { error: { code: string } }).error.code).toBe('INVALID_DEPARTMENT_IDS');

      // 2. Create public task assigned to BOTH deptMedia & deptEvent -> viMember (in both) deduplicated to 1 notif/email, admin (actor) excluded, inactive excluded
      const publicTaskRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: `Public Dept Task ${suffix}`,
          departmentIds: [deptMediaId, deptEventId],
        }),
      }));
      expect(publicTaskRes.status).toBe(201);
      const publicTaskBody = (await publicTaskRes.json()) as {
        task: { id: string; version: number; assignedDepartments: Array<{ id: string; name: string }> };
      };
      const publicTaskId = publicTaskBody.task.id;
      expect(publicTaskBody.task.assignedDepartments.map((d) => d.id)).toEqual([deptEventId, deptMediaId]);

      // Emails: viMember (vi), enMember (en), NOT admin, NOT inactive
      expect(sentEmails.map((e) => e.to).sort()).toEqual([
        `cr03-men-${suffix}@eiu.edu.vn`,
        `cr03-mvi-${suffix}@eiu.edu.vn`,
      ]);
      const viMail = sentEmails.find((e) => e.to === `cr03-mvi-${suffix}@eiu.edu.vn`)!;
      const enMail = sentEmails.find((e) => e.to === `cr03-men-${suffix}@eiu.edu.vn`)!;
      expect(viMail.subject).toContain(`Public Dept Task ${suffix}`);
      expect(enMail.subject).toContain(`New task for`);
      sentEmails.length = 0;

      // 3. Create hidden task assigned to deptMediaId -> WQ-27 ensures taskTitle omitted from DB payload & email!
      const hiddenSecretTitle = `SECRET_AGENDA_${suffix}`;
      const hiddenTaskRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: hiddenSecretTitle,
          departmentIds: [deptMediaId],
          isHidden: true,
        }),
      }));
      expect(hiddenTaskRes.status).toBe(201);
      const hiddenTaskId = ((await hiddenTaskRes.json()) as { task: { id: string } }).task.id;
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe(`cr03-mvi-${suffix}@eiu.edu.vn`);
      expect(sentEmails[0]!.subject).not.toContain(hiddenSecretTitle);
      expect(sentEmails[0]!.text).not.toContain(hiddenSecretTitle);
      expect(sentEmails[0]!.html).not.toContain(hiddenSecretTitle);
      sentEmails.length = 0;

      // 4. Hidden task access: viMember can GET/PATCH/MOVE, outsider (even with task.update_any & task.delete) gets 404
      expect((await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { headers: { cookie: outsiderCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(404);
      expect((await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: outsiderCookie }, body: JSON.stringify({ title: 'Steal', version: 1 }) }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(404);
      expect((await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { method: 'DELETE', headers: { cookie: outsiderCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(404);

      expect((await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { headers: { cookie: viMemberCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(200);
      expect((await taskPatch(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: viMemberCookie }, body: JSON.stringify({ description: 'Dept edit', version: 1 }) }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(200);
      expect((await taskMovePost(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}/move`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: viMemberCookie }, body: JSON.stringify({ columnId: doingColId, version: 2 }) }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(200);

      // 5. GET /tasks?departmentId=... & GET /me/tasks?departmentId=...
      const filteredTasks = (await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?departmentId=${deptMediaId}`, { headers: { cookie: viMemberCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(filteredTasks.items.map((t) => t.id).sort()).toEqual([hiddenTaskId, publicTaskId].sort());
      const outsiderFiltered = (await (await tasksGet(new Request(`http://localhost:3000/api/v1/tasks?departmentId=${deptMediaId}`, { headers: { cookie: outsiderCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(outsiderFiltered.items.map((t) => t.id)).toEqual([publicTaskId]);
      const myTasksRes = (await (await myTasksGet(new Request(`http://localhost:3000/api/v1/me/tasks?departmentId=${deptEventId}`, { headers: { cookie: enMemberCookie } }))).json()) as { items: Array<{ id: string }> };
      expect(myTasksRes.items.map((t) => t.id)).toEqual([publicTaskId]);

      // 6. GET /notifications + WQ-27 null taskTitle + cursor + read + read-all
      const viNotifsPage1 = (await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications?limit=1', { headers: { cookie: viMemberCookie } }))).json()) as {
        items: Array<{ id: string; taskId: string; taskTitle: string | null; isHiddenTask: boolean; readAt: string | null }>;
        unreadCount: number;
        meta: { nextCursor: string | null };
      };
      expect(viNotifsPage1.unreadCount).toBe(2);
      expect(viNotifsPage1.items).toHaveLength(1);
      expect(viNotifsPage1.meta.nextCursor).toBeTruthy();

      const viNotifsAll = (await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications', { headers: { cookie: viMemberCookie } }))).json()) as {
        items: Array<{ id: string; taskId: string; taskTitle: string | null; isHiddenTask: boolean; readAt: string | null }>;
        unreadCount: number;
      };
      const hiddenNotif = viNotifsAll.items.find((n) => n.taskId === hiddenTaskId)!;
      const publicNotif = viNotifsAll.items.find((n) => n.taskId === publicTaskId)!;
      expect(hiddenNotif.isHiddenTask).toBe(true);
      expect(hiddenNotif.taskTitle).toBeNull();
      expect(publicNotif.taskTitle).toBe(`Public Dept Task ${suffix}`);

      // Other user cannot mark viMember's notification as read -> 404
      expect((await notificationReadPost(new Request(`http://localhost:3000/api/v1/notifications/${publicNotif.id}/read`, { method: 'POST', headers: { cookie: enMemberCookie } }), { params: Promise.resolve({ id: publicNotif.id }) })).status).toBe(404);

      const markOneRes = await notificationReadPost(new Request(`http://localhost:3000/api/v1/notifications/${publicNotif.id}/read`, { method: 'POST', headers: { cookie: viMemberCookie } }), { params: Promise.resolve({ id: publicNotif.id }) });
      expect(markOneRes.status).toBe(200);
      expect(((await markOneRes.json()) as { unreadCount: number }).unreadCount).toBe(1);

      const unreadOnly = (await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications?unreadOnly=true', { headers: { cookie: viMemberCookie } }))).json()) as {
        items: Array<{ id: string }>;
      };
      expect(unreadOnly.items.map((i) => i.id)).toEqual([hiddenNotif.id]);

      // 7. Immediate revocation on removing member from deptMediaId -> hidden task & hidden notif immediately 404!
      const revokeDeptRes = await memberPatch(
        new Request(`http://localhost:3000/api/v1/members/${deptMemberViId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ departmentIds: [deptEventId] }),
        }),
        { params: Promise.resolve({ id: deptMemberViId }) },
      );
      expect(revokeDeptRes.status).toBe(200);

      expect((await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenTaskId}`, { headers: { cookie: viMemberCookie } }), { params: Promise.resolve({ id: hiddenTaskId }) })).status).toBe(404);
      expect((await notificationReadPost(new Request(`http://localhost:3000/api/v1/notifications/${hiddenNotif.id}/read`, { method: 'POST', headers: { cookie: viMemberCookie } }), { params: Promise.resolve({ id: hiddenNotif.id }) })).status).toBe(404);
      const afterRevokeNotifs = (await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications', { headers: { cookie: viMemberCookie } }))).json()) as {
        items: Array<{ id: string }>;
        unreadCount: number;
      };
      expect(afterRevokeNotifs.items.map((i) => i.id)).toEqual([publicNotif.id]);
      expect(afterRevokeNotifs.unreadCount).toBe(0);

      // read-all for enMember marks unreadCount to 0
      const readAllEn = await notificationReadAllPost(new Request('http://localhost:3000/api/v1/notifications/read-all', { method: 'POST', headers: { cookie: enMemberCookie } }));
      expect(readAllEn.status).toBe(200);
      expect(await readAllEn.json()).toEqual({ updatedCount: 1, unreadCount: 0 });

      // 8. PUT /tasks/{id}/assignees partial updates & silent mode
      const emptyUpdate = await taskAssigneesPut(
        new Request(`http://localhost:3000/api/v1/tasks/${publicTaskId}/assignees`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ version: 1 }),
        }),
        { params: Promise.resolve({ id: publicTaskId }) },
      );
      expect(emptyUpdate.status).toBe(400);

      // Add deptTempId silently (notifyDepartmentMembers: false) while preserving existing assignees
      const silentAssignRes = await taskAssigneesPut(
        new Request(`http://localhost:3000/api/v1/tasks/${publicTaskId}/assignees`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            departmentIds: [deptMediaId, deptEventId, deptTempId],
            notifyDepartmentMembers: false,
            version: 1,
          }),
        }),
        { params: Promise.resolve({ id: publicTaskId }) },
      );
      expect(silentAssignRes.status).toBe(200);
      expect(sentEmails).toHaveLength(0);

      // Replace only assigneeIds (omit departmentIds -> preserved) -> newly added outsiderId receives 1 direct task.assigned notif & email
      sentEmails.length = 0;
      const userOnlyAssignRes = await taskAssigneesPut(
        new Request(`http://localhost:3000/api/v1/tasks/${publicTaskId}/assignees`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ assigneeIds: [outsiderId], version: 2 }),
        }),
        { params: Promise.resolve({ id: publicTaskId }) },
      );
      expect(userOnlyAssignRes.status).toBe(200);
      const userOnlyBody = (await userOnlyAssignRes.json()) as {
        task: { assignees: Array<{ id: string }>; assignedDepartments: Array<{ id: string }> };
      };
      expect(userOnlyBody.task.assignees.map((a) => a.id)).toEqual([outsiderId]);
      expect(userOnlyBody.task.assignedDepartments.map((d) => d.id)).toHaveLength(3);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe(`cr03-out-${suffix}@eiu.edu.vn`);
      expect(sentEmails[0]!.subject).toBe(`[BEAM] Công việc mới được giao cho bạn: Public Dept Task ${suffix}`);
      sentEmails.length = 0;

      // 8b. CR-06: Multi-source deduplication (dept + direct -> 1 task.department_assigned), actor exclusion, independent notifyInApp/notifyEmail, and WQ-27 hidden direct task
      const mixedTaskRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: `Mixed Assign ${suffix}`,
          departmentIds: [deptEventId],
          assigneeIds: [adminId, deptMemberEnId, outsiderId],
        }),
      }));
      expect(mixedTaskRes.status).toBe(201);
      const mixedTaskId = ((await mixedTaskRes.json()) as { task: { id: string } }).task.id;
      expect(sentEmails.map((e) => e.to).sort()).toEqual([
        `cr03-men-${suffix}@eiu.edu.vn`,
        `cr03-mvi-${suffix}@eiu.edu.vn`,
        `cr03-out-${suffix}@eiu.edu.vn`,
      ]);
      const mixedNotifRows = await tx.select().from(notifications).where(eq(notifications.taskId, mixedTaskId));
      expect(mixedNotifRows).toHaveLength(3);
      expect(mixedNotifRows.find((r) => r.userId === deptMemberViId)?.type).toBe('task.department_assigned');
      expect(mixedNotifRows.find((r) => r.userId === deptMemberEnId)?.type).toBe('task.department_assigned');
      expect(mixedNotifRows.find((r) => r.userId === outsiderId)?.type).toBe('task.assigned');
      expect(mixedNotifRows.find((r) => r.userId === outsiderId)?.departmentId).toBeNull();
      sentEmails.length = 0;

      // notifyInApp=true, notifyEmail=false -> DB row only, 0 emails
      const inAppOnlyRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: `InApp Only ${suffix}`,
          assigneeIds: [outsiderId],
          notifyInApp: true,
          notifyEmail: false,
        }),
      }));
      expect(inAppOnlyRes.status).toBe(201);
      const inAppOnlyTaskId = ((await inAppOnlyRes.json()) as { task: { id: string } }).task.id;
      expect(sentEmails).toHaveLength(0);
      expect(await tx.select().from(notifications).where(eq(notifications.taskId, inAppOnlyTaskId))).toHaveLength(1);

      // notifyInApp=false, notifyEmail=true -> email only, 0 DB rows
      const emailOnlyRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: `Email Only ${suffix}`,
          assigneeIds: [deptMemberEnId],
          notifyInApp: false,
          notifyEmail: true,
        }),
      }));
      expect(emailOnlyRes.status).toBe(201);
      const emailOnlyTaskId = ((await emailOnlyRes.json()) as { task: { id: string } }).task.id;
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.subject).toBe(`[BEAM] New task assigned to you: Email Only ${suffix}`);
      expect(await tx.select().from(notifications).where(eq(notifications.taskId, emailOnlyTaskId))).toHaveLength(0);
      sentEmails.length = 0;

      // Hidden direct task -> WQ-27 redacts title in DB, GET /notifications, and direct email; unassigning immediately 404s
      const directSecretTitle = `DIRECT_HIDDEN_${suffix}`;
      const hiddenDirectRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          boardId,
          columnId: todoColId,
          title: directSecretTitle,
          assigneeIds: [outsiderId],
          isHidden: true,
        }),
      }));
      expect(hiddenDirectRes.status).toBe(201);
      const hiddenDirectTaskId = ((await hiddenDirectRes.json()) as { task: { id: string } }).task.id;
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.subject).toBe('[BEAM] Công việc ẩn mới được giao cho bạn');
      expect(sentEmails[0]!.subject).not.toContain(directSecretTitle);
      expect(sentEmails[0]!.text).not.toContain(directSecretTitle);
      expect(sentEmails[0]!.html).not.toContain(directSecretTitle);
      sentEmails.length = 0;

      const outsiderNotifs = (await (await notificationsGet(new Request('http://localhost:3000/api/v1/notifications', { headers: { cookie: outsiderCookie } }))).json()) as {
        items: Array<{ id: string; type: string; taskId: string; taskTitle: string | null; departmentId: string | null; departmentName: string | null; isHiddenTask: boolean }>;
      };
      const hiddenDirectNotif = outsiderNotifs.items.find((n) => n.taskId === hiddenDirectTaskId)!;
      expect(hiddenDirectNotif).toMatchObject({
        type: 'task.assigned',
        taskId: hiddenDirectTaskId,
        taskTitle: null,
        departmentId: null,
        departmentName: null,
        isHiddenTask: true,
      });

      // Unassign outsiderId from hiddenDirectTaskId -> immediate 404 on task & notification
      expect((await taskAssigneesPut(
        new Request(`http://localhost:3000/api/v1/tasks/${hiddenDirectTaskId}/assignees`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ assigneeIds: [], version: 1 }),
        }),
        { params: Promise.resolve({ id: hiddenDirectTaskId }) },
      )).status).toBe(200);
      expect((await taskGet(new Request(`http://localhost:3000/api/v1/tasks/${hiddenDirectTaskId}`, { headers: { cookie: outsiderCookie } }), { params: Promise.resolve({ id: hiddenDirectTaskId }) })).status).toBe(404);
      expect((await notificationReadPost(new Request(`http://localhost:3000/api/v1/notifications/${hiddenDirectNotif.id}/read`, { method: 'POST', headers: { cookie: outsiderCookie } }), { params: Promise.resolve({ id: hiddenDirectNotif.id }) })).status).toBe(404);

      // 9. Soft-delete & Archive purge frees department and cleans notifications/task_departments
      const silentTempTaskRes = await tasksPost(new Request('http://localhost:3000/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ boardId, columnId: todoColId, title: `Temp Purge ${suffix}`, departmentIds: [deptTempId], notifyDepartmentMembers: true }),
      }));
      expect(silentTempTaskRes.status).toBe(201);
      const tempTaskId = ((await silentTempTaskRes.json()) as { task: { id: string } }).task.id;

      // Remove deptTempId from publicTaskId so only tempTaskId references deptTempId
      await taskAssigneesPut(
        new Request(`http://localhost:3000/api/v1/tasks/${publicTaskId}/assignees`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ departmentIds: [deptMediaId, deptEventId], version: 3 }),
        }),
        { params: Promise.resolve({ id: publicTaskId }) },
      );
      // Deleting deptTempId while referenced by tempTaskId + disposableRecipientId fails 409
      expect((await departmentDelete(new Request(`http://localhost:3000/api/v1/departments/${deptTempId}`, { method: 'DELETE', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: deptTempId }) })).status).toBe(409);

      // Soft-delete & purge tempTaskId -> cleans task_departments & notifications of tempTaskId
      expect((await taskDelete(new Request(`http://localhost:3000/api/v1/tasks/${tempTaskId}`, { method: 'DELETE', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: tempTaskId }) })).status).toBe(200);
      expect((await archivePurgeDelete(new Request(`http://localhost:3000/api/v1/archive/tasks/${tempTaskId}`, { method: 'DELETE', headers: { cookie: adminCookie } }), { params: Promise.resolve({ entityType: 'tasks', id: tempTaskId }) })).status).toBe(200);
      expect(await tx.select().from(taskDepartments).where(eq(taskDepartments.taskId, tempTaskId))).toHaveLength(0);
      expect(await tx.select().from(notifications).where(eq(notifications.taskId, tempTaskId))).toHaveLength(0);

      // Remove member from deptTempId -> now deptTempId has 0 references and can be deleted cleanly (and notifications.department_id on other tasks is preserved or set null)
      await tx.delete(memberDepartments).where(eq(memberDepartments.departmentId, deptTempId));
      expect((await departmentDelete(new Request(`http://localhost:3000/api/v1/departments/${deptTempId}`, { method: 'DELETE', headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: deptTempId }) })).status).toBe(200);

      // 9b. Member purge cleanup: recipient-only inactive member is physically deleted (disposable notifications.user_id deleted);
      // notification actor inactive member is anonymized (notifications.actor_id preserved)
      const recipientOnlyId = randomUUID();
      const actorOnlyId = randomUUID();
      await tx.insert(profiles).values([
        { id: recipientOnlyId, studentId: `MSSV-CR03-REC-${suffix}`, email: `cr03-rec-${suffix}@eiu.edu.vn`, fullName: `RecOnly ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: false, leftAt: new Date('2026-10-01T00:00:00Z'), locale: 'vi' },
        { id: actorOnlyId, studentId: `MSSV-CR03-ACT-${suffix}`, email: `cr03-act-${suffix}@eiu.edu.vn`, fullName: `ActOnly ${suffix}`, passwordHash: pwHash, isAdmin: false, isActive: false, leftAt: new Date('2026-10-01T00:00:00Z'), locale: 'vi' },
      ]);
      await tx.insert(notifications).values([
        { userId: recipientOnlyId, type: 'task.department_assigned', taskId: publicTaskId, boardId, actorId: adminId, isHiddenTask: false, payload: { boardName: 'B' } },
        { userId: deptMemberViId, type: 'task.department_assigned', taskId: publicTaskId, boardId, actorId: actorOnlyId, isHiddenTask: false, payload: { boardName: 'B' } },
      ]);
      const purgeRecipientRes = await archivePurgeDelete(
        new Request(`http://localhost:3000/api/v1/archive/members/${recipientOnlyId}`, { method: 'DELETE', headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ entityType: 'members', id: recipientOnlyId }) },
      );
      expect(purgeRecipientRes.status).toBe(200);
      expect(((await purgeRecipientRes.json()) as { mode: string }).mode).toBe('physical_delete');
      expect(await tx.select().from(notifications).where(eq(notifications.userId, recipientOnlyId))).toHaveLength(0);

      const purgeActorRes = await archivePurgeDelete(
        new Request(`http://localhost:3000/api/v1/archive/members/${actorOnlyId}`, { method: 'DELETE', headers: { cookie: adminCookie } }),
        { params: Promise.resolve({ entityType: 'members', id: actorOnlyId }) },
      );
      expect(purgeActorRes.status).toBe(200);
      expect(((await purgeActorRes.json()) as { mode: string }).mode).toBe('anonymized');

      // 10. Zero PII in task_events, notifications, API responses, and logs
      const allEvents = await tx.select().from(taskEvents).where(eq(taskEvents.taskId, publicTaskId));
      const allNotifs = await tx.select().from(notifications).where(eq(notifications.boardId, boardId));
      const serialized = JSON.stringify([allEvents, allNotifs, viNotifsAll, logs]);
      for (const pii of [adminSid, creatorSid, viMemberSid, enMemberSid, outsiderSid, inactiveSid, `cr03-adm-${suffix}`, `cr03-mvi-${suffix}`, `cr03-out-${suffix}`]) {
        expect(serialized).not.toContain(pii);
      }
    });
  });
});
