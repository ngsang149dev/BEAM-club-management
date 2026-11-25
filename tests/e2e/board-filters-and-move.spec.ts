import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
  returnTo = '/boards',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

function getColumnSection(page: Page, columnName: string): Locator {
  return page.locator('section.kanban-col', {
    has: page.locator('h2.kanban-col-name', {
      hasText: new RegExp(`^${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    }),
  });
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
        dueAt: pastDueOne,
        priority: 1,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: taskUpcomingMoveId,
        boardId: boardAlphaId,
        columnId: colDoingId,
        title: taskUpcomingMoveTitle,
        description: 'Upcoming task assigned to member without member.view',
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

    await signInAs(page, adminStudentId, '/boards');

    const searchInput = page.getByLabel(viMessages.boards.searchLabel, { exact: true });
    const searchAlphaPromise = page.waitForResponse((res) => {
      if (!res.url().includes('/api/v1/boards') || res.status() !== 200) return false;
      return new URL(res.url()).searchParams.get('q') === boardAlphaName;
    });
    await searchInput.fill(boardAlphaName);
    const adminSearchRes = await searchAlphaPromise;
    adminResponses.push(await adminSearchRes.text());

    const alphaTileAdmin = page.locator('article.board-tile', { hasText: boardAlphaName });
    await expect(alphaTileAdmin).toBeVisible();
    await expect(page.locator('article.board-tile', { hasText: boardBetaName })).toHaveCount(0);
    // Admin sees all 4 tasks (including 1 hidden + 1 in Done); only 2 are overdue (Done excluded)
    await expect(alphaTileAdmin).toContainText('4 task');
    await expect(alphaTileAdmin).toContainText('2 quá hạn');

    // Clearing search restores other boards (served from query cache or server)
    await searchInput.fill('');
    await expect(page.locator('article.board-tile', { hasText: boardBetaName })).toBeVisible();

    // Dept A member also sees the hidden task assigned to Dept A
    const deptCtx = await browser.newContext();
    const deptPage = await deptCtx.newPage();
    const deptTracker = await attachRuntimeErrorTracker(deptPage);
    try {
      await signInAs(deptPage, deptMemberStudentId, '/boards');
      const deptSearchPromise = deptPage.waitForResponse((res) => {
        if (!res.url().includes('/api/v1/boards') || res.status() !== 200) return false;
        return new URL(res.url()).searchParams.get('q') === boardAlphaName;
      });
      await deptPage.getByLabel(viMessages.boards.searchLabel, { exact: true }).fill(boardAlphaName);
      await deptSearchPromise;

      const alphaTileDept = deptPage.locator('article.board-tile', { hasText: boardAlphaName });
      await expect(alphaTileDept).toContainText('4 task');
      await expect(alphaTileDept).toContainText('2 quá hạn');
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
      const nvSearchPromise = nonViewerPage.waitForResponse((res) => {
        if (!res.url().includes('/api/v1/boards') || res.status() !== 200) return false;
        return new URL(res.url()).searchParams.get('q') === boardAlphaName;
      });
      await nonViewerPage
        .getByLabel(viMessages.boards.searchLabel, { exact: true })
        .fill(boardAlphaName);
      const nvSearchRes = await nvSearchPromise;
      nonViewerResponses.push(await nvSearchRes.text());

      const alphaTileNv = nonViewerPage.locator('article.board-tile', { hasText: boardAlphaName });
      await expect(alphaTileNv).toBeVisible();
      await expect(alphaTileNv).toContainText('3 task');
      await expect(alphaTileNv).toContainText('1 quá hạn');

      const bodyText = await nonViewerPage.locator('body').innerText();
      assertZeroPiiInPayloads([...nonViewerResponses, bodyText], sensitiveValues);
      await nonViewerTracker.assertClean();
    } finally {
      await nonViewerCtx.close();
    }

    assertZeroPiiInPayloads(adminResponses, sensitiveValues);
    await tracker.assertClean();
  });

  test('S04 filters, sort, URL reload persistence, DnD pause notice, drawer close URL retention, and no-member.view assignee hiding', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await signInAs(page, leadStudentId, `/boards/${boardAlphaId}`);

    await expect(getColumnSection(page, 'Todo')).toBeVisible();
    await expect(page.getByText(viMessages.boards.dndPausedNotice)).toHaveCount(0);

    // Done-column task with past dueAt MUST NOT render overdue warning/danger urgency styling
    const doneCard = getColumnSection(page, 'Done').locator('article.kanban-card', {
      hasText: taskDoneOverdueTitle,
    });
    await expect(doneCard).toBeVisible();
    await expect(doneCard).not.toHaveClass(/is-overdue/);
    await expect(doneCard.locator('.ui-due')).toHaveClass(/is-done/);
    await expect(doneCard.locator('.ui-due')).not.toHaveClass(/is-overdue/);
    await expect(doneCard).not.toContainText(viMessages.tasks.overdueBadge);

    // 1. Search q matching description (desc-needle-...)
    const searchInput = page.getByLabel(viMessages.boards.filterSearchLabel, { exact: true });
    const qFilterPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes(`boardId=${boardAlphaId}`) &&
        res.url().includes(encodeURIComponent(`desc-needle-${suffix}`)) &&
        res.status() === 200,
    );
    await searchInput.fill(`desc-needle-${suffix}`);
    await qFilterPromise;

    await expect(page.getByText(viMessages.boards.dndPausedNotice)).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle })).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskDoneOverdueTitle })).toHaveCount(0);
    await expect(page.locator('article.kanban-card', { hasText: taskUpcomingMoveTitle })).toHaveCount(0);
    await expect(getColumnSection(page, 'Todo')).toContainText('1 task');

    // Reset filters -> DnD notice disappears and all public tasks return
    await page.getByRole('button', { name: viMessages.boards.dndPausedReset }).click();
    await expect(page.getByText(viMessages.boards.dndPausedNotice)).toHaveCount(0);
    await expect(page.locator('article.kanban-card', { hasText: taskDoneOverdueTitle })).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskUpcomingMoveTitle })).toBeVisible();

    // 2. Priority = 4 (Khẩn)
    const prioritySelect = page.getByLabel(viMessages.boards.filterPriorityLabel, { exact: true });
    const prioPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes('priority=4') &&
        res.status() === 200,
    );
    await prioritySelect.selectOption('4');
    await prioPromise;
    await expect(page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle })).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskUpcomingMoveTitle })).toHaveCount(0);
    await expect(page.locator('article.kanban-card', { hasText: taskDoneOverdueTitle })).toHaveCount(0);

    // 3. dueStatus=overdue (confirms Done task excluded even when priority filter cleared)
    await page.getByRole('button', { name: viMessages.boards.clearFilters }).click();
    const dueSelect = page.getByLabel(viMessages.boards.filterDueLabel, { exact: true });
    const duePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes('dueStatus=overdue') &&
        res.status() === 200,
    );
    await dueSelect.selectOption('overdue');
    await duePromise;
    await expect(page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle })).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskDoneOverdueTitle })).toHaveCount(0);
    await expect(page.locator('article.kanban-card', { hasText: taskUpcomingMoveTitle })).toHaveCount(0);

    // 4. departmentId filter
    const deptSelect = page.getByLabel(viMessages.boards.filterDepartmentLabel, { exact: true });
    const deptPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes(`departmentId=${deptAId}`) &&
        res.status() === 200,
    );
    await deptSelect.selectOption(deptAId);
    await deptPromise;
    await expect(page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle })).toBeVisible();

    // 5. assigneeId filter (for lead WITH member.view)
    const assigneeSelect = page.getByLabel(viMessages.boards.filterAssigneeLabel, { exact: true });
    await expect(assigneeSelect).toBeVisible();
    const assigneePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes(`assigneeId=${deptMemberUserId}`) &&
        res.status() === 200,
    );
    await assigneeSelect.selectOption(deptMemberUserId);
    await assigneePromise;
    await expect(page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle })).toBeVisible();

    // 6. sortBy & sortOrder + URL reload survival + TaskDetailDrawer close retention
    await page.getByRole('button', { name: viMessages.boards.clearFilters }).click();
    const sortBySelect = page.getByLabel(viMessages.boards.sortByLabel, { exact: true });
    const sortOrderSelect = page.getByLabel(viMessages.boards.sortOrderLabel, { exact: true });

    await prioritySelect.selectOption('4');
    await expect(page).toHaveURL(/priority=4/);

    const dueFilterAgain = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes('priority=4') &&
        res.url().includes('dueStatus=overdue') &&
        res.status() === 200,
    );
    await dueSelect.selectOption('overdue');
    await dueFilterAgain;

    const sortByPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/tasks') && res.url().includes('sortBy=dueAt') && res.status() === 200,
    );
    await sortBySelect.selectOption('dueAt');
    await sortByPromise;

    const sortOrderPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/tasks') && res.url().includes('sortOrder=desc') && res.status() === 200,
    );
    await sortOrderSelect.selectOption('desc');
    await sortOrderPromise;

    await expect(page).toHaveURL(/priority=4/);
    await expect(page).toHaveURL(/dueStatus=overdue/);
    await expect(page).toHaveURL(/sortBy=dueAt/);
    await expect(page).toHaveURL(/sortOrder=desc/);

    // Reload and confirm filter/sort params & DnD-paused banner survive
    const reloadTasksPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes('priority=4') &&
        res.url().includes('dueStatus=overdue') &&
        res.url().includes('sortBy=dueAt') &&
        res.url().includes('sortOrder=desc') &&
        res.status() === 200,
    );
    await page.reload();
    await reloadTasksPromise;

    await expect(page).toHaveURL(/priority=4/);
    await expect(page).toHaveURL(/dueStatus=overdue/);
    await expect(page).toHaveURL(/sortBy=dueAt/);
    await expect(page).toHaveURL(/sortOrder=desc/);
    await expect(prioritySelect).toHaveValue('4');
    await expect(dueSelect).toHaveValue('overdue');
    await expect(sortBySelect).toHaveValue('dueAt');
    await expect(sortOrderSelect).toHaveValue('desc');
    await expect(page.getByText(viMessages.boards.dndPausedNotice)).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle })).toBeVisible();
    await expect(page.locator('article.kanban-card', { hasText: taskDoneOverdueTitle })).toHaveCount(0);

    // Open and close TaskDetailDrawer -> active filters remain in URL
    const cardToOpen = page.locator('article.kanban-card', { hasText: taskPublicOverdueTitle });
    await cardToOpen.locator('button.kanban-card-open').click();
    const drawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);

    await expect(page).toHaveURL(/priority=4/);
    await expect(page).toHaveURL(/dueStatus=overdue/);
    await expect(page).toHaveURL(/sortBy=dueAt/);
    await expect(page).toHaveURL(/sortOrder=desc/);

    // Sort-only (without filters) also pauses DnD and returns tasks sorted by priority desc
    await page.getByRole('button', { name: viMessages.boards.dndPausedReset }).click();
    const sortOnlyPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes('sortBy=priority') &&
        res.status() === 200,
    );
    await sortBySelect.selectOption('priority');
    await sortOnlyPromise;
    const sortDescPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/tasks') &&
        res.url().includes('sortBy=priority') &&
        res.url().includes('sortOrder=desc') &&
        res.status() === 200,
    );
    await sortOrderSelect.selectOption('desc');
    const sortDescRes = await sortDescPromise;
    const sortDescBody = (await sortDescRes.json()) as { items: Array<{ priority: number }> };
    expect(sortDescBody.items.map((item) => item.priority)).toEqual([4, 3, 1]);
    await expect(page.getByText(viMessages.boards.dndPausedNotice)).toBeVisible();

    // User WITHOUT member.view: does NOT see assignee select and triggers ZERO /api/v1/members requests
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
      await expect(getColumnSection(noViewPage, 'Doing')).toBeVisible();
      await expect(
        noViewPage.getByLabel(viMessages.boards.filterAssigneeLabel, { exact: true }),
      ).toHaveCount(0);
      expect(memberRequests).toEqual([]);
      await noViewTracker.assertClean();
    } finally {
      await noViewCtx.close();
    }

    await tracker.assertClean();
  });

  test('S04 card menu "Chuyển tới cột…" moves task while filtered, persists across reload, records task_events, and enforces AC-15 404 + zero PII', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const interceptedPayloads: string[] = [];

    await signInAs(page, noMemberViewStudentId, `/boards/${boardAlphaId}`);
    await expect(getColumnSection(page, 'Doing')).toBeVisible();

    // Hidden task must never render in DOM for non-viewer
    await expect(page.locator('article.kanban-card', { hasText: taskHiddenOverdueTitle })).toHaveCount(0);

    // Filter to taskUpcomingMoveTitle (DnD paused) and move via ⋯ -> "Chuyển tới cột…" without opening TaskDetailDrawer
    const filterQPromise = page.waitForResponse((res) => {
      if (!res.url().includes('/api/v1/tasks') || res.status() !== 200) return false;
      return new URL(res.url()).searchParams.get('q') === taskUpcomingMoveTitle;
    });
    await page
      .getByLabel(viMessages.boards.filterSearchLabel, { exact: true })
      .fill(taskUpcomingMoveTitle);
    const filterQRes = await filterQPromise;
    interceptedPayloads.push(await filterQRes.text());
    await expect(page.getByText(viMessages.boards.dndPausedNotice)).toBeVisible();

    const targetCard = getColumnSection(page, 'Doing').locator('article.kanban-card', {
      hasText: taskUpcomingMoveTitle,
    });
    await expect(targetCard).toBeVisible();

    await targetCard.getByLabel(viMessages.tasks.taskActionsMenu, { exact: true }).click();
    await expect(targetCard.getByText(viMessages.tasks.moveToColumnMenu)).toBeVisible();
    await expect(targetCard.getByRole('menuitem', { name: 'Doing' })).toHaveCount(0);

    const movePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${taskUpcomingMoveId}/move`) &&
        res.request().method() === 'POST',
    );
    await targetCard.getByRole('menuitem', { name: 'Review' }).click();
    expect((await movePromise).status()).toBe(200);

    // TaskDetailDrawer must NOT have opened
    await expect(page.getByRole('dialog', { name: viMessages.tasks.drawerTitle })).toHaveCount(0);
    await expect(
      getColumnSection(page, 'Review').locator('article.kanban-card', {
        hasText: taskUpcomingMoveTitle,
      }),
    ).toBeVisible();

    // Reset filter and reload -> task remains in Review
    await page.getByRole('button', { name: viMessages.boards.dndPausedReset }).click();
    await page.reload();
    await expect(
      getColumnSection(page, 'Review').locator('article.kanban-card', {
        hasText: taskUpcomingMoveTitle,
      }),
    ).toBeVisible();
    await expect(
      getColumnSection(page, 'Doing').locator('article.kanban-card', {
        hasText: taskUpcomingMoveTitle,
      }),
    ).toHaveCount(0);

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

    // Move taskUpcomingMoveId via ⋯ -> Done when overdue-like? We already moved it to Review; also verify moving to Done removes overdue badge if overdue
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
