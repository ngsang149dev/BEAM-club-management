import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  columns,
  comments,
  loginAttempts,
  permissions,
  profiles,
  sessions,
  taskAssignees,
  taskDepartments,
  taskEvents,
  tasks,
  userPermissions,
} from '@db/schema';
import { uuidSchema } from '@/lib/members';
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

function getColumnSection(page: Page, columnName: string): Locator {
  return page.locator('section.kanban-col', {
    has: page.locator('h2.kanban-col-name', {
      hasText: new RegExp(`^${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    }),
  });
}

function getTaskCard(page: Page, title: string): Locator {
  return page.locator('article.kanban-card', {
    has: page.locator('.kanban-card-title', {
      hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    }),
  });
}

function getTaskDrawer(page: Page): Locator {
  return page.locator('aside.ui-drawer-task[role="dialog"]');
}

async function openCommentsTab(drawer: Locator): Promise<void> {
  await drawer
    .getByRole('tab', { name: new RegExp(viMessages.tasks.tabComments) })
    .click();
  await expect(drawer.locator('.task-comments-panel')).toBeVisible();
}

async function openDetailsTab(drawer: Locator): Promise<void> {
  await drawer
    .getByRole('tab', { name: new RegExp(viMessages.tasks.tabDetails) })
    .click();
  await expect(drawer.locator('.task-drawer-grid')).toBeVisible();
}

function formatVisibleTaskCount(count: number): string {
  return viMessages.boards.visibleTaskCount.replace('{count}', String(count));
}

function formatCommentsCount(count: number): string {
  return viMessages.tasks.commentsCount.replace('{count}', String(count));
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
    expect(body).not.toContain('scrypt$');
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

test.describe('E7 Comments & Hidden Task Flag E2E (FR-07, FR-24, FR-26, AC-04, AC-05, AC-15, WQ-27)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);

  const adminUserId = randomUUID();
  const creatorUserId = randomUUID();
  const assigneeUserId = randomUUID();
  const outsiderUserId = randomUUID();
  const readOnlyUserId = randomUUID();
  const inactiveAuthorUserId = randomUUID();

  const adminStudentId = `MSSV-E7-ADM-${suffix}`;
  const creatorStudentId = `MSSV-E7-CRE-${suffix}`;
  const assigneeStudentId = `MSSV-E7-ASN-${suffix}`;
  const outsiderStudentId = `MSSV-E7-OUT-${suffix}`;
  const readOnlyStudentId = `MSSV-E7-RDO-${suffix}`;
  const inactiveStudentId = `MSSV-E7-INA-${suffix}`;

  const adminEmail = `e7-admin-${suffix}@eiu.edu.vn`;
  const creatorEmail = `e7-creator-${suffix}@eiu.edu.vn`;
  const assigneeEmail = `e7-assignee-${suffix}@eiu.edu.vn`;
  const outsiderEmail = `e7-outsider-${suffix}@eiu.edu.vn`;
  const readOnlyEmail = `e7-readonly-${suffix}@eiu.edu.vn`;
  const inactiveEmail = `e7-inactive-${suffix}@eiu.edu.vn`;

  const adminFullName = `E7 Admin ${suffix}`;
  const creatorFullName = `E7 Creator ${suffix}`;
  const assigneeFullName = `E7 Assignee ${suffix}`;
  const outsiderFullName = `E7 Outsider ${suffix}`;
  const readOnlyFullName = `E7 ReadOnly ${suffix}`;
  const inactiveFullName = `E7 FormerMember ${suffix}`;

  const sensitiveValues = [
    adminStudentId,
    creatorStudentId,
    assigneeStudentId,
    outsiderStudentId,
    readOnlyStudentId,
    inactiveStudentId,
    adminEmail,
    creatorEmail,
    assigneeEmail,
    outsiderEmail,
    readOnlyEmail,
    inactiveEmail,
  ];

  const hiddenBoardId = randomUUID();
  const hiddenBoardName = `E7 Hidden Board ${suffix}`;
  const hiddenTodoColId = randomUUID();
  const hiddenDoneColId = randomUUID();
  const publicTaskOnHiddenBoardId = randomUUID();
  const publicTaskOnHiddenBoardTitle = `E7 Public Baseline ${suffix}`;

  const commentsBoardId = randomUUID();
  const commentsBoardName = `E7 Comments Board ${suffix}`;
  const commentsTodoColId = randomUUID();
  const commentsDoneColId = randomUUID();
  const commentsTaskId = randomUUID();
  const commentsTaskTitle = `E7 Comments Target ${suffix}`;
  const inactiveCommentId = randomUUID();
  const creatorCommentId = randomUUID();
  const inactiveCommentBody = `E7 former member note ${suffix}`;
  const creatorCommentBody = `E7 creator initial note ${suffix}`;

  const trackedUserIds = [
    adminUserId,
    creatorUserId,
    assigneeUserId,
    outsiderUserId,
    readOnlyUserId,
    inactiveAuthorUserId,
  ];
  const trackedStudentIds = [
    adminStudentId,
    creatorStudentId,
    assigneeStudentId,
    outsiderStudentId,
    readOnlyStudentId,
    inactiveStudentId,
  ];
  const trackedBoardIds = [hiddenBoardId, commentsBoardId];
  const trackedTaskIds: string[] = [publicTaskOnHiddenBoardId, commentsTaskId];

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
        id: creatorUserId,
        studentId: creatorStudentId,
        email: creatorEmail,
        fullName: creatorFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: assigneeUserId,
        studentId: assigneeStudentId,
        email: assigneeEmail,
        fullName: assigneeFullName,
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
        id: readOnlyUserId,
        studentId: readOnlyStudentId,
        email: readOnlyEmail,
        fullName: readOnlyFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveAuthorUserId,
        studentId: inactiveStudentId,
        email: inactiveEmail,
        fullName: inactiveFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: false,
        leftAt: new Date('2026-10-01T00:00:00.000Z'),
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      ...(
        [
          'member.view',
          'task.create',
          'task.assign',
          'task.update_assigned',
          'comment.create',
        ] as const
      ).map((code) => ({
        userId: creatorUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...(['member.view', 'task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: assigneeUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...(
        ['member.view', 'task.update_any', 'comment.create', 'comment.delete_any'] as const
      ).map((code) => ({
        userId: outsiderUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      // Deliberately omit comment.create and comment.delete_any for readOnlyUserId
      ...(['member.view', 'task.update_assigned'] as const).map((code) => ({
        userId: readOnlyUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
    ]);

    await db.insert(boards).values([
      {
        id: hiddenBoardId,
        name: hiddenBoardName,
        createdBy: adminUserId,
      },
      {
        id: commentsBoardId,
        name: commentsBoardName,
        createdBy: adminUserId,
      },
    ]);

    await db.insert(columns).values([
      { id: hiddenTodoColId, boardId: hiddenBoardId, name: 'Todo', orderIndex: 0 },
      { id: hiddenDoneColId, boardId: hiddenBoardId, name: 'Done', orderIndex: 1 },
      { id: commentsTodoColId, boardId: commentsBoardId, name: 'Todo', orderIndex: 0 },
      { id: commentsDoneColId, boardId: commentsBoardId, name: 'Done', orderIndex: 1 },
    ]);

    await db.insert(tasks).values([
      {
        id: publicTaskOnHiddenBoardId,
        boardId: hiddenBoardId,
        columnId: hiddenTodoColId,
        title: publicTaskOnHiddenBoardTitle,
        description: 'Public baseline task for hidden RBAC checks',
        priority: 2,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: commentsTaskId,
        boardId: commentsBoardId,
        columnId: commentsTodoColId,
        title: commentsTaskTitle,
        description: 'Target task for comments lifecycle & RBAC checks',
        priority: 3,
        position: '1000',
        isHidden: false,
        createdBy: creatorUserId,
      },
    ]);

    await db.insert(comments).values([
      {
        id: inactiveCommentId,
        taskId: commentsTaskId,
        userId: inactiveAuthorUserId,
        body: inactiveCommentBody,
        createdAt: new Date('2026-11-25T10:00:00.000Z'),
      },
      {
        id: creatorCommentId,
        taskId: commentsTaskId,
        userId: creatorUserId,
        body: creatorCommentBody,
        createdAt: new Date('2026-11-25T10:05:00.000Z'),
      },
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
        await db.delete(comments).where(inArray(comments.taskId, trackedTaskIds));
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
          inArray(profiles.id, [
            creatorUserId,
            assigneeUserId,
            outsiderUserId,
            readOnlyUserId,
            inactiveAuthorUserId,
          ]),
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

  test('Hidden flag RBAC, WQ-27 unassigned warning, AC-15 404 concealment across all endpoints/UI, and task_events without PII', async ({
    browser,
  }) => {
    const createdTaskTitle = `E7 Hidden Toggle Target ${suffix}`;
    const hiddenCommentBody = `E7 hidden discussion ${suffix}`;
    let createdTaskId = '';
    let hiddenCommentId = '';
    const capturedPayloads: string[] = [];

    const attachPayloadMonitor = (page: Page) => {
      page.on('response', async (response) => {
        const url = response.url();
        if (
          url.includes('/api/v1/tasks') ||
          url.includes('/api/v1/boards') ||
          url.includes('/api/v1/comments')
        ) {
          const contentType = response.headers()['content-type'] ?? '';
          if (contentType.includes('application/json')) {
            try {
              capturedPayloads.push(await response.text());
            } catch {
              // Ignore aborted response streams on navigation
            }
          }
        }
      });
    };

    const creatorSession = await openSignedInContext(
      browser,
      creatorStudentId,
      `/boards/${hiddenBoardId}`,
    );
    const assigneeSession = await openSignedInContext(
      browser,
      assigneeStudentId,
      `/boards/${hiddenBoardId}`,
    );
    const outsiderSession = await openSignedInContext(browser, outsiderStudentId, '/boards');
    const adminSession = await openSignedInContext(
      browser,
      adminStudentId,
      `/boards/${hiddenBoardId}`,
    );

    try {
      for (const s of [creatorSession, assigneeSession, outsiderSession, adminSession]) {
        attachPayloadMonitor(s.page);
      }

      // 1. Creator creates a public task without assignees via CreateTaskModal (also verifying WQ-27 preview warning in modal)
      const creatorPage = creatorSession.page;
      const todoCol = getColumnSection(creatorPage, 'Todo');
      await todoCol.getByRole('button', { name: new RegExp(viMessages.boards.addTaskInColumn) }).click();
      const createDialog = creatorPage.locator('.ui-modal[role="dialog"]');
      await expect(createDialog).toBeVisible();

      await createDialog.getByLabel(viMessages.tasks.titleLabel).fill(createdTaskTitle);
      const hiddenCheckbox = createDialog.getByLabel(viMessages.tasks.isHiddenLabel);
      await hiddenCheckbox.check();
      await expect(createDialog.getByText(viMessages.tasks.hiddenUnassignedWarnTitle)).toBeVisible();
      await hiddenCheckbox.uncheck();
      await expect(createDialog.getByText(viMessages.tasks.hiddenUnassignedWarnTitle)).toHaveCount(0);

      const createTaskResPromise = creatorPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
      );
      await createDialog.getByRole('button', { name: viMessages.tasks.createSubmit, exact: true }).click();
      const createTaskRes = await createTaskResPromise;
      expect(createTaskRes.status()).toBe(201);
      const createdJson = (await createTaskRes.json()) as { task: { id: string } };
      createdTaskId = createdJson.task.id;
      trackedTaskIds.push(createdTaskId);

      // Creator opens TaskDetailDrawer, sees role="switch", toggles Hidden ON -> WQ-27 warning appears
      await getTaskCard(creatorPage, createdTaskTitle).locator('.kanban-card-open').click();
      const creatorDrawer = getTaskDrawer(creatorPage);
      await expect(creatorDrawer).toBeVisible();

      const creatorSwitch = creatorDrawer.getByRole('switch');
      await expect(creatorSwitch).toBeVisible();
      await expect(creatorSwitch).toHaveAttribute('aria-checked', 'false');

      const hideResPromise = creatorPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${createdTaskId}/hidden`) &&
          res.request().method() === 'PUT',
      );
      await creatorSwitch.click();
      expect((await hideResPromise).status()).toBe(200);

      await expect(creatorSwitch).toHaveAttribute('aria-checked', 'true');
      await expect(creatorDrawer.getByText(viMessages.tasks.hiddenBannerTitle)).toBeVisible();
      await expect(creatorDrawer.getByText(viMessages.tasks.hiddenUnassignedWarnTitle)).toBeVisible();
      await expect(creatorDrawer.getByText(viMessages.tasks.hiddenUnassignedWarnBody)).toBeVisible();

      // Creator assigns Member A (assigneeUserId) -> WQ-27 warning clears
      await creatorDrawer
        .locator('summary.task-individual-summary', {
          hasText: viMessages.tasks.individualAssigneesSummary,
        })
        .click();
      await creatorDrawer.getByLabel(assigneeFullName, { exact: true }).check();
      const assignResPromise = creatorPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${createdTaskId}/assignees`) &&
          res.request().method() === 'PUT',
      );
      await creatorDrawer
        .getByRole('button', { name: viMessages.tasks.saveAssignments, exact: true })
        .click();
      expect((await assignResPromise).status()).toBe(200);
      await expect(creatorDrawer.getByText(viMessages.tasks.hiddenUnassignedWarnTitle)).toHaveCount(0);

      // Creator also posts one comment on the hidden task (via Comments tab) for Member C's 404 comment delete probe
      await openCommentsTab(creatorDrawer);
      await creatorDrawer.getByLabel(viMessages.comments.composerLabel).fill(hiddenCommentBody);
      const hiddenCommentResPromise = creatorPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${createdTaskId}/comments`) &&
          res.request().method() === 'POST',
      );
      await creatorDrawer.getByRole('button', { name: viMessages.comments.submit, exact: true }).click();
      const hiddenCommentRes = await hiddenCommentResPromise;
      expect(hiddenCommentRes.status()).toBe(201);
      const hiddenCommentJson = (await hiddenCommentRes.json()) as { comment: { id: string } };
      hiddenCommentId = hiddenCommentJson.comment.id;
      await expect(creatorDrawer.getByText(hiddenCommentBody)).toBeVisible();

      // 2. Assignee (Member A) sees hidden task + badge + banner, does NOT see switch, receives 403 on PUT /hidden
      const assigneePage = assigneeSession.page;
      await assigneePage.reload();
      const assigneeCard = getTaskCard(assigneePage, createdTaskTitle);
      await expect(assigneeCard).toBeVisible();
      await expect(assigneeCard.getByText(viMessages.tasks.hiddenBadge)).toBeVisible();

      await assigneeCard.locator('.kanban-card-open').click();
      const assigneeDrawer = getTaskDrawer(assigneePage);
      await expect(assigneeDrawer).toBeVisible();
      await expect(assigneeDrawer.getByText(viMessages.tasks.hiddenBannerTitle)).toBeVisible();
      await expect(assigneeDrawer.getByRole('switch')).toHaveCount(0);
      await openCommentsTab(assigneeDrawer);
      await expect(assigneeDrawer.getByText(hiddenCommentBody)).toBeVisible();

      const assigneeToggleAttempt = await assigneePage.request.put(
        `/api/v1/tasks/${createdTaskId}/hidden`,
        { data: { isHidden: false } },
      );
      expect(assigneeToggleAttempt.status()).toBe(403);
      expect((await assigneeToggleAttempt.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      // 3. Non-viewer Member C (even holding task.update_any, comment.create, comment.delete_any)
      const outsiderPage = outsiderSession.page;
      await outsiderPage.reload();
      const outsiderBoardTile = outsiderPage.locator('.board-tile', { hasText: hiddenBoardName });
      await expect(outsiderBoardTile).toBeVisible();
      await expect(outsiderBoardTile).toContainText(formatVisibleTaskCount(1));

      await outsiderPage.goto(`/boards/${hiddenBoardId}`);
      await expect(getTaskCard(outsiderPage, publicTaskOnHiddenBoardTitle)).toBeVisible();
      await expect(getTaskCard(outsiderPage, createdTaskTitle)).toHaveCount(0);

      const outsiderSearchRes = await outsiderPage.request.get(
        `/api/v1/tasks?boardId=${hiddenBoardId}&q=${encodeURIComponent(createdTaskTitle)}`,
      );
      expect(outsiderSearchRes.status()).toBe(200);
      expect(((await outsiderSearchRes.json()) as { items: unknown[] }).items).toEqual([]);

      // All 5 hidden-task probes MUST return 404 NOT_FOUND (never 403)
      const hiddenGetRes = await outsiderPage.request.get(`/api/v1/tasks/${createdTaskId}`);
      expect(hiddenGetRes.status()).toBe(404);
      expect((await hiddenGetRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      const hiddenPutRes = await outsiderPage.request.put(
        `/api/v1/tasks/${createdTaskId}/hidden`,
        { data: { isHidden: false } },
      );
      expect(hiddenPutRes.status()).toBe(404);
      expect((await hiddenPutRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      const hiddenCommentsGetRes = await outsiderPage.request.get(
        `/api/v1/tasks/${createdTaskId}/comments`,
      );
      expect(hiddenCommentsGetRes.status()).toBe(404);
      expect((await hiddenCommentsGetRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      const hiddenCommentsPostRes = await outsiderPage.request.post(
        `/api/v1/tasks/${createdTaskId}/comments`,
        { data: { body: 'Unauthorized hidden comment probe' } },
      );
      expect(hiddenCommentsPostRes.status()).toBe(404);
      expect((await hiddenCommentsPostRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      const hiddenCommentDeleteRes = await outsiderPage.request.delete(
        `/api/v1/comments/${hiddenCommentId}`,
      );
      expect(hiddenCommentDeleteRes.status()).toBe(404);
      expect((await hiddenCommentDeleteRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      // Direct UI visit /boards/{boardId}?task={hiddenId} renders 404 ErrorState
      await outsiderPage.goto(`/boards/${hiddenBoardId}?task=${createdTaskId}`);
      const outsiderNotFoundDrawer = getTaskDrawer(outsiderPage);
      await expect(outsiderNotFoundDrawer).toBeVisible();
      await expect(outsiderNotFoundDrawer.getByText(viMessages.errors['404'].code)).toBeVisible();
      await expect(outsiderNotFoundDrawer.getByText(viMessages.errors['404'].title)).toBeVisible();
      await expect(
        outsiderNotFoundDrawer.getByText(viMessages.errors['404'].description),
      ).toBeVisible();
      await outsiderNotFoundDrawer
        .locator('.ui-btn.primary', { hasText: viMessages.common.close })
        .click();
      await expect(outsiderNotFoundDrawer).toHaveCount(0);

      // 4. On a public task, Member C (with task.update_any, not creator, not admin) STILL sees no switch and gets 403
      await getTaskCard(outsiderPage, publicTaskOnHiddenBoardTitle).locator('.kanban-card-open').click();
      const outsiderPublicDrawer = getTaskDrawer(outsiderPage);
      await expect(outsiderPublicDrawer).toBeVisible();
      await expect(outsiderPublicDrawer.getByRole('switch')).toHaveCount(0);

      const outsiderPublicToggleRes = await outsiderPage.request.put(
        `/api/v1/tasks/${publicTaskOnHiddenBoardId}/hidden`,
        { data: { isHidden: true } },
      );
      expect(outsiderPublicToggleRes.status()).toBe(403);
      expect((await outsiderPublicToggleRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      // 5. Admin toggles Hidden OFF -> Member C now sees the task & comments
      const adminPage = adminSession.page;
      await adminPage.goto(`/boards/${hiddenBoardId}?task=${createdTaskId}`);
      const adminDrawer = getTaskDrawer(adminPage);
      await expect(adminDrawer).toBeVisible();
      const adminSwitch = adminDrawer.getByRole('switch');
      await expect(adminSwitch).toHaveAttribute('aria-checked', 'true');

      const unhideResPromise = adminPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${createdTaskId}/hidden`) &&
          res.request().method() === 'PUT',
      );
      await adminSwitch.click();
      expect((await unhideResPromise).status()).toBe(200);
      await expect(adminSwitch).toHaveAttribute('aria-checked', 'false');

      await outsiderPage.goto('/boards');
      await expect(outsiderPage.locator('.board-tile', { hasText: hiddenBoardName })).toContainText(
        formatVisibleTaskCount(2),
      );
      await outsiderPage.goto(`/boards/${hiddenBoardId}`);
      const revealedCard = getTaskCard(outsiderPage, createdTaskTitle);
      await expect(revealedCard).toBeVisible();
      await revealedCard.locator('.kanban-card-open').click();
      const outsiderRevealedDrawer = getTaskDrawer(outsiderPage);
      await expect(outsiderRevealedDrawer.locator('.task-comments-panel')).toHaveCount(0);
      await openCommentsTab(outsiderRevealedDrawer);
      await expect(outsiderRevealedDrawer.getByText(hiddenCommentBody)).toBeVisible();

      // 6. Verify task_events recorded task.hidden_changed without PII
      const hiddenEvents = await db
        .select()
        .from(taskEvents)
        .where(
          and(
            eq(taskEvents.taskId, createdTaskId),
            eq(taskEvents.type, 'task.hidden_changed'),
          ),
        )
        .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id));

      expect(hiddenEvents.map((evt) => evt.changes)).toEqual([
        { is_hidden: { from: false, to: true } },
        { is_hidden: { from: true, to: false } },
      ]);
      assertZeroPiiInStrings(
        [
          ...capturedPayloads,
          ...hiddenEvents.map((evt) => JSON.stringify(evt)),
          await outsiderPage.locator('main').innerText(),
        ],
        sensitiveValues,
      );

      for (const s of [creatorSession, assigneeSession, outsiderSession, adminSession]) {
        await s.tracker.assertClean();
      }
    } finally {
      await Promise.all([
        creatorSession.context.close(),
        assigneeSession.context.close(),
        outsiderSession.context.close(),
        adminSession.context.close(),
      ]);
    }
  });

  test('Comments lifecycle, RBAC (comment.create & comment.delete_any), inactive author badge, count sync, task_events & zero PII', async ({
    browser,
  }) => {
    const liveCommentBody = `E7 Member A live comment ${suffix}`;
    const capturedPayloads: string[] = [];

    const attachCommentPayloadMonitor = (page: Page) => {
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('/api/v1/comments') || url.includes('/comments') || url.includes(`/api/v1/tasks/${commentsTaskId}`)) {
          const contentType = response.headers()['content-type'] ?? '';
          if (contentType.includes('application/json')) {
            try {
              capturedPayloads.push(await response.text());
            } catch {
              // Ignore aborted response streams on navigation
            }
          }
        }
      });
    };

    const assigneeSession = await openSignedInContext(
      browser,
      assigneeStudentId,
      `/boards/${commentsBoardId}`,
    );
    const readOnlySession = await openSignedInContext(
      browser,
      readOnlyStudentId,
      `/boards/${commentsBoardId}?task=${commentsTaskId}`,
    );
    const outsiderSession = await openSignedInContext(
      browser,
      outsiderStudentId,
      `/boards/${commentsBoardId}?task=${commentsTaskId}`,
    );

    try {
      for (const s of [assigneeSession, readOnlySession, outsiderSession]) {
        attachCommentPayloadMonitor(s.page);
      }

      // 1. Member A (with comment.create) sees inactive author "(đã rời)", posts comment, verifies S04/S05 count & reload persistence
      const assigneePage = assigneeSession.page;
      const cardOnBoard = getTaskCard(assigneePage, commentsTaskTitle);
      await expect(cardOnBoard).toBeVisible();
      await expect(cardOnBoard).toContainText(formatCommentsCount(2));

      await cardOnBoard.locator('.kanban-card-open').click();
      const assigneeDrawer = getTaskDrawer(assigneePage);
      await expect(assigneeDrawer).toBeVisible();
      await expect(assigneeDrawer.locator('.task-comments-panel')).toHaveCount(0);
      await expect(assigneeDrawer.locator('.task-drawer-tab-count')).toHaveText('2');
      await openCommentsTab(assigneeDrawer);
      await expect(assigneeDrawer).toContainText(`${inactiveFullName} ${viMessages.member.leftBadge}`);
      await expect(assigneeDrawer.getByText(inactiveCommentBody)).toBeVisible();
      await expect(assigneeDrawer.getByText(creatorCommentBody)).toBeVisible();

      // Regular member (lacking comment.delete_any) does NOT see Delete button on creator's or former member's comment
      const creatorCommentItem = assigneeDrawer.locator('li.task-comment-item', {
        hasText: creatorCommentBody,
      });
      await expect(
        creatorCommentItem.getByRole('button', { name: viMessages.comments.deleteAction, exact: true }),
      ).toHaveCount(0);

      // Regular member gets 403 on DELETE /api/v1/comments/{creatorCommentId}
      const regularDeleteOtherRes = await assigneePage.request.delete(
        `/api/v1/comments/${creatorCommentId}`,
      );
      expect(regularDeleteOtherRes.status()).toBe(403);
      expect((await regularDeleteOtherRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      // Post new comment via TaskCommentsSection composer
      await assigneeDrawer.getByLabel(viMessages.comments.composerLabel).fill(liveCommentBody);
      const createCommentResPromise = assigneePage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${commentsTaskId}/comments`) &&
          res.request().method() === 'POST',
      );
      await assigneeDrawer
        .getByRole('button', { name: viMessages.comments.submit, exact: true })
        .click();
      const createCommentRes = await createCommentResPromise;
      expect(createCommentRes.status()).toBe(201);
      const createdCommentJson = (await createCommentRes.json()) as { comment: { id: string } };
      const liveCommentId = createdCommentJson.comment.id;

      await expect(assigneeDrawer.getByText(liveCommentBody)).toBeVisible();
      await expect(assigneeDrawer.locator('li.task-comment-item').first()).toContainText(liveCommentBody);
      await expect(assigneeDrawer.locator('.task-drawer-tab-count')).toHaveText('3');
      await expect(assigneeDrawer.locator('.task-comments-header .ui-chip')).toHaveText('3');
      await openDetailsTab(assigneeDrawer);
      await expect(assigneeDrawer.locator('.task-drawer-badges')).toContainText(
        formatCommentsCount(3),
      );
      await expect(getTaskCard(assigneePage, commentsTaskTitle)).toContainText(
        formatCommentsCount(3),
      );

      // Persist across full reload
      await assigneePage.reload();
      await expect(getTaskCard(assigneePage, commentsTaskTitle)).toContainText(
        formatCommentsCount(3),
      );
      await getTaskCard(assigneePage, commentsTaskTitle).locator('.kanban-card-open').click();
      const reloadedAssigneeDrawer = getTaskDrawer(assigneePage);
      await expect(reloadedAssigneeDrawer.locator('.task-drawer-badges')).toContainText(
        formatCommentsCount(3),
      );
      await reloadedAssigneeDrawer.locator('.task-comments-jump-chip').click();
      await expect(reloadedAssigneeDrawer.locator('.task-comments-panel')).toBeVisible();
      await expect(reloadedAssigneeDrawer.getByText(liveCommentBody)).toBeVisible();

      // 2. Member D (without comment.create) sees comments cleanly, NO composer, NO Delete button, gets 403 on POST/DELETE
      const readOnlyPage = readOnlySession.page;
      await readOnlyPage.reload();
      const readOnlyDrawer = getTaskDrawer(readOnlyPage);
      await expect(readOnlyDrawer).toBeVisible();
      await openCommentsTab(readOnlyDrawer);
      await expect(readOnlyDrawer.getByText(liveCommentBody)).toBeVisible();
      await expect(readOnlyDrawer.getByLabel(viMessages.comments.composerLabel)).toHaveCount(0);
      await expect(
        readOnlyDrawer.getByRole('button', { name: viMessages.comments.deleteAction, exact: true }),
      ).toHaveCount(0);

      const deniedCreateRes = await readOnlyPage.request.post(
        `/api/v1/tasks/${commentsTaskId}/comments`,
        { data: { body: 'Unauthorized comment attempt' } },
      );
      expect(deniedCreateRes.status()).toBe(403);
      expect((await deniedCreateRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      const deniedDeleteRes = await readOnlyPage.request.delete(
        `/api/v1/comments/${creatorCommentId}`,
      );
      expect(deniedDeleteRes.status()).toBe(403);
      expect((await deniedDeleteRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      // 3. Author (Member A) deletes own comment via inline confirmation ("Xóa" -> "Xác nhận")
      const ownCommentItem = getTaskDrawer(assigneePage).locator('li.task-comment-item', {
        hasText: liveCommentBody,
      });
      await ownCommentItem
        .getByRole('button', { name: viMessages.comments.deleteAction, exact: true })
        .click();
      const deleteOwnResPromise = assigneePage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/comments/${liveCommentId}`) &&
          res.request().method() === 'DELETE',
      );
      await ownCommentItem
        .getByRole('button', { name: viMessages.comments.deleteConfirm, exact: true })
        .click();
      expect((await deleteOwnResPromise).status()).toBe(200);

      await expect(getTaskDrawer(assigneePage).getByText(liveCommentBody)).toHaveCount(0);
      await expect(getTaskDrawer(assigneePage).locator('.task-drawer-tab-count')).toHaveText('2');
      await expect(getTaskCard(assigneePage, commentsTaskTitle)).toContainText(
        formatCommentsCount(2),
      );

      // 4. User holding comment.delete_any (Member C) deletes Creator's comment via inline confirmation
      const outsiderPage = outsiderSession.page;
      await outsiderPage.reload();
      const outsiderDrawer = getTaskDrawer(outsiderPage);
      await expect(outsiderDrawer).toBeVisible();
      await openCommentsTab(outsiderDrawer);
      const outsiderTargetItem = outsiderDrawer.locator('li.task-comment-item', {
        hasText: creatorCommentBody,
      });
      await outsiderTargetItem
        .getByRole('button', { name: viMessages.comments.deleteAction, exact: true })
        .click();
      const deleteAnyResPromise = outsiderPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/comments/${creatorCommentId}`) &&
          res.request().method() === 'DELETE',
      );
      await outsiderTargetItem
        .getByRole('button', { name: viMessages.comments.deleteConfirm, exact: true })
        .click();
      expect((await deleteAnyResPromise).status()).toBe(200);

      await expect(outsiderDrawer.getByText(creatorCommentBody)).toHaveCount(0);
      await expect(outsiderDrawer.locator('.task-drawer-tab-count')).toHaveText('1');
      await expect(getTaskCard(outsiderPage, commentsTaskTitle)).toContainText(
        formatCommentsCount(1),
      );

      // 5. Verify task_events recorded comment.added & comment.deleted with ONLY comment_id UUID (zero body text or PII)
      const commentEvents = await db
        .select()
        .from(taskEvents)
        .where(
          and(
            eq(taskEvents.taskId, commentsTaskId),
            inArray(taskEvents.type, ['comment.added', 'comment.deleted']),
          ),
        )
        .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id));

      expect(commentEvents.map((evt) => evt.type)).toEqual([
        'comment.added',
        'comment.deleted',
        'comment.deleted',
      ]);
      for (const evt of commentEvents) {
        const keys = Object.keys(evt.changes);
        expect(keys).toEqual(['comment_id']);
        expect(uuidSchema.safeParse(evt.changes.comment_id).success).toBe(true);
      }
      expect(commentEvents[0]?.changes.comment_id).toBe(liveCommentId);
      expect(commentEvents[1]?.changes.comment_id).toBe(liveCommentId);
      expect(commentEvents[2]?.changes.comment_id).toBe(creatorCommentId);

      const serializedEvents = commentEvents.map((evt) => JSON.stringify(evt));
      for (const raw of serializedEvents) {
        expect(raw).not.toContain(liveCommentBody);
        expect(raw).not.toContain(creatorCommentBody);
        expect(raw).not.toContain(inactiveCommentBody);
      }
      assertZeroPiiInStrings(
        [
          ...capturedPayloads,
          ...serializedEvents,
          await outsiderDrawer.innerText(),
        ],
        sensitiveValues,
      );

      for (const s of [assigneeSession, readOnlySession, outsiderSession]) {
        await s.tracker.assertClean();
      }
    } finally {
      await Promise.all([
        assigneeSession.context.close(),
        readOnlySession.context.close(),
        outsiderSession.context.close(),
      ]);
    }
  });

  test('Comments tab paginates 10 newest-first items, pins composer inside scrollable panel, and collapses long comments', async ({
    browser,
  }) => {
    const bulkTaskId = randomUUID();
    trackedTaskIds.push(bulkTaskId);
    const bulkTaskTitle = `E7 Bulk Comments ${suffix}`;
    const longNewestBody = [
      `E7 long comment #12 ${suffix}`,
      'Line 2 detail for scrolling check',
      'Line 3 detail for scrolling check',
      'Line 4 detail for scrolling check',
      'Line 5 detail for scrolling check',
      'Line 6 extra detail should collapse',
      'Line 7 extra detail should collapse',
    ].join('\n');

    await db.insert(tasks).values({
      id: bulkTaskId,
      boardId: commentsBoardId,
      columnId: commentsTodoColId,
      title: bulkTaskTitle,
      description: 'Pagination and collapse verification task',
      priority: 2,
      position: '2000',
      isHidden: false,
      createdBy: creatorUserId,
    });

    const baseTime = new Date('2026-11-25T01:00:00.000Z').getTime();
    await db.insert(comments).values(
      Array.from({ length: 12 }, (_, idx) => ({
        id: randomUUID(),
        taskId: bulkTaskId,
        userId: idx % 2 === 0 ? assigneeUserId : creatorUserId,
        body: idx === 11 ? longNewestBody : `E7 bulk comment #${idx + 1} ${suffix}`,
        createdAt: new Date(baseTime + idx * 60_000),
      })),
    );

    const session = await openSignedInContext(
      browser,
      assigneeStudentId,
      `/boards/${commentsBoardId}?task=${bulkTaskId}`,
    );

    try {
      const page = session.page;
      const drawer = getTaskDrawer(page);
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('.task-comments-panel')).toHaveCount(0);
      await expect(drawer.locator('.task-drawer-tab-count')).toHaveText('12');

      await openCommentsTab(drawer);
      await expect(drawer.locator('.task-comments-composer-pin')).toBeVisible();
      await expect(drawer.locator('.task-comments-scroll')).toBeVisible();

      const items = drawer.locator('li.task-comment-item');
      await expect(items).toHaveCount(10);
      await expect(items.first()).toContainText(`E7 long comment #12 ${suffix}`);
      await expect(drawer).toContainText('Đang hiện 10 / 12');

      const expandBtn = items.first().locator('.task-comment-expand-btn');
      await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
      await expect(expandBtn).toHaveText(viMessages.comments.showMore);
      await expandBtn.click();
      await expect(expandBtn).toHaveAttribute('aria-expanded', 'true');
      await expect(expandBtn).toHaveText(viMessages.comments.showLess);
      await expandBtn.click();
      await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');

      const loadOlderBtn = drawer.getByRole('button', {
        name: viMessages.comments.loadOlder,
        exact: true,
      });
      await expect(loadOlderBtn).toBeVisible();
      await loadOlderBtn.click();
      await expect(items).toHaveCount(12);
      await expect(items.last()).toContainText(`E7 bulk comment #1 ${suffix}`);
      await expect(loadOlderBtn).toHaveCount(0);

      await session.tracker.assertClean();
    } finally {
      await session.context.close();
    }
  });
});
