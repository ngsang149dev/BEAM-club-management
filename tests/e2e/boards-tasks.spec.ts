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
import {
  SVG_PAYLOAD_BYTES,
  createOversizedPngDataUrl,
  createSolidPngBuffer,
  expectColorfulInitialsAvatar,
  expectLoadedAvatarImage,
  expectSafeBinaryHeaders,
} from './helpers/media-fixtures';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const VN_OFFSET_MS = 7 * 3_600_000;

function currentVnYearStr(): string {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 4);
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
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

function getTaskModal(page: Page): Locator {
  return page.locator('aside.task-modal-shell[role="dialog"]');
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

test.describe('Boards API, Calendar Tasks & My Tasks E2E (CR-10, S05, S06)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const yearStr = currentVnYearStr();
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
      await db
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(tasks.createdBy, cleanupUserIds), isNull(tasks.deletedAt)));

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

  test('redirects /boards and /boards/[id] to /tasks, enforces WQ-05 409 on columns API, and denies board/task mutations from basic member', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 J1 ${suffix}`;
    const renamedBoardName = `Board E5 J1 Renamed ${suffix}`;
    const disposableBoardName = `Board E5 Dispose ${suffix}`;
    const blockingTaskTitle = `Task Blocking Col ${suffix}`;

    await signInAs(page, leadStudentId, '/tasks');

    // Create board & columns via additive API, verify WQ-05 409 COLUMN_NOT_EMPTY
    const createBoardRes = await page.request.post('/api/v1/boards', {
      data: { name: boardName, departmentId: deptId },
    });
    expect(createBoardRes.status()).toBe(201);
    const createdBoardBody = (await createBoardRes.json()) as {
      board: { id: string; columns: Array<{ id: string; name: string }> };
    };
    const boardId = createdBoardBody.board.id;

    const createQaRes = await page.request.post(`/api/v1/boards/${boardId}/columns`, {
      data: { name: 'QA' },
    });
    expect(createQaRes.status()).toBe(201);
    const qaColId = ((await createQaRes.json()) as { column: { id: string } }).column.id;

    const renameColRes = await page.request.patch(`/api/v1/columns/${qaColId}`, {
      data: { name: 'QA Review' },
    });
    expect(renameColRes.status()).toBe(200);

    const blockingTaskRes = await page.request.post('/api/v1/tasks', {
      data: {
        boardId,
        columnId: qaColId,
        title: blockingTaskTitle,
        startAt: `${yearStr}-01-05T00:00:00.000+07:00`,
        dueAt: `${yearStr}-01-06T00:00:00.000+07:00`,
      },
    });
    expect(blockingTaskRes.status()).toBe(201);
    const blockingTaskId = ((await blockingTaskRes.json()) as { task: { id: string } }).task.id;

    // WQ-05: Deleting column containing tasks returns 409 COLUMN_NOT_EMPTY
    const conflictDelRes = await page.request.delete(`/api/v1/columns/${qaColId}`);
    expect(conflictDelRes.status()).toBe(409);
    expect(await conflictDelRes.json()).toMatchObject({ error: { code: 'COLUMN_NOT_EMPTY' } });

    // Empty column can be created and deleted cleanly
    const tempColRes = await page.request.post(`/api/v1/boards/${boardId}/columns`, {
      data: { name: 'TempCol' },
    });
    expect(tempColRes.status()).toBe(201);
    const tempColId = ((await tempColRes.json()) as { column: { id: string } }).column.id;
    expect((await page.request.delete(`/api/v1/columns/${tempColId}`)).status()).toBe(200);

    expect((await page.request.patch(`/api/v1/boards/${boardId}`, { data: { name: renamedBoardName } })).status()).toBe(200);
    const dispBoardRes = await page.request.post('/api/v1/boards', { data: { name: disposableBoardName } });
    expect(dispBoardRes.status()).toBe(201);
    const disposableBoardId = ((await dispBoardRes.json()) as { board: { id: string } }).board.id;
    expect((await page.request.delete(`/api/v1/boards/${disposableBoardId}`)).status()).toBe(200);

    // UI redirects /boards and /boards/[id]?task=[id] -> /tasks
    await page.goto('/boards');
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);
    await page.goto(`/boards/${boardId}?task=${blockingTaskId}`);
    await page.waitForURL(`${BASE_ORIGIN}/tasks?task=${blockingTaskId}`);
    const modal = getTaskModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(blockingTaskTitle);
    await modal.getByRole('button', { name: viMessages.common.close }).click();

    // Basic member: cannot see + Tạo công việc and gets 403 on board/column mutations
    const basicContext = await browser.newContext();
    const basicPage = await basicContext.newPage();
    const basicTracker = await attachRuntimeErrorTracker(basicPage);
    try {
      await signInAs(basicPage, basicStudentId, '/tasks');
      await expect(
        basicPage.getByRole('button', { name: `+ ${viMessages.calendar.createTask}` }),
      ).toHaveCount(0);
      expect(
        (await basicPage.request.post('/api/v1/boards', { data: { name: 'Forbidden Board' } })).status(),
      ).toBe(403);
      expect(
        (await basicPage.request.post(`/api/v1/boards/${boardId}/columns`, { data: { name: 'Nope' } })).status(),
      ).toBe(403);
      await basicTracker.assertClean();
    } finally {
      await basicContext.close();
    }

    await tracker.assertClean();
  });

  test('creates overdue and hidden tasks on /tasks, handles modal edit, 409 version conflict reload, API move + task_events, soft-delete, AC-06 403, and hidden 404', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 J2 ${suffix}`;
    const urgentTitle = `Task Overdue ${suffix}`;
    const urgentEditedTitle = `Task Overdue Edited ${suffix}`;
    const urgentConcurrentTitle = `Task Overdue Concurrent ${suffix}`;
    const urgentStaleAttemptTitle = `Task Overdue Stale ${suffix}`;
    const hiddenTitle = `Task Hidden Secret ${suffix}`;
    const disposableTitle = `Task Soft Delete ${suffix}`;

    await signInAs(page, leadStudentId, '/tasks');

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

    // Create overdue task via /tasks CreateTaskModal assigned to basicMember
    await page.getByRole('button', { name: `+ ${viMessages.calendar.createTask}` }).click();
    const urgentModal = page.locator('.ui-modal[role="dialog"]');
    await expect(urgentModal).toBeVisible();
    await expect(urgentModal.getByLabel(/priority|độ ưu tiên/i)).toHaveCount(0);
    await urgentModal.getByLabel(viMessages.tasks.titleLabel).fill(urgentTitle);
    await urgentModal.getByLabel(viMessages.tasks.descriptionLabel).fill('Initial urgent description');
    await urgentModal.getByLabel(viMessages.tasks.startAtLabel).fill(`${yearStr}-01-09`);
    await urgentModal.getByLabel(viMessages.tasks.dueAtLabel).fill(`${yearStr}-01-10`);
    await urgentModal
      .locator('summary', { hasText: viMessages.tasks.individualAssigneesSummary })
      .click();
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
    const createdUrgentTask = (
      (await createUrgentRes.json()) as { task: { id: string; boardId: string } }
    ).task;
    const urgentTaskId = createdUrgentTask.id;
    const urgentBoardId = createdUrgentTask.boardId;

    const urgentBoardRes = await page.request.get(`/api/v1/boards/${urgentBoardId}`);
    expect(urgentBoardRes.status()).toBe(200);
    const urgentBoardJson = (await urgentBoardRes.json()) as {
      board: { columns: Array<{ id: string; name: string }> };
    };
    const workspaceDoingColId =
      urgentBoardJson.board.columns.find((col) => col.name === 'Doing')?.id ??
      urgentBoardJson.board.columns[1]?.id;
    expect(workspaceDoingColId).toBeTruthy();

    // Create hidden task NOT assigned to basicMember using role="switch"
    await page.getByRole('button', { name: `+ ${viMessages.calendar.createTask}` }).click();
    const hiddenModal = page.locator('.ui-modal[role="dialog"]');
    await hiddenModal.getByLabel(viMessages.tasks.titleLabel).fill(hiddenTitle);
    await hiddenModal.getByLabel(viMessages.tasks.startAtLabel).fill(`${yearStr}-01-11`);
    await hiddenModal.getByLabel(viMessages.tasks.dueAtLabel).fill(`${yearStr}-01-12`);
    await hiddenModal.getByRole('switch', { name: viMessages.tasks.isHiddenShortLabel }).click();
    const createHiddenPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await hiddenModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createHiddenRes = await createHiddenPromise;
    expect(createHiddenRes.status()).toBe(201);
    const hiddenTaskId = ((await createHiddenRes.json()) as { task: { id: string } }).task.id;

    // Verify .deadline-overdue and hidden lock icon on /tasks, zero Priority UI
    const urgentBar = page.locator(`.hcal-task-bar.deadline-overdue[data-task-id="${urgentTaskId}"]`);
    await expect(urgentBar).toBeVisible();
    await expect(urgentBar).toContainText(urgentTitle);
    await expect(page.locator('.ui-prio, .prio-p1, .prio-p2, .prio-p3, .prio-p4')).toHaveCount(0);

    const hiddenBar = page.locator(`.hcal-task-bar[data-task-id="${hiddenTaskId}"]`);
    await expect(hiddenBar).toBeVisible();
    await expect(hiddenBar.locator('.hcal-task-lock')).toBeVisible();

    // Open Task Detail Modal -> update title/description (200)
    const openDetailPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'GET',
    );
    await urgentBar.click();
    expect((await openDetailPromise).status()).toBe(200);

    const drawer = getTaskModal(page);
    await expect(drawer).toBeVisible();
    await drawer.getByLabel(viMessages.tasks.titleLabel).fill(urgentEditedTitle);
    await drawer.getByLabel(viMessages.tasks.descriptionLabel).fill('Updated urgent description');

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails }).click();
    expect((await patchPromise).status()).toBe(200);
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(urgentEditedTitle);

    // Simulate concurrent edit bumping version (2 -> 3), then trigger 409 TASK_VERSION_CONFLICT
    const concurrentPatchRes = await page.request.patch(`/api/v1/tasks/${urgentTaskId}`, {
      data: { title: urgentConcurrentTitle, version: 2 },
    });
    expect(concurrentPatchRes.status()).toBe(200);

    await drawer.getByLabel(viMessages.tasks.titleLabel).fill(urgentStaleAttemptTitle);
    const conflictPatchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails }).click();
    expect((await conflictPatchPromise).status()).toBe(409);

    const conflictAlert = drawer.getByRole('alert');
    await expect(conflictAlert).toContainText(viMessages.errors.taskVersionConflict);
    const reloadBtn = drawer.getByRole('button', { name: viMessages.tasks.versionConflictReload });
    await expect(reloadBtn).toBeVisible();

    const reloadDetailPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${urgentTaskId}`) && res.request().method() === 'GET',
    );
    await reloadBtn.click();
    expect((await reloadDetailPromise).status()).toBe(200);
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(urgentConcurrentTitle);
    await expect(drawer.locator('.ui-banner.is-danger')).toHaveCount(0);
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);

    // Verify move API + append-only task_events in beam_test with zero PII
    const apiMoveRes = await page.request.post(`/api/v1/tasks/${urgentTaskId}/move`, {
      data: { columnId: workspaceDoingColId, version: 3 },
    });
    expect(apiMoveRes.status()).toBe(200);
    expect(boardId).toBeTruthy();
    expect(todoColId).toBeTruthy();
    expect(doingColId).toBeTruthy();

    const events = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, urgentTaskId));
    const moveEvent = events.find((event) => event.type === 'task.moved');
    expect(moveEvent).toBeDefined();
    expect(moveEvent?.actorId).toBe(leadUserId);
    const moveSerialized = JSON.stringify(moveEvent);
    for (const secret of [...sensitiveValues, leadFullName, basicFullName, adminFullName]) {
      expect(moveSerialized).not.toContain(secret);
    }

    // Create disposable task in current year and soft-delete it via /tasks modal
    const createDispTaskRes = await page.request.post('/api/v1/tasks', {
      data: {
        boardId,
        columnId: todoColId,
        title: disposableTitle,
        startAt: `${yearStr}-02-09T00:00:00.000+07:00`,
        dueAt: `${yearStr}-02-10T00:00:00.000+07:00`,
      },
    });
    expect(createDispTaskRes.status()).toBe(201);
    const disposableTaskId = ((await createDispTaskRes.json()) as { task: { id: string } }).task.id;

    await page.reload();
    const dispBar = page.locator(`.hcal-task-bar[data-task-id="${disposableTaskId}"]`);
    await expect(dispBar).toBeVisible();
    await dispBar.click();

    const dispDrawer = getTaskModal(page);
    await dispDrawer.getByRole('button', { name: viMessages.tasks.deleteTask }).click();
    const deleteTaskPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${disposableTaskId}`) && res.request().method() === 'DELETE',
    );
    await dispDrawer.getByRole('button', { name: viMessages.tasks.deleteConfirmSubmit }).click();
    expect((await deleteTaskPromise).status()).toBe(200);
    await expect(dispDrawer).toHaveCount(0);

    await page.reload();
    await expect(page.locator(`.hcal-task-bar[data-task-id="${disposableTaskId}"]`)).toHaveCount(0);
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
      await signInAs(basicPage, basicStudentId, '/tasks');
      await expect(
        basicPage.locator(`.hcal-task-bar[data-task-id="${urgentTaskId}"]`),
      ).toBeVisible();
      await expect(basicPage.locator(`.hcal-task-bar[data-task-id="${hiddenTaskId}"]`)).toHaveCount(0);
      await expect(
        basicPage.getByRole('button', { name: `+ ${viMessages.calendar.createTask}` }),
      ).toHaveCount(0);

      expect(
        (
          await basicPage.request.post('/api/v1/tasks', {
            data: {
              boardId,
              columnId: todoColId,
              title: `Forbidden ${suffix}`,
              startAt: `${yearStr}-02-09T00:00:00.000+07:00`,
              dueAt: `${yearStr}-02-10T00:00:00.000+07:00`,
            },
          })
        ).status(),
      ).toBe(403);

      expect((await basicPage.request.get(`/api/v1/tasks/${hiddenTaskId}`)).status()).toBe(404);
      expect(
        (
          await basicPage.request.patch(`/api/v1/tasks/${hiddenTaskId}`, {
            data: { title: 'Probe Hidden', version: 1 },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await basicPage.request.post(`/api/v1/tasks/${hiddenTaskId}/move`, {
            data: { columnId: doingColId, version: 1 },
          })
        ).status(),
      ).toBe(404);
      expect((await basicPage.request.delete(`/api/v1/tasks/${hiddenTaskId}`)).status()).toBe(404);

      await basicTracker.assertClean();
    } finally {
      await basicContext.close();
    }

    await tracker.assertClean();
  });

  test('consolidates /my-tasks -> /progress with deadline tiers, acceptance & deliverable counts, default Đang làm vs Đã xong filter, and zero PII (FR-42)', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 J3 ${suffix}`;
    const activeMyTaskTitle = `My Active Overdue ${suffix}`;
    const doneMyTaskTitle = `My Done Task ${suffix}`;

    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    let boardId: string;
    let activeTaskId: string;
    try {
      await signInAs(leadPage, leadStudentId, '/tasks');
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
          startAt: `${yearStr}-01-09T00:00:00.000Z`,
          dueAt: `${yearStr}-01-10T00:00:00.000Z`,
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
          startAt: `${yearStr}-01-09T00:00:00.000Z`,
          dueAt: `${yearStr}-01-10T00:00:00.000Z`,
          assigneeIds: [basicUserId],
        },
      });
      expect(doneTaskRes.status()).toBe(201);
      const doneTaskId = ((await doneTaskRes.json()) as { task: { id: string } }).task.id;
      await leadPage.request.patch(`/api/v1/tasks/${doneTaskId}`, {
        data: { isCompleted: true, version: 1 },
      });

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

    await signInAs(page, basicStudentId, '/progress');
    await expect(page.locator('.app-side a[href="/my-tasks"]')).toHaveCount(0);
    await page.goto('/my-tasks');
    await page.waitForURL(`${BASE_ORIGIN}/progress`);

    const activeRow = page.locator('.prog-row', { hasText: activeMyTaskTitle });
    await expect(activeRow).toBeVisible();
    await expect(activeRow.locator('.prog-dot.is-overdue')).toBeVisible();
    await expect(activeRow).toContainText(viMessages.progress.unacceptedShort);
    await expect(page.locator('.ui-prio, .prio-p1, .prio-p2, .prio-p3, .prio-p4')).toHaveCount(0);
    await activeRow.locator('.prog-row-btn').click();
    await expect(page.locator('.prog-summary-card .prog-deadline-box.is-overdue')).toBeVisible();
    await expect(page.locator('.prog-deliv-card')).toContainText(
      viMessages.progress.deliverablesTitle.replace('{count}', '0'),
    );

    // Default Đang làm tab excludes completed tasks until clicking Đã xong
    await expect(page.locator('.prog-row', { hasText: doneMyTaskTitle })).toHaveCount(0);
    await page
      .locator('.prog-filter-tabs')
      .getByRole('tab', { name: viMessages.progress.filterDone, exact: true })
      .click();
    await expect(page.locator('.prog-row', { hasText: doneMyTaskTitle })).toBeVisible();

    const progressTaskListText = await page.locator('.prog-list-scroll').innerText();
    const progressInspectorText = await page.locator('.prog-inspector').innerText();
    const progressMainText = await page.locator('main').innerText();

    await page.goto('/tasks');
    await expect(page.locator(`.hcal-task-bar[data-task-id="${activeTaskId}"]`)).toBeVisible();
    const calendarDomText = await page.locator('main').innerText();

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
    // Task lists/inspector/calendar & other-member secrets never expose MSSV/email; only own banner displays basicUser's own identity (AGENTS §7)
    for (const domText of [progressTaskListText, progressInspectorText, calendarDomText]) {
      for (const secret of sensitiveValues) {
        expect(domText).not.toContain(secret);
      }
    }
    for (const otherSecret of [adminStudentId, leadStudentId, adminEmail, leadEmail]) {
      expect(progressMainText).not.toContain(otherSecret);
    }

    await tracker.assertClean();
  });

  test('uploads member avatar on S08 /profile, renders across ProfileView, AppShell, /members, /progress, and /tasks modal, enforces 403/400 guards, and reverts to colorful initials (CR-02)', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardName = `Board E5 Avatar ${suffix}`;
    const avatarTaskTitle = `Task Avatar Card ${suffix}`;
    const pngBytes = createSolidPngBuffer(24, 24, [29, 78, 216, 255]);
    const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;
    const svgDataUrl = `data:image/svg+xml;base64,${SVG_PAYLOAD_BYTES.toString('base64')}`;
    const spoofedPngDataUrl = `data:image/png;base64,${SVG_PAYLOAD_BYTES.toString('base64')}`;
    const oversizedDataUrl = createOversizedPngDataUrl();

    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    let avatarTaskId = '';
    try {
      await signInAs(leadPage, leadStudentId, '/tasks');
      const boardRes = await leadPage.request.post('/api/v1/boards', {
        data: { name: boardName, departmentId: deptId },
      });
      expect(boardRes.status()).toBe(201);
      const boardData = (await boardRes.json()) as {
        board: { id: string; columns: Array<{ id: string; name: string }> };
      };
      const boardId = boardData.board.id;
      const todoColId = boardData.board.columns.find((col) => col.name === 'Todo')?.id;
      expect(todoColId).toBeTruthy();

      const taskRes = await leadPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: todoColId,
          title: avatarTaskTitle,
          startAt: `${yearStr}-03-14T00:00:00.000+07:00`,
          dueAt: `${yearStr}-03-15T00:00:00.000+07:00`,
          assigneeIds: [basicUserId],
        },
      });
      expect(taskRes.status()).toBe(201);
      avatarTaskId = ((await taskRes.json()) as { task: { id: string } }).task.id;
      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    try {
      await signInAs(page, basicStudentId, '/profile');
      await expectColorfulInitialsAvatar(
        page.locator('.profile-hero .ui-avatar'),
        basicUserId,
        basicFullName,
      );
      await expectColorfulInitialsAvatar(
        page.locator('.app-side .app-user .ui-avatar'),
        basicUserId,
        basicFullName,
      );

      const otherPutForbidden = await page.request.put(`/api/v1/members/${leadUserId}/avatar`, {
        data: { dataUrl: pngDataUrl },
      });
      expect(otherPutForbidden.status()).toBe(403);
      const otherDelForbidden = await page.request.delete(`/api/v1/members/${leadUserId}/avatar`);
      expect(otherDelForbidden.status()).toBe(403);

      for (const badPayload of [svgDataUrl, spoofedPngDataUrl, oversizedDataUrl]) {
        const badRes = await page.request.put('/api/v1/me/avatar', {
          data: { dataUrl: badPayload },
        });
        expect(badRes.status()).toBe(400);
      }

      await page.locator('.profile-hero input[type="file"]').setInputFiles({
        name: 'evil.svg',
        mimeType: 'image/svg+xml',
        buffer: SVG_PAYLOAD_BYTES,
      });
      await expect(page.locator('.profile-hero .ui-banner.is-danger')).toContainText(
        viMessages.errors.invalidImageFormat,
      );

      await page.reload();
      await expect(page.locator('.profile-hero .ui-banner.is-danger')).toHaveCount(0);

      // Prime SPA QueryClient caches (/progress & /tasks modal) before avatar upload
      await page.locator('.app-side a[href="/progress"]').click();
      await page.waitForURL(`${BASE_ORIGIN}/progress`);
      await page.locator('.prog-row', { hasText: avatarTaskTitle }).locator('.prog-row-btn').click();
      await page.getByRole('button', { name: viMessages.progress.expandDetail, exact: true }).click();
      const primedModal = getTaskModal(page);
      await expectColorfulInitialsAvatar(
        primedModal.locator('.task-acceptance-list .ui-avatar'),
        basicUserId,
        basicFullName,
      );
      await primedModal.getByRole('button', { name: viMessages.common.close }).click();

      await page.locator('.app-side a[href="/profile"]').click();
      await page.waitForURL(`${BASE_ORIGIN}/profile`);

      // Upload valid PNG on S08 /profile -> invalidates SPA caches across ProfileView, AppShell, /members, /progress & /tasks modal
      const uploadPromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/me/avatar') && res.request().method() === 'PUT',
      );
      await page.locator('.profile-hero input[type="file"]').setInputFiles({
        name: 'my-avatar.png',
        mimeType: 'image/png',
        buffer: pngBytes,
      });
      const uploadRes = await uploadPromise;
      expect(uploadRes.status()).toBe(200);
      const uploadJson = (await uploadRes.json()) as { profile: { avatarUrl: string | null } };
      expect(uploadJson.profile.avatarUrl).toMatch(
        new RegExp(`^/api/v1/members/${basicUserId}/avatar\\?v=\\d+$`),
      );

      const expectedPrefix = `/api/v1/members/${basicUserId}/avatar?v=`;
      expect(await expectLoadedAvatarImage(page.locator('.profile-hero .ui-avatar'), expectedPrefix)).toBe(
        uploadJson.profile.avatarUrl,
      );
      expect(await expectLoadedAvatarImage(page.locator('.app-side .app-user .ui-avatar'), expectedPrefix)).toBe(
        uploadJson.profile.avatarUrl,
      );

      const binRes = await page.request.get(`/api/v1/members/${basicUserId}/avatar`);
      expect(binRes.status()).toBe(200);
      expectSafeBinaryHeaders(binRes.headers(), 'image/png');

      await page.locator('.app-side a[href="/members"]').click();
      await page.waitForURL(`${BASE_ORIGIN}/members`);
      await page.getByLabel(viMessages.members.searchLabel).fill(basicFullName);
      const directoryRow = page.locator('.directory-table-wrap table.ui-table tbody tr', {
        hasText: basicFullName,
      });
      await expect(directoryRow).toBeVisible();
      expect(await expectLoadedAvatarImage(directoryRow.locator('.ui-avatar'), expectedPrefix)).toBe(
        uploadJson.profile.avatarUrl,
      );

      await page.locator('.app-side a.app-nav-item[href="/tasks"]').click();
      await page.waitForURL(`${BASE_ORIGIN}/tasks`);
      await page.locator(`.hcal-task-bar[data-task-id="${avatarTaskId}"]`).click();
      const updatedModal = getTaskModal(page);
      expect(
        await expectLoadedAvatarImage(updatedModal.locator('.task-acceptance-list .ui-avatar'), expectedPrefix),
      ).toBe(uploadJson.profile.avatarUrl);
      await updatedModal.getByRole('button', { name: viMessages.common.close }).click();

      // Remove own avatar on S08 /profile -> restores colorful initials across SPA-cached views
      await page.locator('.app-side a[href="/profile"]').click();
      await page.waitForURL(`${BASE_ORIGIN}/profile`);
      const removePromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/me/avatar') && res.request().method() === 'DELETE',
      );
      await page
        .locator('.profile-hero')
        .getByRole('button', { name: viMessages.media.removePhoto, exact: true })
        .click();
      expect((await removePromise).status()).toBe(200);
      await expectColorfulInitialsAvatar(
        page.locator('.profile-hero .ui-avatar'),
        basicUserId,
        basicFullName,
      );
      expect((await page.request.get(`/api/v1/members/${basicUserId}/avatar`)).status()).toBe(404);

      await page.locator('.app-side a.app-nav-item[href="/tasks"]').click();
      await page.waitForURL(`${BASE_ORIGIN}/tasks`);
      await page.locator(`.hcal-task-bar[data-task-id="${avatarTaskId}"]`).click();
      const revertedModal = getTaskModal(page);
      await expectColorfulInitialsAvatar(
        revertedModal.locator('.task-acceptance-list .ui-avatar'),
        basicUserId,
        basicFullName,
      );
      await revertedModal.getByRole('button', { name: viMessages.common.close }).click();
    } finally {
      await db
        .update(profiles)
        .set({ avatarData: null, avatarMime: null, avatarUpdatedAt: null, updatedAt: new Date() })
        .where(eq(profiles.id, basicUserId));
    }

    await tracker.assertClean();
  });
});
