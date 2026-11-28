import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  appSettings,
  auditLogs,
  boards,
  columns,
  departments,
  loginAttempts,
  memberDepartments,
  permissions,
  profiles,
  sessions,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { PURGED_MEMBER_DISPLAY_NAME } from '@/lib/archive';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS } from '@/lib/permissions';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import enMessages from '../../messages/en.json';
import viMessages from '../../messages/vi.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const MS_PER_DAY = 86_400_000;

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
  returnTo = '/archive',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

function getDesktopRow(page: Page, text: string): Locator {
  return page.locator('.directory-table-wrap table.ui-table tbody tr', { hasText: text });
}

function assertZeroSensitiveStrings(
  payloads: readonly string[],
  sensitiveValues: readonly string[],
): void {
  for (const body of payloads) {
    for (const secret of sensitiveValues) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

function assertNoRawTranslationKeys(text: string): void {
  const rawPrefixes = ['archive.', 'errors.', 'common.', 'auditLogs.', 'members.', 'tasks.'];
  for (const prefix of rawPrefixes) {
    expect(text).not.toContain(prefix);
  }
}

test.describe('Unified Archive Center E2E (CR-04)', () => {
  let pool: Pool;
  let db: Database;
  let seedPasswordHash: string;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const taskDelUserId = randomUUID();
  const memMgrUserId = randomUUID();
  const basicUserId = randomUUID();

  const adminStudentId = `MSSV-CR04-ADM-${suffix}`;
  const taskDelStudentId = `MSSV-CR04-TD-${suffix}`;
  const memMgrStudentId = `MSSV-CR04-MD-${suffix}`;
  const basicStudentId = `MSSV-CR04-BAS-${suffix}`;

  const adminEmail = `cr04-admin-${suffix}@eiu.edu.vn`;
  const taskDelEmail = `cr04-td-${suffix}@eiu.edu.vn`;
  const memMgrEmail = `cr04-md-${suffix}@eiu.edu.vn`;
  const basicEmail = `cr04-bas-${suffix}@eiu.edu.vn`;

  const adminFullName = `CR04 Admin ${suffix}`;
  const taskDelFullName = `CR04 TaskDel ${suffix}`;
  const memMgrFullName = `CR04 MemMgr ${suffix}`;
  const basicFullName = `CR04 Basic ${suffix}`;

  const trackedBoardIds: string[] = [];
  const trackedDeptIds: string[] = [];
  const trackedMemberIds: string[] = [adminUserId, taskDelUserId, memMgrUserId, basicUserId];
  const trackedStudentIds: string[] = [
    adminStudentId,
    taskDelStudentId,
    memMgrStudentId,
    basicStudentId,
  ];
  const deactivatedCleanupIds: string[] = [taskDelUserId, memMgrUserId, basicUserId];

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

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

    await db
      .insert(appSettings)
      .values({
        key: 'archive_retention',
        value: { retentionDays: null },
        updatedBy: null,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { retentionDays: null }, updatedBy: null, updatedAt: new Date() },
      });

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
        id: taskDelUserId,
        studentId: taskDelStudentId,
        email: taskDelEmail,
        fullName: taskDelFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: memMgrUserId,
        studentId: memMgrStudentId,
        email: memMgrEmail,
        fullName: memMgrFullName,
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
    ]);

    await db.insert(userPermissions).values([
      { userId: taskDelUserId, permissionCode: 'task.delete', grantedBy: adminUserId },
      { userId: memMgrUserId, permissionCode: 'member.deactivate', grantedBy: adminUserId },
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: basicUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
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
    await db
      .update(profiles)
      .set({ locale: 'vi', updatedAt: new Date() })
      .where(eq(profiles.id, adminUserId));
  });

  test.afterAll(async () => {
    if (db) {
      const now = new Date();
      await db
        .insert(appSettings)
        .values({ key: 'archive_retention', value: { retentionDays: null }, updatedBy: null })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: { retentionDays: null }, updatedBy: null, updatedAt: now },
        });

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

      if (trackedDeptIds.length > 0) {
        await db.delete(memberDepartments).where(inArray(memberDepartments.departmentId, trackedDeptIds));
        await db.delete(departments).where(inArray(departments.id, trackedDeptIds));
      }

      await db.delete(sessions).where(inArray(sessions.userId, trackedMemberIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, trackedMemberIds));
      await db.delete(memberDepartments).where(inArray(memberDepartments.userId, trackedMemberIds));
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
        .where(and(inArray(profiles.id, deactivatedCleanupIds), isNull(profiles.purgedAt)));

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

  test('enforces Archive RBAC navigation, scoped tabs, read-only retention, non-admin purge 403, and member PII masking', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const colId = randomUUID();
    const deletedTaskId = randomUUID();
    const deactivatedTargetId = randomUUID();
    const deactivatedStudentId = `MSSV-CR04-PRIV-${suffix}`;
    const deactivatedEmail = `cr04-priv-${suffix}@eiu.edu.vn`;
    const deactivatedFullName = `CR04 Masked Member ${suffix}`;
    const sampleTaskTitle = `CR04 Scoped Deleted Task ${suffix}`;

    trackedBoardIds.push(boardId);
    trackedMemberIds.push(deactivatedTargetId);
    trackedStudentIds.push(deactivatedStudentId);
    deactivatedCleanupIds.push(deactivatedTargetId);

    await db.insert(boards).values({
      id: boardId,
      name: `Board CR04 RBAC ${suffix}`,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values({
      id: colId,
      boardId,
      name: 'Todo',
      orderIndex: 0,
    });
    const seedStartAt = new Date();
    const seedDueAt = new Date(seedStartAt.getTime() + MS_PER_DAY);
    await db.insert(tasks).values({
      id: deletedTaskId,
      boardId,
      columnId: colId,
      title: sampleTaskTitle,
      startAt: seedStartAt,
      dueAt: seedDueAt,
      priority: 2,
      position: '1000',
      isHidden: false,
      deletedAt: new Date(),
      createdBy: adminUserId,
    });
    await db.insert(profiles).values({
      id: deactivatedTargetId,
      studentId: deactivatedStudentId,
      email: deactivatedEmail,
      fullName: deactivatedFullName,
      passwordHash: seedPasswordHash,
      mustChangePassword: false,
      isAdmin: false,
      isActive: false,
      leftAt: new Date(Date.now() - 2 * MS_PER_DAY),
      locale: 'vi',
    });

    // 1. Active user with NO archive permissions does not see /archive sidebar link and sees 403 ErrorState
    await signInAs(page, basicStudentId, '/profile');
    await expect(page.locator('.app-side a[href="/archive"]')).toHaveCount(0);
    await expect(page.locator('.app-mtabs a[href="/archive"]')).toHaveCount(0);

    await page.goto('/archive');
    await expect(page.getByText(viMessages.errors['403'].code, { exact: true })).toBeVisible();
    await expect(page.getByText(viMessages.archive.forbiddenTitle)).toBeVisible();
    await expect(page.getByText(viMessages.archive.forbiddenDescription)).toBeVisible();

    expect((await page.request.get('/api/v1/archive?tab=tasks')).status()).toBe(403);
    expect((await page.request.get('/api/v1/settings/archive-retention')).status()).toBe(403);

    // 2. Scoped user with task.delete ONLY sees Tasks tab, read-only retention banner, no Purge, and 403 on members/boards/purge
    const taskDelContext = await browser.newContext();
    const taskDelPage = await taskDelContext.newPage();
    const taskDelTracker = await attachRuntimeErrorTracker(taskDelPage);
    try {
      await signInAs(taskDelPage, taskDelStudentId, '/archive');
      await expect(taskDelPage.locator('.app-side a[href="/archive"]')).toBeVisible();
      await expect(taskDelPage.locator('#archive-tab-tasks')).toBeVisible();
      await expect(taskDelPage.locator('#archive-tab-members')).toHaveCount(0);
      await expect(taskDelPage.locator('#archive-tab-boards')).toHaveCount(0);

      await expect(getDesktopRow(taskDelPage, sampleTaskTitle)).toBeVisible();

      const retentionBar = taskDelPage.locator('section.archive-retention-bar');
      await expect(retentionBar).toContainText(viMessages.archive.retentionAdminOnlyNote);
      await expect(retentionBar.locator('select')).toHaveCount(0);
      await expect(
        retentionBar.getByRole('button', { name: viMessages.archive.retentionSave }),
      ).toHaveCount(0);
      await expect(
        taskDelPage.getByRole('button', { name: viMessages.archive.purgeButton }),
      ).toHaveCount(0);

      expect((await taskDelPage.request.get('/api/v1/archive?tab=members')).status()).toBe(403);
      expect((await taskDelPage.request.get('/api/v1/archive?tab=boards')).status()).toBe(403);
      expect(
        (
          await taskDelPage.request.delete(`/api/v1/archive/tasks/${deletedTaskId}`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await taskDelPage.request.put('/api/v1/settings/archive-retention', {
            data: { retentionDays: 7 },
          })
        ).status(),
      ).toBe(403);

      await taskDelTracker.assertClean();
    } finally {
      await taskDelContext.close();
    }

    // 3. Scoped user with member.deactivate WITHOUT member.view_detail sees deactivated members WITHOUT studentId or email
    const memMgrContext = await browser.newContext();
    const memMgrPage = await memMgrContext.newPage();
    const memMgrTracker = await attachRuntimeErrorTracker(memMgrPage);
    const capturedMemberResponses: string[] = [];
    memMgrPage.on('response', async (res) => {
      if (res.url().includes('/api/v1/archive') && res.status() === 200) {
        capturedMemberResponses.push(await res.text());
      }
    });

    try {
      const membersFetchPromise = memMgrPage.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/archive') &&
          res.url().includes('tab=members') &&
          res.status() === 200,
      );
      await signInAs(memMgrPage, memMgrStudentId, '/archive?tab=members');
      await membersFetchPromise;

      await expect(memMgrPage.locator('#archive-tab-members')).toBeVisible();
      await expect(memMgrPage.locator('#archive-tab-tasks')).toHaveCount(0);
      await expect(memMgrPage.locator('#archive-tab-boards')).toHaveCount(0);
      await expect(memMgrPage.getByText(viMessages.archive.privacyHint)).toBeVisible();

      const headerText = await memMgrPage
        .locator('.directory-table-wrap table.ui-table thead')
        .innerText();
      expect(headerText).not.toContain(viMessages.members.colStudentId);
      expect(headerText).not.toContain(viMessages.members.colEmail);

      // Filter by fullName so deactivatedFullName is isolated even with prior E2E rows in beam_test
      const nameSearchPromise = memMgrPage.waitForResponse((res) => {
        if (!res.url().includes('/api/v1/archive') || res.status() !== 200) return false;
        const sp = new URL(res.url()).searchParams;
        return sp.get('tab') === 'members' && sp.get('q') === deactivatedFullName;
      });
      await memMgrPage.getByLabel(viMessages.archive.searchLabel).fill(deactivatedFullName);
      await nameSearchPromise;

      const memberRow = getDesktopRow(memMgrPage, deactivatedFullName);
      await expect(memberRow).toBeVisible();
      await expect(memberRow).toContainText(viMessages.member.leftBadge);

      const sensitiveValues = [
        deactivatedStudentId,
        deactivatedEmail,
        adminStudentId,
        adminEmail,
        taskDelStudentId,
        taskDelEmail,
      ];
      const mainText = await memMgrPage.locator('#main-content').innerText();
      assertZeroSensitiveStrings([mainText], sensitiveValues);
      assertZeroSensitiveStrings(capturedMemberResponses, sensitiveValues);
      for (const body of capturedMemberResponses) {
        expect(body).not.toContain('"studentId"');
        expect(body).not.toContain('"email"');
      }

      // Searching by studentId without member.view_detail yields zero matches
      const sidSearchPromise = memMgrPage.waitForResponse((res) => {
        if (!res.url().includes('/api/v1/archive') || res.status() !== 200) return false;
        const sp = new URL(res.url()).searchParams;
        return sp.get('tab') === 'members' && sp.get('q') === deactivatedStudentId;
      });
      await memMgrPage.getByLabel(viMessages.archive.searchLabel).fill(deactivatedStudentId);
      await sidSearchPromise;
      await expect(memMgrPage.getByText(viMessages.archive.emptyTitle)).toBeVisible();

      expect((await memMgrPage.request.get('/api/v1/archive?tab=tasks')).status()).toBe(403);
      expect((await memMgrPage.request.get('/api/v1/archive?tab=boards')).status()).toBe(403);
      await memMgrTracker.assertClean();
    } finally {
      await memMgrContext.close();
    }

    await tracker.assertClean();
  });

  test('protects hidden tasks with 404, restores original/WQ-33/hidden tasks, handles 409 BOARD_ARCHIVED, and restores boards & members', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const activeBoardId = randomUUID();
    const activeBoardName = `Board CR04 Restore ${suffix}`;
    const todoColId = randomUUID();
    const extraColId = randomUUID();

    const archivedBoardId = randomUUID();
    const archivedBoardName = `Board CR04 Archived ${suffix}`;
    const archivedBoardColId = randomUUID();

    const hiddenTaskId = randomUUID();
    const hiddenTaskTitle = `Hidden Secret Restore ${suffix}`;
    const origColTaskId = randomUUID();
    const origColTaskTitle = `Orig Col Restore ${suffix}`;
    const wq33TaskId = randomUUID();
    const wq33TaskTitle = `WQ33 Fallback Restore ${suffix}`;
    const blockedTaskId = randomUUID();
    const blockedTaskTitle = `Blocked Archived Board Task ${suffix}`;

    const inactiveRestoreId = randomUUID();
    const inactiveRestoreStudentId = `MSSV-CR04-RST-${suffix}`;
    const inactiveRestoreEmail = `cr04-rst-${suffix}@eiu.edu.vn`;
    const inactiveRestoreName = `CR04 Restore Member ${suffix}`;

    trackedBoardIds.push(activeBoardId, archivedBoardId);
    trackedMemberIds.push(inactiveRestoreId);
    trackedStudentIds.push(inactiveRestoreStudentId);
    deactivatedCleanupIds.push(inactiveRestoreId);

    const now = new Date();
    await db.insert(profiles).values({
      id: inactiveRestoreId,
      studentId: inactiveRestoreStudentId,
      email: inactiveRestoreEmail,
      fullName: inactiveRestoreName,
      passwordHash: seedPasswordHash,
      mustChangePassword: false,
      isAdmin: false,
      isActive: false,
      leftAt: new Date(now.getTime() - MS_PER_DAY),
      locale: 'vi',
    });

    await db.insert(boards).values([
      {
        id: activeBoardId,
        name: activeBoardName,
        departmentId: null,
        createdBy: adminUserId,
      },
      {
        id: archivedBoardId,
        name: archivedBoardName,
        departmentId: null,
        createdBy: adminUserId,
        archivedAt: new Date(now.getTime() - MS_PER_DAY),
      },
    ]);
    await db.insert(columns).values([
      { id: todoColId, boardId: activeBoardId, name: 'Todo', orderIndex: 0 },
      { id: extraColId, boardId: activeBoardId, name: 'Temp Col', orderIndex: 1 },
      { id: archivedBoardColId, boardId: archivedBoardId, name: 'Todo', orderIndex: 0 },
    ]);
    const restoreStartAt = now;
    const restoreDueAt = new Date(now.getTime() + MS_PER_DAY);
    await db.insert(tasks).values([
      {
        id: hiddenTaskId,
        boardId: activeBoardId,
        columnId: todoColId,
        title: hiddenTaskTitle,
        startAt: restoreStartAt,
        dueAt: restoreDueAt,
        priority: 3,
        position: '1000',
        isHidden: true,
        deletedAt: new Date(now.getTime() - 1_000),
        createdBy: adminUserId,
      },
      {
        id: origColTaskId,
        boardId: activeBoardId,
        columnId: todoColId,
        title: origColTaskTitle,
        startAt: restoreStartAt,
        dueAt: restoreDueAt,
        priority: 2,
        position: '2000',
        isHidden: false,
        deletedAt: new Date(now.getTime() - 2_000),
        createdBy: adminUserId,
      },
      {
        id: wq33TaskId,
        boardId: activeBoardId,
        columnId: null,
        title: wq33TaskTitle,
        startAt: restoreStartAt,
        dueAt: restoreDueAt,
        priority: 4,
        position: '3000',
        isHidden: false,
        deletedAt: new Date(now.getTime() - 3_000),
        createdBy: adminUserId,
      },
      {
        id: blockedTaskId,
        boardId: archivedBoardId,
        columnId: archivedBoardColId,
        title: blockedTaskTitle,
        startAt: restoreStartAt,
        dueAt: restoreDueAt,
        priority: 2,
        position: '1000',
        isHidden: false,
        deletedAt: new Date(now.getTime() - 4_000),
        createdBy: adminUserId,
      },
    ]);
    // Delete Temp Col so wq33TaskId authentically has no original column in DB
    await db.delete(columns).where(eq(columns.id, extraColId));

    // 1. Scoped task.delete user: hidden task invisible + 404 on restore endpoints, 409 BOARD_ARCHIVED alert, origCol + WQ-33 restores
    const taskDelContext = await browser.newContext();
    const taskDelPage = await taskDelContext.newPage();
    const taskDelTracker = await attachRuntimeErrorTracker(taskDelPage);
    const taskArchiveBodies: string[] = [];
    taskDelPage.on('response', async (res) => {
      if (res.url().includes('/api/v1/archive') && res.status() === 200) {
        taskArchiveBodies.push(await res.text());
      }
    });

    try {
      const listPromise = taskDelPage.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/archive') &&
          res.url().includes('tab=tasks') &&
          res.status() === 200,
      );
      await signInAs(taskDelPage, taskDelStudentId, '/archive?tab=tasks');
      await listPromise;

      await taskDelPage.getByLabel(viMessages.archive.searchLabel).fill(suffix);
      await expect(getDesktopRow(taskDelPage, origColTaskTitle)).toBeVisible();
      await expect(getDesktopRow(taskDelPage, hiddenTaskTitle)).toHaveCount(0);
      for (const body of taskArchiveBodies) {
        expect(body).not.toContain(hiddenTaskId);
        expect(body).not.toContain(hiddenTaskTitle);
      }

      // Direct restore calls to hidden task MUST return 404 (never 403)
      const hiddenArchiveRestoreRes = await taskDelPage.request.post(
        `/api/v1/archive/tasks/${hiddenTaskId}/restore`,
      );
      expect(hiddenArchiveRestoreRes.status()).toBe(404);
      const hiddenAliasRestoreRes = await taskDelPage.request.post(
        `/api/v1/tasks/${hiddenTaskId}/restore`,
      );
      expect(hiddenAliasRestoreRes.status()).toBe(404);

      // Task on archived board -> 409 BOARD_ARCHIVED alert in UI
      const blockedRow = getDesktopRow(taskDelPage, blockedTaskTitle);
      await expect(blockedRow).toBeVisible();
      const blockedRestorePromise = taskDelPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/archive/tasks/${blockedTaskId}/restore`) &&
          res.request().method() === 'POST',
      );
      await blockedRow
        .getByRole('button', { name: viMessages.archive.restoreButton, exact: true })
        .click();
      expect((await blockedRestorePromise).status()).toBe(409);
      await expect(taskDelPage.locator('#main-content .ui-banner.is-danger[role="alert"]')).toContainText(
        viMessages.errors.boardArchived,
      );

      // Restore task whose original column still exists
      const origRow = getDesktopRow(taskDelPage, origColTaskTitle);
      const origRestorePromise = taskDelPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/archive/tasks/${origColTaskId}/restore`) &&
          res.request().method() === 'POST',
      );
      await origRow
        .getByRole('button', { name: viMessages.archive.restoreButton, exact: true })
        .click();
      expect((await origRestorePromise).status()).toBe(200);
      await expect(getDesktopRow(taskDelPage, origColTaskTitle)).toHaveCount(0);

      const [origTaskRow] = await db.select().from(tasks).where(eq(tasks.id, origColTaskId)).limit(1);
      expect(origTaskRow?.deletedAt).toBeNull();
      expect(origTaskRow?.columnId).toBe(todoColId);
      const origEvents = await db
        .select()
        .from(taskEvents)
        .where(and(eq(taskEvents.taskId, origColTaskId), eq(taskEvents.type, 'task.restored')));
      expect(origEvents).toHaveLength(1);

      // Restore WQ-33 task whose original column was deleted -> lands in first column
      const wq33Row = getDesktopRow(taskDelPage, wq33TaskTitle);
      await expect(wq33Row).toBeVisible();
      const wq33RestorePromise = taskDelPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/archive/tasks/${wq33TaskId}/restore`) &&
          res.request().method() === 'POST',
      );
      await wq33Row
        .getByRole('button', { name: viMessages.archive.restoreButton, exact: true })
        .click();
      expect((await wq33RestorePromise).status()).toBe(200);
      await expect(getDesktopRow(taskDelPage, wq33TaskTitle)).toHaveCount(0);

      const [wq33TaskDb] = await db.select().from(tasks).where(eq(tasks.id, wq33TaskId)).limit(1);
      expect(wq33TaskDb?.deletedAt).toBeNull();
      expect(wq33TaskDb?.columnId).toBe(todoColId);
      const wq33Events = await db
        .select()
        .from(taskEvents)
        .where(and(eq(taskEvents.taskId, wq33TaskId), eq(taskEvents.type, 'task.restored')));
      expect(wq33Events).toHaveLength(1);
      expect(wq33Events[0]?.changes).toMatchObject({ column_id: { from: null, to: todoColId } });

      // Verify legacy /boards/[id] redirects to /tasks and restored tasks appear on /tasks timeline (no unscheduled tray)
      await taskDelPage.goto(`/boards/${activeBoardId}`);
      await taskDelPage.waitForURL(`${BASE_ORIGIN}/tasks`);
      await expect(taskDelPage.locator('.hcal-unscheduled-tray')).toHaveCount(0);
      await expect(taskDelPage.locator(`.hcal-task-bar[data-task-id="${origColTaskId}"]`)).toBeVisible();
      await expect(taskDelPage.locator(`.hcal-task-bar[data-task-id="${wq33TaskId}"]`)).toBeVisible();

      await taskDelTracker.assertClean();
    } finally {
      await taskDelContext.close();
    }

    // 2. Admin sees & restores hidden task and deactivated member via UI, and archived board via API (#archive-tab-boards removed from UI)
    await signInAs(page, adminStudentId, '/archive');
    await expect(page.locator('#archive-tab-boards')).toHaveCount(0);
    await page.getByLabel(viMessages.archive.searchLabel).fill(suffix);

    const hiddenRow = getDesktopRow(page, hiddenTaskTitle);
    await expect(hiddenRow).toBeVisible();
    await expect(hiddenRow).toContainText(viMessages.tasks.hiddenBadge);
    const restoreHiddenPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/archive/tasks/${hiddenTaskId}/restore`) &&
        res.request().method() === 'POST',
    );
    await hiddenRow
      .getByRole('button', { name: viMessages.archive.restoreButton, exact: true })
      .click();
    expect((await restoreHiddenPromise).status()).toBe(200);
    await expect(getDesktopRow(page, hiddenTaskTitle)).toHaveCount(0);

    // Archived boards list + restore via API (keeping backend coverage intact)
    const archivedBoardsListRes = await page.request.get(
      `/api/v1/archive?tab=boards&q=${encodeURIComponent(archivedBoardName)}`,
    );
    expect(archivedBoardsListRes.status()).toBe(200);
    const archivedBoardsListJson = (await archivedBoardsListRes.json()) as {
      boards: Array<{ board: { id: string; name: string } }>;
    };
    expect(archivedBoardsListJson.boards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          board: expect.objectContaining({ id: archivedBoardId, name: archivedBoardName }),
        }),
      ]),
    );
    const restoreBoardApiRes = await page.request.post(
      `/api/v1/archive/boards/${archivedBoardId}/restore`,
    );
    expect(restoreBoardApiRes.status()).toBe(200);

    // Switch to Members tab -> restore deactivated member
    const membersTabPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/archive') &&
        res.url().includes('tab=members') &&
        res.status() === 200,
    );
    await page.locator('#archive-tab-members').click();
    await membersTabPromise;

    const archivedMemberRow = getDesktopRow(page, inactiveRestoreName);
    await expect(archivedMemberRow).toBeVisible();
    const restoreMemberPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/archive/members/${inactiveRestoreId}/restore`) &&
        res.request().method() === 'POST',
    );
    await archivedMemberRow
      .getByRole('button', { name: viMessages.archive.restoreButton, exact: true })
      .click();
    expect((await restoreMemberPromise).status()).toBe(200);
    await expect(getDesktopRow(page, inactiveRestoreName)).toHaveCount(0);

    // Verify board active via /api/v1/boards, /boards redirects to /tasks, hidden task restored on /tasks timeline, and member active on /members
    await page.goto(`/boards/${activeBoardId}`);
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    await expect(page.locator(`.hcal-task-bar[data-task-id="${hiddenTaskId}"]`)).toBeVisible();

    await page.goto('/boards');
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);
    const activeBoardsRes = await page.request.get('/api/v1/boards');
    expect(activeBoardsRes.status()).toBe(200);
    expect(
      ((await activeBoardsRes.json()) as { items: Array<{ id: string; name: string }> }).items,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: archivedBoardId, name: archivedBoardName })]));

    await page.goto('/members');
    await page.getByLabel(viMessages.members.searchLabel).fill(inactiveRestoreName);
    const activeMemberRow = getDesktopRow(page, inactiveRestoreName);
    await expect(activeMemberRow).toBeVisible();
    await expect(activeMemberRow).not.toContainText(viMessages.member.leftBadge);

    const [restoredProfile] = await db
      .select({ isActive: profiles.isActive, leftAt: profiles.leftAt })
      .from(profiles)
      .where(eq(profiles.id, inactiveRestoreId))
      .limit(1);
    expect(restoredProfile?.isActive).toBe(true);
    expect(restoredProfile?.leftAt).toBeNull();

    await tracker.assertClean();
  });

  test('persists Admin retention policy (7 days) with audit_logs and runs CRON_SECRET auto-purge selectively', async ({
    page,
  }) => {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
      throw new Error('CRON_SECRET is required to test archive-purge cron endpoint.');
    }

    const tracker = await attachRuntimeErrorTracker(page);
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * MS_PER_DAY);
    const twoDaysAgo = new Date(now.getTime() - 2 * MS_PER_DAY);

    const hostBoardId = randomUUID();
    const hostColId = randomUUID();
    const expiredBoardId = randomUUID();
    const freshBoardId = randomUUID();
    const expiredTaskId = randomUUID();
    const freshTaskId = randomUUID();
    const expiredMemberId = randomUUID();
    const freshMemberId = randomUUID();

    const expiredTaskTitle = `Cron Expired Task ${suffix}`;
    const freshTaskTitle = `Cron Fresh Task ${suffix}`;
    const expiredBoardName = `Cron Expired Board ${suffix}`;
    const freshBoardName = `Cron Fresh Board ${suffix}`;
    const expiredMemberName = `Cron Expired Member ${suffix}`;
    const freshMemberName = `Cron Fresh Member ${suffix}`;

    trackedBoardIds.push(hostBoardId, expiredBoardId, freshBoardId);
    trackedMemberIds.push(expiredMemberId, freshMemberId);
    trackedStudentIds.push(`MSSV-CR04-CEXP-${suffix}`, `MSSV-CR04-CFR-${suffix}`);
    deactivatedCleanupIds.push(freshMemberId);

    await db.insert(profiles).values([
      {
        id: expiredMemberId,
        studentId: `MSSV-CR04-CEXP-${suffix}`,
        email: `cr04-cexp-${suffix}@eiu.edu.vn`,
        fullName: expiredMemberName,
        passwordHash: seedPasswordHash,
        isAdmin: false,
        isActive: false,
        leftAt: tenDaysAgo,
        locale: 'vi',
      },
      {
        id: freshMemberId,
        studentId: `MSSV-CR04-CFR-${suffix}`,
        email: `cr04-cfr-${suffix}@eiu.edu.vn`,
        fullName: freshMemberName,
        passwordHash: seedPasswordHash,
        isAdmin: false,
        isActive: false,
        leftAt: twoDaysAgo,
        locale: 'vi',
      },
    ]);

    await db.insert(boards).values([
      { id: hostBoardId, name: `Cron Host Board ${suffix}`, departmentId: null, createdBy: adminUserId },
      { id: expiredBoardId, name: expiredBoardName, departmentId: null, createdBy: adminUserId, archivedAt: tenDaysAgo },
      { id: freshBoardId, name: freshBoardName, departmentId: null, createdBy: adminUserId, archivedAt: twoDaysAgo },
    ]);
    await db.insert(columns).values({ id: hostColId, boardId: hostBoardId, name: 'Todo', orderIndex: 0 });
    await db.insert(tasks).values([
      {
        id: expiredTaskId,
        boardId: hostBoardId,
        columnId: hostColId,
        title: expiredTaskTitle,
        startAt: tenDaysAgo,
        dueAt: tenDaysAgo,
        priority: 1,
        position: '1000',
        isHidden: false,
        deletedAt: tenDaysAgo,
        createdBy: adminUserId,
      },
      {
        id: freshTaskId,
        boardId: hostBoardId,
        columnId: hostColId,
        title: freshTaskTitle,
        startAt: twoDaysAgo,
        dueAt: twoDaysAgo,
        priority: 2,
        position: '2000',
        isHidden: false,
        deletedAt: twoDaysAgo,
        createdBy: adminUserId,
      },
    ]);

    try {
      await signInAs(page, adminStudentId, '/archive');

      const retentionBar = page.locator('section.archive-retention-bar');
      const retentionSelect = retentionBar.getByLabel(viMessages.archive.retentionLabel);
      await expect(retentionSelect).toHaveValue('never');

      await retentionSelect.selectOption('7');
      const saveRetentionPromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/settings/archive-retention') &&
          res.request().method() === 'PUT',
      );
      await retentionBar.getByRole('button', { name: viMessages.archive.retentionSave }).click();
      const saveRes = await saveRetentionPromise;
      expect(saveRes.status()).toBe(200);
      await expect(page.getByText(viMessages.archive.retentionSavedToast)).toBeVisible();

      // Reload and confirm 7 days persisted in UI + audit_logs recorded settings.archive_retention_updated
      await page.reload();
      await expect(retentionBar.getByLabel(viMessages.archive.retentionLabel)).toHaveValue('7');
      await expect(retentionBar).toContainText(viMessages.archive.retentionOptions.days7);

      const [retentionAudit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorId, adminUserId),
            eq(auditLogs.action, 'settings.archive_retention_updated'),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(retentionAudit).toBeDefined();
      expect(retentionAudit?.detail).toMatchObject({
        previousRetentionDays: null,
        retentionDays: 7,
      });

      // Missing / invalid Bearer token -> 401
      const unauthCronRes = await page.request.post('/api/v1/internal/cron/archive-purge');
      expect(unauthCronRes.status()).toBe(401);
      const wrongCronRes = await page.request.post('/api/v1/internal/cron/archive-purge', {
        headers: { authorization: 'Bearer wrong-cron-secret' },
      });
      expect(wrongCronRes.status()).toBe(401);

      // Valid CRON_SECRET -> purges expired items, spares newer items
      const cronRes = await page.request.post('/api/v1/internal/cron/archive-purge', {
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      expect(cronRes.status()).toBe(200);
      const cronJson = (await cronRes.json()) as {
        retentionDays: number | null;
        cutoffAt: string | null;
        purgedTasks: number;
        purgedBoards: number;
        purgedMembers: number;
      };
      expect(cronJson.retentionDays).toBe(7);
      expect(cronJson.cutoffAt).toBeTruthy();
      expect(cronJson.purgedTasks).toBeGreaterThanOrEqual(1);
      expect(cronJson.purgedBoards).toBeGreaterThanOrEqual(1);
      expect(cronJson.purgedMembers).toBeGreaterThanOrEqual(1);

      const [expTaskRow] = await db.select().from(tasks).where(eq(tasks.id, expiredTaskId)).limit(1);
      const [frTaskRow] = await db.select().from(tasks).where(eq(tasks.id, freshTaskId)).limit(1);
      expect(expTaskRow?.purgedAt).not.toBeNull();
      expect(frTaskRow?.purgedAt).toBeNull();

      const [expBoardRow] = await db.select().from(boards).where(eq(boards.id, expiredBoardId)).limit(1);
      const [frBoardRow] = await db.select().from(boards).where(eq(boards.id, freshBoardId)).limit(1);
      expect(expBoardRow?.purgedAt).not.toBeNull();
      expect(frBoardRow?.purgedAt).toBeNull();

      const expMemRows = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, expiredMemberId));
      const [frMemRow] = await db.select().from(profiles).where(eq(profiles.id, freshMemberId)).limit(1);
      expect(expMemRows).toHaveLength(0);
      expect(frMemRow?.purgedAt).toBeNull();

      // Confirm in UI that expired items vanished while newer archived items remain (and archived boards via API)
      await page.reload();
      await page.getByLabel(viMessages.archive.searchLabel).fill(suffix);
      await expect(getDesktopRow(page, freshTaskTitle)).toBeVisible();
      await expect(getDesktopRow(page, expiredTaskTitle)).toHaveCount(0);

      const cronBoardsRes = await page.request.get(
        `/api/v1/archive?tab=boards&q=${encodeURIComponent(suffix)}`,
      );
      expect(cronBoardsRes.status()).toBe(200);
      const cronBoardsJson = (await cronBoardsRes.json()) as {
        boards: Array<{ board: { id: string; name: string } }>;
      };
      expect(cronBoardsJson.boards.some((b) => b.board.id === freshBoardId)).toBe(true);
      expect(cronBoardsJson.boards.some((b) => b.board.id === expiredBoardId)).toBe(false);

      await page.locator('#archive-tab-members').click();
      await expect(getDesktopRow(page, freshMemberName)).toBeVisible();
      await expect(getDesktopRow(page, expiredMemberName)).toHaveCount(0);
    } finally {
      await db
        .insert(appSettings)
        .values({ key: 'archive_retention', value: { retentionDays: null }, updatedBy: null })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: { retentionDays: null }, updatedBy: null, updatedAt: new Date() },
        });
    }

    await tracker.assertClean();
  });

  test('permanently purges task, board (releasing department), history-referenced member (anonymized), clean member (physical delete), and toggles VI/EN', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const now = new Date();
    const purgeDeptId = randomUUID();
    const purgeDeptName = `Ban CR04 Purge ${suffix}`;
    const hostBoardId = randomUUID();
    const hostBoardName = `Board CR04 Host ${suffix}`;
    const hostColId = randomUUID();
    const purgeBoardId = randomUUID();
    const purgeBoardName = `Board CR04 PurgeTarget ${suffix}`;
    const purgeBoardColId = randomUUID();
    const purgeTaskId = randomUUID();
    const purgeTaskTitle = `Task CR04 PurgeTarget ${suffix}`;
    const cascadeTaskId = randomUUID();

    const histMemberId = randomUUID();
    const histMemberSid = `MSSV-CR04-HIST-${suffix}`;
    const histMemberEmail = `cr04-hist-${suffix}@eiu.edu.vn`;
    const histMemberName = `CR04 History Member ${suffix}`;

    const cleanMemberId = randomUUID();
    const cleanMemberSid = `MSSV-CR04-CLN-${suffix}`;
    const cleanMemberEmail = `cr04-cln-${suffix}@eiu.edu.vn`;
    const cleanMemberName = `CR04 Clean Member ${suffix}`;

    trackedDeptIds.push(purgeDeptId);
    trackedBoardIds.push(hostBoardId, purgeBoardId);
    trackedMemberIds.push(histMemberId, cleanMemberId);
    trackedStudentIds.push(histMemberSid, cleanMemberSid);

    await db.insert(departments).values({ id: purgeDeptId, name: purgeDeptName });
    await db.insert(profiles).values([
      {
        id: histMemberId,
        studentId: histMemberSid,
        email: histMemberEmail,
        fullName: histMemberName,
        passwordHash: seedPasswordHash,
        isAdmin: false,
        isActive: false,
        leftAt: new Date(now.getTime() - MS_PER_DAY),
        locale: 'vi',
      },
      {
        id: cleanMemberId,
        studentId: cleanMemberSid,
        email: cleanMemberEmail,
        fullName: cleanMemberName,
        passwordHash: seedPasswordHash,
        isAdmin: false,
        isActive: false,
        leftAt: new Date(now.getTime() - 2 * MS_PER_DAY),
        locale: 'vi',
      },
    ]);
    await db.insert(auditLogs).values({
      actorId: adminUserId,
      action: 'member.deactivated',
      targetUserId: histMemberId,
      detail: {},
      createdAt: now,
    });
    await db.insert(boards).values([
      { id: hostBoardId, name: hostBoardName, departmentId: null, createdBy: histMemberId },
      { id: purgeBoardId, name: purgeBoardName, departmentId: purgeDeptId, createdBy: adminUserId, archivedAt: now },
    ]);
    await db.insert(columns).values([
      { id: hostColId, boardId: hostBoardId, name: 'Todo', orderIndex: 0 },
      { id: purgeBoardColId, boardId: purgeBoardId, name: 'Todo', orderIndex: 0 },
    ]);
    await db.insert(tasks).values([
      {
        id: purgeTaskId,
        boardId: hostBoardId,
        columnId: hostColId,
        title: purgeTaskTitle,
        startAt: now,
        dueAt: now,
        priority: 2,
        position: '1000',
        isHidden: false,
        deletedAt: now,
        createdBy: histMemberId,
      },
      {
        id: cascadeTaskId,
        boardId: purgeBoardId,
        columnId: purgeBoardColId,
        title: `Task CR04 Cascade ${suffix}`,
        startAt: now,
        dueAt: now,
        priority: 2,
        position: '1000',
        isHidden: false,
        deletedAt: null,
        createdBy: adminUserId,
      },
    ]);

    await signInAs(page, adminStudentId, '/archive');
    await page.getByLabel(viMessages.archive.searchLabel).fill(suffix);

    // 1. Purge soft-deleted task via modal -> 404 across task & restore endpoints
    const purgeTaskRow = getDesktopRow(page, purgeTaskTitle);
    await expect(purgeTaskRow).toBeVisible();
    await purgeTaskRow
      .getByRole('button', { name: viMessages.archive.purgeButton, exact: true })
      .click();
    const taskModal = page.getByRole('dialog');
    await expect(taskModal).toContainText(viMessages.archive.purgeModalTitle);
    await expect(taskModal).toContainText(purgeTaskTitle);

    const purgeTaskPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/archive/tasks/${purgeTaskId}`) &&
        res.request().method() === 'DELETE',
    );
    await taskModal
      .getByRole('button', { name: viMessages.archive.purgeModalConfirm, exact: true })
      .click();
    const purgeTaskRes = await purgeTaskPromise;
    expect(purgeTaskRes.status()).toBe(200);
    await expect(taskModal).toHaveCount(0);
    await expect(getDesktopRow(page, purgeTaskTitle)).toHaveCount(0);

    expect((await page.request.get(`/api/v1/tasks/${purgeTaskId}`)).status()).toBe(404);
    expect(
      (await page.request.post(`/api/v1/archive/tasks/${purgeTaskId}/restore`)).status(),
    ).toBe(404);
    expect((await page.request.post(`/api/v1/tasks/${purgeTaskId}/restore`)).status()).toBe(404);

    // 2. Purge archived board linked to purgeDept via API -> 404 on board/task/restore & dept reports 0 boards + deletes cleanly
    const boardsTabApiRes = await page.request.get(
      `/api/v1/archive?tab=boards&q=${encodeURIComponent(purgeBoardName)}`,
    );
    expect(boardsTabApiRes.status()).toBe(200);
    expect(
      ((await boardsTabApiRes.json()) as { boards: Array<{ board: { id: string } }> }).boards.some(
        (b) => b.board.id === purgeBoardId,
      ),
    ).toBe(true);
    const purgeBoardApiRes = await page.request.delete(`/api/v1/archive/boards/${purgeBoardId}`);
    expect(purgeBoardApiRes.status()).toBe(200);

    expect((await page.request.get(`/api/v1/boards/${purgeBoardId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/v1/tasks/${cascadeTaskId}`)).status()).toBe(404);
    expect(
      (await page.request.post(`/api/v1/archive/boards/${purgeBoardId}/restore`)).status(),
    ).toBe(404);

    const deptsRes = await page.request.get('/api/v1/departments');
    expect(deptsRes.status()).toBe(200);
    const deptsData = (await deptsRes.json()) as {
      items: Array<{ id: string; boardCount: number }>;
    };
    const freedDept = deptsData.items.find((d) => d.id === purgeDeptId);
    expect(freedDept?.boardCount).toBe(0);
    expect((await page.request.delete(`/api/v1/departments/${purgeDeptId}`)).status()).toBe(200);

    // 3. Purge member WITH history -> anonymized PII + 'Thành viên đã xóa' preserved in board & audit_logs
    await page.locator('#archive-tab-members').click();
    const histRow = getDesktopRow(page, histMemberName);
    await expect(histRow).toBeVisible();
    await histRow
      .getByRole('button', { name: viMessages.archive.purgeButton, exact: true })
      .click();
    const histModal = page.getByRole('dialog');
    const purgeHistPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/archive/members/${histMemberId}`) &&
        res.request().method() === 'DELETE',
    );
    await histModal
      .getByRole('button', { name: viMessages.archive.purgeModalConfirm, exact: true })
      .click();
    const purgeHistRes = await purgeHistPromise;
    expect(purgeHistRes.status()).toBe(200);
    expect(await purgeHistRes.json()).toEqual({
      purged: true,
      entityType: 'members',
      id: histMemberId,
      mode: 'anonymized',
    });
    await expect(histModal).toHaveCount(0);
    await expect(getDesktopRow(page, histMemberName)).toHaveCount(0);
    expect((await page.request.get(`/api/v1/members/${histMemberId}`)).status()).toBe(404);

    const [anonymizedDb] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, histMemberId))
      .limit(1);
    expect(anonymizedDb?.fullName).toBe(PURGED_MEMBER_DISPLAY_NAME);
    expect(anonymizedDb?.studentId).toBe(`PURGED-${histMemberId}`);
    expect(anonymizedDb?.email).toBe(`purged+${histMemberId}@redacted.local`);
    expect(anonymizedDb?.passwordHash).toBeNull();
    expect(anonymizedDb?.isActive).toBe(false);
    expect(anonymizedDb?.purgedAt).not.toBeNull();

    const hostBoardRes = await page.request.get(`/api/v1/boards/${hostBoardId}`);
    expect(hostBoardRes.status()).toBe(200);
    const hostBoardText = await hostBoardRes.text();
    expect(hostBoardText).toContain(PURGED_MEMBER_DISPLAY_NAME);
    expect(hostBoardText).not.toContain(histMemberSid);
    expect(hostBoardText).not.toContain(histMemberEmail);

    const auditRes = await page.request.get(`/api/v1/audit-logs?targetUserId=${histMemberId}`);
    expect(auditRes.status()).toBe(200);
    const auditText = await auditRes.text();
    expect(auditText).toContain(PURGED_MEMBER_DISPLAY_NAME);
    expect(auditText).not.toContain(histMemberSid);
    expect(auditText).not.toContain(histMemberEmail);

    // 4. Purge member WITH ZERO history -> physically deleted from profiles
    const cleanRow = getDesktopRow(page, cleanMemberName);
    await expect(cleanRow).toBeVisible();
    await cleanRow
      .getByRole('button', { name: viMessages.archive.purgeButton, exact: true })
      .click();
    const cleanModal = page.getByRole('dialog');
    const purgeCleanPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/archive/members/${cleanMemberId}`) &&
        res.request().method() === 'DELETE',
    );
    await cleanModal
      .getByRole('button', { name: viMessages.archive.purgeModalConfirm, exact: true })
      .click();
    const purgeCleanRes = await purgeCleanPromise;
    expect(purgeCleanRes.status()).toBe(200);
    expect(await purgeCleanRes.json()).toEqual({
      purged: true,
      entityType: 'members',
      id: cleanMemberId,
      mode: 'physical_delete',
    });
    await expect(cleanModal).toHaveCount(0);
    await expect(getDesktopRow(page, cleanMemberName)).toHaveCount(0);

    const cleanDbRows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, cleanMemberId));
    expect(cleanDbRows).toHaveLength(0);

    // Verify /members directory excludes both purged members and leaks zero original PII
    const membersListPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/members') &&
        res.request().method() === 'GET' &&
        res.status() === 200,
    );
    await page.goto('/members');
    const membersListText = await (await membersListPromise).text();
    expect(membersListText).not.toContain(histMemberId);
    expect(membersListText).not.toContain(cleanMemberId);
    expect(membersListText).not.toContain(histMemberSid);
    expect(membersListText).not.toContain(histMemberEmail);
    expect(membersListText).not.toContain(cleanMemberSid);
    expect(membersListText).not.toContain(cleanMemberEmail);

    // 5. Bilingual VI / EN toggle on /archive with zero raw translation keys and only Tasks & Members tabs
    await page.goto('/archive');
    await expect(page.locator('.app-top-bread')).toContainText(viMessages.archive.title);
    await expect(page.locator('.page-subtitle')).toHaveText(viMessages.archive.subtitle);
    await expect(page.locator('#archive-tab-tasks')).toHaveText(viMessages.archive.tabs.tasks);
    await expect(page.locator('#archive-tab-members')).toHaveText(viMessages.archive.tabs.members);
    await expect(page.locator('#archive-tab-boards')).toHaveCount(0);
    assertNoRawTranslationKeys(await page.locator('#main-content').innerText());

    const switchToEnPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
    );
    await page.locator('.app-side .app-side-lang').getByRole('button', { name: 'EN', exact: true }).click();
    expect((await switchToEnPromise).status()).toBe(200);

    await expect(page.locator('.app-top-bread')).toContainText(enMessages.archive.title);
    await expect(page.locator('.page-subtitle')).toHaveText(enMessages.archive.subtitle);
    await expect(page.locator('#archive-tab-tasks')).toHaveText(enMessages.archive.tabs.tasks);
    await expect(page.locator('#archive-tab-members')).toHaveText(enMessages.archive.tabs.members);
    await expect(page.locator('#archive-tab-boards')).toHaveCount(0);
    await expect(page.locator('section.archive-retention-bar')).toContainText(
      enMessages.archive.retentionTitle,
    );
    assertNoRawTranslationKeys(await page.locator('#main-content').innerText());

    const switchToViPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
    );
    await page.locator('.app-side .app-side-lang').getByRole('button', { name: 'VI', exact: true }).click();
    expect((await switchToViPromise).status()).toBe(200);
    await expect(page.locator('.app-top-bread')).toContainText(viMessages.archive.title);
    await expect(page.locator('.page-subtitle')).toHaveText(viMessages.archive.subtitle);
    assertNoRawTranslationKeys(await page.locator('#main-content').innerText());

    await tracker.assertClean();
  });
});
