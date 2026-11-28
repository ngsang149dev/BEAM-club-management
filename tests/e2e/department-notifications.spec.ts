import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  columns,
  departments,
  loginAttempts,
  memberDepartments,
  notifications,
  permissions,
  profiles,
  sessions,
  taskDepartments,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS } from '@/lib/permissions';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import enMessages from '../../messages/en.json';
import viMessages from '../../messages/vi.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const VN_OFFSET_MS = 7 * 3_600_000;

function vnDateIsoOffset(daysOffset: number): string {
  const vnNow = new Date(Date.now() + VN_OFFSET_MS);
  const shifted = new Date(
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + daysOffset),
  );
  return shifted.toISOString().slice(0, 10);
}

function vnMidnightUtc(daysOffset: number): string {
  return `${vnDateIsoOffset(daysOffset)}T00:00:00+07:00`;
}

async function attachRuntimeErrorTracker(page: Page): Promise<{
  assertClean: () => Promise<void>;
}> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
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
    },
  };
}

async function signInAs(
  page: Page,
  studentId: string,
  returnTo = '/tasks',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  const expectedPath = returnTo.startsWith('/boards')
    ? `/tasks${returnTo.includes('?') ? returnTo.slice(returnTo.indexOf('?')) : ''}`
    : returnTo;
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${expectedPath}`);
}

function getTaskBar(page: Page, taskId: string): Locator {
  return page.locator(`.hcal-task-bar[data-task-id="${taskId}"]`);
}

function getTaskModal(page: Page): Locator {
  return page.locator('aside.task-modal-shell[role="dialog"]');
}

function assertNoSecretsInText(payloads: readonly string[], sensitiveValues: readonly string[]): void {
  for (const body of payloads) {
    for (const secret of sensitiveValues) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain('"studentId"');
    expect(body).not.toContain('"email"');
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('scrypt$');
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

function assertNoRawNotificationKeys(text: string): void {
  const rawPrefixes = ['notifications.', 'tasks.', 'myTasks.', 'errors.'];
  for (const prefix of rawPrefixes) {
    expect(text).not.toContain(prefix);
  }
}

test.describe('Department Task Assignment & Notifications E2E (CR-03)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);

  const adminUserId = randomUUID();
  const leadUserId = randomUUID();
  const memberAUserId = randomUUID();
  const revokeUserId = randomUUID();
  const outsiderUserId = randomUUID();
  const bellUserId = randomUUID();
  const directUserId = randomUUID();

  const deptAId = randomUUID();
  const deptBId = randomUUID();
  const deptBellId = randomUUID();

  const adminStudentId = `MSSV-CR03-ADM-${suffix}`;
  const leadStudentId = `MSSV-CR03-LEAD-${suffix}`;
  const memberAStudentId = `MSSV-CR03-MEMA-${suffix}`;
  const revokeStudentId = `MSSV-CR03-REV-${suffix}`;
  const outsiderStudentId = `MSSV-CR03-OUT-${suffix}`;
  const bellStudentId = `MSSV-CR03-BELL-${suffix}`;
  const directStudentId = `MSSV-CR06-DIR-${suffix}`;

  const adminEmail = `cr03-admin-${suffix}@eiu.edu.vn`;
  const leadEmail = `cr03-lead-${suffix}@eiu.edu.vn`;
  const memberAEmail = `cr03-mema-${suffix}@eiu.edu.vn`;
  const revokeEmail = `cr03-rev-${suffix}@eiu.edu.vn`;
  const outsiderEmail = `cr03-out-${suffix}@eiu.edu.vn`;
  const bellEmail = `cr03-bell-${suffix}@eiu.edu.vn`;
  const directEmail = `cr06-direct-${suffix}@eiu.edu.vn`;

  const adminFullName = `CR03 Admin ${suffix}`;
  const leadFullName = `CR03 Lead ${suffix}`;
  const memberAFullName = `CR03 MemberA ${suffix}`;
  const revokeFullName = `CR03 Revoke ${suffix}`;
  const outsiderFullName = `CR03 Outsider ${suffix}`;
  const bellFullName = `CR03 BellUser ${suffix}`;
  const directFullName = `CR06 DirectMember ${suffix}`;

  const deptAName = `Ban Truyền thông ${suffix}`;
  const deptBName = `Ban Hậu cần ${suffix}`;
  const deptBellName = `Ban Sự kiện Bell ${suffix}`;

  const trackedUserIds = [
    adminUserId,
    leadUserId,
    memberAUserId,
    revokeUserId,
    outsiderUserId,
    bellUserId,
    directUserId,
  ];
  const trackedStudentIds = [
    adminStudentId,
    leadStudentId,
    memberAStudentId,
    revokeStudentId,
    outsiderStudentId,
    bellStudentId,
    directStudentId,
  ];
  const trackedDeptIds = [deptAId, deptBId, deptBellId];
  const trackedBoardIds: string[] = [];
  const trackedTaskIds: string[] = [];

  const sensitiveValues = [
    adminStudentId,
    leadStudentId,
    memberAStudentId,
    revokeStudentId,
    outsiderStudentId,
    bellStudentId,
    directStudentId,
    adminEmail,
    leadEmail,
    memberAEmail,
    revokeEmail,
    outsiderEmail,
    bellEmail,
    directEmail,
  ];

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

    expect(enMessages.notifications.hiddenTaskDepartmentAssigned).toBeTruthy();
    expect(viMessages.notifications.hiddenTaskDepartmentAssigned).toBeTruthy();

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

    await db.insert(departments).values([
      { id: deptAId, name: deptAName },
      { id: deptBId, name: deptBName },
      { id: deptBellId, name: deptBellName },
    ]);

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
        id: leadUserId,
        studentId: leadStudentId,
        email: leadEmail,
        fullName: leadFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: memberAUserId,
        studentId: memberAStudentId,
        email: memberAEmail,
        fullName: memberAFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: revokeUserId,
        studentId: revokeStudentId,
        email: revokeEmail,
        fullName: revokeFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: outsiderUserId,
        studentId: outsiderStudentId,
        email: outsiderEmail,
        fullName: outsiderFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: bellUserId,
        studentId: bellStudentId,
        email: bellEmail,
        fullName: bellFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: directUserId,
        studentId: directStudentId,
        email: directEmail,
        fullName: directFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    const leadPermissionCodes = [
      'board.create',
      'board.update',
      'task.create',
      'task.assign',
      'task.update_any',
      'member.view',
    ] as const;

    const outsiderPermissionCodes = [
      'member.view',
      'task.update_any',
      'comment.create',
    ] as const;

    await db.insert(userPermissions).values([
      ...leadPermissionCodes.map((code) => ({
        userId: leadUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: memberAUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: revokeUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...outsiderPermissionCodes.map((code) => ({
        userId: outsiderUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: bellUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: directUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
    ]);

    await db.insert(memberDepartments).values([
      { userId: memberAUserId, departmentId: deptAId },
      { userId: revokeUserId, departmentId: deptAId },
      { userId: bellUserId, departmentId: deptBellId },
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
      if (trackedBoardIds.length > 0) {
        const boardTasks = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.boardId, trackedBoardIds));
        for (const row of boardTasks) {
          if (!trackedTaskIds.includes(row.id)) {
            trackedTaskIds.push(row.id);
          }
        }
      }

      if (trackedTaskIds.length > 0) {
        await db.delete(taskDepartments).where(inArray(taskDepartments.taskId, trackedTaskIds));
        await db.delete(notifications).where(inArray(notifications.taskId, trackedTaskIds));
        await db
          .update(tasks)
          .set({
            deletedAt: sql`COALESCE(${tasks.deletedAt}, ${now.toISOString()}::timestamptz)`,
            purgedAt: sql`COALESCE(${tasks.purgedAt}, ${now.toISOString()}::timestamptz)`,
            updatedAt: now,
          })
          .where(inArray(tasks.id, trackedTaskIds));
      }

      if (trackedBoardIds.length > 0) {
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

      await db
        .delete(notifications)
        .where(
          or(
            inArray(notifications.userId, trackedUserIds),
            inArray(notifications.actorId, trackedUserIds),
          ),
        );
      await db.delete(taskDepartments).where(inArray(taskDepartments.departmentId, trackedDeptIds));
      await db.delete(memberDepartments).where(inArray(memberDepartments.userId, trackedUserIds));
      await db.delete(memberDepartments).where(inArray(memberDepartments.departmentId, trackedDeptIds));
      await db.delete(departments).where(inArray(departments.id, trackedDeptIds));

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
        .where(
          and(
            inArray(profiles.id, [
              leadUserId,
              memberAUserId,
              revokeUserId,
              outsiderUserId,
              bellUserId,
              directUserId,
            ]),
            isNull(profiles.purgedAt),
          ),
        );

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

  test('defaults to Department picker with notify checked and collapsed member picker, renders badges on S04/S05/S06, and creates zero notifications when unchecked', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const todoColId = randomUUID();
    const doingColId = randomUUID();
    const doneColId = randomUUID();
    trackedBoardIds.push(boardId);

    const notifiedTitle = `CR03 Public Dept Task ${suffix}`;
    const silentTitle = `CR03 Silent Dept Task ${suffix}`;

    await db.insert(boards).values({
      id: boardId,
      name: `Board CR03 Scenario1 ${suffix}`,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values([
      { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
      { id: doingColId, boardId, name: 'Doing', orderIndex: 1 },
      { id: doneColId, boardId, name: 'Done', orderIndex: 2 },
    ]);

    await page.setViewportSize({ width: 1280, height: 720 });
    await signInAs(page, leadStudentId, `/boards/${boardId}`);
    await expect(page.locator('.hcal-shell')).toBeVisible();

    // Open spacious 720px CreateTaskModal -> verify Department picker prominent, TaskNotificationOptions switches checked, individual picker collapsed
    await page
      .getByRole('button', { name: `+ ${viMessages.calendar.createTask}`, exact: true })
      .click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveClass(/ui-modal-lg/);
    await expect(modal).toHaveCSS('max-width', '720px');
    const modalBox = await modal.boundingBox();
    expect(modalBox).not.toBeNull();
    expect(modalBox!.width).toBeGreaterThanOrEqual(700);

    await expect(modal.getByText(viMessages.tasks.departmentsLabel)).toBeVisible();
    const deptACheckbox = modal
      .locator('label', { hasText: deptAName })
      .locator('input[type="checkbox"]');
    await expect(deptACheckbox).toBeVisible();

    const notifyToggles = modal.locator('.task-create-toggles');
    await expect(notifyToggles).toBeVisible();
    const notifyInAppSwitch = modal.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel });
    const notifyEmailSwitch = modal.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel });
    await expect(notifyInAppSwitch).toBeVisible();
    await expect(notifyInAppSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(notifyEmailSwitch).toBeVisible();
    await expect(notifyEmailSwitch).toHaveAttribute('aria-checked', 'true');

    const individualDetails = modal.locator('details.task-individual-details', {
      hasText: viMessages.tasks.individualAssigneesSummary,
    });
    await expect(individualDetails).toBeVisible();
    await expect(individualDetails).not.toHaveAttribute('open', '');

    // Create public task assigned to Dept A with both notification toggles checked
    await modal.getByLabel(viMessages.tasks.titleLabel).fill(notifiedTitle);
    await modal.getByLabel(viMessages.tasks.dueAtLabel).fill(vnDateIsoOffset(2));
    await deptACheckbox.check();

    const createNotifiedPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createNotifiedRes = await createNotifiedPromise;
    expect(createNotifiedRes.status()).toBe(201);
    const notifiedTaskId = ((await createNotifiedRes.json()) as { task: { id: string } }).task.id;
    trackedTaskIds.push(notifiedTaskId);

    // Open task bar on /tasks timeline -> verify spacious near-fullscreen 2-column TaskDetailDrawer, dept summary, notification switches & saveAssignments button
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    const notifiedBar = getTaskBar(page, notifiedTaskId);
    await expect(notifiedBar).toBeVisible();
    await notifiedBar.click();

    const drawer = getTaskModal(page);
    await expect(drawer).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    const mainColBox = await drawer.locator('.task-modal-col-main').boundingBox();
    const sideColBox = await drawer.locator('.task-modal-col-side').boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.width).toBeGreaterThanOrEqual(1150);
    expect(mainColBox).not.toBeNull();
    expect(sideColBox).not.toBeNull();
    expect(sideColBox!.x).toBeGreaterThanOrEqual(mainColBox!.x + mainColBox!.width);

    await expect(drawer.locator('.task-modal-header-badges')).toContainText(deptAName);
    await expect(
      drawer.locator('.task-side-card label', { hasText: deptAName }).locator('input[type="checkbox"]'),
    ).toBeChecked();
    await expect(drawer.locator('.task-notify-card')).toContainText(
      viMessages.tasks.notifySectionTitle,
    );
    await expect(
      drawer.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      drawer.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      drawer.getByRole('button', { name: viMessages.tasks.saveAssignments }),
    ).toBeVisible();
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);

    // Verify notifications were created in DB for Dept A members and NOT for outsider/lead
    const notifiedRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.taskId, notifiedTaskId));
    expect(notifiedRows.map((row) => row.userId)).toContain(memberAUserId);
    expect(notifiedRows.map((row) => row.userId)).toContain(revokeUserId);
    expect(notifiedRows.map((row) => row.userId)).not.toContain(outsiderUserId);
    expect(notifiedRows.map((row) => row.userId)).not.toContain(leadUserId);

    // Verify Dept A member sees department badge, pill, /my-tasks -> /progress redirect, and department filtering
    const memberAContext = await browser.newContext();
    const memberAPage = await memberAContext.newPage();
    const memberATracker = await attachRuntimeErrorTracker(memberAPage);
    try {
      await signInAs(memberAPage, memberAStudentId, '/tasks');
      await expect(memberAPage.locator('.app-side a[href="/my-tasks"]')).toHaveCount(0);
      await memberAPage.goto('/my-tasks');
      await memberAPage.waitForURL(`${BASE_ORIGIN}/progress`);

      const progRow = memberAPage.locator('.prog-row', { hasText: notifiedTitle });
      await expect(progRow).toBeVisible();
      await expect(progRow).toContainText(deptAName);
      await expect(progRow.locator('.prog-dept-pill')).toContainText(
        viMessages.progress.deptAssignedPill,
      );

      // "Việc của Ban" tab on /progress ("Của tôi" mode) + API departmentId filter verification
      await memberAPage
        .getByRole('tab', { name: new RegExp(`^${viMessages.progress.filterDepartment}\\b`) })
        .click();
      await expect(memberAPage.locator('.prog-row', { hasText: notifiedTitle })).toBeVisible();

      const filterDeptARes = await memberAPage.request.get(
        `/api/v1/me/tasks?departmentId=${deptAId}`,
      );
      expect(filterDeptARes.status()).toBe(200);
      const filterDeptAJson = (await filterDeptARes.json()) as {
        items: Array<{ id: string }>;
      };
      expect(filterDeptAJson.items.some((item) => item.id === notifiedTaskId)).toBe(true);

      const filterDeptBRes = await memberAPage.request.get(
        `/api/v1/me/tasks?departmentId=${deptBId}`,
      );
      expect(filterDeptBRes.status()).toBe(200);
      const filterDeptBJson = (await filterDeptBRes.json()) as {
        items: Array<{ id: string }>;
      };
      expect(filterDeptBJson.items.some((item) => item.id === notifiedTaskId)).toBe(false);

      await memberATracker.assertClean();
    } finally {
      await memberAContext.close();
    }

    // CR-06: Create another task with notifyInApp OFF (keeping notifyEmail ON) -> assignment persists, 0 in-app notifications
    await page
      .getByRole('button', { name: `+ ${viMessages.calendar.createTask}`, exact: true })
      .click();
    const silentModal = page.getByRole('dialog');
    await silentModal.getByLabel(viMessages.tasks.titleLabel).fill(silentTitle);
    await silentModal.getByLabel(viMessages.tasks.dueAtLabel).fill(vnDateIsoOffset(2));
    await silentModal
      .locator('label', { hasText: deptAName })
      .locator('input[type="checkbox"]')
      .check();
    await silentModal.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }).click();
    await expect(
      silentModal.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(
      silentModal.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }),
    ).toHaveAttribute('aria-checked', 'true');

    const createSilentPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await silentModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createSilentRes = await createSilentPromise;
    expect(createSilentRes.status()).toBe(201);
    expect(createSilentRes.request().postDataJSON()).toMatchObject({
      notifyInApp: false,
      notifyEmail: true,
    });
    const silentTaskId = ((await createSilentRes.json()) as { task: { id: string } }).task.id;
    trackedTaskIds.push(silentTaskId);

    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    const silentBar = getTaskBar(page, silentTaskId);
    await expect(silentBar).toBeVisible();

    const silentNotifsAfterCreate = await db
      .select()
      .from(notifications)
      .where(eq(notifications.taskId, silentTaskId));
    expect(silentNotifsAfterCreate).toHaveLength(0);

    // Also update assignments in S05 modal adding Dept B with both toggles OFF -> 0 notifications
    await silentBar.click();
    const silentDrawer = getTaskModal(page);
    await expect(silentDrawer).toBeVisible();
    await expect(silentDrawer.locator('.task-modal-header-badges')).toContainText(deptAName);
    await silentDrawer
      .locator('.task-side-card label', { hasText: deptBName })
      .locator('input[type="checkbox"]')
      .check();
    await silentDrawer.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }).click();
    await silentDrawer.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }).click();

    const updateAssigneesPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${silentTaskId}/assignees`) &&
        res.request().method() === 'PUT',
    );
    await silentDrawer
      .getByRole('button', { name: viMessages.tasks.saveAssignments })
      .click();
    const updateAssigneesRes = await updateAssigneesPromise;
    expect(updateAssigneesRes.status()).toBe(200);
    expect(updateAssigneesRes.request().postDataJSON()).toMatchObject({
      notifyInApp: false,
      notifyEmail: false,
    });
    await silentDrawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(silentDrawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);

    await page.reload();
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    await getTaskBar(page, silentTaskId).click();
    const reloadedSilentDrawer = getTaskModal(page);
    await expect(reloadedSilentDrawer).toBeVisible();
    await expect(reloadedSilentDrawer.locator('.task-modal-header-badges')).toContainText(deptAName);
    await expect(reloadedSilentDrawer.locator('.task-modal-header-badges')).toContainText(deptBName);

    const silentNotifsAfterUpdate = await db
      .select()
      .from(notifications)
      .where(eq(notifications.taskId, silentTaskId));
    expect(silentNotifsAfterUpdate).toHaveLength(0);

    await tracker.assertClean();
  });

  test('allows Dept A member with only task.update_assigned to view on /my-tasks, edit in S05 modal, and move task persisting UUID-only task_events', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const todoColId = randomUUID();
    const doingColId = randomUUID();
    const doneColId = randomUUID();
    trackedBoardIds.push(boardId);

    const initialTitle = `CR03 Dept Work ${suffix}`;
    const editedTitle = `CR03 Dept Work Edited ${suffix}`;

    await db.insert(boards).values({
      id: boardId,
      name: `Board CR03 Scenario2 ${suffix}`,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values([
      { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
      { id: doingColId, boardId, name: 'Doing', orderIndex: 1 },
      { id: doneColId, boardId, name: 'Done', orderIndex: 2 },
    ]);

    // Lead assigns task strictly to Dept A (NO individual assigneeIds!)
    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    let taskId: string;
    try {
      await signInAs(leadPage, leadStudentId, '/boards');
      const createRes = await leadPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: todoColId,
          title: initialTitle,
          priority: 2,
          startAt: vnMidnightUtc(0),
          dueAt: vnMidnightUtc(2),
          departmentIds: [deptAId],
          notifyDepartmentMembers: false,
        },
      });
      expect(createRes.status()).toBe(201);
      taskId = ((await createRes.json()) as { task: { id: string } }).task.id;
      trackedTaskIds.push(taskId);
      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    // Sign in as memberA (holding ONLY member.view, task.update_assigned, comment.create)
    await signInAs(page, memberAStudentId, '/progress');
    const myRow = page.locator('.prog-row', { hasText: initialTitle });
    await expect(myRow).toBeVisible();
    await expect(myRow).toContainText(deptAName);

    // Select row and expand S05 modal from /progress and edit title & description
    await myRow.locator('.prog-row-btn').click();
    await page.locator('.prog-expand-btn').click();
    const drawer = getTaskModal(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(viMessages.tasks.readOnlyNotice)).toHaveCount(0);

    await drawer.getByLabel(viMessages.tasks.titleLabel).fill(editedTitle);
    await drawer.getByLabel(viMessages.tasks.descriptionLabel).fill('Updated by dept member');

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${taskId}`) && res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails }).click();
    expect((await patchPromise).status()).toBe(200);
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(editedTitle);
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);

    // Navigate to legacy /boards/[id] -> redirects to /tasks -> verify edited task bar visible on /tasks timeline
    await page.goto(`/boards/${boardId}`);
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    const editedBar = getTaskBar(page, taskId);
    await expect(editedBar).toBeVisible();
    await expect(editedBar).toContainText(editedTitle);

    // Move task via /api/v1/tasks/{id}/move (Todo -> Doing) & persist UUID-only task_events
    const moveRes = await page.request.post(`/api/v1/tasks/${taskId}/move`, {
      data: { columnId: doingColId, version: 2 },
    });
    expect(moveRes.status()).toBe(200);

    const [movedRow] = await db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(movedRow?.columnId).toBe(doingColId);

    // Verify task_events in beam_test: UUIDs only, zero PII, no department names
    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId));
    const createdEvent = events.find((event) => event.type === 'task.created');
    const updatedEvent = events.find((event) => event.type === 'task.updated');
    const movedEvent = events.find((event) => event.type === 'task.moved');
    expect(createdEvent).toBeDefined();
    expect(updatedEvent).toBeDefined();
    expect(movedEvent).toBeDefined();
    expect(movedEvent?.actorId).toBe(memberAUserId);

    const eventsSerialized = JSON.stringify(events);
    expect(eventsSerialized).toContain(deptAId);
    expect(eventsSerialized).toContain(todoColId);
    expect(eventsSerialized).toContain(doingColId);
    expect(eventsSerialized).not.toContain(deptAName);
    assertNoSecretsInText(
      [eventsSerialized],
      [...sensitiveValues, leadFullName, memberAFullName, adminFullName],
    );

    await tracker.assertClean();
  });

  test('protects hidden department task with 404 for outsider (even with task.update_any), redacts WQ-27 title, and revokes access & notifications immediately on leaving department', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const todoColId = randomUUID();
    const doingColId = randomUUID();
    trackedBoardIds.push(boardId);

    const hiddenTitle = `CR03 TopSecret Hidden ${suffix}`;

    await db.insert(boards).values({
      id: boardId,
      name: `Board CR03 Scenario3 ${suffix}`,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values([
      { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
      { id: doingColId, boardId, name: 'Doing', orderIndex: 1 },
    ]);

    // Lead creates hidden task assigned to Dept A with notifyDepartmentMembers=true
    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    let hiddenTaskId: string;
    try {
      await signInAs(leadPage, leadStudentId, `/boards/${boardId}`);
      await leadPage
        .getByRole('button', { name: `+ ${viMessages.calendar.createTask}`, exact: true })
        .click();
      const modal = leadPage.getByRole('dialog');
      await modal.getByLabel(viMessages.tasks.titleLabel).fill(hiddenTitle);
      await modal.getByLabel(viMessages.tasks.dueAtLabel).fill(vnDateIsoOffset(2));
      await modal
        .locator('label', { hasText: deptAName })
        .locator('input[type="checkbox"]')
        .check();
      await modal.getByRole('switch', { name: viMessages.tasks.isHiddenShortLabel }).click();
      await expect(
        modal.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }),
      ).toHaveAttribute('aria-checked', 'true');
      await expect(
        modal.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }),
      ).toHaveAttribute('aria-checked', 'true');

      const createPromise = leadPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
      );
      await modal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
      const createRes = await createPromise;
      expect(createRes.status()).toBe(201);
      hiddenTaskId = ((await createRes.json()) as { task: { id: string } }).task.id;
      trackedTaskIds.push(hiddenTaskId);
      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    // Verify DB notifications payload omits hidden task title (WQ-27)
    const dbNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.taskId, hiddenTaskId));
    expect(dbNotifs.length).toBeGreaterThanOrEqual(1);
    for (const row of dbNotifs) {
      expect(row.isHiddenTask).toBe(true);
      expect(row.payload.taskTitle ?? null).toBeNull();
      expect(JSON.stringify(row.payload)).not.toContain(hiddenTitle);
      expect(row.userId).not.toBe(outsiderUserId);
    }
    const revokeNotif = dbNotifs.find((row) => row.userId === revokeUserId);
    expect(revokeNotif).toBeDefined();
    const revokeNotifId = revokeNotif!.id;

    // 1. Outsider holding task.update_any gets 404 everywhere, sees nothing on /tasks or /progress, 0 notifications
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    const outsiderTracker = await attachRuntimeErrorTracker(outsiderPage);
    try {
      await signInAs(outsiderPage, outsiderStudentId, `/boards/${boardId}`);
      await expect(outsiderPage.locator('.hcal-shell')).toBeVisible();
      await expect(outsiderPage.getByText(hiddenTitle)).toHaveCount(0);

      await outsiderPage.goto('/progress');
      await expect(outsiderPage.locator('.prog-row', { hasText: hiddenTitle })).toHaveCount(0);

      expect((await outsiderPage.request.get(`/api/v1/tasks/${hiddenTaskId}`)).status()).toBe(404);
      expect(
        (
          await outsiderPage.request.patch(`/api/v1/tasks/${hiddenTaskId}`, {
            data: { title: 'Bypass Attempt', version: 1 },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await outsiderPage.request.post(`/api/v1/tasks/${hiddenTaskId}/move`, {
            data: { columnId: doingColId, version: 1 },
          })
        ).status(),
      ).toBe(404);

      const outsiderNotifsRes = await outsiderPage.request.get('/api/v1/notifications');
      expect(outsiderNotifsRes.status()).toBe(200);
      const outsiderNotifsText = await outsiderNotifsRes.text();
      expect(outsiderNotifsText).not.toContain(hiddenTaskId);
      expect(outsiderNotifsText).not.toContain(hiddenTitle);

      await outsiderTracker.assertClean();
    } finally {
      await outsiderContext.close();
    }

    // 2. Dept A member (revokeUser) sees hidden task & redacted WQ-27 notification, then loses access immediately on leaving Dept A
    await signInAs(page, revokeStudentId, `/boards/${boardId}`);
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    await expect(getTaskBar(page, hiddenTaskId)).toBeVisible();

    await page.goto('/progress');
    await expect(page.locator('.prog-row', { hasText: hiddenTitle })).toBeVisible();

    const revokeNotifsRes = await page.request.get('/api/v1/notifications');
    expect(revokeNotifsRes.status()).toBe(200);
    const revokeNotifsText = await revokeNotifsRes.text();
    expect(revokeNotifsText).toContain(revokeNotifId);
    expect(revokeNotifsText).not.toContain(hiddenTitle);
    const revokeNotifsJson = JSON.parse(revokeNotifsText) as {
      items: Array<{ id: string; isHiddenTask: boolean; taskTitle: string | null }>;
    };
    const matchingNotif = revokeNotifsJson.items.find((item) => item.id === revokeNotifId);
    expect(matchingNotif).toBeDefined();
    expect(matchingNotif?.isHiddenTask).toBe(true);
    expect(matchingNotif?.taskTitle).toBeNull();

    // Open NotificationBell popover -> verify WQ-27 hidden notification omits hiddenTitle
    const bellButton = page.getByRole('button', {
      name: new RegExp(viMessages.notifications.bellAriaLabel),
    });
    await bellButton.click();
    const popover = page.locator(`[aria-label="${viMessages.notifications.popoverAriaLabel}"]`);
    await expect(popover).toBeVisible();
    const expectedHiddenText = viMessages.notifications.hiddenTaskDepartmentAssigned.replace(
      '{departmentName}',
      deptAName,
    );
    await expect(popover).toContainText(expectedHiddenText);
    expect(await popover.innerText()).not.toContain(hiddenTitle);
    assertNoRawNotificationKeys(await popover.innerText());

    // Admin removes revokeUser from Dept A via PATCH /api/v1/members/{id}
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminTracker = await attachRuntimeErrorTracker(adminPage);
    try {
      await signInAs(adminPage, adminStudentId, '/admin/members');
      const removeDeptRes = await adminPage.request.patch(`/api/v1/members/${revokeUserId}`, {
        data: { departmentIds: [] },
      });
      expect(removeDeptRes.status()).toBe(200);
      await adminTracker.assertClean();
    } finally {
      await adminContext.close();
    }

    // WITHOUT re-login: next request immediately returns 404 and hidden task & notification disappear
    expect((await page.request.get(`/api/v1/tasks/${hiddenTaskId}`)).status()).toBe(404);
    expect(
      (await page.request.post(`/api/v1/notifications/${revokeNotifId}/read`)).status(),
    ).toBe(404);

    const postRevokeNotifsRes = await page.request.get('/api/v1/notifications');
    expect(postRevokeNotifsRes.status()).toBe(200);
    const postRevokeNotifsText = await postRevokeNotifsRes.text();
    expect(postRevokeNotifsText).not.toContain(revokeNotifId);
    expect(postRevokeNotifsText).not.toContain(hiddenTaskId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);
    await expect(page.getByText(hiddenTitle)).toHaveCount(0);

    await page.goto('/progress');
    await expect(page.locator('.prog-row', { hasText: hiddenTitle })).toHaveCount(0);

    await tracker.assertClean();
  });

  test('renders NotificationBell badge (2 -> 1 -> 0), navigates to /tasks?task=[id], auto-opens & cleanly closes modal, marks all read, and leaks zero PII', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const boardName = `Board CR03 Bell ${suffix}`;
    const todoColId = randomUUID();
    trackedBoardIds.push(boardId);

    const publicTitle = `CR03 Bell Public ${suffix}`;
    const hiddenTitle = `CR03 Bell Hidden Secret ${suffix}`;

    await db.insert(boards).values({
      id: boardId,
      name: boardName,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values({
      id: todoColId,
      boardId,
      name: 'Todo',
      orderIndex: 0,
    });

    // Lead creates 1 public task + 1 hidden task assigned to deptBell (notifyDepartmentMembers=true)
    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    let publicTaskId: string;
    let hiddenTaskId: string;
    try {
      await signInAs(leadPage, leadStudentId, '/boards');

      const pubRes = await leadPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: todoColId,
          title: publicTitle,
          priority: 3,
          startAt: vnMidnightUtc(0),
          dueAt: vnMidnightUtc(2),
          departmentIds: [deptBellId],
          notifyDepartmentMembers: true,
        },
      });
      expect(pubRes.status()).toBe(201);
      publicTaskId = ((await pubRes.json()) as { task: { id: string } }).task.id;
      trackedTaskIds.push(publicTaskId);

      const hidRes = await leadPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: todoColId,
          title: hiddenTitle,
          priority: 2,
          startAt: vnMidnightUtc(0),
          dueAt: vnMidnightUtc(2),
          departmentIds: [deptBellId],
          isHidden: true,
          notifyDepartmentMembers: true,
        },
      });
      expect(hidRes.status()).toBe(201);
      hiddenTaskId = ((await hidRes.json()) as { task: { id: string } }).task.id;
      trackedTaskIds.push(hiddenTaskId);

      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    const userNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, bellUserId));
    expect(userNotifs).toHaveLength(2);
    const publicNotif = userNotifs.find((row) => row.taskId === publicTaskId);
    const hiddenNotif = userNotifs.find((row) => row.taskId === hiddenTaskId);
    expect(publicNotif).toBeDefined();
    expect(hiddenNotif).toBeDefined();

    const capturedJsonResponses: string[] = [];
    const notifListPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/notifications') &&
        res.request().method() === 'GET' &&
        res.status() === 200,
    );
    page.on('response', async (res) => {
      if (res.url().includes('/api/v1/notifications') && res.status() === 200) {
        const text = await res.text().catch(() => null);
        if (text) {
          capturedJsonResponses.push(text);
        }
      }
    });

    await signInAs(page, bellStudentId, '/boards');
    const initialNotifRes = await notifListPromise;
    capturedJsonResponses.push(await initialNotifRes.text());

    const bellButton = page.getByRole('button', {
      name: new RegExp(viMessages.notifications.bellAriaLabel),
    });
    await expect(bellButton).toBeVisible();
    await expect(bellButton).toContainText('2');

    // Open popover and verify public vs WQ-27 hidden notification content + zero PII
    await bellButton.click();
    const popover = page.locator(`[aria-label="${viMessages.notifications.popoverAriaLabel}"]`);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(
      viMessages.notifications.unreadCountLabel.replace('{count}', '2'),
    );

    const expectedPublicMsg = viMessages.notifications.taskDepartmentAssigned
      .replace('{actorName}', leadFullName)
      .replace('{taskTitle}', publicTitle)
      .replace('{departmentName}', deptBellName);
    const expectedHiddenMsg = viMessages.notifications.hiddenTaskDepartmentAssigned.replace(
      '{departmentName}',
      deptBellName,
    );
    await expect(popover).toContainText(expectedPublicMsg);
    await expect(popover).toContainText(expectedHiddenMsg);
    await expect(
      popover.getByRole('button', { name: new RegExp(publicTitle) }),
    ).toHaveAttribute('title', viMessages.notifications.openTaskHint);

    const popoverTextBeforeClick = await popover.innerText();
    expect(popoverTextBeforeClick).not.toContain(hiddenTitle);
    assertNoRawNotificationKeys(popoverTextBeforeClick);
    assertNoSecretsInText([popoverTextBeforeClick], sensitiveValues);

    // Click public notification -> POST /notifications/{id}/read (200), badge=1, navigate & auto-open drawer
    const markReadPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/notifications/${publicNotif!.id}/read`) &&
        res.request().method() === 'POST',
    );
    await popover.getByText(expectedPublicMsg).click();
    const markReadRes = await markReadPromise;
    expect(markReadRes.status()).toBe(200);
    const markReadText = await markReadRes.text();
    capturedJsonResponses.push(markReadText);
    const markReadJson = JSON.parse(markReadText) as { unreadCount: number };
    expect(markReadJson.unreadCount).toBe(1);

    await page.waitForURL(`${BASE_ORIGIN}/tasks?task=${publicTaskId}`);
    const drawer = getTaskModal(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(publicTitle);

    // Close modal cleanly -> ?task= query param cleared
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(`${BASE_ORIGIN}/tasks`);
    expect(new URL(page.url()).searchParams.get('task')).toBeNull();

    // Verify unread badge decremented to 1
    await expect(bellButton).toContainText('1');

    // Open popover again -> click Mark all read -> badge resets to 0 and read items remain
    await bellButton.click();
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(
      viMessages.notifications.unreadCountLabel.replace('{count}', '1'),
    );

    const readAllPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/v1/notifications/read-all') && res.request().method() === 'POST',
    );
    await popover.getByRole('button', { name: viMessages.notifications.markAllRead }).click();
    const readAllRes = await readAllPromise;
    expect(readAllRes.status()).toBe(200);
    const readAllText = await readAllRes.text();
    capturedJsonResponses.push(readAllText);
    const readAllJson = JSON.parse(readAllText) as {
      updatedCount: number;
      unreadCount: number;
    };
    expect(readAllJson.updatedCount).toBe(1);
    expect(readAllJson.unreadCount).toBe(0);

    await expect(
      popover.getByRole('button', { name: viMessages.notifications.markAllRead }),
    ).toBeDisabled();
    await expect(popover).not.toContainText(
      viMessages.notifications.unreadCountLabel.replace('{count}', '1'),
    );
    await expect(popover).toContainText(expectedPublicMsg);
    await expect(popover).toContainText(expectedHiddenMsg);
    await expect(bellButton).not.toContainText(/[1-9]/);

    expect(capturedJsonResponses.length).toBeGreaterThanOrEqual(3);
    assertNoSecretsInText(capturedJsonResponses, sensitiveValues);
    for (const jsonText of capturedJsonResponses) {
      expect(jsonText).not.toContain(hiddenTitle);
    }

    await tracker.assertClean();
  });

  test('delivers task.assigned bell notification for direct individual assignment via CreateTaskModal & TaskDetailDrawer with WQ-27 redaction in VI/EN, independent notifyInApp opt-out, and zero PII (CR-06)', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const boardName = `Board CR06 Direct ${suffix}`;
    const todoColId = randomUUID();
    trackedBoardIds.push(boardId);

    const publicDirectTitle = `CR06 Public Direct ${suffix}`;
    const hiddenDirectSecretTitle = `CR06_SECRET_DIRECT_${suffix}`;
    const silentDirectTitle = `CR06 Silent Direct OptOut ${suffix}`;

    await db.insert(boards).values({
      id: boardId,
      name: boardName,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values({
      id: todoColId,
      boardId,
      name: 'Todo',
      orderIndex: 0,
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await signInAs(page, leadStudentId, `/boards/${boardId}`);
    await expect(page.locator('.hcal-shell')).toBeVisible();

    // 1. Create hidden task without assignees, then assign directUserId individually via TaskDetailDrawer (notifyInApp=true, notifyEmail=false)
    const hiddenBaseRes = await page.request.post('/api/v1/tasks', {
      data: {
        boardId,
        columnId: todoColId,
        title: hiddenDirectSecretTitle,
        startAt: vnMidnightUtc(0),
        dueAt: vnMidnightUtc(2),
        isHidden: true,
        notifyInApp: false,
        notifyEmail: false,
      },
    });
    expect(hiddenBaseRes.status()).toBe(201);
    const hiddenDirectTaskId = ((await hiddenBaseRes.json()) as { task: { id: string } }).task.id;
    trackedTaskIds.push(hiddenDirectTaskId);

    await page.reload();
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    const hiddenBar = getTaskBar(page, hiddenDirectTaskId);
    await expect(hiddenBar).toBeVisible();
    await hiddenBar.click();

    const drawer = getTaskModal(page);
    await expect(drawer).toBeVisible();
    await drawer.locator('details.task-individual-details > summary').click();
    const directMemberDrawerCheckbox = drawer
      .locator('details.task-individual-details label.dept-check-item', { hasText: directFullName })
      .locator('input[type="checkbox"]');
    await expect(directMemberDrawerCheckbox).toBeVisible();
    await directMemberDrawerCheckbox.check();

    await expect(
      drawer.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }),
    ).toHaveAttribute('aria-checked', 'true');
    await drawer.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }).click();
    await expect(
      drawer.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }),
    ).toHaveAttribute('aria-checked', 'false');

    const assignPutPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${hiddenDirectTaskId}/assignees`) &&
        res.request().method() === 'PUT',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveAssignments }).click();
    const assignPutRes = await assignPutPromise;
    expect(assignPutRes.status()).toBe(200);
    expect(assignPutRes.request().postDataJSON()).toMatchObject({
      assigneeIds: [directUserId],
      departmentIds: [],
      notifyInApp: true,
      notifyEmail: false,
    });
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);

    // 2. Create public direct task (notifyInApp=true, plus self-assigning leadUserId to verify actorId exclusion) AND web-silent direct task (notifyInApp=false, notifyEmail=true) via CreateTaskModal
    await page
      .getByRole('button', { name: `+ ${viMessages.calendar.createTask}`, exact: true })
      .click();
    const publicModal = page.getByRole('dialog');
    await publicModal.getByLabel(viMessages.tasks.titleLabel).fill(publicDirectTitle);
    await publicModal.getByLabel(viMessages.tasks.dueAtLabel).fill(vnDateIsoOffset(2));
    await publicModal.locator('details.task-individual-details > summary').click();
    await publicModal
      .locator('details.task-individual-details label.dept-check-item', { hasText: directFullName })
      .locator('input[type="checkbox"]')
      .check();
    await publicModal
      .locator('details.task-individual-details label.dept-check-item', { hasText: leadFullName })
      .locator('input[type="checkbox"]')
      .check();
    const createPubDirectPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await publicModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createPubDirectRes = await createPubDirectPromise;
    expect(createPubDirectRes.status()).toBe(201);
    const createdPubDirectJson = (await createPubDirectRes.json()) as {
      task: { id: string; boardId: string };
    };
    const publicDirectTaskId = createdPubDirectJson.task.id;
    const publicDirectBoardId = createdPubDirectJson.task.boardId;
    trackedTaskIds.push(publicDirectTaskId);

    await page
      .getByRole('button', { name: `+ ${viMessages.calendar.createTask}`, exact: true })
      .click();
    const silentModal = page.getByRole('dialog');
    await silentModal.getByLabel(viMessages.tasks.titleLabel).fill(silentDirectTitle);
    await silentModal.getByLabel(viMessages.tasks.dueAtLabel).fill(vnDateIsoOffset(2));
    await silentModal.locator('details.task-individual-details > summary').click();
    await silentModal
      .locator('details.task-individual-details label.dept-check-item', { hasText: directFullName })
      .locator('input[type="checkbox"]')
      .check();
    await silentModal.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }).click();
    await expect(
      silentModal.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(
      silentModal.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel }),
    ).toHaveAttribute('aria-checked', 'true');
    const createSilentDirectPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await silentModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createSilentDirectRes = await createSilentDirectPromise;
    expect(createSilentDirectRes.status()).toBe(201);
    expect(createSilentDirectRes.request().postDataJSON()).toMatchObject({
      assigneeIds: [directUserId],
      notifyInApp: false,
      notifyEmail: true,
    });
    const silentDirectTaskId = ((await createSilentDirectRes.json()) as { task: { id: string } }).task.id;
    trackedTaskIds.push(silentDirectTaskId);

    // Silent direct assignment still persists on /tasks timeline
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    await expect(getTaskBar(page, silentDirectTaskId)).toBeVisible();

    // Verify DB notifications: actor (leadUserId) excluded from self-notifications; directUserId has 2 task.assigned rows with WQ-27 redaction in DB payload
    const leadSelfRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.taskId, publicDirectTaskId), eq(notifications.userId, leadUserId)));
    expect(leadSelfRows).toHaveLength(0);

    const directDbRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, directUserId));
    expect(directDbRows).toHaveLength(2);
    const hiddenDbRow = directDbRows.find((row) => row.taskId === hiddenDirectTaskId);
    expect(hiddenDbRow).toBeDefined();
    expect(hiddenDbRow?.type).toBe('task.assigned');
    expect(hiddenDbRow?.departmentId).toBeNull();
    expect(hiddenDbRow?.isHiddenTask).toBe(true);
    expect(hiddenDbRow?.payload.taskTitle ?? null).toBeNull();
    expect(JSON.stringify(hiddenDbRow?.payload)).not.toContain(hiddenDirectSecretTitle);

    // 3. directUser signs in -> sees unreadCount=2, flat NotificationDto (WQ-27 taskTitle: null), VI & EN popover copy, and zero PII
    const directContext = await browser.newContext();
    const directPage = await directContext.newPage();
    const directTracker = await attachRuntimeErrorTracker(directPage);
    const capturedDirectResponses: string[] = [];
    directPage.on('response', async (res) => {
      if (res.url().includes('/api/v1/notifications') && res.status() === 200) {
        const text = await res.text().catch(() => null);
        if (text) {
          capturedDirectResponses.push(text);
        }
      }
    });

    try {
      const initialNotifPromise = directPage.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/notifications') &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );
      await signInAs(directPage, directStudentId, '/progress');
      await initialNotifPromise;

      const viBellBtn = directPage.getByRole('button', {
        name: new RegExp(viMessages.notifications.bellAriaLabel),
      });
      await expect(viBellBtn).toBeVisible();
      await expect(viBellBtn).toContainText('2');

      const notifRes = await directPage.request.get('/api/v1/notifications');
      expect(notifRes.status()).toBe(200);
      const notifText = await notifRes.text();
      expect(notifText).not.toContain(hiddenDirectSecretTitle);
      expect(notifText).not.toContain(silentDirectTitle);

      const notifJson = JSON.parse(notifText) as {
        items: Array<{
          type: string;
          taskId: string;
          boardId: string;
          departmentId: string | null;
          departmentName: string | null;
          boardName: string;
          taskTitle: string | null;
          isHiddenTask: boolean;
        }>;
        unreadCount: number;
      };
      expect(notifJson.unreadCount).toBe(2);
      expect(notifJson.items).toHaveLength(2);
      expect(notifJson.items.find((item) => item.taskId === hiddenDirectTaskId)).toMatchObject({
        type: 'task.assigned',
        boardId,
        departmentId: null,
        departmentName: null,
        boardName,
        taskTitle: null,
        isHiddenTask: true,
      });
      expect(notifJson.items.find((item) => item.taskId === publicDirectTaskId)).toMatchObject({
        type: 'task.assigned',
        boardId: publicDirectBoardId,
        departmentId: null,
        departmentName: null,
        boardName: 'BEAM Workspace',
        taskTitle: publicDirectTitle,
        isHiddenTask: false,
      });

      await viBellBtn.click();
      const viPopover = directPage.locator(
        `[aria-label="${viMessages.notifications.popoverAriaLabel}"]`,
      );
      await expect(viPopover).toBeVisible();
      await expect(viPopover).toContainText(viMessages.notifications.hiddenTaskAssigned);
      await expect(viPopover).toContainText(
        viMessages.notifications.taskAssigned
          .replace('{actorName}', leadFullName)
          .replace('{taskTitle}', publicDirectTitle),
      );
      const popoverViText = await viPopover.innerText();
      expect(popoverViText).not.toContain(hiddenDirectSecretTitle);
      expect(popoverViText).not.toContain(silentDirectTitle);
      assertNoRawNotificationKeys(popoverViText);

      // Switch to EN via AppShell sidebar -> verify EN taskAssigned & hiddenTaskAssigned copy with WQ-27 redaction intact
      const enSwitchPromise = directPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
      );
      await directPage
        .locator('.app-side .app-side-lang')
        .getByRole('button', { name: 'EN', exact: true })
        .click();
      expect((await enSwitchPromise).status()).toBe(200);
      await expect(directPage.locator('.app-top-bread')).toContainText(enMessages.progress.title);

      const enBellBtn = directPage.getByRole('button', {
        name: new RegExp(enMessages.notifications.bellAriaLabel),
      });
      await expect(enBellBtn).toBeVisible();
      const enPopover = directPage.locator(
        `[aria-label="${enMessages.notifications.popoverAriaLabel}"]`,
      );
      if ((await enPopover.count()) === 0) {
        await enBellBtn.click();
      }
      await expect(enPopover).toBeVisible();
      await expect(enPopover).toContainText(enMessages.notifications.hiddenTaskAssigned);
      await expect(enPopover).toContainText(
        enMessages.notifications.taskAssigned
          .replace('{actorName}', leadFullName)
          .replace('{taskTitle}', publicDirectTitle),
      );
      const popoverEnText = await enPopover.innerText();
      expect(popoverEnText).not.toContain(hiddenDirectSecretTitle);
      expect(popoverEnText).not.toContain(silentDirectTitle);
      assertNoRawNotificationKeys(popoverEnText);

      assertNoSecretsInText(
        [...capturedDirectResponses, notifText, popoverViText, popoverEnText],
        sensitiveValues,
      );
      await directTracker.assertClean();
    } finally {
      await directContext.close();
    }

    await tracker.assertClean();
  });
});
