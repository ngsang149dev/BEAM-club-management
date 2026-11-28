import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  columns,
  departments,
  loginAttempts,
  memberDepartments,
  permissions,
  profiles,
  sessions,
  taskAssignees,
  taskDepartments,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { PERMISSIONS } from '@/lib/permissions';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import viMessages from '../../messages/vi.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];

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

async function switchCalendarToYear(page: Page, targetYear: number): Promise<void> {
  const yearLabel = page.locator('.hcal-year-label');
  await expect(yearLabel).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    const currentYear = Number((await yearLabel.innerText()).trim());
    if (currentYear === targetYear) return;
    const buttonLabel =
      currentYear > targetYear ? viMessages.calendar.prevYear : viMessages.calendar.nextYear;
    await page.getByLabel(buttonLabel, { exact: true }).click();
    const expectedNextYear = currentYear > targetYear ? currentYear - 1 : currentYear + 1;
    await expect(yearLabel).toHaveText(String(expectedNextYear));
  }
  await expect(yearLabel).toHaveText(String(targetYear));
}

function assertZeroPiiInPayloads(
  payloads: readonly string[],
  sensitiveValues: readonly string[],
): void {
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

test.describe('E6 Board Search/Counts, Task Filters/Sort/URL Sync & Card Column Move E2E', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);

  const adminUserId = randomUUID();
  const leadUserId = randomUUID();
  const deptMemberUserId = randomUUID();
  const noMemberViewUserId = randomUUID();

  const deptAId = randomUUID();
  const deptBId = randomUUID();

  const adminStudentId = `MSSV-E6-ADM-${suffix}`;
  const leadStudentId = `MSSV-E6-LEAD-${suffix}`;
  const deptMemberStudentId = `MSSV-E6-DMEM-${suffix}`;
  const noMemberViewStudentId = `MSSV-E6-NOVW-${suffix}`;

  const adminEmail = `e6-admin-${suffix}@eiu.edu.vn`;
  const leadEmail = `e6-lead-${suffix}@eiu.edu.vn`;
  const deptMemberEmail = `e6-dmem-${suffix}@eiu.edu.vn`;
  const noMemberViewEmail = `e6-novw-${suffix}@eiu.edu.vn`;

  const adminFullName = `E6 Admin ${suffix}`;
  const leadFullName = `E6 Lead ${suffix}`;
  const deptMemberFullName = `E6 DeptMember ${suffix}`;
  const noMemberViewFullName = `E6 NoMemberView ${suffix}`;

  const deptAName = `Ban E6 Alpha ${suffix}`;
  const deptBName = `Ban E6 Beta ${suffix}`;

  const trackedUserIds = [adminUserId, leadUserId, deptMemberUserId, noMemberViewUserId];
  const trackedStudentIds = [
    adminStudentId,
    leadStudentId,
    deptMemberStudentId,
    noMemberViewStudentId,
  ];
  const trackedDeptIds = [deptAId, deptBId];
  const trackedBoardIds: string[] = [];
  const trackedTaskIds: string[] = [];

  const sensitiveValues = [
    ...trackedStudentIds,
    adminEmail,
    leadEmail,
    deptMemberEmail,
    noMemberViewEmail,
  ];

  const boardAlphaId = randomUUID();
  const boardBetaId = randomUUID();
  const boardAlphaName = `Alpha E6 Board ${suffix}`;
  const boardBetaName = `Beta E6 Other ${suffix}`;

  const colTodoId = randomUUID();
  const colDoingId = randomUUID();
  const colReviewId = randomUUID();
  const colDoneId = randomUUID();

  const betaTodoId = randomUUID();
  const betaDoneId = randomUUID();

  const taskPublicOverdueId = randomUUID();
  const taskDoneOverdueId = randomUUID();
  const taskUpcomingMoveId = randomUUID();
  const taskHiddenOverdueId = randomUUID();

  const taskPublicOverdueTitle = `Task E6 Public Overdue ${suffix}`;
  const taskPublicOverdueDesc = `desc-needle-${suffix} urgent audit target`;
  const taskDoneOverdueTitle = `Task E6 Done Overdue ${suffix}`;
  const taskUpcomingMoveTitle = `Task E6 Upcoming Move ${suffix}`;
  const taskHiddenOverdueTitle = `Task E6 Hidden Secret ${suffix}`;

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

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
        id: deptMemberUserId,
        studentId: deptMemberStudentId,
        email: deptMemberEmail,
        fullName: deptMemberFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: noMemberViewUserId,
        studentId: noMemberViewStudentId,
        email: noMemberViewEmail,
        fullName: noMemberViewFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      ...(['board.create', 'board.update', 'task.create', 'task.assign', 'task.update_any', 'member.view'] as const).map(
        (code) => ({
          userId: leadUserId,
          permissionCode: code,
          grantedBy: adminUserId,
        }),
      ),
      ...(['member.view', 'task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: deptMemberUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      // Deliberately omit member.view for noMemberViewUserId
      ...(['task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: noMemberViewUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
    ]);

    await db.insert(memberDepartments).values({
      userId: deptMemberUserId,
      departmentId: deptAId,
    });

    trackedBoardIds.push(boardAlphaId, boardBetaId);
    await db.insert(boards).values([
      {
        id: boardAlphaId,
        name: boardAlphaName,
        departmentId: deptAId,
        createdBy: adminUserId,
      },
      {
        id: boardBetaId,
        name: boardBetaName,
        departmentId: deptBId,
        createdBy: adminUserId,
      },
    ]);

    await db.insert(columns).values([
      { id: colTodoId, boardId: boardAlphaId, name: 'Todo', orderIndex: 0 },
      { id: colDoingId, boardId: boardAlphaId, name: 'Doing', orderIndex: 1 },
      { id: colReviewId, boardId: boardAlphaId, name: 'Review', orderIndex: 2 },
      { id: colDoneId, boardId: boardAlphaId, name: 'Done', orderIndex: 3 },
      { id: betaTodoId, boardId: boardBetaId, name: 'Todo', orderIndex: 0 },
      { id: betaDoneId, boardId: boardBetaId, name: 'Done', orderIndex: 1 },
    ]);

    const pastDueOne = new Date('2025-01-10T00:00:00.000Z');
    const pastDueTwo = new Date('2025-01-12T00:00:00.000Z');
    const futureDue = new Date('2028-06-15T00:00:00.000Z');

    trackedTaskIds.push(
      taskPublicOverdueId,
      taskDoneOverdueId,
      taskUpcomingMoveId,
      taskHiddenOverdueId,
    );

    await db.insert(tasks).values([
      {
        id: taskPublicOverdueId,
        boardId: boardAlphaId,
        columnId: colTodoId,
        title: taskPublicOverdueTitle,
        description: taskPublicOverdueDesc,
        startAt: pastDueOne,
        dueAt: pastDueOne,
        priority: 4,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: taskDoneOverdueId,
        boardId: boardAlphaId,
        columnId: colDoneId,
        title: taskDoneOverdueTitle,
        description: 'Done task with past due date',
        startAt: pastDueOne,
        dueAt: pastDueOne,
        priority: 1,
        position: '1000',
        isCompleted: true,
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: taskUpcomingMoveId,
        boardId: boardAlphaId,
        columnId: colDoingId,
        title: taskUpcomingMoveTitle,
        description: 'Upcoming task assigned to member without member.view',
        startAt: futureDue,
        dueAt: futureDue,
        priority: 3,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: taskHiddenOverdueId,
        boardId: boardAlphaId,
        columnId: colTodoId,
        title: taskHiddenOverdueTitle,
        description: 'Confidential overdue task only for admin and deptA',
        startAt: pastDueTwo,
        dueAt: pastDueTwo,
        priority: 4,
        position: '2000',
        isHidden: true,
        createdBy: adminUserId,
      },
    ]);

    await db.insert(taskAssignees).values([
      { taskId: taskPublicOverdueId, userId: deptMemberUserId },
      { taskId: taskUpcomingMoveId, userId: noMemberViewUserId },
    ]);

    await db.insert(taskDepartments).values([
      { taskId: taskPublicOverdueId, departmentId: deptAId },
      { taskId: taskDoneOverdueId, departmentId: deptBId },
      { taskId: taskHiddenOverdueId, departmentId: deptAId },
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
      if (trackedTaskIds.length > 0) {
        await db.delete(taskDepartments).where(inArray(taskDepartments.taskId, trackedTaskIds));
        await db.delete(taskAssignees).where(inArray(taskAssignees.taskId, trackedTaskIds));
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
        .where(inArray(profiles.id, [leadUserId, deptMemberUserId, noMemberViewUserId]));

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

  test('S03 server search and per-viewer counts exclude hidden tasks for non-viewers and exclude Done tasks from overdueTaskCount', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const adminResponses: string[] = [];

    // /boards redirects to /tasks
    await signInAs(page, adminStudentId, '/boards');
    await switchCalendarToYear(page, 2025);

    const adminBoardsRes = await page.request.get(
      `/api/v1/boards?q=${encodeURIComponent(boardAlphaName)}`,
    );
    expect(adminBoardsRes.status()).toBe(200);
    const adminBoardsText = await adminBoardsRes.text();
    adminResponses.push(adminBoardsText);
    const adminBoardsJson = JSON.parse(adminBoardsText) as {
      items: Array<{ id: string; visibleTaskCount: number; overdueTaskCount: number }>;
    };
    const alphaTileAdmin = adminBoardsJson.items.find((item) => item.id === boardAlphaId);
    expect(alphaTileAdmin).toBeDefined();
    // Admin sees all 4 tasks (including 1 hidden + 1 in Done); only 2 are overdue (Done excluded)
    expect(alphaTileAdmin?.visibleTaskCount).toBe(4);
    expect(alphaTileAdmin?.overdueTaskCount).toBe(2);

    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`),
    ).toBeVisible();
    await expect(page.locator(`.hcal-task-bar[data-task-id="${taskDoneOverdueId}"]`)).toBeVisible();
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskHiddenOverdueId}"]`),
    ).toBeVisible();

    // Dept A member also sees the hidden task assigned to Dept A
    const deptCtx = await browser.newContext();
    const deptPage = await deptCtx.newPage();
    const deptTracker = await attachRuntimeErrorTracker(deptPage);
    try {
      await signInAs(deptPage, deptMemberStudentId, '/boards');
      await switchCalendarToYear(deptPage, 2025);
      const deptBoardsRes = await deptPage.request.get(
        `/api/v1/boards?q=${encodeURIComponent(boardAlphaName)}`,
      );
      expect(deptBoardsRes.status()).toBe(200);
      const deptBoardsJson = (await deptBoardsRes.json()) as {
        items: Array<{ id: string; visibleTaskCount: number; overdueTaskCount: number }>;
      };
      const alphaTileDept = deptBoardsJson.items.find((item) => item.id === boardAlphaId);
      expect(alphaTileDept?.visibleTaskCount).toBe(4);
      expect(alphaTileDept?.overdueTaskCount).toBe(2);
      await expect(
        deptPage.locator(`.hcal-task-bar[data-task-id="${taskHiddenOverdueId}"]`),
      ).toBeVisible();
      await deptTracker.assertClean();
    } finally {
      await deptCtx.close();
    }

    // Non-viewer member (not creator, not direct assignee, not Dept A member) sees 3 tasks and 1 overdue
    const nonViewerCtx = await browser.newContext();
    const nonViewerPage = await nonViewerCtx.newPage();
    const nonViewerTracker = await attachRuntimeErrorTracker(nonViewerPage);
    const nonViewerResponses: string[] = [];
    try {
      await signInAs(nonViewerPage, noMemberViewStudentId, '/boards');
      await switchCalendarToYear(nonViewerPage, 2025);
      const nvBoardsRes = await nonViewerPage.request.get(
        `/api/v1/boards?q=${encodeURIComponent(boardAlphaName)}`,
      );
      expect(nvBoardsRes.status()).toBe(200);
      const nvBoardsText = await nvBoardsRes.text();
      nonViewerResponses.push(nvBoardsText);
      const nvBoardsJson = JSON.parse(nvBoardsText) as {
        items: Array<{ id: string; visibleTaskCount: number; overdueTaskCount: number }>;
      };
      const alphaTileNv = nvBoardsJson.items.find((item) => item.id === boardAlphaId);
      expect(alphaTileNv?.visibleTaskCount).toBe(3);
      expect(alphaTileNv?.overdueTaskCount).toBe(1);

      await expect(
        nonViewerPage.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`),
      ).toBeVisible();
      await expect(
        nonViewerPage.locator(`.hcal-task-bar[data-task-id="${taskHiddenOverdueId}"]`),
      ).toHaveCount(0);

      const bodyText = await nonViewerPage.locator('body').innerText();
      assertZeroPiiInPayloads([...nonViewerResponses, bodyText], sensitiveValues);
      await nonViewerTracker.assertClean();
    } finally {
      await nonViewerCtx.close();
    }

    assertZeroPiiInPayloads(adminResponses, sensitiveValues);
    await tracker.assertClean();
  });

  test('S04 calendar & API filters, URL reload persistence, modal close URL retention, and no-member.view assignee hiding', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await signInAs(page, leadStudentId, `/boards/${boardAlphaId}`);
    await switchCalendarToYear(page, 2025);

    // Done task with past dueAt MUST render .deadline-done and NOT .deadline-overdue
    const doneBar = page.locator(`.hcal-task-bar[data-task-id="${taskDoneOverdueId}"]`);
    await expect(doneBar).toBeVisible();
    await expect(doneBar).toHaveClass(/deadline-done/);
    await expect(doneBar).not.toHaveClass(/deadline-overdue/);
    await expect(doneBar).toContainText(viMessages.tasks.deadlineBadgeDone);
    await expect(doneBar).not.toContainText(
      viMessages.calendar.filterOverdue.replace(/\s*\(\{count\}\)/, ''),
    );

    // Verify backend /api/v1/tasks filter & sort parameters still honor priority, dueStatus, assigneeId, sortBy/sortOrder
    const apiPrioRes = await page.request.get(
      `/api/v1/tasks?boardId=${boardAlphaId}&priority=4`,
    );
    expect(apiPrioRes.status()).toBe(200);
    const apiPrioIds = ((await apiPrioRes.json()) as { items: Array<{ id: string }> }).items.map(
      (i) => i.id,
    );
    expect(apiPrioIds).toContain(taskPublicOverdueId);
    expect(apiPrioIds).not.toContain(taskDoneOverdueId);
    expect(apiPrioIds).not.toContain(taskUpcomingMoveId);

    const apiAssigneeRes = await page.request.get(
      `/api/v1/tasks?boardId=${boardAlphaId}&assigneeId=${deptMemberUserId}`,
    );
    expect(apiAssigneeRes.status()).toBe(200);
    const apiAssigneeIds = (
      (await apiAssigneeRes.json()) as { items: Array<{ id: string }> }
    ).items.map((i) => i.id);
    expect(apiAssigneeIds).toEqual([taskPublicOverdueId]);

    const apiSortRes = await page.request.get(
      `/api/v1/tasks?boardId=${boardAlphaId}&sortBy=priority&sortOrder=desc`,
    );
    expect(apiSortRes.status()).toBe(200);
    const apiSortPriorities = (
      (await apiSortRes.json()) as { items: Array<{ priority: number }> }
    ).items.map((i) => i.priority);
    expect(apiSortPriorities).toEqual([4, 3, 1]);

    // 1. Search q matching description (desc-needle-...)
    const searchInput = page.getByLabel(viMessages.calendar.searchLabel, { exact: true });
    await searchInput.fill(`desc-needle-${suffix}`);
    await expect(page).toHaveURL(new RegExp(`q=desc-needle-${suffix}`));
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskDoneOverdueId}"]`),
    ).toHaveCount(0);

    // Clear search -> Done task returns
    await searchInput.fill('');
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.locator(`.hcal-task-bar[data-task-id="${taskDoneOverdueId}"]`)).toBeVisible();

    // 2. Deadline filter pill = overdue (confirms Done task excluded)
    const filterGroup = page.getByRole('group', { name: viMessages.calendar.deadlineFilterGroup });
    await filterGroup
      .locator('button', { hasText: viMessages.calendar.filterOverdue.replace(/\s*\(\{count\}\)/, '') })
      .click();
    await expect(page).toHaveURL(/deadline=overdue/);
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskDoneOverdueId}"]`),
    ).toHaveCount(0);

    // 3. departmentId filter
    const deptSelect = page.getByLabel(viMessages.calendar.departmentFilterLabel, { exact: true });
    await deptSelect.selectOption(deptAId);
    await expect(page).toHaveURL(new RegExp(`dept=${deptAId}`));
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`),
    ).toBeVisible();

    // 4. Add q back + reload -> verify year, deadline, dept, q all survive reload
    await searchInput.fill(`desc-needle-${suffix}`);
    await expect(page).toHaveURL(new RegExp(`q=desc-needle-${suffix}`));
    await expect(page).toHaveURL(/year=2025/);
    await expect(page).toHaveURL(/deadline=overdue/);
    await expect(page).toHaveURL(new RegExp(`dept=${deptAId}`));

    await page.reload();
    await expect(page).toHaveURL(/year=2025/);
    await expect(page).toHaveURL(/deadline=overdue/);
    await expect(page).toHaveURL(new RegExp(`dept=${deptAId}`));
    await expect(page).toHaveURL(new RegExp(`q=desc-needle-${suffix}`));
    await expect(deptSelect).toHaveValue(deptAId);
    await expect(searchInput).toHaveValue(`desc-needle-${suffix}`);
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskDoneOverdueId}"]`),
    ).toHaveCount(0);

    // Open and close near-fullscreen TaskDetailDrawer modal -> active filters remain in URL
    await page.locator(`.hcal-task-bar[data-task-id="${taskPublicOverdueId}"]`).click();
    const modal = page.locator('aside.task-modal-shell[role="dialog"]');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: viMessages.common.close }).click();
    await expect(modal).toHaveCount(0);

    await expect(page).toHaveURL(/year=2025/);
    await expect(page).toHaveURL(/deadline=overdue/);
    await expect(page).toHaveURL(new RegExp(`dept=${deptAId}`));
    await expect(page).toHaveURL(new RegExp(`q=desc-needle-${suffix}`));

    // User WITHOUT member.view: triggers ZERO /api/v1/members requests on /tasks and modal
    const noViewCtx = await browser.newContext();
    const noViewPage = await noViewCtx.newPage();
    const noViewTracker = await attachRuntimeErrorTracker(noViewPage);
    const memberRequests: Array<{ url: string; status: number }> = [];
    noViewPage.on('response', (res) => {
      if (res.url().includes('/api/v1/members')) {
        memberRequests.push({ url: res.url(), status: res.status() });
      }
    });

    try {
      await signInAs(noViewPage, noMemberViewStudentId, `/boards/${boardAlphaId}`);
      await switchCalendarToYear(noViewPage, 2028);
      const upcomingBar = noViewPage.locator(`.hcal-task-bar[data-task-id="${taskUpcomingMoveId}"]`);
      await expect(upcomingBar).toBeVisible();
      await upcomingBar.click();
      await expect(noViewPage.locator('aside.task-modal-shell[role="dialog"]')).toBeVisible();
      expect(memberRequests).toEqual([]);
      await noViewTracker.assertClean();
    } finally {
      await noViewCtx.close();
    }

    await tracker.assertClean();
  });

  test('S04 task move API persists column & task_events without PII, and enforces AC-15 404 on hidden task API + UI', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const interceptedPayloads: string[] = [];

    // Legacy /boards/{id} redirects to /tasks
    await signInAs(page, noMemberViewStudentId, `/boards/${boardAlphaId}`);
    await switchCalendarToYear(page, 2025);

    // Hidden task must never render in DOM for non-viewer
    await expect(
      page.locator(`.hcal-task-bar[data-task-id="${taskHiddenOverdueId}"]`),
    ).toHaveCount(0);
    await expect(page.getByText(taskHiddenOverdueTitle)).toHaveCount(0);

    // Move taskUpcomingMoveId via /api/v1/tasks/{id}/move -> persists in DB & records task_events without PII
    const moveRes = await page.request.post(`/api/v1/tasks/${taskUpcomingMoveId}/move`, {
      data: {
        columnId: colReviewId,
        version: 1,
      },
    });
    expect(moveRes.status()).toBe(200);
    const moveBodyText = await moveRes.text();
    interceptedPayloads.push(moveBodyText);

    const [movedDbTask] = await db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(eq(tasks.id, taskUpcomingMoveId))
      .limit(1);
    expect(movedDbTask?.columnId).toBe(colReviewId);

    // Verify task_events recorded the move cleanly without PII
    const moveEvents = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskUpcomingMoveId));
    const moveEvent = moveEvents.find((evt) => evt.type === 'task.moved');
    expect(moveEvent).toBeDefined();
    expect(moveEvent?.actorId).toBe(noMemberViewUserId);
    expect(moveEvent?.boardId).toBe(boardAlphaId);
    const serializedEvent = JSON.stringify(moveEvent);
    expect(serializedEvent).toContain(colDoingId);
    expect(serializedEvent).toContain(colReviewId);
    assertZeroPiiInPayloads(
      [serializedEvent],
      [...sensitiveValues, adminFullName, leadFullName, deptMemberFullName, noMemberViewFullName],
    );

    // Security & Privacy AC-15: non-viewer API checks
    const boardDetailRes = await page.request.get(`/api/v1/boards/${boardAlphaId}`);
    expect(boardDetailRes.status()).toBe(200);
    const boardDetailJson = (await boardDetailRes.json()) as {
      board: {
        visibleTaskCount: number;
        overdueTaskCount: number;
        tasks: Array<{ id: string }>;
      };
    };
    expect(boardDetailJson.board.visibleTaskCount).toBe(3);
    expect(boardDetailJson.board.overdueTaskCount).toBe(1);
    expect(boardDetailJson.board.tasks.map((t) => t.id)).not.toContain(taskHiddenOverdueId);

    const tasksListRes = await page.request.get(`/api/v1/tasks?boardId=${boardAlphaId}`);
    expect(tasksListRes.status()).toBe(200);
    const tasksListJson = (await tasksListRes.json()) as { items: Array<{ id: string }> };
    expect(tasksListJson.items.map((t) => t.id)).not.toContain(taskHiddenOverdueId);

    const hiddenSearchRes = await page.request.get(
      `/api/v1/tasks?boardId=${boardAlphaId}&q=${encodeURIComponent(taskHiddenOverdueTitle)}`,
    );
    expect(hiddenSearchRes.status()).toBe(200);
    const hiddenSearchJson = (await hiddenSearchRes.json()) as { items: unknown[] };
    expect(hiddenSearchJson.items).toHaveLength(0);

    const hiddenDetailRes = await page.request.get(`/api/v1/tasks/${taskHiddenOverdueId}`);
    expect(hiddenDetailRes.status()).toBe(404);

    // Direct UI /boards/{id}?task={hiddenId} redirects to /tasks?task={hiddenId} & renders 404 ErrorState
    await page.goto(`/boards/${boardAlphaId}?task=${taskHiddenOverdueId}`);
    await page.waitForURL(`${BASE_ORIGIN}/tasks?task=${taskHiddenOverdueId}`);
    const notFoundModal = page.locator('aside.task-modal-shell[role="dialog"]');
    await expect(notFoundModal).toBeVisible();
    await expect(notFoundModal.getByText(viMessages.errors['404'].code)).toBeVisible();
    await expect(notFoundModal.getByText(viMessages.errors['404'].title)).toBeVisible();
    await expect(notFoundModal.getByText(viMessages.errors['404'].description)).toBeVisible();
    await expect(notFoundModal).not.toContainText(taskHiddenOverdueTitle);

    const domText = await page.locator('body').innerText();
    assertZeroPiiInPayloads(
      [
        ...interceptedPayloads,
        JSON.stringify(boardDetailJson),
        JSON.stringify(tasksListJson),
        domText,
      ],
      sensitiveValues,
    );
    await tracker.assertClean();
  });
});
