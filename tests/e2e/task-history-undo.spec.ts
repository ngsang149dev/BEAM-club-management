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

function formatTitleChangedSummary(fromTitle: string, toTitle: string): string {
  return viMessages.taskHistory.events.titleChanged
    .replace('{from}', fromTitle)
    .replace('{to}', toTitle);
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
  await page.waitForURL((url) => `${url.pathname}${url.search}` === expectedPath);
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

async function ensureUnscheduledTrayOpen(page: Page): Promise<void> {
  const toggle = page.locator('.hcal-unscheduled-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.locator('.hcal-unscheduled-list')).toBeVisible();
}

function getUnscheduledTaskChip(page: Page, title: string): Locator {
  return page.locator('.hcal-unscheduled-chip', {
    has: page.locator('.hcal-unscheduled-title', {
      hasText: new RegExp(`^${escapeRegex(title)}$`),
    }),
  });
}

function getTaskDrawer(page: Page): Locator {
  return page.locator('aside.task-modal-shell[role="dialog"]');
}

async function openHistoryTab(drawer: Locator): Promise<void> {
  await drawer
    .locator('.task-subtabs')
    .getByRole('tab', { name: new RegExp(`^${escapeRegex(viMessages.tasks.tabHistory)}$`) })
    .click();
  await expect(drawer.locator('.task-history-section')).toBeVisible();
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
    await ensureUnscheduledTrayOpen(page);
    await expect(getUnscheduledTaskChip(page, primaryTaskTitle)).toBeVisible();

    // 1. Move task via API -> revert via compensating task_event -> verify DB columnId & append-only task_events
    const moveRes = await page.request.post(`/api/v1/tasks/${primaryTaskId}/move`, {
      data: { columnId: histDoingColId, version: 1 },
    });
    expect(moveRes.status()).toBe(200);
    const moveEventId = ((await moveRes.json()) as { eventId: string }).eventId;

    const [movedDoingDb] = await db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(eq(tasks.id, primaryTaskId))
      .limit(1);
    expect(movedDoingDb?.columnId).toBe(histDoingColId);

    const revertMoveRes = await page.request.post(
      `/api/v1/tasks/${primaryTaskId}/events/${moveEventId}/revert`,
      { data: { force: false } },
    );
    expect(revertMoveRes.status()).toBe(200);

    const [revertedTodoDb] = await db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(eq(tasks.id, primaryTaskId))
      .limit(1);
    expect(revertedTodoDb?.columnId).toBe(histTodoColId);

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

    // 2. Open S05 near-fullscreen modal -> update Title -> click 10s Undo toast -> Title reverts back (AC-17)
    const primaryTitleV1 = `${primaryTaskTitle} V1`;
    const primaryTitleV2 = `${primaryTaskTitle} V2`;

    await getUnscheduledTaskChip(page, primaryTaskTitle).click();
    const drawer = getTaskDrawer(page);
    await expect(drawer).toBeVisible();

    const titleInput = drawer.getByLabel(viMessages.tasks.titleLabel, { exact: true });
    await expect(titleInput).toHaveValue(primaryTaskTitle);
    await titleInput.fill(primaryTitleV1);

    const patchTitle1Promise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/tasks/${primaryTaskId}`) &&
        res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
    const patchTitle1Res = await patchTitle1Promise;
    expect(patchTitle1Res.status()).toBe(200);
    const titleV1EventId = ((await patchTitle1Res.json()) as { eventId: string }).eventId;

    const editToast = page
      .locator('[data-sonner-toast]', { hasText: viMessages.tasks.updatedToast })
      .last();
    await expect(editToast).toBeVisible();
    const editUndoBtn = editToast.getByRole('button', {
      name: viMessages.taskHistory.undoAction,
      exact: true,
    });
    await expect(editUndoBtn).toBeVisible();

    const revertTitle1Promise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/events/${titleV1EventId}/revert`) &&
        res.request().method() === 'POST',
    );
    await editUndoBtn.click();
    expect((await revertTitle1Promise).status()).toBe(200);

    await expect(drawer.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(
      primaryTaskTitle,
    );

    // 3. Update Title again -> switch to inline Lịch sử sub-tab -> verify entries, order, (đã rời), no UUID/PII, revert from history
    await drawer.getByLabel(viMessages.tasks.titleLabel, { exact: true }).fill(primaryTitleV2);
    const patchTitle2Promise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/tasks/${primaryTaskId}`) &&
        res.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
    const patchTitle2Res = await patchTitle2Promise;
    expect(patchTitle2Res.status()).toBe(200);
    const titleV2EventId = ((await patchTitle2Res.json()) as { eventId: string }).eventId;

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

    const expectedV2Text = formatTitleChangedSummary(primaryTaskTitle, primaryTitleV2);
    const expectedRevertV1Text = formatTitleChangedSummary(primaryTitleV1, primaryTaskTitle);
    const expectedCreatedText = viMessages.taskHistory.events.taskCreatedInColumn.replace(
      '{column}',
      'Todo',
    );
    const expectedMovedTodoToDoingText = viMessages.taskHistory.events.taskMoved
      .replace('{from}', 'Todo')
      .replace('{to}', 'Doing');

    // Newest-first assertions
    await expect(historyRows.first()).toContainText(creatorEditorFullName);
    await expect(historyRows.first()).toContainText(expectedV2Text);

    await expect(historyRows.nth(1)).toContainText(expectedRevertV1Text);
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

    // Revert primaryTitleV2 -> primaryTaskTitle directly from History sub-tab ("Khôi phục giá trị này")
    const v2Row = drawer.locator('li.task-history-row', { hasText: expectedV2Text });
    const historyRevertPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${primaryTaskId}/events/${titleV2EventId}/revert`) &&
        res.request().method() === 'POST',
    );
    await v2Row
      .getByRole('button', { name: viMessages.taskHistory.restoreValueButton, exact: true })
      .click();
    expect((await historyRevertPromise).status()).toBe(200);

    const expectedRevertV2Text = formatTitleChangedSummary(primaryTitleV2, primaryTaskTitle);
    await expect(historyRows).toHaveCount(8);
    await expect(historyRows.first()).toContainText(expectedRevertV2Text);
    await expect(
      historyRows.first().locator('.task-history-badge.is-revert'),
    ).toHaveText(viMessages.taskHistory.revertedBadge);

    await expect(drawer.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(
      primaryTaskTitle,
    );

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
    const [userASession, userBSession] = await Promise.all([
      openSignedInContext(browser, creatorEditorStudentId, `/boards/${historyBoardId}?task=${conflictTaskId}`),
      openSignedInContext(browser, peerEditorStudentId, `/boards/${historyBoardId}?task=${conflictTaskId}`),
    ]);

    try {
      const pageA = userASession.page;
      const pageB = userBSession.page;
      const drawerA = getTaskDrawer(pageA);
      const drawerB = getTaskDrawer(pageB);
      await expect(drawerA).toBeVisible();
      await expect(drawerB).toBeVisible();

      const conflictTitleA = `${conflictTaskTitle} A`;
      const conflictTitleB = `${conflictTaskTitle} B`;

      // User A updates Title (event X)
      await drawerA.getByLabel(viMessages.tasks.titleLabel, { exact: true }).fill(conflictTitleA);
      const userAPatchPromise = pageA.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/tasks/${conflictTaskId}`) &&
          res.request().method() === 'PATCH',
      );
      await drawerA.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
      const userAPatchRes = await userAPatchPromise;
      expect(userAPatchRes.status()).toBe(200);
      const eventXId = ((await userAPatchRes.json()) as { eventId: string }).eventId;

      // User B reloads task detail so version matches, then updates Title A -> B
      await pageB.reload();
      await expect(drawerB).toBeVisible();
      await expect(drawerB.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(
        conflictTitleA,
      );
      await drawerB.getByLabel(viMessages.tasks.titleLabel, { exact: true }).fill(conflictTitleB);
      const userBPatchPromise = pageB.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/v1/tasks/${conflictTaskId}`) &&
          res.request().method() === 'PATCH',
      );
      await drawerB.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
      expect((await userBPatchPromise).status()).toBe(200);

      // User A opens Lịch sử sub-tab and clicks "Khôi phục giá trị này" on event X
      const eventsFetchPromise = pageA.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/tasks/${conflictTaskId}/events`) &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );
      await openHistoryTab(drawerA);
      await eventsFetchPromise;

      const eventXSummary = formatTitleChangedSummary(conflictTaskTitle, conflictTitleA);
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
          details: { conflictingFields: ['title'] },
        },
      });

      // Verify TaskRevertConflictModal renders title + conflicting field chip + confirm force button
      const conflictModal = pageA.locator('.ui-modal[role="dialog"]');
      await expect(conflictModal).toBeVisible();
      await expect(conflictModal.getByRole('heading')).toHaveText(
        viMessages.taskHistory.conflictModalTitle,
      );
      await expect(conflictModal.locator('.task-conflict-field-chip')).toHaveText([
        viMessages.taskHistory.conflictFields.title,
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
        task: { title: string };
        eventId: string;
        revertedEventId: string;
      };
      expect(forceJson.task.title).toBe(conflictTaskTitle);
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
        formatTitleChangedSummary(conflictTitleB, conflictTaskTitle),
      );

      // Verify forced: true & revertsEventId in DB
      const [dbForcedRow] = await db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.id, forceJson.eventId));
      expect(dbForcedRow).toBeDefined();
      expect(dbForcedRow?.revertsEventId).toBe(eventXId);
      expect(dbForcedRow?.forced).toBe(true);

      await expect(drawerA.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(
        conflictTaskTitle,
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
    const [basicSession, outsiderSession] = await Promise.all([
      openSignedInContext(browser, assigneeBasicStudentId, `/boards/${historyBoardId}?task=${rbacPublicTaskId}`),
      openSignedInContext(browser, peerEditorStudentId, `/boards/${historyBoardId}`),
    ]);

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
    const [deleterSession, basicSession, adminSession] = await Promise.all([
      openSignedInContext(browser, deleterStudentId, `/boards/${trashBoardId}`),
      openSignedInContext(browser, assigneeBasicStudentId, `/boards/${trashBoardId}`),
      openSignedInContext(browser, adminStudentId, `/boards/${trashBoardId}`),
    ]);

    try {
      const deleterPage = deleterSession.page;

      // Deleter sees public task in unscheduled tray and Trash button, never sees hidden task
      await ensureUnscheduledTrayOpen(deleterPage);
      await expect(getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle)).toBeVisible();
      await expect(getUnscheduledTaskChip(deleterPage, trashHiddenTaskTitle)).toHaveCount(0);
      const openTrashBtn = deleterPage.getByRole('button', {
        name: viMessages.calendar.openTrash,
        exact: true,
      });
      await expect(openTrashBtn).toBeVisible();

      // 1. Delete public task in S05 modal -> closes + 10s Undo toast appears -> click Undo restores task immediately
      await getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle).click();
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
      await expect(getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle)).toHaveCount(0);

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

      await ensureUnscheduledTrayOpen(deleterPage);
      await expect(getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle)).toBeVisible();

      // 2. Delete public task again -> open Trash modal ("Thùng rác") on /tasks -> verify public shown, hidden NOT shown (WQ-17), restore via "Khôi phục"
      await getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle).click();
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
      await expect(getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle)).toHaveCount(0);

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

      // Verify non-admin deleter /trash API honors WQ-17
      const deleterTrashApiRes = await deleterPage.request.get(
        `/api/v1/boards/${trashBoardId}/trash`,
      );
      expect(deleterTrashApiRes.status()).toBe(200);
      const deleterTrashJson = (await deleterTrashApiRes.json()) as {
        items: Array<{ id: string; title: string }>;
      };
      expect(deleterTrashJson.items.map((item) => item.id)).toEqual([trashPublicTaskId]);
      expect(deleterTrashJson.items.map((item) => item.id)).not.toContain(trashHiddenTaskId);

      // Open Trash modal from /tasks as non-admin deleter -> must display trashPublicTaskTitle and exclude hidden task
      await expect(openTrashBtn).toBeVisible();
      await openTrashBtn.click();

      const trashModal = deleterPage.locator('.ui-modal[role="dialog"]');
      await expect(trashModal).toBeVisible();
      await expect(trashModal.locator('.ui-prio')).toHaveCount(0);
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

      await expect(
        trashModal.locator('li.board-trash-item', { hasText: trashPublicTaskTitle }),
      ).toHaveCount(0);
      await trashModal
        .locator('.board-trash-modal-foot')
        .getByRole('button', { name: viMessages.common.close, exact: true })
        .click();
      await expect(trashModal).toHaveCount(0);

      await ensureUnscheduledTrayOpen(deleterPage);
      await expect(getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle)).toBeVisible();
      await deleterPage.reload();
      await ensureUnscheduledTrayOpen(deleterPage);
      await expect(getUnscheduledTaskChip(deleterPage, trashPublicTaskTitle)).toBeVisible();

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
      await ensureUnscheduledTrayOpen(basicPage);
      await expect(getUnscheduledTaskChip(basicPage, trashPublicTaskTitle)).toBeVisible();
      await expect(
        basicPage.getByRole('button', { name: viMessages.calendar.openTrash, exact: true }),
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
