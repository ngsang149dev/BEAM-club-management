import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  columns,
  comments,
  loginAttempts,
  notifications,
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

const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatPriorityChangedSummary(fromLabel: string, toLabel: string): string {
  return viMessages.taskHistory.events.priorityChanged
    .replace('{from}', fromLabel)
    .replace('{to}', toLabel);
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
  returnTo = '/boards',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === returnTo);
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
      hasText: new RegExp(`^${escapeRegex(columnName)}$`),
    }),
  });
}

function getTaskCardInColumn(page: Page, columnName: string, title: string): Locator {
  return getColumnSection(page, columnName).locator('article.kanban-card', {
    has: page.locator('.kanban-card-title', {
      hasText: new RegExp(`^${escapeRegex(title)}$`),
    }),
  });
}

function getTaskDrawer(page: Page): Locator {
  return page.locator('aside.ui-drawer-task[role="dialog"]');
}

async function openHistoryTab(drawer: Locator): Promise<void> {
  await drawer
    .getByRole('tab', { name: new RegExp(`^${escapeRegex(viMessages.tasks.tabHistory)}$`) })
    .click();
  await expect(drawer.locator('.task-history-section')).toBeVisible();
}

async function openDetailsTab(drawer: Locator): Promise<void> {
  await drawer
    .getByRole('tab', { name: new RegExp(`^${escapeRegex(viMessages.tasks.tabDetails)}$`) })
    .click();
  await expect(drawer.locator('.task-drawer-grid')).toBeVisible();
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

function extractPgErrorInfo(error: unknown): { message: string; code?: string; hint?: string } {
  const messages: string[] = [];
  let code: string | undefined;
  let hint: string | undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    const record = current as { message?: unknown; code?: unknown; hint?: unknown; cause?: unknown };
    if (typeof record.message === 'string') messages.push(record.message);
    if (!code && typeof record.code === 'string') code = record.code;
    if (!hint && typeof record.hint === 'string') hint = record.hint;
    current = record.cause;
  }
  return { message: messages.join(' | '), code, hint };
}

test.describe('E7A Task History, Quick Undo, Conflict Force-Revert & Board Trash E2E (FR-60..FR-62, AC-16..AC-20, AC-22, WQ-17)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);

  const adminUserId = randomUUID();
  const creatorEditorUserId = randomUUID();
  const peerEditorUserId = randomUUID();
  const assigneeBasicUserId = randomUUID();
  const deleterUserId = randomUUID();
  const inactiveFormerUserId = randomUUID();

  const adminStudentId = `MSSV-E7A-ADM-${suffix}`;
  const creatorEditorStudentId = `MSSV-E7A-CRE-${suffix}`;
  const peerEditorStudentId = `MSSV-E7A-PER-${suffix}`;
  const assigneeBasicStudentId = `MSSV-E7A-BAS-${suffix}`;
  const deleterStudentId = `MSSV-E7A-DEL-${suffix}`;
  const inactiveStudentId = `MSSV-E7A-INA-${suffix}`;

  const adminEmail = `e7a-admin-${suffix}@eiu.edu.vn`;
  const creatorEditorEmail = `e7a-creator-${suffix}@eiu.edu.vn`;
  const peerEditorEmail = `e7a-peer-${suffix}@eiu.edu.vn`;
  const assigneeBasicEmail = `e7a-basic-${suffix}@eiu.edu.vn`;
  const deleterEmail = `e7a-deleter-${suffix}@eiu.edu.vn`;
  const inactiveEmail = `e7a-inactive-${suffix}@eiu.edu.vn`;

  const adminFullName = `E7A Admin ${suffix}`;
  const creatorEditorFullName = `E7A CreatorEditor ${suffix}`;
  const peerEditorFullName = `E7A PeerEditor ${suffix}`;
  const assigneeBasicFullName = `E7A BasicAssignee ${suffix}`;
  const deleterFullName = `E7A Deleter ${suffix}`;
  const inactiveFormerFullName = `E7A FormerMember ${suffix}`;

  const trackedUserIds = [
    adminUserId,
    creatorEditorUserId,
    peerEditorUserId,
    assigneeBasicUserId,
    deleterUserId,
    inactiveFormerUserId,
  ];
  const trackedStudentIds = [
    adminStudentId,
    creatorEditorStudentId,
    peerEditorStudentId,
    assigneeBasicStudentId,
    deleterStudentId,
    inactiveStudentId,
  ];
  const allFullNames = [
    adminFullName,
    creatorEditorFullName,
    peerEditorFullName,
    assigneeBasicFullName,
    deleterFullName,
    inactiveFormerFullName,
  ];
  const sensitiveValues = [
    ...trackedStudentIds,
    adminEmail,
    creatorEditorEmail,
    peerEditorEmail,
    assigneeBasicEmail,
    deleterEmail,
    inactiveEmail,
  ];

  const historyBoardId = randomUUID();
  const historyBoardName = `E7A History Board ${suffix}`;
  const histTodoColId = randomUUID();
  const histDoingColId = randomUUID();
  const histDoneColId = randomUUID();

  const trashBoardId = randomUUID();
  const trashBoardName = `E7A Trash Board ${suffix}`;
  const trashTodoColId = randomUUID();
  const trashDoneColId = randomUUID();

  const primaryTaskId = randomUUID();
  const primaryTaskTitle = `E7A Primary History ${suffix}`;

  const conflictTaskId = randomUUID();
  const conflictTaskTitle = `E7A Conflict Task ${suffix}`;

  const rbacPublicTaskId = randomUUID();
  const rbacPublicTaskTitle = `E7A RBAC Public ${suffix}`;
  const rbacHiddenTaskId = randomUUID();
  const rbacHiddenTaskTitle = `E7A RBAC Hidden ${suffix}`;

  const trashPublicTaskId = randomUUID();
  const trashPublicTaskTitle = `E7A Trash Public ${suffix}`;
  const trashHiddenTaskId = randomUUID();
  const trashHiddenTaskTitle = `E7A Trash Hidden Secret ${suffix}`;

  const rbacCreatedEvtId = randomUUID();
  const rbacUpdatedEvtId = randomUUID();
  const rbacMovedEvtId = randomUUID();
  const rbacAssignEvtId = randomUUID();
  const rbacHiddenEvtId = randomUUID();
  const rbacDeletedEvtId = randomUUID();
  const rbacRestoredEvtId = randomUUID();
  const rbacCommentEvtId = randomUUID();
  const rbacCommentId = randomUUID();

  const hiddenUpdatedEvtId = randomUUID();

  const trackedBoardIds = [historyBoardId, trashBoardId];
  const trackedTaskIds = [
    primaryTaskId,
    conflictTaskId,
    rbacPublicTaskId,
    rbacHiddenTaskId,
    trashPublicTaskId,
    trashHiddenTaskId,
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
        id: creatorEditorUserId,
        studentId: creatorEditorStudentId,
        email: creatorEditorEmail,
        fullName: creatorEditorFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: peerEditorUserId,
        studentId: peerEditorStudentId,
        email: peerEditorEmail,
        fullName: peerEditorFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: assigneeBasicUserId,
        studentId: assigneeBasicStudentId,
        email: assigneeBasicEmail,
        fullName: assigneeBasicFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: deleterUserId,
        studentId: deleterStudentId,
        email: deleterEmail,
        fullName: deleterFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveFormerUserId,
        studentId: inactiveStudentId,
        email: inactiveEmail,
        fullName: inactiveFormerFullName,
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
          'task.update_any',
          'task.assign',
          'task.delete',
          'comment.create',
        ] as const
      ).map((code) => ({
        userId: creatorEditorUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...(['member.view', 'task.update_any', 'task.delete', 'comment.create'] as const).map(
        (code) => ({
          userId: peerEditorUserId,
          permissionCode: code,
          grantedBy: adminUserId,
        }),
      ),
      ...(['member.view', 'task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: assigneeBasicUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...(['member.view', 'task.delete'] as const).map((code) => ({
        userId: deleterUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
    ]);

    await db.insert(boards).values([
      { id: historyBoardId, name: historyBoardName, createdBy: adminUserId },
      { id: trashBoardId, name: trashBoardName, createdBy: adminUserId },
    ]);

    await db.insert(columns).values([
      { id: histTodoColId, boardId: historyBoardId, name: 'Todo', orderIndex: 0 },
      { id: histDoingColId, boardId: historyBoardId, name: 'Doing', orderIndex: 1 },
      { id: histDoneColId, boardId: historyBoardId, name: 'Done', orderIndex: 2 },
      { id: trashTodoColId, boardId: trashBoardId, name: 'Todo', orderIndex: 0 },
      { id: trashDoneColId, boardId: trashBoardId, name: 'Done', orderIndex: 1 },
    ]);

    const tBase = new Date('2026-11-24T00:00:00.000Z').getTime();
    await db.insert(tasks).values([
      {
        id: primaryTaskId,
        boardId: historyBoardId,
        columnId: histTodoColId,
        title: primaryTaskTitle,
        description: 'legacy desc',
        priority: 2,
        position: '1000',
        isHidden: false,
        createdBy: creatorEditorUserId,
      },
      {
        id: conflictTaskId,
        boardId: historyBoardId,
        columnId: histTodoColId,
        title: conflictTaskTitle,
        description: 'Conflict detection target',
        priority: 2,
        position: '2000',
        isHidden: false,
        createdBy: creatorEditorUserId,
      },
      {
        id: rbacPublicTaskId,
        boardId: historyBoardId,
        columnId: histTodoColId,
        title: rbacPublicTaskTitle,
        description: 'RBAC revert check target',
        priority: 2,
        position: '3000',
        isHidden: false,
        createdBy: creatorEditorUserId,
      },
      {
        id: rbacHiddenTaskId,
        boardId: historyBoardId,
        columnId: histTodoColId,
        title: rbacHiddenTaskTitle,
        description: 'Hidden RBAC target',
        priority: 2,
        position: '4000',
        isHidden: true,
        createdBy: adminUserId,
      },
      {
        id: trashPublicTaskId,
        boardId: trashBoardId,
        columnId: trashTodoColId,
        title: trashPublicTaskTitle,
        description: 'Public task for trash & 10s delete undo',
        priority: 2,
        position: '1000',
        isHidden: false,
        createdBy: deleterUserId,
      },
      {
        id: trashHiddenTaskId,
        boardId: trashBoardId,
        columnId: trashTodoColId,
        title: trashHiddenTaskTitle,
        description: 'Hidden soft-deleted task invisible to deleter (WQ-17)',
        priority: 3,
        position: '2000',
        isHidden: true,
        deletedAt: new Date(tBase + 30 * 60_000),
        createdBy: adminUserId,
      },
    ]);

    await db.insert(taskAssignees).values({
      taskId: rbacPublicTaskId,
      userId: assigneeBasicUserId,
    });

    await db.insert(comments).values({
      id: rbacCommentId,
      taskId: rbacPublicTaskId,
      userId: assigneeBasicUserId,
      body: `E7A RBAC comment ${suffix}`,
      createdAt: new Date(tBase + 25 * 60_000),
    });

    await db.insert(taskEvents).values([
      // Primary task baseline history (created + former member edit)
      {
        taskId: primaryTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.created',
        changes: { column_id: histTodoColId },
        createdAt: new Date(tBase),
      },
      {
        taskId: primaryTaskId,
        boardId: historyBoardId,
        actorId: inactiveFormerUserId,
        type: 'task.updated',
        changes: { description: { from: null, to: 'legacy desc' } },
        createdAt: new Date(tBase + 5 * 60_000),
      },
      // Conflict task creation event
      {
        taskId: conflictTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.created',
        changes: { column_id: histTodoColId },
        createdAt: new Date(tBase),
      },
      // RBAC public task mixed history events
      {
        id: rbacCreatedEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.created',
        changes: { column_id: histTodoColId },
        createdAt: new Date(tBase),
      },
      {
        id: rbacUpdatedEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.updated',
        changes: { priority: { from: 3, to: 2 } },
        createdAt: new Date(tBase + 5 * 60_000),
      },
      {
        id: rbacMovedEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.moved',
        changes: {
          column_id: { from: histDoingColId, to: histTodoColId },
          position: { from: 1000, to: 3000 },
        },
        createdAt: new Date(tBase + 10 * 60_000),
      },
      {
        id: rbacAssignEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.assignees_changed',
        changes: { assignee_ids: { from: [], to: [assigneeBasicUserId] } },
        createdAt: new Date(tBase + 15 * 60_000),
      },
      {
        id: rbacHiddenEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.hidden_changed',
        changes: { is_hidden: { from: true, to: false } },
        createdAt: new Date(tBase + 18 * 60_000),
      },
      {
        id: rbacDeletedEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.deleted',
        changes: { deleted_at: { from: null, to: '2026-11-24T00:20:00.000Z' } },
        createdAt: new Date(tBase + 20 * 60_000),
      },
      {
        id: rbacRestoredEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: creatorEditorUserId,
        type: 'task.restored',
        changes: {
          deleted_at: { from: '2026-11-24T00:20:00.000Z', to: null },
          column_id: { from: histTodoColId, to: histTodoColId },
        },
        createdAt: new Date(tBase + 22 * 60_000),
      },
      {
        id: rbacCommentEvtId,
        taskId: rbacPublicTaskId,
        boardId: historyBoardId,
        actorId: assigneeBasicUserId,
        type: 'comment.added',
        changes: { comment_id: rbacCommentId },
        createdAt: new Date(tBase + 25 * 60_000),
      },
      // Hidden RBAC task events
      {
        taskId: rbacHiddenTaskId,
        boardId: historyBoardId,
        actorId: adminUserId,
        type: 'task.created',
        changes: { column_id: histTodoColId },
        createdAt: new Date(tBase),
      },
      {
        id: hiddenUpdatedEvtId,
        taskId: rbacHiddenTaskId,
        boardId: historyBoardId,
        actorId: adminUserId,
        type: 'task.updated',
        changes: { priority: { from: 1, to: 2 } },
        createdAt: new Date(tBase + 5 * 60_000),
      },
      // Trash tasks events
      {
        taskId: trashPublicTaskId,
        boardId: trashBoardId,
        actorId: deleterUserId,
        type: 'task.created',
        changes: { column_id: trashTodoColId },
        createdAt: new Date(tBase),
      },
      {
        taskId: trashHiddenTaskId,
        boardId: trashBoardId,
        actorId: adminUserId,
        type: 'task.created',
        changes: { column_id: trashTodoColId },
        createdAt: new Date(tBase),
      },
      {
        taskId: trashHiddenTaskId,
        boardId: trashBoardId,
        actorId: adminUserId,
        type: 'task.deleted',
        changes: { deleted_at: { from: null, to: new Date(tBase + 30 * 60_000).toISOString() } },
        createdAt: new Date(tBase + 30 * 60_000),
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
      // task_events is append-only with ON DELETE RESTRICT to tasks/boards/profiles,
      // so we clear mutable child tables and mark tasks/boards purged & profiles inactive.
      await db.delete(notifications).where(inArray(notifications.taskId, trackedTaskIds));
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

      await db
        .update(boards)
        .set({
          archivedAt: sql`COALESCE(${boards.archivedAt}, ${now.toISOString()}::timestamptz)`,
          purgedAt: sql`COALESCE(${boards.purgedAt}, ${now.toISOString()}::timestamptz)`,
          departmentId: null,
          updatedAt: now,
        })
        .where(inArray(boards.id, trackedBoardIds));

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
            creatorEditorUserId,
            peerEditorUserId,
            assigneeBasicUserId,
            deleterUserId,
            inactiveFormerUserId,
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

  test('History tab rendering, AC-16, AC-17 (10s Undo toast & History revert), AC-22 append-only DB trigger, and zero PII / no raw UUIDs', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const capturedEventPayloads: string[] = [];

    page.on('response', async (response) => {
      if (
        response.url().includes(`/api/v1/tasks/${primaryTaskId}/events`) &&
        (response.headers()['content-type'] ?? '').includes('application/json')
      ) {
        try {
          capturedEventPayloads.push(await response.text());
        } catch {
          // Ignore aborted responses during reload
        }
      }
    });

    await signInAs(page, creatorEditorStudentId, `/boards/${historyBoardId}`);
    await expect(getTaskCardInColumn(page, 'Todo', primaryTaskTitle)).toBeVisible();

    // 1. Move task via S04 "Chuyển tới cột…" menu -> verify Sonner Undo toast -> click Undo -> persists across reload + compensating task_event
    const primaryCardInTodo = getTaskCardInColumn(page, 'Todo', primaryTaskTitle);
    await primaryCardInTodo.getByLabel(viMessages.tasks.taskActionsMenu, { exact: true }).click();
    await expect(primaryCardInTodo.getByText(viMessages.tasks.moveToColumnMenu)).toBeVisible();

    const movePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/move`) &&
        res.request().method() === 'POST',
    );
    await primaryCardInTodo.getByRole('menuitem', { name: 'Doing' }).click();
    const moveRes = await movePromise;
    expect(moveRes.status()).toBe(200);
    const moveEventId = ((await moveRes.json()) as { eventId: string }).eventId;

    await expect(getTaskCardInColumn(page, 'Doing', primaryTaskTitle)).toBeVisible();

    const moveToastText = viMessages.tasks.movedToColumnToast.replace('{column}', 'Doing');
    const moveToast = page.locator('[data-sonner-toast]', { hasText: moveToastText }).last();
    await expect(moveToast).toBeVisible();
    const moveUndoBtn = moveToast.getByRole('button', {
      name: viMessages.taskHistory.undoAction,
      exact: true,
    });
    await expect(moveUndoBtn).toBeVisible();

    const revertMovePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/events/${moveEventId}/revert`) &&
        res.request().method() === 'POST',
    );
    await moveUndoBtn.click();
    expect((await revertMovePromise).status()).toBe(200);

    await expect(getTaskCardInColumn(page, 'Todo', primaryTaskTitle)).toBeVisible();
    await expect(getTaskCardInColumn(page, 'Doing', primaryTaskTitle)).toHaveCount(0);

    await page.reload();
    await expect(getTaskCardInColumn(page, 'Todo', primaryTaskTitle)).toBeVisible();
    await expect(getTaskCardInColumn(page, 'Doing', primaryTaskTitle)).toHaveCount(0);

    const moveEventsAfterUndo = await db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, primaryTaskId), eq(taskEvents.type, 'task.moved')))
      .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id));
    expect(moveEventsAfterUndo).toHaveLength(2);
    expect(moveEventsAfterUndo[0]?.id).toBe(moveEventId);
    expect(moveEventsAfterUndo[0]?.revertsEventId).toBeNull();
    expect(moveEventsAfterUndo[1]?.revertsEventId).toBe(moveEventId);
    expect(moveEventsAfterUndo[1]?.forced).toBe(false);

    // 2. Open S05 Drawer -> update Priority (2 -> 4) -> click 10s Undo toast -> Priority reverts back to 2 (AC-17)
    await getTaskCardInColumn(page, 'Todo', primaryTaskTitle).locator('.kanban-card-open').click();
    const drawer = getTaskDrawer(page);
    await expect(drawer).toBeVisible();

    const prioritySelect = drawer.getByLabel(viMessages.tasks.priorityLabel, { exact: true });
    await expect(prioritySelect).toHaveValue('2');
    await prioritySelect.selectOption('4');

    const patchPrio1Promise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/tasks/${primaryTaskId}`) &&
        res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
    const patchPrio1Res = await patchPrio1Promise;
    expect(patchPrio1Res.status()).toBe(200);
    const prio4EventId = ((await patchPrio1Res.json()) as { eventId: string }).eventId;

    const prioToast = page
      .locator('[data-sonner-toast]', { hasText: viMessages.tasks.updatedToast })
      .last();
    await expect(prioToast).toBeVisible();
    const prioUndoBtn = prioToast.getByRole('button', {
      name: viMessages.taskHistory.undoAction,
      exact: true,
    });
    await expect(prioUndoBtn).toBeVisible();

    const revertPrio4Promise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/events/${prio4EventId}/revert`) &&
        res.request().method() === 'POST',
    );
    await prioUndoBtn.click();
    expect((await revertPrio4Promise).status()).toBe(200);

    await expect(drawer.getByLabel(viMessages.tasks.priorityLabel, { exact: true })).toHaveValue('2');
    await expect(drawer.locator('.task-drawer-badges')).toContainText(viMessages.priority.medium);

    // 3. Update Priority again (2 -> 3) -> switch to Lịch sử tab -> verify entries, order, (đã rời), no UUID/PII, revert from history
    await drawer.getByLabel(viMessages.tasks.priorityLabel, { exact: true }).selectOption('3');
    const patchPrio2Promise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/tasks/${primaryTaskId}`) &&
        res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
    const patchPrio2Res = await patchPrio2Promise;
    expect(patchPrio2Res.status()).toBe(200);
    const prio3EventId = ((await patchPrio2Res.json()) as { eventId: string }).eventId;

    const eventsListPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/events`) &&
        res.request().method() === 'GET' &&
        res.status() === 200,
    );
    await openHistoryTab(drawer);
    await eventsListPromise;

    const historyRows = drawer.locator('li.task-history-row');
    await expect(historyRows).toHaveCount(7);

    const expectedPrio2To3Text = formatPriorityChangedSummary(
      viMessages.priority.medium,
      viMessages.priority.high,
    );
    const expectedPrio4To2Text = formatPriorityChangedSummary(
      viMessages.priority.urgent,
      viMessages.priority.medium,
    );
    const expectedCreatedText = viMessages.taskHistory.events.taskCreatedInColumn.replace(
      '{column}',
      'Todo',
    );
    const expectedMovedTodoToDoingText = viMessages.taskHistory.events.taskMoved
      .replace('{from}', 'Todo')
      .replace('{to}', 'Doing');

    // Newest-first assertions
    await expect(historyRows.first()).toContainText(creatorEditorFullName);
    await expect(historyRows.first()).toContainText(expectedPrio2To3Text);

    await expect(historyRows.nth(1)).toContainText(expectedPrio4To2Text);
    await expect(
      historyRows.nth(1).locator('.task-history-badge.is-revert'),
    ).toHaveText(viMessages.taskHistory.revertedBadge);

    await expect(
      drawer.locator('li.task-history-row', { hasText: expectedMovedTodoToDoingText }),
    ).toBeVisible();

    const formerRow = drawer.locator('li.task-history-row', { hasText: inactiveFormerFullName });
    await expect(formerRow).toBeVisible();
    await expect(formerRow).toContainText(`${inactiveFormerFullName} ${viMessages.member.leftBadge}`);
    await expect(formerRow).toContainText(viMessages.taskHistory.events.descriptionAdded);

    const createdRow = historyRows.last();
    await expect(createdRow).toContainText(expectedCreatedText);
    await expect(
      createdRow.getByRole('button', {
        name: viMessages.taskHistory.restoreValueButton,
        exact: true,
      }),
    ).toHaveCount(0);

    await expect(drawer.locator('.task-history-foot')).toHaveText(
      viMessages.taskHistory.appendOnlyNotice,
    );

    const historyDomText = await drawer.locator('.task-history-section').innerText();
    expect(historyDomText).not.toMatch(UUID_PATTERN);
    assertZeroPiiInStrings([historyDomText, ...capturedEventPayloads], sensitiveValues);

    // Revert 2 -> 3 directly from History tab ("Khôi phục giá trị này")
    const prio2To3Row = drawer.locator('li.task-history-row', { hasText: expectedPrio2To3Text });
    const historyRevertPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/events/${prio3EventId}/revert`) &&
        res.request().method() === 'POST',
    );
    await prio2To3Row
      .getByRole('button', { name: viMessages.taskHistory.restoreValueButton, exact: true })
      .click();
    expect((await historyRevertPromise).status()).toBe(200);

    const expectedPrio3To2Text = formatPriorityChangedSummary(
      viMessages.priority.high,
      viMessages.priority.medium,
    );
    await expect(historyRows).toHaveCount(8);
    await expect(historyRows.first()).toContainText(expectedPrio3To2Text);
    await expect(
      historyRows.first().locator('.task-history-badge.is-revert'),
    ).toHaveText(viMessages.taskHistory.revertedBadge);

    await openDetailsTab(drawer);
    await expect(drawer.getByLabel(viMessages.tasks.priorityLabel, { exact: true })).toHaveValue('2');
    await expect(drawer.locator('.task-drawer-badges')).toContainText(viMessages.priority.medium);

    // Verify DB task_events are strictly append-only (no names/PII stored in JSON)
    const dbEvents = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, primaryTaskId))
      .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id));
    expect(dbEvents).toHaveLength(8);
    assertZeroPiiInStrings(
      dbEvents.map((evt) => JSON.stringify(evt)),
      [...sensitiveValues, ...allFullNames],
    );

    // 4. AC-22: Append-only DB protection — direct UPDATE & DELETE on task_events MUST fail with append-only trigger error
    let updateError: unknown = null;
    try {
      await db.update(taskEvents).set({ forced: true }).where(eq(taskEvents.id, moveEventId));
    } catch (err) {
      updateError = err;
    }
    expect(updateError).not.toBeNull();
    const updatePgInfo = extractPgErrorInfo(updateError);
    expect(updatePgInfo.message.toLowerCase()).toContain('append-only');
    expect(updatePgInfo.hint).toBe('APPEND_ONLY_TABLE');

    let deleteError: unknown = null;
    try {
      await db.delete(taskEvents).where(eq(taskEvents.id, moveEventId));
    } catch (err) {
      deleteError = err;
    }
    expect(deleteError).not.toBeNull();
    const deletePgInfo = extractPgErrorInfo(deleteError);
    expect(deletePgInfo.message.toLowerCase()).toContain('append-only');
    expect(deletePgInfo.hint).toBe('APPEND_ONLY_TABLE');

    await tracker.assertClean();
  });

  test('Conflict detection AC-18 (409 REVERT_CONFLICT with conflictingFields and force=true modal)', async ({
    browser,
  }) => {
    const userASession = await openSignedInContext(
      browser,
      creatorEditorStudentId,
      `/boards/${historyBoardId}?task=${conflictTaskId}`,
    );
    const userBSession = await openSignedInContext(
      browser,
      peerEditorStudentId,
      `/boards/${historyBoardId}?task=${conflictTaskId}`,
    );

    try {
      const pageA = userASession.page;
      const pageB = userBSession.page;
      const drawerA = getTaskDrawer(pageA);
      const drawerB = getTaskDrawer(pageB);
      await expect(drawerA).toBeVisible();
      await expect(drawerB).toBeVisible();

      // User A updates Priority 2 -> 3 (event X)
      await drawerA.getByLabel(viMessages.tasks.priorityLabel, { exact: true }).selectOption('3');
      const userAPatchPromise = pageA.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/tasks/${conflictTaskId}`) &&
          res.request().method() === 'PATCH',
      );
      await drawerA.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
      const userAPatchRes = await userAPatchPromise;
      expect(userAPatchRes.status()).toBe(200);
      const eventXId = ((await userAPatchRes.json()) as { eventId: string }).eventId;

      // User B reloads task detail so version matches, then updates Priority 3 -> 4
      await pageB.reload();
      await expect(drawerB).toBeVisible();
      await expect(drawerB.getByLabel(viMessages.tasks.priorityLabel, { exact: true })).toHaveValue(
        '3',
      );
      await drawerB.getByLabel(viMessages.tasks.priorityLabel, { exact: true }).selectOption('4');
      const userBPatchPromise = pageB.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/tasks/${conflictTaskId}`) &&
          res.request().method() === 'PATCH',
      );
      await drawerB.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
      expect((await userBPatchPromise).status()).toBe(200);

      // User A opens Lịch sử tab and clicks "Khôi phục giá trị này" on event X (2 -> 3)
      const eventsFetchPromise = pageA.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${conflictTaskId}/events`) &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );
      await openHistoryTab(drawerA);
      await eventsFetchPromise;

      const eventXSummary = formatPriorityChangedSummary(
        viMessages.priority.medium,
        viMessages.priority.high,
      );
      const eventXRow = drawerA.locator('li.task-history-row', { hasText: eventXSummary });
      await expect(eventXRow).toBeVisible();

      const conflictResPromise = pageA.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${conflictTaskId}/events/${eventXId}/revert`) &&
          res.request().method() === 'POST',
      );
      await eventXRow
        .getByRole('button', { name: viMessages.taskHistory.restoreValueButton, exact: true })
        .click();
      const conflictRes = await conflictResPromise;
      expect(conflictRes.status()).toBe(409);
      expect(
        (await conflictRes.json()) as {
          error: { code: string; details: { conflictingFields: string[] } };
        },
      ).toMatchObject({
        error: {
          code: 'REVERT_CONFLICT',
          details: { conflictingFields: ['priority'] },
        },
      });

      // Verify TaskRevertConflictModal renders title + conflicting field chip + confirm force button
      const conflictModal = pageA.locator('.ui-modal[role="dialog"]');
      await expect(conflictModal).toBeVisible();
      await expect(conflictModal.getByRole('heading')).toHaveText(
        viMessages.taskHistory.conflictModalTitle,
      );
      await expect(conflictModal.locator('.task-conflict-field-chip')).toHaveText([
        viMessages.taskHistory.conflictFields.priority,
      ]);

      const forceBtn = conflictModal.getByRole('button', {
        name: viMessages.taskHistory.conflictConfirmForce,
        exact: true,
      });
      await expect(forceBtn).toBeVisible();

      const forceResPromise = pageA.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${conflictTaskId}/events/${eventXId}/revert`) &&
          res.request().method() === 'POST',
      );
      await forceBtn.click();
      const forceRes = await forceResPromise;
      expect(forceRes.status()).toBe(200);
      const forceJson = (await forceRes.json()) as {
        task: { priority: number };
        eventId: string;
        revertedEventId: string;
      };
      expect(forceJson.task.priority).toBe(2);
      expect(forceJson.revertedEventId).toBe(eventXId);

      await expect(conflictModal).toHaveCount(0);

      // New top history item shows both Hoàn tác & Ghi đè xung đột badges
      const topRow = drawerA.locator('li.task-history-row').first();
      await expect(topRow.locator('.task-history-badge.is-revert')).toHaveText(
        viMessages.taskHistory.revertedBadge,
      );
      await expect(topRow.locator('.task-history-badge.is-forced')).toHaveText(
        viMessages.taskHistory.forcedBadge,
      );
      await expect(topRow).toContainText(
        formatPriorityChangedSummary(viMessages.priority.urgent, viMessages.priority.medium),
      );

      // Verify forced: true & revertsEventId in DB
      const [dbForcedRow] = await db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.id, forceJson.eventId));
      expect(dbForcedRow).toBeDefined();
      expect(dbForcedRow?.revertsEventId).toBe(eventXId);
      expect(dbForcedRow?.forced).toBe(true);

      await openDetailsTab(drawerA);
      await expect(drawerA.getByLabel(viMessages.tasks.priorityLabel, { exact: true })).toHaveValue(
        '2',
      );

      await userASession.tracker.assertClean();
      await userBSession.tracker.assertClean();
    } finally {
      await Promise.all([userASession.context.close(), userBSession.context.close()]);
    }
  });

  test('Original permission enforcement AC-19 (UI gating + 403/400 API) and hidden task 404 concealment AC-20', async ({
    browser,
  }) => {
    const basicSession = await openSignedInContext(
      browser,
      assigneeBasicStudentId,
      `/boards/${historyBoardId}?task=${rbacPublicTaskId}`,
    );
    const outsiderSession = await openSignedInContext(
      browser,
      peerEditorStudentId,
      `/boards/${historyBoardId}`,
    );

    try {
      const basicPage = basicSession.page;
      const basicDrawer = getTaskDrawer(basicPage);
      await expect(basicDrawer).toBeVisible();

      const eventsResPromise = basicPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${rbacPublicTaskId}/events`) &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );
      await openHistoryTab(basicDrawer);
      await eventsResPromise;

      const updatedSummary = formatPriorityChangedSummary(
        viMessages.priority.high,
        viMessages.priority.medium,
      );
      const movedSummary = viMessages.taskHistory.events.taskMoved
        .replace('{from}', 'Doing')
        .replace('{to}', 'Todo');
      const assignSummary = viMessages.taskHistory.events.assignedTo.replace(
        '{to}',
        assigneeBasicFullName,
      );
      const createdSummary = viMessages.taskHistory.events.taskCreatedInColumn.replace(
        '{column}',
        'Todo',
      );

      const updatedRow = basicDrawer.locator('li.task-history-row', { hasText: updatedSummary });
      const movedRow = basicDrawer.locator('li.task-history-row', { hasText: movedSummary });
      const assignRow = basicDrawer.locator('li.task-history-row', { hasText: assignSummary });
      const hiddenRow = basicDrawer.locator('li.task-history-row', {
        hasText: viMessages.taskHistory.events.hiddenDisabled,
      });
      const deletedRow = basicDrawer.locator('li.task-history-row', {
        hasText: viMessages.taskHistory.events.taskDeleted,
      });
      const commentRow = basicDrawer.locator('li.task-history-row', {
        hasText: viMessages.taskHistory.events.commentAdded,
      });
      const createdRow = basicDrawer.locator('li.task-history-row', { hasText: createdSummary });

      await expect(updatedRow).toBeVisible();
      await expect(movedRow).toBeVisible();
      await expect(assignRow).toBeVisible();
      await expect(hiddenRow).toBeVisible();
      await expect(deletedRow).toBeVisible();
      await expect(commentRow).toBeVisible();
      await expect(createdRow).toBeVisible();

      // Assigned member with task.update_assigned sees revert button on task.updated & task.moved ONLY
      await expect(
        updatedRow.getByRole('button', {
          name: viMessages.taskHistory.restoreValueButton,
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        movedRow.getByRole('button', {
          name: viMessages.taskHistory.restoreValueButton,
          exact: true,
        }),
      ).toHaveCount(1);

      for (const forbiddenOrNonRevertableRow of [
        assignRow,
        hiddenRow,
        deletedRow,
        commentRow,
        createdRow,
      ]) {
        await expect(
          forbiddenOrNonRevertableRow.getByRole('button', {
            name: viMessages.taskHistory.restoreValueButton,
            exact: true,
          }),
        ).toHaveCount(0);
      }

      // Direct API call to revert task.assignees_changed -> 403 FORBIDDEN (AC-19)
      const assignRevertRes = await basicPage.request.post(
        `/api/v1/tasks/${rbacPublicTaskId}/events/${rbacAssignEvtId}/revert`,
        { data: { force: false } },
      );
      expect(assignRevertRes.status()).toBe(403);
      expect((await assignRevertRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      // Direct API calls for task.hidden_changed & task.deleted without permission -> 403 FORBIDDEN
      const hiddenRevertRes = await basicPage.request.post(
        `/api/v1/tasks/${rbacPublicTaskId}/events/${rbacHiddenEvtId}/revert`,
        { data: { force: false } },
      );
      expect(hiddenRevertRes.status()).toBe(403);
      expect((await hiddenRevertRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      const deletedRevertRes = await basicPage.request.post(
        `/api/v1/tasks/${rbacPublicTaskId}/events/${rbacDeletedEvtId}/revert`,
        { data: { force: false } },
      );
      expect(deletedRevertRes.status()).toBe(403);
      expect((await deletedRevertRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      // Non-revertable events (task.created, comment.added) -> 400 EVENT_NOT_REVERTABLE
      for (const nonRevertableEvtId of [rbacCreatedEvtId, rbacCommentEvtId]) {
        const nonRevertableRes = await basicPage.request.post(
          `/api/v1/tasks/${rbacPublicTaskId}/events/${nonRevertableEvtId}/revert`,
          { data: { force: false } },
        );
        expect(nonRevertableRes.status()).toBe(400);
        expect((await nonRevertableRes.json()) as { error: { code: string } }).toMatchObject({
          error: { code: 'EVENT_NOT_REVERTABLE' },
        });
      }

      // AC-20: Non-viewer outsider (even holding task.update_any & task.delete) receives 404 NOT_FOUND on hidden task events & revert
      const outsiderPage = outsiderSession.page;
      const hiddenEventsGetRes = await outsiderPage.request.get(
        `/api/v1/tasks/${rbacHiddenTaskId}/events`,
      );
      expect(hiddenEventsGetRes.status()).toBe(404);
      expect((await hiddenEventsGetRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      const hiddenEventRevertRes = await outsiderPage.request.post(
        `/api/v1/tasks/${rbacHiddenTaskId}/events/${hiddenUpdatedEvtId}/revert`,
        { data: { force: false } },
      );
      expect(hiddenEventRevertRes.status()).toBe(404);
      expect((await hiddenEventRevertRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      // UI direct link to hidden task also shows 404 ErrorState
      await outsiderPage.goto(`/boards/${historyBoardId}?task=${rbacHiddenTaskId}`);
      const outsiderDrawer = getTaskDrawer(outsiderPage);
      await expect(outsiderDrawer).toBeVisible();
      await expect(outsiderDrawer.getByText(viMessages.errors['404'].title)).toBeVisible();

      assertZeroPiiInStrings(
        [await basicDrawer.locator('.task-history-section').innerText()],
        sensitiveValues,
      );
      await basicSession.tracker.assertClean();
      await outsiderSession.tracker.assertClean();
    } finally {
      await Promise.all([basicSession.context.close(), outsiderSession.context.close()]);
    }
  });

  test('Board soft-delete 10s Undo toast, BoardTrashModal WQ-17 hidden task exclusion & restore, and 403 gating without task.delete', async ({
    browser,
  }) => {
    const deleterSession = await openSignedInContext(
      browser,
      deleterStudentId,
      `/boards/${trashBoardId}`,
    );
    const basicSession = await openSignedInContext(
      browser,
      assigneeBasicStudentId,
      `/boards/${trashBoardId}`,
    );
    const adminSession = await openSignedInContext(
      browser,
      adminStudentId,
      `/boards/${trashBoardId}`,
    );

    try {
      const deleterPage = deleterSession.page;

      // Deleter sees public task and Trash button, never sees hidden task
      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)).toBeVisible();
      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashHiddenTaskTitle)).toHaveCount(0);
      const openTrashBtn = deleterPage.getByRole('button', {
        name: viMessages.boards.openTrash,
        exact: true,
      });
      await expect(openTrashBtn).toBeVisible();

      // 1. Delete public task in S05 -> drawer closes + 10s Undo toast appears on S04 -> click Undo restores task immediately
      await getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)
        .locator('.kanban-card-open')
        .click();
      const drawer1 = getTaskDrawer(deleterPage);
      await expect(drawer1).toBeVisible();

      await drawer1.getByRole('button', { name: viMessages.tasks.deleteTask, exact: true }).click();
      const delete1Promise = deleterPage.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/tasks/${trashPublicTaskId}`) &&
          res.request().method() === 'DELETE',
      );
      await drawer1
        .getByRole('button', { name: viMessages.tasks.deleteConfirmSubmit, exact: true })
        .click();
      const delete1Res = await delete1Promise;
      expect(delete1Res.status()).toBe(200);
      const delete1EventId = ((await delete1Res.json()) as { eventId: string }).eventId;

      await expect(drawer1).toHaveCount(0);
      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)).toHaveCount(0);

      const deleteToast = deleterPage
        .locator('[data-sonner-toast]', { hasText: viMessages.tasks.deletedToast })
        .last();
      await expect(deleteToast).toBeVisible();
      const deleteUndoBtn = deleteToast.getByRole('button', {
        name: viMessages.taskHistory.undoAction,
        exact: true,
      });
      await expect(deleteUndoBtn).toBeVisible();

      const undoDeletePromise = deleterPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${trashPublicTaskId}/events/${delete1EventId}/revert`) &&
          res.request().method() === 'POST',
      );
      await deleteUndoBtn.click();
      expect((await undoDeletePromise).status()).toBe(200);

      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)).toBeVisible();

      // 2. Delete public task again -> open BoardTrashModal ("Thùng rác") -> verify public shown, hidden NOT shown (WQ-17), restore via "Khôi phục"
      await getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)
        .locator('.kanban-card-open')
        .click();
      const drawer2 = getTaskDrawer(deleterPage);
      await expect(drawer2).toBeVisible();
      await drawer2.getByRole('button', { name: viMessages.tasks.deleteTask, exact: true }).click();
      const delete2Promise = deleterPage.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/tasks/${trashPublicTaskId}`) &&
          res.request().method() === 'DELETE',
      );
      await drawer2
        .getByRole('button', { name: viMessages.tasks.deleteConfirmSubmit, exact: true })
        .click();
      expect((await delete2Promise).status()).toBe(200);
      await expect(drawer2).toHaveCount(0);
      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)).toHaveCount(0);

      // Confirm admin DOES see hidden deleted task in /trash API (proving hidden deleted task exists)
      const adminTrashRes = await adminSession.page.request.get(
        `/api/v1/boards/${trashBoardId}/trash`,
      );
      expect(adminTrashRes.status()).toBe(200);
      const adminTrashIds = ((await adminTrashRes.json()) as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      );
      expect(adminTrashIds).toContain(trashPublicTaskId);
      expect(adminTrashIds).toContain(trashHiddenTaskId);

      // Open BoardTrashModal as non-admin deleter
      const deleterTrashPromise = deleterPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/boards/${trashBoardId}/trash`) &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );
      await openTrashBtn.click();
      const deleterTrashRes = await deleterTrashPromise;
      const deleterTrashJson = (await deleterTrashRes.json()) as {
        items: Array<{ id: string; title: string }>;
      };
      expect(deleterTrashJson.items.map((item) => item.id)).toEqual([trashPublicTaskId]);
      expect(deleterTrashJson.items.map((item) => item.id)).not.toContain(trashHiddenTaskId);

      const trashModal = deleterPage.locator('.ui-modal[role="dialog"]');
      await expect(trashModal).toBeVisible();
      await expect(trashModal.getByRole('heading')).toHaveText(
        viMessages.boards.trashModalTitle.replace('{name}', trashBoardName),
      );
      await expect(trashModal.getByText(trashPublicTaskTitle)).toBeVisible();
      await expect(trashModal.getByText(trashHiddenTaskTitle)).toHaveCount(0);

      const publicTrashRow = trashModal.locator('li.board-trash-item', {
        hasText: trashPublicTaskTitle,
      });
      const restorePromise = deleterPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${trashPublicTaskId}/restore`) &&
          res.request().method() === 'POST',
      );
      await publicTrashRow
        .getByRole('button', { name: viMessages.boards.trashRestoreButton, exact: true })
        .click();
      expect((await restorePromise).status()).toBe(200);

      await expect(trashModal.getByText(viMessages.boards.trashEmptyTitle)).toBeVisible();
      await trashModal
        .locator('.board-trash-modal-foot')
        .getByRole('button', { name: viMessages.common.close, exact: true })
        .click();
      await expect(trashModal).toHaveCount(0);

      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)).toBeVisible();
      await deleterPage.reload();
      await expect(getTaskCardInColumn(deleterPage, 'Todo', trashPublicTaskTitle)).toBeVisible();

      // WQ-17: non-viewer holding task.delete receives 404 NOT_FOUND when attempting to restore a hidden deleted task
      const hiddenRestoreProbeRes = await deleterPage.request.post(
        `/api/v1/tasks/${trashHiddenTaskId}/restore`,
      );
      expect(hiddenRestoreProbeRes.status()).toBe(404);
      expect((await hiddenRestoreProbeRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      // AC-21: task_events recorded compensating/restored lifecycle without PII
      const trashTaskEvents = await db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, trashPublicTaskId))
        .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id));
      expect(trashTaskEvents.map((evt) => evt.type)).toEqual([
        'task.created',
        'task.deleted',
        'task.restored',
        'task.deleted',
        'task.restored',
      ]);

      // 3. Basic member WITHOUT task.delete sees NO "Thùng rác" button and gets 403 FORBIDDEN on GET /trash
      const basicPage = basicSession.page;
      await expect(getTaskCardInColumn(basicPage, 'Todo', trashPublicTaskTitle)).toBeVisible();
      await expect(
        basicPage.getByRole('button', { name: viMessages.boards.openTrash, exact: true }),
      ).toHaveCount(0);

      const basicTrashRes = await basicPage.request.get(`/api/v1/boards/${trashBoardId}/trash`);
      expect(basicTrashRes.status()).toBe(403);
      expect((await basicTrashRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      assertZeroPiiInStrings([JSON.stringify(deleterTrashJson)], sensitiveValues);
      await deleterSession.tracker.assertClean();
      await basicSession.tracker.assertClean();
      await adminSession.tracker.assertClean();
    } finally {
      await Promise.all([
        deleterSession.context.close(),
        basicSession.context.close(),
        adminSession.context.close(),
      ]);
    }
  });
});
