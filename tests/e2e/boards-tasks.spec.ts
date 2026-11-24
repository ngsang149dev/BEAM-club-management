import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  departments,
  loginAttempts,
  permissions,
  profiles,
  sessions,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS } from '@/lib/permissions';
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

async function openColumnMenu(columnSection: Locator): Promise<void> {
  await columnSection.getByLabel(viMessages.boards.columnActionsMenu).click();
}

async function openBoardMenu(boardTile: Locator): Promise<void> {
  await boardTile.getByLabel(viMessages.boards.boardActionsMenu).click();
}

async function dragCardToColumn(
  page: Page,
  card: Locator,
  targetColumn: Locator,
  taskId: string,
): Promise<void> {
  const dragArea = card.locator('.kanban-card-signals');
  const laneBody = targetColumn.locator('.kanban-col-body');

  await dragArea.scrollIntoViewIfNeeded();
  await laneBody.scrollIntoViewIfNeeded();

  const startBox = await dragArea.boundingBox();
  const targetBox = await laneBody.boundingBox();
  if (!startBox || !targetBox) {
    throw new Error('Unable to measure drag bounding boxes for Kanban drag-and-drop.');
  }

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + Math.min(48, Math.max(16, targetBox.height / 2));

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 16, startY + 6, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 12 });
  await expect(targetColumn).toHaveClass(/is-drop-target/);

  const moveResponsePromise = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/v1/tasks/${taskId}/move`) &&
      res.request().method() === 'POST',
  );
  await page.mouse.up();
  expect((await moveResponsePromise).status()).toBe(200);
}

function assertZeroPiiInStrings(
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
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

test.describe('Boards, Columns, Tasks & My Tasks E2E (S03, S04, S05, S06)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const leadUserId = randomUUID();
  const basicUserId = randomUUID();
  const deptId = randomUUID();

  const adminStudentId = `MSSV-E5-ADM-${suffix}`;
  const leadStudentId = `MSSV-E5-LEAD-${suffix}`;
  const basicStudentId = `MSSV-E5-BAS-${suffix}`;

  const adminEmail = `e5-admin-${suffix}@eiu.edu.vn`;
  const leadEmail = `e5-lead-${suffix}@eiu.edu.vn`;
  const basicEmail = `e5-basic-${suffix}@eiu.edu.vn`;

  const adminFullName = `E5 Admin ${suffix}`;
  const leadFullName = `E5 Lead ${suffix}`;
  const basicFullName = `E5 Basic ${suffix}`;
  const deptName = `Ban E5 ${suffix}`;

  const sensitiveValues = [
    adminStudentId,
    leadStudentId,
    basicStudentId,
    adminEmail,
    leadEmail,
    basicEmail,
  ];

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

    await db.insert(departments).values({
      id: deptId,
      name: deptName,
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

    const leadPermissionCodes = [
      'board.create',
      'board.update',
      'board.delete',
      'task.create',
      'task.assign',
      'task.update_any',
      'task.delete',
      'member.view',
    ] as const;

    await db.insert(userPermissions).values([
      ...leadPermissionCodes.map((code) => ({
        userId: leadUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
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
          inArray(loginAttempts.studentId, [adminStudentId, leadStudentId, basicStudentId]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const cleanupUserIds = [adminUserId, leadUserId, basicUserId];
      const e2eBoards = await db
        .select({ id: boards.id })
        .from(boards)
        .where(inArray(boards.createdBy, cleanupUserIds));
      const e2eBoardIds = e2eBoards.map((board) => board.id);

      if (e2eBoardIds.length > 0) {
        await db
          .update(tasks)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(inArray(tasks.boardId, e2eBoardIds), isNull(tasks.deletedAt)));
        await db
          .update(boards)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(and(inArray(boards.id, e2eBoardIds), isNull(boards.archivedAt)));
      }

      await db.delete(sessions).where(inArray(sessions.userId, cleanupUserIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, cleanupUserIds));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [adminStudentId, leadStudentId, basicStudentId]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .update(profiles)
        .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
        .where(inArray(profiles.id, [leadUserId, basicUserId]));

      const remainingAdmins = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true), ne(profiles.id, adminUserId)));
      if (remainingAdmins.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
          .where(eq(profiles.id, adminUserId));
      }
    }
    await pool?.end();
  });

  test('manages boards and columns via S03/S04 consolidated menus, enforces WQ-05 409, and hides board mutations from basic member', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 J1 ${suffix}`;
    const renamedBoardName = `Board E5 J1 Renamed ${suffix}`;
    const disposableBoardName = `Board E5 Dispose ${suffix}`;
    const blockingTaskTitle = `Task Blocking Col ${suffix}`;

    await signInAs(page, leadStudentId, '/boards');

    await page.getByRole('button', { name: viMessages.boards.newBoard }).first().click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel(viMessages.boards.boardNameLabel).fill(boardName);
    await createDialog.getByLabel(viMessages.boards.boardDepartmentLabel).selectOption(deptId);

    const createBoardPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/boards') && res.request().method() === 'POST',
    );
    await createDialog.getByRole('button', { name: viMessages.boards.boardCreateSubmit }).click();
    const createBoardRes = await createBoardPromise;
    expect(createBoardRes.status()).toBe(201);
    const createdBoardBody = (await createBoardRes.json()) as { board: { id: string } };
    const boardId = createdBoardBody.board.id;

    const boardTile = page.locator('article.board-tile', { hasText: boardName });
    await expect(boardTile).toBeVisible();
    await expect(boardTile).toContainText(deptName);

    await boardTile.getByRole('link', { name: viMessages.boards.openBoard }).click();
    await page.waitForURL(`${BASE_ORIGIN}/boards/${boardId}`);

    const columnHeadings = page.locator('section.kanban-col h2.kanban-col-name');
    await expect(columnHeadings).toHaveText(['Todo', 'Doing', 'Review', 'Done']);

    // Add column QA
    await page.getByRole('button', { name: `+ ${viMessages.boards.addColumn}` }).click();
    const addColDialog = page.getByRole('dialog');
    await addColDialog.getByLabel(viMessages.boards.columnNameLabel).fill('QA');
    const createQaPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/boards/${boardId}/columns`) &&
        res.request().method() === 'POST',
    );
    await addColDialog.getByRole('button', { name: viMessages.boards.columnCreateSubmit }).click();
    expect((await createQaPromise).status()).toBe(201);
    await expect(columnHeadings).toHaveText(['Todo', 'Doing', 'Review', 'Done', 'QA']);

    // Rename QA -> QA Review via consolidated menu
    const qaCol = getColumnSection(page, 'QA');
    await openColumnMenu(qaCol);
    await qaCol.getByRole('menuitem', { name: viMessages.boards.renameColumn }).click();
    const renameColDialog = page.getByRole('dialog');
    await renameColDialog.getByLabel(viMessages.boards.columnNameLabel).fill('QA Review');
    const renameColPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/columns/') && res.request().method() === 'PATCH',
    );
    await renameColDialog.getByRole('button', { name: viMessages.boards.columnRenameSubmit }).click();
    expect((await renameColPromise).status()).toBe(200);
    await expect(columnHeadings).toHaveText(['Todo', 'Doing', 'Review', 'Done', 'QA Review']);

    // Move QA Review left via consolidated menu and verify reload persistence
    const qaReviewCol = getColumnSection(page, 'QA Review');
    await openColumnMenu(qaReviewCol);
    const reorderPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/boards/${boardId}/columns/order`) &&
        res.request().method() === 'PUT',
    );
    await qaReviewCol
      .getByRole('menuitem', { name: `← ${viMessages.boards.moveColumnLeft}` })
      .click();
    expect((await reorderPromise).status()).toBe(200);
    await expect(columnHeadings).toHaveText(['Todo', 'Doing', 'Review', 'QA Review', 'Done']);

    await page.reload();
    await expect(columnHeadings).toHaveText(['Todo', 'Doing', 'Review', 'QA Review', 'Done']);

    // Create a task inside QA Review, then verify WQ-05 409 COLUMN_NOT_EMPTY when deleting column
    const persistedQaReviewCol = getColumnSection(page, 'QA Review');
    await persistedQaReviewCol
      .getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` })
      .click();
    const createTaskDialog = page.getByRole('dialog');
    await createTaskDialog.getByLabel(viMessages.tasks.titleLabel).fill(blockingTaskTitle);
    const createBlockingTaskPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await createTaskDialog.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    expect((await createBlockingTaskPromise).status()).toBe(201);
    await expect(persistedQaReviewCol.locator('article.kanban-card', { hasText: blockingTaskTitle })).toBeVisible();

    await openColumnMenu(persistedQaReviewCol);
    await persistedQaReviewCol.getByRole('menuitem', { name: viMessages.boards.deleteColumn }).click();
    const deleteQaDialog = page.getByRole('dialog');
    const conflictDeletePromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/columns/') && res.request().method() === 'DELETE',
    );
    await deleteQaDialog.getByRole('button', { name: viMessages.boards.columnDeleteConfirm }).click();
    expect((await conflictDeletePromise).status()).toBe(409);
    await expect(deleteQaDialog.getByRole('alert')).toContainText(viMessages.errors.columnNotEmpty);
    await deleteQaDialog.getByRole('button', { name: viMessages.common.cancel }).click();

    // Add an empty column TempCol and delete it cleanly (200)
    await page.getByRole('button', { name: `+ ${viMessages.boards.addColumn}` }).click();
    const addTempDialog = page.getByRole('dialog');
    await addTempDialog.getByLabel(viMessages.boards.columnNameLabel).fill('TempCol');
    const createTempPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/boards/${boardId}/columns`) &&
        res.request().method() === 'POST',
    );
    await addTempDialog.getByRole('button', { name: viMessages.boards.columnCreateSubmit }).click();
    expect((await createTempPromise).status()).toBe(201);

    const tempCol = getColumnSection(page, 'TempCol');
    await expect(tempCol).toBeVisible();
    await openColumnMenu(tempCol);
    await tempCol.getByRole('menuitem', { name: viMessages.boards.deleteColumn }).click();
    const deleteTempDialog = page.getByRole('dialog');
    const deleteTempPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/columns/') && res.request().method() === 'DELETE',
    );
    await deleteTempDialog.getByRole('button', { name: viMessages.boards.columnDeleteConfirm }).click();
    expect((await deleteTempPromise).status()).toBe(200);
    await expect(getColumnSection(page, 'TempCol')).toHaveCount(0);

    // Return to /boards -> rename board and create+archive disposable board via ⋯ menu
    await page.getByRole('link', { name: new RegExp(viMessages.boards.backToBoards) }).click();
    await page.waitForURL(`${BASE_ORIGIN}/boards`);

    const targetTile = page.locator('article.board-tile', { hasText: boardName });
    await expect(targetTile).toBeVisible();
    await openBoardMenu(targetTile);
    await targetTile.getByRole('menuitem', { name: viMessages.boards.editBoard }).click();
    const editBoardDialog = page.getByRole('dialog');
    await editBoardDialog.getByLabel(viMessages.boards.boardNameLabel).fill(renamedBoardName);
    const renameBoardPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/boards/${boardId}`) && res.request().method() === 'PATCH',
    );
    await editBoardDialog.getByRole('button', { name: viMessages.boards.boardEditSubmit }).click();
    expect((await renameBoardPromise).status()).toBe(200);
    await expect(page.locator('article.board-tile', { hasText: renamedBoardName })).toBeVisible();

    await page.getByRole('button', { name: viMessages.boards.newBoard }).first().click();
    const createDispDialog = page.getByRole('dialog');
    await createDispDialog.getByLabel(viMessages.boards.boardNameLabel).fill(disposableBoardName);
    const createDispPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/boards') && res.request().method() === 'POST',
    );
    await createDispDialog.getByRole('button', { name: viMessages.boards.boardCreateSubmit }).click();
    const createDispRes = await createDispPromise;
    expect(createDispRes.status()).toBe(201);
    const dispBody = (await createDispRes.json()) as { board: { id: string } };
    const disposableBoardId = dispBody.board.id;

    const disposableTile = page.locator('article.board-tile', { hasText: disposableBoardName });
    await expect(disposableTile).toBeVisible();
    await openBoardMenu(disposableTile);
    await disposableTile.getByRole('menuitem', { name: viMessages.boards.archiveBoard }).click();
    const archiveDialog = page.getByRole('dialog');
    const archivePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/boards/${disposableBoardId}`) &&
        res.request().method() === 'DELETE',
    );
    await archiveDialog.getByRole('button', { name: viMessages.boards.archiveConfirm }).click();
    expect((await archivePromise).status()).toBe(200);
    await expect(page.locator('article.board-tile', { hasText: disposableBoardName })).toHaveCount(0);

    // Sign in as basicMember -> verify neither Tạo board nor Tùy chọn board is rendered
    const basicContext = await browser.newContext();
    const basicPage = await basicContext.newPage();
    const basicTracker = await attachRuntimeErrorTracker(basicPage);
    try {
      await signInAs(basicPage, basicStudentId, '/boards');
      await expect(
        basicPage.locator('article.board-tile', { hasText: renamedBoardName }),
      ).toBeVisible();
      await expect(
        basicPage.getByRole('button', { name: viMessages.boards.newBoard }),
      ).toHaveCount(0);
      await expect(basicPage.getByLabel(viMessages.boards.boardActionsMenu)).toHaveCount(0);
      await basicTracker.assertClean();
    } finally {
      await basicContext.close();
    }

    await tracker.assertClean();
  });

  test('creates urgent/overdue and hidden tasks, handles S05 edit, 409 version conflict, real DnD move + task_events, soft-delete, AC-06 403, and hidden 404', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 J2 ${suffix}`;
    const urgentTitle = `Task Urgent ${suffix}`;
    const urgentEditedTitle = `Task Urgent Edited ${suffix}`;
    const urgentConcurrentTitle = `Task Urgent Concurrent ${suffix}`;
    const urgentStaleAttemptTitle = `Task Urgent Stale ${suffix}`;
    const hiddenTitle = `Task Hidden Secret ${suffix}`;
    const disposableTitle = `Task Soft Delete ${suffix}`;

    await signInAs(page, leadStudentId, '/boards');

    const createBoardRes = await page.request.post('/api/v1/boards', {
      data: { name: boardName, departmentId: deptId },
    });
    expect(createBoardRes.status()).toBe(201);
    const createdBoard = (await createBoardRes.json()) as {
      board: { id: string; columns: Array<{ id: string; name: string }> };
    };
    const boardId = createdBoard.board.id;
    const todoColId = createdBoard.board.columns.find((col) => col.name === 'Todo')?.id;
    const doingColId = createdBoard.board.columns.find((col) => col.name === 'Doing')?.id;
    expect(todoColId).toBeTruthy();
    expect(doingColId).toBeTruthy();

    await page.goto(`/boards/${boardId}`);
    const todoCol = getColumnSection(page, 'Todo');
    const doingCol = getColumnSection(page, 'Doing');
    await expect(todoCol).toBeVisible();

    // Create urgent (priority 4) overdue task via S04 CreateTaskModal assigned to basicMember
    await todoCol.getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` }).click();
    const urgentModal = page.getByRole('dialog');
    await urgentModal.getByLabel(viMessages.tasks.titleLabel).fill(urgentTitle);
    await urgentModal.getByLabel(viMessages.tasks.descriptionLabel).fill('Initial urgent description');
    await urgentModal.getByLabel(viMessages.tasks.priorityLabel).selectOption('4');
    await urgentModal.getByLabel(viMessages.tasks.dueAtLabel).fill('2025-01-10');
    await urgentModal
      .locator('label.dept-check-item', { hasText: basicFullName })
      .locator('input[type="checkbox"]')
      .check();

    const createUrgentPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await urgentModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createUrgentRes = await createUrgentPromise;
    expect(createUrgentRes.status()).toBe(201);
    const urgentTaskId = ((await createUrgentRes.json()) as { task: { id: string } }).task.id;

    // Create hidden task NOT assigned to basicMember
    await todoCol.getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` }).click();
    const hiddenModal = page.getByRole('dialog');
    await hiddenModal.getByLabel(viMessages.tasks.titleLabel).fill(hiddenTitle);
    await hiddenModal.getByLabel(viMessages.tasks.isHiddenLabel).check();
    const createHiddenPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await hiddenModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createHiddenRes = await createHiddenPromise;
    expect(createHiddenRes.status()).toBe(201);
    const hiddenTaskId = ((await createHiddenRes.json()) as { task: { id: string } }).task.id;

    // Verify priority .prio-p4 (Khẩn) and overdue .is-overdue (Quá hạn) signals
    const urgentCard = todoCol.locator('article.kanban-card', { hasText: urgentTitle });
    await expect(urgentCard).toHaveClass(/prio-p4/);
    await expect(urgentCard).toHaveClass(/is-overdue/);
    await expect(urgentCard).toContainText(viMessages.priority.urgent);
    await expect(urgentCard).toContainText(viMessages.tasks.overdueBadge);

    const hiddenCard = todoCol.locator('article.kanban-card', { hasText: hiddenTitle });
    await expect(hiddenCard).toHaveClass(/is-hidden/);
    await expect(hiddenCard).toContainText(viMessages.tasks.hiddenBadge);

    // Click card -> open S05 drawer -> update title/description (200)
    const openDetailPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'GET',
    );
    await urgentCard.locator('button.kanban-card-open').click();
    expect((await openDetailPromise).status()).toBe(200);

    const drawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel(viMessages.tasks.titleLabel).fill(urgentEditedTitle);
    await drawer.getByLabel(viMessages.tasks.descriptionLabel).fill('Updated urgent description');

    const patchPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'PATCH',
    );
    const refetchAfterPatchPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'GET',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails }).click();
    expect((await patchPromise).status()).toBe(200);
    expect((await refetchAfterPatchPromise).status()).toBe(200);
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(urgentEditedTitle);

    // Simulate concurrent edit bumping version (2 -> 3), then trigger 409 TASK_VERSION_CONFLICT in open drawer
    const concurrentPatchRes = await page.request.patch(`/api/v1/tasks/${urgentTaskId}`, {
      data: { title: urgentConcurrentTitle, version: 2 },
    });
    expect(concurrentPatchRes.status()).toBe(200);

    await drawer.getByLabel(viMessages.tasks.titleLabel).fill(urgentStaleAttemptTitle);
    const conflictPatchPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails }).click();
    expect((await conflictPatchPromise).status()).toBe(409);

    const conflictAlert = drawer.getByRole('alert');
    await expect(conflictAlert).toContainText(viMessages.errors.taskVersionConflict);
    const reloadBtn = drawer.getByRole('button', { name: viMessages.tasks.versionConflictReload });
    await expect(reloadBtn).toBeVisible();

    const reloadDetailPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'GET',
    );
    await reloadBtn.click();
    expect((await reloadDetailPromise).status()).toBe(200);
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(urgentConcurrentTitle);
    await expect(drawer.getByRole('alert')).toHaveCount(0);

    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);

    // Reload board so board cache holds latest version=3, then real Playwright drag Todo -> Doing
    await page.reload();
    const updatedCardInTodo = getColumnSection(page, 'Todo').locator('article.kanban-card', {
      hasText: urgentConcurrentTitle,
    });
    await expect(updatedCardInTodo).toBeVisible();

    await dragCardToColumn(page, updatedCardInTodo, doingCol, urgentTaskId);
    await expect(
      doingCol.locator('article.kanban-card', { hasText: urgentConcurrentTitle }),
    ).toBeVisible();

    await page.reload();
    await expect(
      getColumnSection(page, 'Doing').locator('article.kanban-card', {
        hasText: urgentConcurrentTitle,
      }),
    ).toBeVisible();
    await expect(
      getColumnSection(page, 'Todo').locator('article.kanban-card', {
        hasText: urgentConcurrentTitle,
      }),
    ).toHaveCount(0);

    // Verify append-only task_events in beam_test for task.moved with zero PII
    const events = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, urgentTaskId));
    const moveEvent = events.find((event) => event.type === 'task.moved');
    expect(moveEvent).toBeDefined();
    expect(moveEvent?.actorId).toBe(leadUserId);
    expect(moveEvent?.boardId).toBe(boardId);
    const moveSerialized = JSON.stringify(moveEvent);
    expect(moveSerialized).toContain(todoColId!);
    expect(moveSerialized).toContain(doingColId!);
    for (const secret of [...sensitiveValues, leadFullName, basicFullName, adminFullName]) {
      expect(moveSerialized).not.toContain(secret);
    }

    // Create disposable task and soft-delete it via S05 Drawer
    const createDispTaskRes = await page.request.post('/api/v1/tasks', {
      data: { boardId, columnId: todoColId, title: disposableTitle, priority: 1 },
    });
    expect(createDispTaskRes.status()).toBe(201);
    const disposableTaskId = ((await createDispTaskRes.json()) as { task: { id: string } }).task.id;

    await page.reload();
    const dispCard = getColumnSection(page, 'Todo').locator('article.kanban-card', {
      hasText: disposableTitle,
    });
    await expect(dispCard).toBeVisible();
    await dispCard.locator('button.kanban-card-open').click();

    const dispDrawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
    await dispDrawer.getByRole('button', { name: viMessages.tasks.deleteTask }).click();
    const deleteTaskPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${disposableTaskId}`) &&
        res.request().method() === 'DELETE',
    );
    await dispDrawer.getByRole('button', { name: viMessages.tasks.deleteConfirmSubmit }).click();
    expect((await deleteTaskPromise).status()).toBe(200);
    await expect(dispDrawer).toHaveCount(0);

    await page.reload();
    await expect(page.locator('article.kanban-card', { hasText: disposableTitle })).toHaveCount(0);
    const [softDeletedRow] = await db
      .select({ deletedAt: tasks.deletedAt })
      .from(tasks)
      .where(eq(tasks.id, disposableTaskId));
    expect(softDeletedRow?.deletedAt).not.toBeNull();

    // Basic member: AC-06 403 on POST /api/v1/tasks + 404 across GET/PATCH/move/DELETE on hidden task
    const basicContext = await browser.newContext();
    const basicPage = await basicContext.newPage();
    const basicTracker = await attachRuntimeErrorTracker(basicPage);
    try {
      await signInAs(basicPage, basicStudentId, `/boards/${boardId}`);
      await expect(
        getColumnSection(basicPage, 'Doing').locator('article.kanban-card', {
          hasText: urgentConcurrentTitle,
        }),
      ).toBeVisible();
      await expect(basicPage.locator('article.kanban-card', { hasText: hiddenTitle })).toHaveCount(0);
      await expect(
        basicPage.getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` }),
      ).toHaveCount(0);

      const createForbiddenRes = await basicPage.request.post('/api/v1/tasks', {
        data: { boardId, columnId: todoColId, title: `Forbidden ${suffix}` },
      });
      expect(createForbiddenRes.status()).toBe(403);

      const hiddenGetRes = await basicPage.request.get(`/api/v1/tasks/${hiddenTaskId}`);
      expect(hiddenGetRes.status()).toBe(404);

      const hiddenPatchRes = await basicPage.request.patch(`/api/v1/tasks/${hiddenTaskId}`, {
        data: { title: 'Probe Hidden', version: 1 },
      });
      expect(hiddenPatchRes.status()).toBe(404);

      const hiddenMoveRes = await basicPage.request.post(`/api/v1/tasks/${hiddenTaskId}/move`, {
        data: { columnId: doingColId, version: 1 },
      });
      expect(hiddenMoveRes.status()).toBe(404);

      const hiddenDeleteRes = await basicPage.request.delete(`/api/v1/tasks/${hiddenTaskId}`);
      expect(hiddenDeleteRes.status()).toBe(404);

      await basicTracker.assertClean();
    } finally {
      await basicContext.close();
    }

    await tracker.assertClean();
  });

  test('renders S06 /my-tasks respecting WQ-03 includeDone toggle and leaks zero PII across DOM and JSON responses (FR-42)', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 J3 ${suffix}`;
    const activeMyTaskTitle = `My Active Urgent ${suffix}`;
    const doneMyTaskTitle = `My Done Task ${suffix}`;

    // Setup dedicated board + active task + Done-column task via lead session
    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    let boardId: string;
    let activeTaskId: string;
    try {
      await signInAs(leadPage, leadStudentId, '/boards');
      const boardRes = await leadPage.request.post('/api/v1/boards', {
        data: { name: boardName, departmentId: deptId },
      });
      expect(boardRes.status()).toBe(201);
      const boardData = (await boardRes.json()) as {
        board: { id: string; columns: Array<{ id: string; name: string }> };
      };
      boardId = boardData.board.id;
      const todoColId = boardData.board.columns.find((col) => col.name === 'Todo')?.id;
      const doneColId = boardData.board.columns.find((col) => col.name === 'Done')?.id;
      expect(todoColId).toBeTruthy();
      expect(doneColId).toBeTruthy();

      const activeTaskRes = await leadPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: todoColId,
          title: activeMyTaskTitle,
          priority: 4,
          dueAt: '2025-01-10T00:00:00.000Z',
          assigneeIds: [basicUserId],
        },
      });
      expect(activeTaskRes.status()).toBe(201);
      activeTaskId = ((await activeTaskRes.json()) as { task: { id: string } }).task.id;

      const doneTaskRes = await leadPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: doneColId,
          title: doneMyTaskTitle,
          priority: 2,
          assigneeIds: [basicUserId],
        },
      });
      expect(doneTaskRes.status()).toBe(201);

      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    const capturedJsonResponses: string[] = [];
    page.on('response', async (res) => {
      const url = res.url();
      const matchesTargetApi =
        url.includes('/api/v1/boards') ||
        url.includes('/api/v1/tasks') ||
        url.includes('/api/v1/me/tasks');
      if (matchesTargetApi && res.status() === 200) {
        capturedJsonResponses.push(await res.text());
      }
    });

    await signInAs(page, basicStudentId, '/my-tasks');

    const activeRow = page.locator('.my-task-row', { hasText: activeMyTaskTitle });
    await expect(activeRow).toBeVisible();
    await expect(activeRow).toHaveClass(/prio-p4/);
    await expect(activeRow).toHaveClass(/is-overdue/);
    await expect(activeRow).toContainText(viMessages.priority.urgent);
    await expect(activeRow).toContainText(viMessages.tasks.overdueBadge);

    // WQ-03: Done task hidden by default (includeDone=false)
    await expect(page.locator('.my-task-row', { hasText: doneMyTaskTitle })).toHaveCount(0);

    // Toggle includeDone -> Done task appears
    const includeDoneRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/me/tasks') &&
        res.url().includes('includeDone=true') &&
        res.status() === 200,
    );
    await page.getByLabel(viMessages.myTasks.includeDoneLabel).check();
    await includeDoneRespPromise;
    await expect(page.locator('.my-task-row', { hasText: doneMyTaskTitle })).toBeVisible();

    const myTasksDomText = await page.locator('main').innerText();

    // Also visit /boards and /boards/[id] as basicMember and capture DOM + JSON responses
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('article.kanban-card', { hasText: activeMyTaskTitle })).toBeVisible();
    const boardDetailDomText = await page.locator('main').innerText();

    await page.goto('/boards');
    await expect(page.locator('article.board-tile', { hasText: boardName })).toBeVisible();
    const boardsListDomText = await page.locator('main').innerText();

    // Direct API responses check across /boards*, /tasks*, /me/tasks
    const directResponses = await Promise.all([
      page.request.get('/api/v1/boards'),
      page.request.get(`/api/v1/boards/${boardId}`),
      page.request.get(`/api/v1/tasks?boardId=${boardId}`),
      page.request.get(`/api/v1/tasks/${activeTaskId}`),
      page.request.get('/api/v1/me/tasks?includeDone=true'),
    ]);
    for (const resp of directResponses) {
      expect(resp.status()).toBe(200);
      capturedJsonResponses.push(await resp.text());
    }

    assertZeroPiiInStrings(capturedJsonResponses, sensitiveValues);
    for (const domText of [myTasksDomText, boardDetailDomText, boardsListDomText]) {
      for (const secret of sensitiveValues) {
        expect(domText).not.toContain(secret);
      }
    }

    await tracker.assertClean();
  });
});
