import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appSettings,
  auditLogs,
  boards,
  columns,
  departments,
  memberDepartments,
  permissions,
  profiles,
  reminders,
  taskAssignees,
  taskDepartments,
  tasks,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import {
  GET as cronArchivePurgeGet,
  POST as cronArchivePurgePost,
} from '@/app/api/v1/internal/cron/archive-purge/route';
import {
  GET as cronRemindersGet,
  POST as cronRemindersPost,
} from '@/app/api/v1/internal/cron/reminders/route';
import {
  GET as reminderSettingsGet,
  PUT as reminderSettingsPut,
} from '@/app/api/v1/settings/reminders/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { REMINDERS_APP_SETTING_KEY } from '@/lib/reminders';
import { DrizzleArchiveRepository } from '@/server/modules/archive';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleRemindersRepository } from '@/server/modules/reminders';
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

async function loginAs(studentId: string, ip: string): Promise<string> {
  const res = await loginPost(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD, remember: false }),
    }),
  );
  expect(res.status).toBe(200);
  return cookiePairFromLogin(res);
}

describe('Reminders Settings & Cron Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for reminder integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces RBAC + audit on /settings/reminders, CRON_SECRET on GET/POST cron routes, bilingual E01 digest, WQ-27 hidden redaction, AC-03 idempotency, and post-send persistence', async () => {
    const suffix = randomUUID().slice(0, 8);
    const now = new Date('2026-11-26T00:00:00.000Z'); // 2026-11-26 07:00 VN
    const clock = new FakeClock(now);
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];
    const sentEmails: MailMessage[] = [];
    let failRecipientEmail: string | null = null;

    const fakeMailer: Mailer = {
      send: async (msg) => {
        if (failRecipientEmail && msg.to === failRecipientEmail) {
          throw new Error(`SMTP failure for ${msg.to}`);
        }
        sentEmails.push(msg);
      },
    };

    const adminId = randomUUID();
    const remConfigId = randomUUID();
    const userViId = randomUUID();
    const userEnId = randomUUID();
    const userInactiveId = randomUUID();
    const userPurgedId = randomUUID();
    const userOutsiderId = randomUUID();

    const deptAId = randomUUID();
    const activeBoardId = randomUUID();
    const archivedBoardId = randomUUID();
    const colTodoId = randomUUID();
    const colDoingId = randomUUID();
    const colDoneId = randomUUID();
    const colArchivedBoardId = randomUUID();

    const taskOverdueId = randomUUID();
    const taskDueTodayId = randomUUID();
    const taskHiddenD1Id = randomUUID();
    const taskHiddenDeptD2Id = randomUUID();
    const taskDoneColId = randomUUID();
    const taskSoftDeletedId = randomUUID();
    const taskPurgedId = randomUUID();
    const taskOnArchivedBoardId = randomUUID();
    const taskNoDueId = randomUUID();
    const taskUnmatchedDayId = randomUUID();
    const taskRetryId = randomUUID();

    const adminSid = `REM-ADM-${suffix}`;
    const configSid = `REM-CFG-${suffix}`;
    const viSid = `REM-VI-${suffix}`;
    const enSid = `REM-EN-${suffix}`;
    const inactiveSid = `REM-INA-${suffix}`;
    const purgedSid = `PURGED-${userPurgedId}`;
    const outsiderSid = `REM-OUT-${suffix}`;

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `rem-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: `rem-cron-secret-${suffix}`,
      smtp: {},
      appUrl: 'https://beam.club.test/',
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
        boardsRepo: new DrizzleBoardsRepository(tx),
        archiveRepo: new DrizzleArchiveRepository(tx),
        remindersRepo: new DrizzleRemindersRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      // Isolate from any pre-existing seed tasks inside this rolled-back transaction
      await tx.update(tasks).set({ deletedAt: now });
      await tx.delete(appSettings).where(eq(appSettings.key, REMINDERS_APP_SETTING_KEY));

      await tx.insert(permissions).values([
        { code: 'member.view', groupName: 'members', description: 'MV', scopable: false },
        { code: 'reminder.configure', groupName: 'system', description: 'RC', scopable: false },
      ]).onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(departments).values({ id: deptAId, name: `Dept Rem ${suffix}` });

      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `rem-adm-${suffix}@eiu.edu.vn`,
          fullName: `Rem Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: remConfigId,
          studentId: configSid,
          email: `rem-cfg-${suffix}@eiu.edu.vn`,
          fullName: `Rem Config ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
        {
          id: userViId,
          studentId: viSid,
          email: `rem-vi-${suffix}@eiu.edu.vn`,
          fullName: `Vi Recipient ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: userEnId,
          studentId: enSid,
          email: `rem-en-${suffix}@eiu.edu.vn`,
          fullName: `En Recipient ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
        {
          id: userInactiveId,
          studentId: inactiveSid,
          email: `rem-ina-${suffix}@eiu.edu.vn`,
          fullName: `Inactive Left ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: false,
          leftAt: new Date('2026-11-20T00:00:00.000Z'),
          locale: 'vi',
        },
        {
          id: userPurgedId,
          studentId: purgedSid,
          email: `purged+${userPurgedId}@redacted.local`,
          fullName: 'Thành viên đã xóa',
          passwordHash: null,
          isAdmin: false,
          isActive: false,
          leftAt: new Date('2026-10-01T00:00:00.000Z'),
          purgedAt: new Date('2026-11-20T00:00:00.000Z'),
          locale: 'vi',
        },
        {
          id: userOutsiderId,
          studentId: outsiderSid,
          email: `rem-out-${suffix}@eiu.edu.vn`,
          fullName: `Outsider ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
      ]);

      await tx.insert(userPermissions).values([
        { userId: remConfigId, permissionCode: 'reminder.configure', grantedBy: adminId },
        { userId: userOutsiderId, permissionCode: 'member.view', grantedBy: adminId },
      ]);

      await tx.insert(memberDepartments).values([
        { userId: userViId, departmentId: deptAId },
        { userId: userEnId, departmentId: deptAId },
        { userId: userInactiveId, departmentId: deptAId },
        { userId: userPurgedId, departmentId: deptAId },
      ]);

      await tx.insert(boards).values([
        { id: activeBoardId, name: `Active Rem Board ${suffix}`, createdBy: adminId },
        {
          id: archivedBoardId,
          name: `Archived Rem Board ${suffix}`,
          archivedAt: new Date('2026-11-20T00:00:00.000Z'),
          createdBy: adminId,
        },
      ]);

      await tx.insert(columns).values([
        { id: colTodoId, boardId: activeBoardId, name: 'Todo', orderIndex: 0 },
        { id: colDoingId, boardId: activeBoardId, name: 'Doing', orderIndex: 1 },
        { id: colDoneId, boardId: activeBoardId, name: 'Done', orderIndex: 2 },
        { id: colArchivedBoardId, boardId: archivedBoardId, name: 'Todo', orderIndex: 0 },
      ]);

      await tx.insert(tasks).values([
        {
          id: taskOverdueId,
          boardId: activeBoardId,
          columnId: colDoingId,
          title: `Overdue Task ${suffix}`,
          dueAt: new Date('2026-11-25T10:00:00.000Z'), // -1 VN day
          priority: 4,
          position: '1000',
          isHidden: false,
          createdBy: adminId,
        },
        {
          id: taskDueTodayId,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `Due Today Task ${suffix}`,
          dueAt: new Date('2026-11-26T10:00:00.000Z'), // 0 VN days
          priority: 3,
          position: '2000',
          isHidden: false,
          createdBy: adminId,
        },
        {
          id: taskHiddenD1Id,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `TOP_SECRET_BUDGET_${suffix}`,
          dueAt: new Date('2026-11-27T10:00:00.000Z'), // +1 VN day
          priority: 2,
          position: '3000',
          isHidden: true,
          createdBy: adminId,
        },
        {
          id: taskHiddenDeptD2Id,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `SECRET_DEPT_PLAN_${suffix}`,
          dueAt: new Date('2026-11-28T10:00:00.000Z'), // +2 VN days
          priority: 3,
          position: '4000',
          isHidden: true,
          createdBy: adminId,
        },
        // Excluded tasks below:
        {
          id: taskDoneColId,
          boardId: activeBoardId,
          columnId: colDoneId,
          title: `Done Overdue ${suffix}`,
          dueAt: new Date('2026-11-25T10:00:00.000Z'),
          priority: 4,
          position: '5000',
          isHidden: false,
          createdBy: adminId,
        },
        {
          id: taskSoftDeletedId,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `Deleted Task ${suffix}`,
          dueAt: new Date('2026-11-25T10:00:00.000Z'),
          priority: 4,
          position: '6000',
          isHidden: false,
          deletedAt: now,
          createdBy: adminId,
        },
        {
          id: taskPurgedId,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `Purged Task ${suffix}`,
          dueAt: new Date('2026-11-25T10:00:00.000Z'),
          priority: 4,
          position: '7000',
          isHidden: false,
          deletedAt: now,
          purgedAt: now,
          createdBy: adminId,
        },
        {
          id: taskOnArchivedBoardId,
          boardId: archivedBoardId,
          columnId: colArchivedBoardId,
          title: `Archived Board Task ${suffix}`,
          dueAt: new Date('2026-11-25T10:00:00.000Z'),
          priority: 4,
          position: '8000',
          isHidden: false,
          createdBy: adminId,
        },
        {
          id: taskNoDueId,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `No Due Task ${suffix}`,
          dueAt: null,
          priority: 2,
          position: '9000',
          isHidden: false,
          createdBy: adminId,
        },
        {
          id: taskUnmatchedDayId,
          boardId: activeBoardId,
          columnId: colTodoId,
          title: `Far Future Task ${suffix}`,
          dueAt: new Date('2026-12-02T10:00:00.000Z'), // +6 VN days
          priority: 2,
          position: '10000',
          isHidden: false,
          createdBy: adminId,
        },
      ]);

      await tx.insert(taskAssignees).values([
        // Direct assignee + department member overlap for userViId
        { taskId: taskOverdueId, userId: userViId },
        { taskId: taskOverdueId, userId: userInactiveId },
        { taskId: taskHiddenD1Id, userId: userViId },
        { taskId: taskDoneColId, userId: userViId },
        { taskId: taskSoftDeletedId, userId: userViId },
        { taskId: taskPurgedId, userId: userViId },
        { taskId: taskOnArchivedBoardId, userId: userViId },
        { taskId: taskNoDueId, userId: userViId },
        { taskId: taskUnmatchedDayId, userId: userViId },
      ]);

      await tx.insert(taskDepartments).values([
        { taskId: taskOverdueId, departmentId: deptAId },
        { taskId: taskDueTodayId, departmentId: deptAId },
        { taskId: taskHiddenDeptD2Id, departmentId: deptAId },
      ]);

      const adminCookie = await loginAs(adminSid, `10.${baseHost}.1.1`);
      const cfgCookie = await loginAs(configSid, `10.${baseHost}.1.2`);
      const outsiderCookie = await loginAs(outsiderSid, `10.${baseHost}.1.3`);

      // 1. Settings RBAC & fallback defaults
      expect(
        (await reminderSettingsGet(new Request('http://localhost/api/v1/settings/reminders'))).status,
      ).toBe(401);
      expect(
        (await reminderSettingsPut(
          new Request('http://localhost/api/v1/settings/reminders', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ daysBefore: [1], remindOverdue: true }),
          }),
        )).status,
      ).toBe(401);
      expect(
        (await reminderSettingsGet(
          new Request('http://localhost/api/v1/settings/reminders', {
            headers: { cookie: outsiderCookie },
          }),
        )).status,
      ).toBe(403);
      expect(
        (await reminderSettingsPut(
          new Request('http://localhost/api/v1/settings/reminders', {
            method: 'PUT',
            headers: { cookie: outsiderCookie, 'content-type': 'application/json' },
            body: JSON.stringify({ daysBefore: [1], remindOverdue: true }),
          }),
        )).status,
      ).toBe(403);

      const defaultGetRes = await reminderSettingsGet(
        new Request('http://localhost/api/v1/settings/reminders', {
          headers: { cookie: cfgCookie },
        }),
      );
      expect(defaultGetRes.status).toBe(200);
      expect(await defaultGetRes.json()).toEqual({
        settings: {
          daysBefore: [2, 1],
          remindOverdue: true,
          sendHourVn: 7,
          updatedAt: null,
          updatedBy: null,
        },
      });

      // Bad payload -> 400
      expect(
        (await reminderSettingsPut(
          new Request('http://localhost/api/v1/settings/reminders', {
            method: 'PUT',
            headers: { cookie: cfgCookie, 'content-type': 'application/json' },
            body: JSON.stringify({ daysBefore: [-1], remindOverdue: true }),
          }),
        )).status,
      ).toBe(400);

      // PUT with reminder.configure normalizes [0, 2, 1, 2] -> [2, 1, 0], returns mapped updatedBy without PII
      const putCfgRes = await reminderSettingsPut(
        new Request('http://localhost/api/v1/settings/reminders', {
          method: 'PUT',
          headers: { cookie: cfgCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ daysBefore: [0, 2, 1, 2], remindOverdue: true }),
        }),
      );
      expect(putCfgRes.status).toBe(200);
      const putCfgBody = await putCfgRes.json();
      expect(putCfgBody.settings.daysBefore).toEqual([2, 1, 0]);
      expect(putCfgBody.settings.remindOverdue).toBe(true);
      expect(putCfgBody.settings.sendHourVn).toBe(7);
      expect(putCfgBody.settings.updatedAt).not.toBeNull();
      expect(putCfgBody.settings.updatedBy).toMatchObject({
        id: remConfigId,
        fullName: `Rem Config ${suffix}`,
      });
      expect(putCfgBody.settings.updatedBy.studentId).toBeUndefined();
      expect(putCfgBody.settings.updatedBy.email).toBeUndefined();

      // Admin bypasses permission check too
      expect(
        (await reminderSettingsGet(
          new Request('http://localhost/api/v1/settings/reminders', {
            headers: { cookie: adminCookie },
          }),
        )).status,
      ).toBe(200);

      const audits = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, remConfigId));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.action).toBe('settings.reminders_updated');
      expect(audits[0]!.detail).toEqual({
        previousDaysBefore: [2, 1],
        previousRemindOverdue: true,
        daysBefore: [2, 1, 0],
        remindOverdue: true,
      });

      // 2. Cron auth checks on POST and GET (reminders + archive-purge)
      expect((await cronRemindersPost(new Request('http://localhost/api/v1/internal/cron/reminders', { method: 'POST' }))).status).toBe(401);
      expect((await cronRemindersGet(new Request('http://localhost/api/v1/internal/cron/reminders', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
      expect((await cronArchivePurgeGet(new Request('http://localhost/api/v1/internal/cron/archive-purge'))).status).toBe(401);
      expect(
        (await cronArchivePurgePost(
          new Request('http://localhost/api/v1/internal/cron/archive-purge', {
            method: 'POST',
            headers: { authorization: `Bearer ${testConfig.cronSecret}` },
          }),
        )).status,
      ).toBe(200);
      expect(
        (await cronArchivePurgeGet(
          new Request('http://localhost/api/v1/internal/cron/archive-purge', {
            headers: { authorization: `Bearer ${testConfig.cronSecret}` },
          }),
        )).status,
      ).toBe(200);

      // 3. First cron run (POST) -> 4 matched tasks, 2 digest emails (VI + EN), 7 recorded rows
      const run1Res = await cronRemindersPost(
        new Request('http://localhost/api/v1/internal/cron/reminders', {
          method: 'POST',
          headers: { authorization: `Bearer ${testConfig.cronSecret}` },
        }),
      );
      expect(run1Res.status).toBe(200);
      expect(await run1Res.json()).toEqual({
        processedTasks: 4,
        emailsSent: 2,
        remindersRecorded: 7,
        skippedAlreadySent: 0,
      });
      expect(sentEmails).toHaveLength(2);

      const viMail = sentEmails.find((m) => m.to === `rem-vi-${suffix}@eiu.edu.vn`);
      const enMail = sentEmails.find((m) => m.to === `rem-en-${suffix}@eiu.edu.vn`);
      expect(viMail).toBeDefined();
      expect(enMail).toBeDefined();

      // Verify VI email: bilingual E01, hidden task titles omitted, no PII, no other member names
      expect(viMail!.text).toContain('Quá hạn');
      expect(viMail!.text).toContain('Đến hạn hôm nay');
      expect(viMail!.text).toContain('Sắp tới');
      expect(viMail!.text).toContain(`Overdue Task ${suffix}`);
      expect(viMail!.text).toContain(`Due Today Task ${suffix}`);
      expect(viMail!.text).toContain('(Công việc ẩn — đăng nhập để xem chi tiết)');
      expect(viMail!.text).toContain('https://beam.club.test/my-tasks');
      expect(viMail!.text).not.toContain(`TOP_SECRET_BUDGET_${suffix}`);
      expect(viMail!.html).not.toContain(`TOP_SECRET_BUDGET_${suffix}`);
      expect(viMail!.text).not.toContain(`SECRET_DEPT_PLAN_${suffix}`);
      expect(viMail!.html).not.toContain(`SECRET_DEPT_PLAN_${suffix}`);
      expect(viMail!.text).not.toContain(viSid);
      expect(viMail!.text).not.toContain(`rem-vi-${suffix}@eiu.edu.vn`);
      expect(viMail!.text).not.toContain(`En Recipient ${suffix}`);
      expect(viMail!.text).not.toContain(`Inactive Left ${suffix}`);

      // Verify EN email: EN locale, Overdue omitted (already sent? No, EN got overdue + dueToday + hiddenDeptD2)
      expect(enMail!.text).toContain('Overdue');
      expect(enMail!.text).toContain('Due today');
      expect(enMail!.text).toContain('Coming up');
      expect(enMail!.text).toContain('(Hidden task — sign in to view details)');
      expect(enMail!.text).toContain('https://beam.club.test/my-tasks');
      expect(enMail!.text).not.toContain(`TOP_SECRET_BUDGET_${suffix}`);
      expect(enMail!.text).not.toContain(`SECRET_DEPT_PLAN_${suffix}`);
      expect(enMail!.html).not.toContain(`SECRET_DEPT_PLAN_${suffix}`);
      expect(enMail!.text).not.toContain(enSid);
      expect(enMail!.text).not.toContain(`rem-en-${suffix}@eiu.edu.vn`);
      expect(enMail!.text).not.toContain(`Vi Recipient ${suffix}`);

      // 4. Second cron run same day via GET -> idempotent AC-03 (0 emails, 7 skipped)
      const run2Res = await cronRemindersGet(
        new Request('http://localhost/api/v1/internal/cron/reminders', {
          headers: { authorization: `Bearer ${testConfig.cronSecret}` },
        }),
      );
      expect(run2Res.status).toBe(200);
      expect(await run2Res.json()).toEqual({
        processedTasks: 4,
        emailsSent: 0,
        remindersRecorded: 0,
        skippedAlreadySent: 7,
      });

      // Verify PostgreSQL ON CONFLICT DO NOTHING against reminders_task_user_kind_uq directly
      const directRemindersRepo = new DrizzleRemindersRepository(tx);
      const duplicateInsertCount = await directRemindersRepo.insertSentReminders([
        { taskId: taskOverdueId, userId: userViId, kind: 'overdue', sentAt: now },
      ]);
      expect(duplicateInsertCount).toBe(0);

      // 5. Mailer error for one recipient does not insert reminders row for that recipient, and retries cleanly
      await tx.insert(tasks).values({
        id: taskRetryId,
        boardId: activeBoardId,
        columnId: colTodoId,
        title: `Retry Task ${suffix}`,
        dueAt: new Date('2026-11-28T10:00:00.000Z'), // d2
        priority: 2,
        position: '11000',
        isHidden: false,
        createdBy: adminId,
      });
      await tx.insert(taskAssignees).values([
        { taskId: taskRetryId, userId: userViId },
        { taskId: taskRetryId, userId: userEnId },
      ]);

      failRecipientEmail = `rem-vi-${suffix}@eiu.edu.vn`;
      const run3Res = await cronRemindersPost(
        new Request('http://localhost/api/v1/internal/cron/reminders', {
          method: 'POST',
          headers: { authorization: `Bearer ${testConfig.cronSecret}` },
        }),
      );
      expect(run3Res.status).toBe(200);
      expect(await run3Res.json()).toEqual({
        processedTasks: 5,
        emailsSent: 1,
        remindersRecorded: 1,
        skippedAlreadySent: 7,
      });

      const retryRowsAfterFail = await tx
        .select()
        .from(reminders)
        .where(eq(reminders.taskId, taskRetryId));
      expect(retryRowsAfterFail.map((r) => r.userId)).toEqual([userEnId]);

      // Recover mailer -> VI user retried, EN user skipped
      failRecipientEmail = null;
      const run4Res = await cronRemindersPost(
        new Request('http://localhost/api/v1/internal/cron/reminders', {
          method: 'POST',
          headers: { authorization: `Bearer ${testConfig.cronSecret}` },
        }),
      );
      expect(run4Res.status).toBe(200);
      expect(await run4Res.json()).toEqual({
        processedTasks: 5,
        emailsSent: 1,
        remindersRecorded: 1,
        skippedAlreadySent: 8,
      });

      const joinedLogs = logs.join('\n');
      expect(joinedLogs).not.toContain(`rem-vi-${suffix}@eiu.edu.vn`);
      expect(joinedLogs).not.toContain(`rem-en-${suffix}@eiu.edu.vn`);
      expect(joinedLogs).not.toContain(viSid);
      expect(joinedLogs).not.toContain(enSid);
      expect(joinedLogs).not.toContain(testConfig.cronSecret);
      expect(joinedLogs).toContain('[REDACTED_EMAIL]');
    });
  });
});
