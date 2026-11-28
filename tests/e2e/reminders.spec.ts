import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  appSettings,
  boards,
  columns,
  comments,
  departments,
  loginAttempts,
  memberDepartments,
  notifications,
  permissions,
  profiles,
  reminders,
  sessions,
  taskAssignees,
  taskDepartments,
  tasks,
  userPermissions,
} from '@db/schema';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS } from '@/lib/permissions';
import { REMINDERS_APP_SETTING_KEY } from '@/lib/reminders';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import enMessages from '../../messages/en.json';
import viMessages from '../../messages/vi.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const VN_OFFSET_MS = 7 * 3_600_000;
const MS_PER_DAY = 86_400_000;

interface RemindersSettingSnapshot {
  readonly value: Record<string, unknown>;
  readonly updatedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CronRemindersResponseBody {
  readonly processedTasks: number;
  readonly emailsSent: number;
  readonly remindersRecorded: number;
  readonly skippedAlreadySent: number;
}

function loadEnvLocalIfMissing(): void {
  if (process.env.TEST_DATABASE_URL && process.env.CRON_SECRET) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function vnMidnightFromNow(nowMs: number, offsetDays: number): Date {
  const vn = new Date(nowMs + VN_OFFSET_MS);
  const utcMidnightMs =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + offsetDays) - VN_OFFSET_MS;
  return new Date(utcMidnightMs);
}

async function attachRuntimeErrorTracker(page: Page): Promise<{
  assertClean: () => Promise<void>;
}> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const locUrl = msg.location()?.url ?? '';
      consoleErrors.push(locUrl ? `${msg.text()} (${locUrl})` : msg.text());
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });

  await page.addInitScript(() => {
    const win = window as Window & { __beamUnhandledRejections?: string[] };
    win.__beamUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      win.__beamUnhandledRejections?.push(String(event.reason));
    });
  });

  return {
    assertClean: async () => {
      const unhandled = await page.evaluate(() => {
        const win = window as Window & { __beamUnhandledRejections?: string[] };
        return win.__beamUnhandledRejections ?? [];
      });
      expect(pageErrors).toEqual([]);
      expect(unhandled).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(serverErrors).toEqual([]);
    },
  };
}

async function signInAs(
  page: Page,
  studentId: string,
  returnTo = '/admin/reminders',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

async function openSignedInContext(
  browser: Browser,
  studentId: string,
  returnTo: string,
): Promise<{
  context: BrowserContext;
  page: Page;
  tracker: { assertClean: () => Promise<void> };
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const tracker = await attachRuntimeErrorTracker(page);
  await signInAs(page, studentId, returnTo);
  return { context, page, tracker };
}

function assertZeroPiiInStrings(
  payloads: readonly string[],
  sensitiveValues: readonly string[],
): void {
  for (const body of payloads) {
    for (const secret of sensitiveValues) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain('@eiu.edu.vn');
    expect(body).not.toContain('"studentId"');
    expect(body).not.toContain('"email"');
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('scrypt$');
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

function assertNoRawTranslationKeys(text: string): void {
  const rawPrefixes = ['reminders.', 'auditLogs.', 'errors.', 'common.', 'nav.', 'member.'];
  for (const prefix of rawPrefixes) {
    expect(text).not.toContain(prefix);
  }
}

function getMilestoneCheckbox(milestonesCard: Locator, title: string): Locator {
  return milestonesCard
    .locator('label.rem-option', { hasText: title })
    .locator('input[type="checkbox"]');
}

test.describe('E8-03 Deadline Reminders Admin, E01 Preview & Cron Idempotency E2E', () => {
  let pool: Pool;
  let db: Database;
  let seedPasswordHash: string;
  let cronSecret: string;
  let originalRemindersSetting: RemindersSettingSnapshot | null = null;

  const suffix = randomUUID().slice(0, 8);

  const adminUserId = randomUUID();
  const reminderMgrUserId = randomUUID();
  const basicUserId = randomUUID();
  const peerUserId = randomUUID();

  const adminStudentId = `MSSV-E8-ADM-${suffix}`;
  const reminderMgrStudentId = `MSSV-E8-REM-${suffix}`;
  const basicStudentId = `MSSV-E8-BAS-${suffix}`;
  const peerStudentId = `MSSV-E8-PER-${suffix}`;

  const adminEmail = `e8-admin-${suffix}@eiu.edu.vn`;
  const reminderMgrEmail = `e8-rem-${suffix}@eiu.edu.vn`;
  const basicEmail = `e8-basic-${suffix}@eiu.edu.vn`;
  const peerEmail = `e8-peer-${suffix}@eiu.edu.vn`;

  const adminFullName = `E8 Admin ${suffix}`;
  const reminderMgrFullName = `E8 ReminderConfig ${suffix}`;
  const basicFullName = `E8 BasicMember ${suffix}`;
  const peerFullName = `E8 PeerHidden ${suffix}`;

  const trackedUserIds: string[] = [adminUserId, reminderMgrUserId, basicUserId, peerUserId];
  const trackedStudentIds: string[] = [
    adminStudentId,
    reminderMgrStudentId,
    basicStudentId,
    peerStudentId,
  ];
  const nonAdminCleanupIds: string[] = [reminderMgrUserId, basicUserId, peerUserId];
  const sensitivePiiValues: string[] = [
    adminStudentId,
    reminderMgrStudentId,
    basicStudentId,
    peerStudentId,
    adminEmail,
    reminderMgrEmail,
    basicEmail,
    peerEmail,
  ];
  const trackedBoardIds: string[] = [];
  const trackedTaskIds: string[] = [];
  const trackedDeptIds: string[] = [];

  test.beforeAll(async () => {
    loadEnvLocalIfMissing();
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }
    const envCronSecret = process.env.CRON_SECRET?.trim();
    if (!envCronSecret) {
      throw new Error('CRON_SECRET is required to test reminders cron endpoint.');
    }
    cronSecret = envCronSecret;

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

    const [existingSetting] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, REMINDERS_APP_SETTING_KEY))
      .limit(1);
    if (existingSetting) {
      originalRemindersSetting = {
        value: existingSetting.value,
        updatedBy: existingSetting.updatedBy,
        createdAt: existingSetting.createdAt,
        updatedAt: existingSetting.updatedAt,
      };
    }

    await db
      .insert(permissions)
      .values(
        PERMISSIONS.map((permission) => ({
          code: permission.code,
          groupName: permission.group,
          description: permission.code,
          scopable: false,
        })),
      )
      .onConflictDoNothing();

    await db.insert(profiles).values([
      {
        id: adminUserId,
        studentId: adminStudentId,
        email: adminEmail,
        fullName: adminFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: reminderMgrUserId,
        studentId: reminderMgrStudentId,
        email: reminderMgrEmail,
        fullName: reminderMgrFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: basicUserId,
        studentId: basicStudentId,
        email: basicEmail,
        fullName: basicFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: peerUserId,
        studentId: peerStudentId,
        email: peerEmail,
        fullName: peerFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: reminderMgrUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: reminderMgrUserId, permissionCode: 'reminder.configure', grantedBy: adminUserId },
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: basicUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      { userId: peerUserId, permissionCode: 'member.view', grantedBy: adminUserId },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, trackedStudentIds),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const now = new Date();
      if (originalRemindersSetting) {
        await db
          .insert(appSettings)
          .values({
            key: REMINDERS_APP_SETTING_KEY,
            value: originalRemindersSetting.value,
            updatedBy: originalRemindersSetting.updatedBy,
            createdAt: originalRemindersSetting.createdAt,
            updatedAt: originalRemindersSetting.updatedAt,
          })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: {
              value: originalRemindersSetting.value,
              updatedBy: originalRemindersSetting.updatedBy,
              updatedAt: originalRemindersSetting.updatedAt,
            },
          });
      } else {
        await db.delete(appSettings).where(eq(appSettings.key, REMINDERS_APP_SETTING_KEY));
      }

      if (trackedTaskIds.length > 0) {
        await db.delete(reminders).where(inArray(reminders.taskId, trackedTaskIds));
        await db.delete(notifications).where(inArray(notifications.taskId, trackedTaskIds));
        await db.delete(comments).where(inArray(comments.taskId, trackedTaskIds));
        await db.delete(taskDepartments).where(inArray(taskDepartments.taskId, trackedTaskIds));
        await db.delete(taskAssignees).where(inArray(taskAssignees.taskId, trackedTaskIds));
      }
      await db.delete(reminders).where(inArray(reminders.userId, trackedUserIds));

      if (trackedBoardIds.length > 0) {
        await db
          .update(tasks)
          .set({
            deletedAt: sql`COALESCE(${tasks.deletedAt}, ${now.toISOString()}::timestamptz)`,
            purgedAt: sql`COALESCE(${tasks.purgedAt}, ${now.toISOString()}::timestamptz)`,
            updatedAt: now,
          })
          .where(inArray(tasks.boardId, trackedBoardIds));
        await db
          .update(boards)
          .set({
            archivedAt: sql`COALESCE(${boards.archivedAt}, ${now.toISOString()}::timestamptz)`,
            purgedAt: sql`COALESCE(${boards.purgedAt}, ${now.toISOString()}::timestamptz)`,
            departmentId: null,
            updatedAt: now,
          })
          .where(inArray(boards.id, trackedBoardIds));
      }

      await db.delete(memberDepartments).where(inArray(memberDepartments.userId, trackedUserIds));
      if (trackedDeptIds.length > 0) {
        await db.delete(memberDepartments).where(inArray(memberDepartments.departmentId, trackedDeptIds));
        await db.delete(departments).where(inArray(departments.id, trackedDeptIds));
      }

      await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, trackedUserIds));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, trackedStudentIds),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );

      await db
        .update(profiles)
        .set({ isActive: false, leftAt: now, updatedAt: now })
        .where(inArray(profiles.id, nonAdminCleanupIds));

      const remainingAdmins = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(
            eq(profiles.isAdmin, true),
            eq(profiles.isActive, true),
            ne(profiles.id, adminUserId),
          ),
        );
      if (remainingAdmins.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: false, leftAt: now, updatedAt: now })
          .where(eq(profiles.id, adminUserId));
      }
    }
    await pool?.end();
  });

  test('Scenario 1: S12 RBAC, milestone config, all-off warning, audit log, and VI/EN E01 preview with WQ-27 redaction', async ({
    browser,
  }) => {
    const nowMs = Date.now();
    await db
      .insert(appSettings)
      .values({
        key: REMINDERS_APP_SETTING_KEY,
        value: { daysBefore: [2, 1], remindOverdue: true, sendHourVn: 7 },
        updatedBy: adminUserId,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: { daysBefore: [2, 1], remindOverdue: true, sendHourVn: 7 },
          updatedBy: adminUserId,
          updatedAt: new Date(nowMs),
        },
      });

    const s1BoardId = randomUUID();
    const s1TodoColId = randomUUID();
    const s1DoneColId = randomUUID();
    const s1PublicDeptId = randomUUID();
    const s1HiddenDeptId = randomUUID();
    const s1PublicDeptName = `Ban S1 CongKhai ${suffix}`;
    const s1HiddenDeptName = `Ban S1 Mat ${suffix}`;

    const s1OverdueTaskId = randomUUID();
    const s1TodayTaskId = randomUUID();
    const s1UpcomingPublicTaskId = randomUUID();
    const s1UpcomingHiddenTaskId = randomUUID();
    const s1DoneTaskId = randomUUID();
    const s1DeletedTaskId = randomUUID();

    const s1OverdueTitle = `S1 Overdue Public ${suffix}`;
    const s1TodayTitle = `S1 Today Public ${suffix}`;
    const s1UpcomingPublicTitle = `S1 Upcoming Public ${suffix}`;
    const s1UpcomingHiddenTitle = `S1_TOP_SECRET_HIDDEN_${suffix}`;
    const s1DoneTitle = `S1 Done Excluded ${suffix}`;
    const s1DeletedTitle = `S1 Deleted Excluded ${suffix}`;

    trackedBoardIds.push(s1BoardId);
    trackedDeptIds.push(s1PublicDeptId, s1HiddenDeptId);
    trackedTaskIds.push(
      s1OverdueTaskId,
      s1TodayTaskId,
      s1UpcomingPublicTaskId,
      s1UpcomingHiddenTaskId,
      s1DoneTaskId,
      s1DeletedTaskId,
    );

    await db.insert(departments).values([
      { id: s1PublicDeptId, name: s1PublicDeptName },
      { id: s1HiddenDeptId, name: s1HiddenDeptName },
    ]);
    await db.insert(boards).values({
      id: s1BoardId,
      name: `Board E8 S1 ${suffix}`,
      createdBy: adminUserId,
    });
    await db.insert(columns).values([
      { id: s1TodoColId, boardId: s1BoardId, name: 'Todo', orderIndex: 0 },
      { id: s1DoneColId, boardId: s1BoardId, name: 'Done', orderIndex: 1 },
    ]);
    await db.insert(tasks).values([
      {
        id: s1OverdueTaskId,
        boardId: s1BoardId,
        columnId: s1TodoColId,
        title: s1OverdueTitle,
        startAt: vnMidnightFromNow(nowMs, -3),
        dueAt: vnMidnightFromNow(nowMs, -2),
        priority: 4,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: s1TodayTaskId,
        boardId: s1BoardId,
        columnId: s1TodoColId,
        title: s1TodayTitle,
        startAt: vnMidnightFromNow(nowMs, -1),
        dueAt: vnMidnightFromNow(nowMs, 0),
        priority: 3,
        position: '2000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: s1UpcomingPublicTaskId,
        boardId: s1BoardId,
        columnId: s1TodoColId,
        title: s1UpcomingPublicTitle,
        startAt: vnMidnightFromNow(nowMs, 0),
        dueAt: vnMidnightFromNow(nowMs, 1),
        priority: 2,
        position: '3000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: s1UpcomingHiddenTaskId,
        boardId: s1BoardId,
        columnId: s1TodoColId,
        title: s1UpcomingHiddenTitle,
        startAt: vnMidnightFromNow(nowMs, 0),
        dueAt: vnMidnightFromNow(nowMs, 2),
        priority: 3,
        position: '4000',
        isHidden: true,
        createdBy: adminUserId,
      },
      {
        id: s1DoneTaskId,
        boardId: s1BoardId,
        columnId: s1DoneColId,
        title: s1DoneTitle,
        startAt: vnMidnightFromNow(nowMs, 0),
        dueAt: vnMidnightFromNow(nowMs, 1),
        priority: 4,
        position: '5000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: s1DeletedTaskId,
        boardId: s1BoardId,
        columnId: s1TodoColId,
        title: s1DeletedTitle,
        startAt: vnMidnightFromNow(nowMs, 0),
        dueAt: vnMidnightFromNow(nowMs, 1),
        priority: 4,
        position: '6000',
        isHidden: false,
        deletedAt: new Date(nowMs),
        createdBy: adminUserId,
      },
    ]);
    await db.insert(taskAssignees).values([
      { taskId: s1OverdueTaskId, userId: reminderMgrUserId },
      { taskId: s1OverdueTaskId, userId: peerUserId },
      { taskId: s1TodayTaskId, userId: reminderMgrUserId },
      { taskId: s1UpcomingPublicTaskId, userId: reminderMgrUserId },
      { taskId: s1UpcomingHiddenTaskId, userId: reminderMgrUserId },
      { taskId: s1UpcomingHiddenTaskId, userId: peerUserId },
      { taskId: s1DoneTaskId, userId: reminderMgrUserId },
      { taskId: s1DeletedTaskId, userId: reminderMgrUserId },
    ]);
    await db.insert(taskDepartments).values([
      { taskId: s1OverdueTaskId, departmentId: s1PublicDeptId },
      { taskId: s1UpcomingHiddenTaskId, departmentId: s1HiddenDeptId },
    ]);

    try {
      // 1. Unauthenticated API checks -> 401
      const anonContext = await browser.newContext();
      try {
        expect((await anonContext.request.get('/api/v1/settings/reminders')).status()).toBe(401);
        expect(
          (
            await anonContext.request.put('/api/v1/settings/reminders', {
              data: { daysBefore: [1], remindOverdue: true },
            })
          ).status(),
        ).toBe(401);
      } finally {
        await anonContext.close();
      }

      // 2. Active member WITHOUT reminder.configure: hidden sidebar link, 403 UI, 403 GET/PUT API
      const basicSession = await openSignedInContext(browser, basicStudentId, '/profile');
      try {
        await expect(basicSession.page.locator('.app-side a[href="/admin/reminders"]')).toHaveCount(0);
        await expect(basicSession.page.locator('.app-mtabs a[href="/admin/reminders"]')).toHaveCount(0);

        await basicSession.page.goto('/admin/reminders');
        await expect(
          basicSession.page.getByText(viMessages.errors['403'].code, { exact: true }),
        ).toBeVisible();
        await expect(basicSession.page.getByText(viMessages.reminders.forbiddenTitle)).toBeVisible();
        await expect(
          basicSession.page.getByText(viMessages.reminders.forbiddenDescription),
        ).toBeVisible();

        const forbiddenGet = await basicSession.page.request.get('/api/v1/settings/reminders');
        expect(forbiddenGet.status()).toBe(403);
        const forbiddenPut = await basicSession.page.request.put('/api/v1/settings/reminders', {
          data: { daysBefore: [1], remindOverdue: true },
        });
        expect(forbiddenPut.status()).toBe(403);

        await basicSession.tracker.assertClean();
      } finally {
        await basicSession.context.close();
      }

      // 3. Member GRANTED reminder.configure: S12 config, all-off warning + restore defaults, add custom day 3, save, reload, simplified E01 live sample preview
      const mgrContext = await browser.newContext();
      const mgrPage = await mgrContext.newPage();
      const mgrTracker = await attachRuntimeErrorTracker(mgrPage);
      const capturedMgrApiBodies: string[] = [];
      const meTasksRequests: string[] = [];
      mgrPage.on('request', (req) => {
        if (req.url().includes('/api/v1/me/tasks')) {
          meTasksRequests.push(`${req.method()} ${req.url()}`);
        }
      });

      try {
        const initialSettingsPromise = mgrPage.waitForResponse(
          (res) =>
            res.url().includes('/api/v1/settings/reminders') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
        );
        await signInAs(mgrPage, reminderMgrStudentId, '/admin/reminders');
        const initialSettingsRes = await initialSettingsPromise;
        capturedMgrApiBodies.push(await initialSettingsRes.text());
        expect(meTasksRequests).toEqual([]);

        const page = mgrPage;
        await expect(page.locator('.app-side a[href="/admin/reminders"]')).toBeVisible();
        await expect(page.locator('.app-side a[href="/admin/reminders"]')).toHaveAttribute(
          'aria-current',
          'page',
        );

        const milestonesCard = page.locator(
          `section[aria-label="${viMessages.reminders.milestonesCardTitle}"]`,
        );
        await expect(milestonesCard).toBeVisible();
        const scheduleChip = milestonesCard.getByTestId('reminders-schedule-chip');
        await expect(scheduleChip).toBeVisible();
        await expect(scheduleChip).toHaveText(
          viMessages.reminders.scheduleChip.replace('{time}', '07:00'),
        );
        await expect(milestonesCard).toContainText(viMessages.reminders.milestonesCardLead);
        await expect(milestonesCard).toContainText(viMessages.reminders.milestoneOverdueDesc);
        await expect(milestonesCard.locator('.rem-chip-list')).toHaveCount(0);

        const toggle2Days = getMilestoneCheckbox(milestonesCard, viMessages.reminders.milestone2Days);
        const toggle1Day = getMilestoneCheckbox(milestonesCard, viMessages.reminders.milestone1Day);
        const toggleOverdue = getMilestoneCheckbox(
          milestonesCard,
          viMessages.reminders.milestoneOverdue,
        );

        await expect(toggle2Days).toBeChecked();
        await expect(toggle1Day).toBeChecked();
        await expect(toggleOverdue).toBeChecked();

        // Toggle all milestones off -> all-off warning banner + empty email notice -> restore defaults
        await toggle2Days.uncheck();
        await toggle1Day.uncheck();
        await toggleOverdue.uncheck();

        await expect(milestonesCard.locator('.rem-chip-list')).toHaveCount(0);
        const allOffBanner = milestonesCard.locator('.rem-all-off-banner');
        await expect(allOffBanner).toBeVisible();
        await expect(allOffBanner).toContainText(viMessages.reminders.allOffTitle);
        await expect(allOffBanner).toContainText(viMessages.reminders.allOffBody);
        await expect(
          page.locator('article.rem-email').getByText(viMessages.reminders.emailContent.vi.emptyTitle),
        ).toBeVisible();
        await expect(page.locator('article.rem-email button')).toHaveCount(0);

        await allOffBanner
          .getByRole('button', { name: viMessages.reminders.restoreDefaults, exact: true })
          .click();
        await expect(allOffBanner).toHaveCount(0);
        await expect(toggle2Days).toBeChecked();
        await expect(toggle1Day).toBeChecked();
        await expect(toggleOverdue).toBeChecked();

        // Add custom milestone day 3 -> chipList only shows custom days (!= 2, 1) -> save -> toast -> reload persistence
        await milestonesCard
          .getByLabel(viMessages.reminders.customDayLabel, { exact: true })
          .fill('3');
        await milestonesCard
          .getByRole('button', { name: viMessages.reminders.customDayAdd, exact: true })
          .click();

        const day3Chip = viMessages.reminders.dayChipLabel.replace('{days}', '3');
        const day2Chip = viMessages.reminders.dayChipLabel.replace('{days}', '2');
        const day1Chip = viMessages.reminders.dayChipLabel.replace('{days}', '1');
        const chipList = milestonesCard.locator('.rem-chip-list');
        await expect(chipList).toBeVisible();
        await expect(chipList).toContainText(day3Chip);
        await expect(chipList).not.toContainText(day2Chip);
        await expect(chipList).not.toContainText(day1Chip);
        await expect(milestonesCard.getByTestId('reminders-custom-chip-3')).toBeVisible();
        await expect(milestonesCard.getByTestId('reminders-custom-chip-2')).toHaveCount(0);
        await expect(milestonesCard.getByTestId('reminders-custom-chip-1')).toHaveCount(0);
        await expect(toggle2Days).toBeChecked();
        await expect(toggle1Day).toBeChecked();

        const saveBar = page.locator('.rem-save');
        await expect(saveBar).toContainText(viMessages.reminders.unsavedChanges);

        const saveResponsePromise = page.waitForResponse(
          (res) =>
            res.url().includes('/api/v1/settings/reminders') && res.request().method() === 'PUT',
        );
        await saveBar.getByRole('button', { name: viMessages.reminders.save, exact: true }).click();
        const saveResponse = await saveResponsePromise;
        expect(saveResponse.status()).toBe(200);
        const saveBodyText = await saveResponse.text();
        capturedMgrApiBodies.push(saveBodyText);
        const saveBody = JSON.parse(saveBodyText) as {
          settings: {
            daysBefore: number[];
            remindOverdue: boolean;
            sendHourVn: number;
            updatedBy: { id: string; fullName: string } | null;
          };
        };
        expect(saveBody.settings.daysBefore).toEqual([3, 2, 1]);
        expect(saveBody.settings.remindOverdue).toBe(true);
        expect(saveBody.settings.sendHourVn).toBe(7);
        expect(saveBody.settings.updatedBy?.fullName).toBe(reminderMgrFullName);

        await expect(
          page.locator('[data-sonner-toast]', { hasText: viMessages.reminders.savedToast }),
        ).toBeVisible();

        const reloadSettingsPromise = page.waitForResponse(
          (res) =>
            res.url().includes('/api/v1/settings/reminders') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
        );
        await page.reload();
        const reloadSettingsRes = await reloadSettingsPromise;
        capturedMgrApiBodies.push(await reloadSettingsRes.text());
        expect(meTasksRequests).toEqual([]);

        await expect(chipList).toContainText(day3Chip);
        await expect(chipList).not.toContainText(day2Chip);
        await expect(chipList).not.toContainText(day1Chip);
        await expect(toggle2Days).toBeChecked();
        await expect(toggle1Day).toBeChecked();
        await expect(toggleOverdue).toBeChecked();
        const metaNote = milestonesCard.locator('.rem-meta-note');
        await expect(metaNote).toBeVisible();
        await expect(metaNote).toContainText(reminderMgrFullName);
        await expect(
          saveBar.getByRole('button', { name: viMessages.reminders.save, exact: true }),
        ).toBeDisabled();
        assertNoRawTranslationKeys(await page.locator('#main-content').innerText());

        // 4. Admin views /admin/audit -> sees settings.reminders_updated without PII
        const adminContext = await browser.newContext();
        const auditPage = await adminContext.newPage();
        const adminTracker = await attachRuntimeErrorTracker(auditPage);
        try {
          const initialAuditPromise = auditPage.waitForResponse(
            (res) =>
              res.url().includes('/api/v1/audit-logs') &&
              res.request().method() === 'GET' &&
              res.status() === 200,
          );
          await signInAs(auditPage, adminStudentId, '/admin/audit');
          const initialAuditRes = await initialAuditPromise;
          const initialAuditBody = await initialAuditRes.text();

          const filterPromise = auditPage.waitForResponse(
            (res) =>
              res.url().includes('/api/v1/audit-logs') &&
              res.url().includes('action=settings.reminders_updated'),
          );
          await auditPage
            .getByLabel(viMessages.auditLogs.actionFilterLabel)
            .selectOption('settings.reminders_updated');
          const filterRes = await filterPromise;
          expect(filterRes.status()).toBe(200);
          const filteredAuditBody = await filterRes.text();

          const auditRow = auditPage
            .locator('.audit-table tbody tr', { hasText: reminderMgrFullName })
            .first();
          await expect(auditRow).toBeVisible();
          await expect(auditRow).toContainText(viMessages.auditLogs.actions.remindersUpdated);
          await expect(auditRow).toContainText('[3, 2, 1]');
          await auditRow.click();

          const detailPane = auditPage.locator('aside.audit-side');
          await expect(detailPane).toContainText(viMessages.auditLogs.detailHeading);
          await expect(detailPane).toContainText(reminderMgrFullName);
          await expect(detailPane).toContainText(viMessages.auditLogs.actions.remindersUpdated);
          await expect(detailPane).toContainText(viMessages.auditLogs.detailFieldReminders);
          await expect(detailPane).toContainText('3, 2, 1');
          await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.remindOverdue);
          await expect(detailPane).toContainText(viMessages.auditLogs.detailValues.yes);
          await expect(detailPane).toContainText(viMessages.auditLogs.detailPrivacyNotice);

          const auditMainText = await auditPage.locator('#main-content').innerText();
          assertZeroPiiInStrings(
            [auditMainText, initialAuditBody, filteredAuditBody],
            sensitivePiiValues,
          );
          assertNoRawTranslationKeys(auditMainText);
          await adminTracker.assertClean();
        } finally {
          await adminContext.close();
        }

        // 5. Simplified E01 Email Preview on /admin/reminders (CR-14 Bug #3):
        //    no preview controls/lang group/sample toggle/chip, dynamically filtered live sample digest synced to app locale, CTA links to /progress
        await milestonesCard
          .getByLabel(viMessages.reminders.customDayLabel, { exact: true })
          .fill('0');
        await milestonesCard
          .getByRole('button', { name: viMessages.reminders.customDayAdd, exact: true })
          .click();
        await expect(chipList).toContainText(viMessages.reminders.dayChipToday);

        const previewAside = page.locator('aside.rem-side');
        const emailCard = previewAside.locator('article.rem-email[data-component="ReminderEmail"]');
        await expect(previewAside.locator('.rem-preview-controls')).toHaveCount(0);
        await expect(previewAside.locator('[role="group"]')).toHaveCount(0);
        await expect(previewAside.locator('.rem-email-lang')).toHaveCount(0);
        await expect(previewAside.locator('.rem-sample-chip')).toHaveCount(0);
        await expect(previewAside.getByTestId('reminders-sample-chip')).toHaveCount(0);
        await expect(previewAside.locator('.rem-sample-banner')).toHaveCount(0);
        await expect(previewAside.locator('.rem-preview-note')).toHaveCount(0);
        await expect(emailCard.locator('.rem-email-kicker')).toHaveCount(0);
        await expect(emailCard.locator('.rem-email-foot')).toHaveCount(0);
        await expect(previewAside.getByRole('button', { name: /mẫu minh họa|sample/i })).toHaveCount(0);

        await expect(emailCard).toContainText(reminderMgrFullName);
        const viOverdueGroup = emailCard.locator('section.rem-email-group', {
          hasText: viMessages.reminders.emailContent.vi.groupOverdue,
        });
        const viTodayGroup = emailCard.locator('section.rem-email-group', {
          hasText: viMessages.reminders.emailContent.vi.groupToday,
        });
        const viUpcomingGroup = emailCard.locator('section.rem-email-group', {
          hasText: viMessages.reminders.emailContent.vi.groupUpcoming,
        });
        await expect(viOverdueGroup).toContainText(viMessages.reminders.emailContent.vi.sampleTaskOverdue);
        await expect(viOverdueGroup).toContainText(viMessages.reminders.emailContent.vi.sampleTaskOverdueDept);
        await expect(viTodayGroup).toContainText(viMessages.reminders.emailContent.vi.sampleTaskToday);
        await expect(viTodayGroup).toContainText(viMessages.reminders.emailContent.vi.sampleTaskTodayDept);
        await expect(viUpcomingGroup).toContainText(viMessages.reminders.emailContent.vi.sampleTaskSoon);
        await expect(viUpcomingGroup).toContainText(viMessages.reminders.emailContent.vi.sampleTaskLater);
        await expect(emailCard.locator('a.rem-email-cta')).toHaveAttribute('href', '/progress');
        await expect(emailCard.locator('a.rem-email-cta')).toHaveText(
          viMessages.reminders.emailContent.vi.cta,
        );

        // Dynamic filtering: toggling overdue off removes groupOverdue immediately
        await toggleOverdue.uncheck();
        await expect(
          emailCard.locator('section.rem-email-group', {
            hasText: viMessages.reminders.emailContent.vi.groupOverdue,
          }),
        ).toHaveCount(0);
        await toggleOverdue.check();
        await expect(viOverdueGroup).toBeVisible();

        const viPreviewText = await emailCard.innerText();
        expect(viPreviewText).not.toContain(s1UpcomingHiddenTitle);
        expect(viPreviewText).not.toContain(s1HiddenDeptName);
        expect(viPreviewText).not.toContain(s1DoneTitle);
        expect(viPreviewText).not.toContain(s1DeletedTitle);
        expect(viPreviewText).not.toContain(peerFullName);
        expect(viPreviewText).not.toContain(adminFullName);
        assertZeroPiiInStrings([viPreviewText], sensitivePiiValues);
        assertNoRawTranslationKeys(viPreviewText);

        // Switch app language via .app-side .app-side-lang to EN -> preview dynamically follows useLocale()
        const switchToEnPromise = page.waitForResponse(
          (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
        );
        await page.locator('.app-side .app-side-lang').getByRole('button', { name: 'EN', exact: true }).click();
        expect((await switchToEnPromise).status()).toBe(200);
        await expect(emailCard).toContainText(`Hi ${reminderMgrFullName},`);

        const enOverdueGroup = emailCard.locator('section.rem-email-group', {
          hasText: enMessages.reminders.emailContent.en.groupOverdue,
        });
        const enTodayGroup = emailCard.locator('section.rem-email-group', {
          hasText: enMessages.reminders.emailContent.en.groupToday,
        });
        const enUpcomingGroup = emailCard.locator('section.rem-email-group', {
          hasText: enMessages.reminders.emailContent.en.groupUpcoming,
        });
        await expect(enOverdueGroup).toContainText(enMessages.reminders.emailContent.en.sampleTaskOverdue);
        await expect(enTodayGroup).toContainText(enMessages.reminders.emailContent.en.sampleTaskToday);
        await expect(enUpcomingGroup).toContainText(enMessages.reminders.emailContent.en.sampleTaskSoon);
        await expect(enUpcomingGroup).toContainText(enMessages.reminders.emailContent.en.sampleTaskLater);
        await expect(emailCard.locator('a.rem-email-cta')).toHaveAttribute('href', '/progress');
        await expect(emailCard.locator('a.rem-email-cta')).toHaveText(
          enMessages.reminders.emailContent.en.cta,
        );

        const enPreviewText = await emailCard.innerText();
        expect(enPreviewText).not.toContain(s1UpcomingHiddenTitle);
        expect(enPreviewText).not.toContain(s1HiddenDeptName);
        expect(enPreviewText).not.toContain(s1DoneTitle);
        expect(enPreviewText).not.toContain(s1DeletedTitle);
        expect(enPreviewText).not.toContain(peerFullName);
        expect(enPreviewText).not.toContain(adminFullName);
        assertZeroPiiInStrings([enPreviewText], sensitivePiiValues);
        assertNoRawTranslationKeys(enPreviewText);

        // Switch app language back to VI
        const switchToViPromise = page.waitForResponse(
          (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
        );
        await page.locator('.app-side .app-side-lang').getByRole('button', { name: 'VI', exact: true }).click();
        expect((await switchToViPromise).status()).toBe(200);
        await expect(emailCard).toContainText(`Chào ${reminderMgrFullName},`);
        expect(meTasksRequests).toEqual([]);

        // 6. Responsive check on /admin/reminders at 375x812 (zero horizontal overflow)
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(milestonesCard).toBeVisible();
        await expect(previewAside).toBeVisible();
        const mobileOverflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          main:
            (document.querySelector('#main-content')?.scrollWidth ?? 0) >
            (document.querySelector('#main-content')?.clientWidth ?? 0),
        }));
        expect(mobileOverflow.doc).toBe(false);
        expect(mobileOverflow.main).toBe(false);

        assertZeroPiiInStrings(capturedMgrApiBodies, sensitivePiiValues);
        await mgrTracker.assertClean();
      } finally {
        await mgrContext.close();
      }
    } finally {
      const cleanupNow = new Date();
      await db
        .update(tasks)
        .set({
          deletedAt: sql`COALESCE(${tasks.deletedAt}, ${cleanupNow.toISOString()}::timestamptz)`,
          purgedAt: sql`COALESCE(${tasks.purgedAt}, ${cleanupNow.toISOString()}::timestamptz)`,
          updatedAt: cleanupNow,
        })
        .where(eq(tasks.boardId, s1BoardId));
    }
  });

  test('Scenario 2: CRON_SECRET auth on POST & GET /api/v1/internal/cron/reminders, filtering, CR-03 dept deduplication & AC-03 idempotency', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const nowMs = Date.now();

    // 1. Verify missing & invalid Bearer tokens return 401 UNAUTHORIZED on both POST and GET
    for (const headers of [
      undefined,
      { authorization: 'Bearer wrong-cron-secret' },
    ] as const) {
      const postRes = await page.request.post('/api/v1/internal/cron/reminders', { headers });
      expect(postRes.status()).toBe(401);
      expect(await postRes.json()).toMatchObject({
        error: { code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized' },
      });

      const getRes = await page.request.get('/api/v1/internal/cron/reminders', { headers });
      expect(getRes.status()).toBe(401);
      expect(await getRes.json()).toMatchObject({
        error: { code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized' },
      });
    }

    // 2. Ensure app_settings('reminders') = { daysBefore: [2, 1], remindOverdue: true, sendHourVn: 7 }
    await db
      .insert(appSettings)
      .values({
        key: REMINDERS_APP_SETTING_KEY,
        value: { daysBefore: [2, 1], remindOverdue: true, sendHourVn: 7 },
        updatedBy: adminUserId,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: { daysBefore: [2, 1], remindOverdue: true, sendHourVn: 7 },
          updatedBy: adminUserId,
          updatedAt: new Date(nowMs),
        },
      });

    // 3. Seed isolated board, department, profiles & VN-midnight anchored tasks
    const activeDirectUserId = randomUUID();
    const activeDeptMemberId = randomUUID();
    const inactiveUserId = randomUUID();
    const outsiderUserId = randomUUID();

    const activeDirectSid = `MSSV-E8-S2DIR-${suffix}`;
    const activeDeptSid = `MSSV-E8-S2DEP-${suffix}`;
    const inactiveSid = `MSSV-E8-S2INA-${suffix}`;
    const outsiderSid = `MSSV-E8-S2OUT-${suffix}`;

    const activeDirectEmail = `e8-s2-dir-${suffix}@eiu.edu.vn`;
    const activeDeptEmail = `e8-s2-dep-${suffix}@eiu.edu.vn`;
    const inactiveEmail = `e8-s2-ina-${suffix}@eiu.edu.vn`;
    const outsiderEmail = `e8-s2-out-${suffix}@eiu.edu.vn`;

    trackedUserIds.push(activeDirectUserId, activeDeptMemberId, inactiveUserId, outsiderUserId);
    trackedStudentIds.push(activeDirectSid, activeDeptSid, inactiveSid, outsiderSid);
    nonAdminCleanupIds.push(activeDirectUserId, activeDeptMemberId, inactiveUserId, outsiderUserId);
    const s2SensitiveValues = [
      ...sensitivePiiValues,
      activeDirectSid,
      activeDeptSid,
      inactiveSid,
      outsiderSid,
      activeDirectEmail,
      activeDeptEmail,
      inactiveEmail,
      outsiderEmail,
    ];

    const s2DeptId = randomUUID();
    const s2BoardId = randomUUID();
    const s2TodoColId = randomUUID();
    const s2DoneColId = randomUUID();
    const d1PublicTaskId = randomUUID();
    const overdueHiddenTaskId = randomUUID();
    const doneTaskId = randomUUID();
    const deletedTaskId = randomUUID();
    const s2TaskIds = [d1PublicTaskId, overdueHiddenTaskId, doneTaskId, deletedTaskId];

    trackedDeptIds.push(s2DeptId);
    trackedBoardIds.push(s2BoardId);
    trackedTaskIds.push(...s2TaskIds);

    await db.insert(profiles).values([
      {
        id: activeDirectUserId,
        studentId: activeDirectSid,
        email: activeDirectEmail,
        fullName: `E8 S2 Direct ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: activeDeptMemberId,
        studentId: activeDeptSid,
        email: activeDeptEmail,
        fullName: `E8 S2 DeptMember ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'en',
      },
      {
        id: inactiveUserId,
        studentId: inactiveSid,
        email: inactiveEmail,
        fullName: `E8 S2 Inactive ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: false,
        leftAt: new Date(nowMs - MS_PER_DAY),
        locale: 'vi',
      },
      {
        id: outsiderUserId,
        studentId: outsiderSid,
        email: outsiderEmail,
        fullName: `E8 S2 Outsider ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(departments).values({
      id: s2DeptId,
      name: `Ban E8 S2 ${suffix}`,
    });
    await db.insert(memberDepartments).values([
      // Include activeDirectUserId in s2DeptId as well to exercise CR-03 direct+dept deduplication
      { userId: activeDirectUserId, departmentId: s2DeptId },
      { userId: activeDeptMemberId, departmentId: s2DeptId },
      { userId: inactiveUserId, departmentId: s2DeptId },
    ]);

    await db.insert(boards).values({
      id: s2BoardId,
      name: `Board E8 S2 ${suffix}`,
      createdBy: adminUserId,
    });
    await db.insert(columns).values([
      { id: s2TodoColId, boardId: s2BoardId, name: 'Todo', orderIndex: 0 },
      { id: s2DoneColId, boardId: s2BoardId, name: 'Done', orderIndex: 1 },
    ]);

    const tomorrowVn = vnMidnightFromNow(nowMs, 1);
    const twoDaysAgoVn = vnMidnightFromNow(nowMs, -2);

    await db.insert(tasks).values([
      {
        id: d1PublicTaskId,
        boardId: s2BoardId,
        columnId: s2TodoColId,
        title: `S2 D1 Public ${suffix}`,
        startAt: twoDaysAgoVn,
        dueAt: tomorrowVn,
        priority: 3,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: overdueHiddenTaskId,
        boardId: s2BoardId,
        columnId: s2TodoColId,
        title: `S2_OVERDUE_HIDDEN_${suffix}`,
        startAt: twoDaysAgoVn,
        dueAt: twoDaysAgoVn,
        priority: 4,
        position: '2000',
        isHidden: true,
        createdBy: adminUserId,
      },
      {
        id: doneTaskId,
        boardId: s2BoardId,
        columnId: s2DoneColId,
        title: `S2 Done Excluded ${suffix}`,
        startAt: twoDaysAgoVn,
        dueAt: tomorrowVn,
        priority: 4,
        position: '3000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: deletedTaskId,
        boardId: s2BoardId,
        columnId: s2TodoColId,
        title: `S2 Deleted Excluded ${suffix}`,
        startAt: twoDaysAgoVn,
        dueAt: tomorrowVn,
        priority: 4,
        position: '4000',
        isHidden: false,
        deletedAt: new Date(nowMs),
        createdBy: adminUserId,
      },
    ]);

    await db.insert(taskAssignees).values([
      { taskId: d1PublicTaskId, userId: activeDirectUserId },
      { taskId: overdueHiddenTaskId, userId: activeDirectUserId },
      { taskId: doneTaskId, userId: activeDirectUserId },
      { taskId: deletedTaskId, userId: activeDirectUserId },
    ]);
    await db.insert(taskDepartments).values({
      taskId: d1PublicTaskId,
      departmentId: s2DeptId,
    });

    // 4. Cron Run 1 (POST with Bearer CRON_SECRET)
    const run1Res = await page.request.post('/api/v1/internal/cron/reminders', {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(run1Res.status()).toBe(200);
    const run1Text = await run1Res.text();
    assertZeroPiiInStrings([run1Text], s2SensitiveValues);
    const run1Json = JSON.parse(run1Text) as CronRemindersResponseBody;
    expect(run1Json.processedTasks).toBeGreaterThanOrEqual(2);
    expect(run1Json.emailsSent).toBeGreaterThanOrEqual(2);
    expect(run1Json.remindersRecorded).toBeGreaterThanOrEqual(3);
    expect(run1Json.skippedAlreadySent).toBeGreaterThanOrEqual(0);

    const run1Rows = await db
      .select({
        taskId: reminders.taskId,
        userId: reminders.userId,
        kind: reminders.kind,
      })
      .from(reminders)
      .where(inArray(reminders.taskId, s2TaskIds));

    const expectedTuples = [
      `${d1PublicTaskId}:${activeDeptMemberId}:d1`,
      `${d1PublicTaskId}:${activeDirectUserId}:d1`,
      `${overdueHiddenTaskId}:${activeDirectUserId}:overdue`,
    ].sort();

    const actualRun1Tuples = run1Rows
      .map((row) => `${row.taskId}:${row.userId}:${row.kind}`)
      .sort();
    expect(actualRun1Tuples).toEqual(expectedTuples);

    const userRowsAfterRun1 = await db
      .select({ taskId: reminders.taskId, userId: reminders.userId, kind: reminders.kind })
      .from(reminders)
      .where(inArray(reminders.userId, [inactiveUserId, outsiderUserId]));
    expect(userRowsAfterRun1).toEqual([]);

    // 5. Cron Run 2 immediately via GET -> idempotent AC-03 (0 duplicates, skippedAlreadySent >= 3)
    const run2Res = await page.request.get('/api/v1/internal/cron/reminders', {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(run2Res.status()).toBe(200);
    const run2Text = await run2Res.text();
    assertZeroPiiInStrings([run2Text], s2SensitiveValues);
    const run2Json = JSON.parse(run2Text) as CronRemindersResponseBody;
    expect(run2Json.processedTasks).toBeGreaterThanOrEqual(2);
    expect(run2Json.emailsSent).toBe(0);
    expect(run2Json.remindersRecorded).toBe(0);
    expect(run2Json.skippedAlreadySent).toBeGreaterThanOrEqual(3);

    const run2Rows = await db
      .select({
        taskId: reminders.taskId,
        userId: reminders.userId,
        kind: reminders.kind,
      })
      .from(reminders)
      .where(inArray(reminders.taskId, s2TaskIds));
    const actualRun2Tuples = run2Rows
      .map((row) => `${row.taskId}:${row.userId}:${row.kind}`)
      .sort();
    expect(actualRun2Tuples).toEqual(expectedTuples);

    await tracker.assertClean();
  });
});
