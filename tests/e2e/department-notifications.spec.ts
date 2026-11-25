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

  const deptAId = randomUUID();
  const deptBId = randomUUID();
  const deptBellId = randomUUID();

  const adminStudentId = `MSSV-CR03-ADM-${suffix}`;
  const leadStudentId = `MSSV-CR03-LEAD-${suffix}`;
  const memberAStudentId = `MSSV-CR03-MEMA-${suffix}`;
  const revokeStudentId = `MSSV-CR03-REV-${suffix}`;
  const outsiderStudentId = `MSSV-CR03-OUT-${suffix}`;
  const bellStudentId = `MSSV-CR03-BELL-${suffix}`;

  const adminEmail = `cr03-admin-${suffix}@eiu.edu.vn`;
  const leadEmail = `cr03-lead-${suffix}@eiu.edu.vn`;
  const memberAEmail = `cr03-mema-${suffix}@eiu.edu.vn`;
  const revokeEmail = `cr03-rev-${suffix}@eiu.edu.vn`;
  const outsiderEmail = `cr03-out-${suffix}@eiu.edu.vn`;
  const bellEmail = `cr03-bell-${suffix}@eiu.edu.vn`;

  const adminFullName = `CR03 Admin ${suffix}`;
  const leadFullName = `CR03 Lead ${suffix}`;
  const memberAFullName = `CR03 MemberA ${suffix}`;
  const revokeFullName = `CR03 Revoke ${suffix}`;
  const outsiderFullName = `CR03 Outsider ${suffix}`;
  const bellFullName = `CR03 BellUser ${suffix}`;

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
  ];
  const trackedStudentIds = [
    adminStudentId,
    leadStudentId,
    memberAStudentId,
    revokeStudentId,
    outsiderStudentId,
    bellStudentId,
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
    adminEmail,
    leadEmail,
    memberAEmail,
    revokeEmail,
    outsiderEmail,
    bellEmail,
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

    await signInAs(page, leadStudentId, `/boards/${boardId}`);
    const todoCol = getColumnSection(page, 'Todo');
    await expect(todoCol).toBeVisible();

    // Open Create Task modal -> verify Department picker prominent, notify checked, individual picker collapsed
    await todoCol.getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    await expect(modal.getByText(viMessages.tasks.departmentsLabel)).toBeVisible();
    const deptACheckbox = modal
      .locator('label', { hasText: deptAName })
      .locator('input[type="checkbox"]');
    await expect(deptACheckbox).toBeVisible();

    const notifyCheckbox = modal.getByLabel(viMessages.tasks.notifyDepartmentMembersLabel);
    await expect(notifyCheckbox).toBeVisible();
    await expect(notifyCheckbox).toBeChecked();

    const individualDetails = modal.locator('details', {
      hasText: viMessages.tasks.individualAssigneesSummary,
    });
    await expect(individualDetails).toBeVisible();
    await expect(individualDetails).not.toHaveAttribute('open', '');

    // Create public task assigned to Dept A with notifyDepartmentMembers checked
    await modal.getByLabel(viMessages.tasks.titleLabel).fill(notifiedTitle);
    await deptACheckbox.check();

    const createNotifiedPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createNotifiedRes = await createNotifiedPromise;
    expect(createNotifiedRes.status()).toBe(201);
    const notifiedTaskId = ((await createNotifiedRes.json()) as { task: { id: string } }).task.id;
    trackedTaskIds.push(notifiedTaskId);

    // Verify department badge appears on S04 Kanban card
    const notifiedCard = todoCol.locator('article.kanban-card', { hasText: notifiedTitle });
    await expect(notifiedCard).toBeVisible();
    await expect(notifiedCard).toContainText(deptAName);

    // Open S05 Task Detail Drawer -> verify department badge / assignment
    await notifiedCard.locator('button.kanban-card-open').click();
    const drawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(deptAName);
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

    // Verify Dept A member sees department badge & department filter on S06 /my-tasks
    const memberAContext = await browser.newContext();
    const memberAPage = await memberAContext.newPage();
    const memberATracker = await attachRuntimeErrorTracker(memberAPage);
    try {
      await signInAs(memberAPage, memberAStudentId, '/my-tasks');
      const myTaskRow = memberAPage.locator('.my-task-row', { hasText: notifiedTitle });
      await expect(myTaskRow).toBeVisible();
      await expect(myTaskRow).toContainText(deptAName);

      // Department filter on /my-tasks
      const deptFilter = memberAPage.getByLabel(viMessages.myTasks.departmentFilterLabel);
      const filterDeptAPromise = memberAPage.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/me/tasks') &&
          res.url().includes(`departmentId=${deptAId}`) &&
          res.status() === 200,
      );
      await deptFilter.selectOption(deptAId);
      await filterDeptAPromise;
      await expect(memberAPage.locator('.my-task-row', { hasText: notifiedTitle })).toBeVisible();

      const filterDeptBPromise = memberAPage.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/me/tasks') &&
          res.url().includes(`departmentId=${deptBId}`) &&
          res.status() === 200,
      );
      await deptFilter.selectOption(deptBId);
      await filterDeptBPromise;
      await expect(memberAPage.locator('.my-task-row', { hasText: notifiedTitle })).toHaveCount(0);

      await memberATracker.assertClean();
    } finally {
      await memberAContext.close();
    }

    // Create another task with notifyDepartmentMembers UNCHECKED -> persists on card, 0 notifications
    await todoCol.getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` }).click();
    const silentModal = page.getByRole('dialog');
    await silentModal.getByLabel(viMessages.tasks.titleLabel).fill(silentTitle);
    await silentModal
      .locator('label', { hasText: deptAName })
      .locator('input[type="checkbox"]')
      .check();
    await silentModal.getByLabel(viMessages.tasks.notifyDepartmentMembersLabel).uncheck();
    await expect(
      silentModal.getByLabel(viMessages.tasks.notifyDepartmentMembersLabel),
    ).not.toBeChecked();

    const createSilentPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await silentModal.getByRole('button', { name: viMessages.tasks.createSubmit }).click();
    const createSilentRes = await createSilentPromise;
    expect(createSilentRes.status()).toBe(201);
    const silentTaskId = ((await createSilentRes.json()) as { task: { id: string } }).task.id;
    trackedTaskIds.push(silentTaskId);

    const silentCard = todoCol.locator('article.kanban-card', { hasText: silentTitle });
    await expect(silentCard).toBeVisible();
    await expect(silentCard).toContainText(deptAName);

    const silentNotifsAfterCreate = await db
      .select()
      .from(notifications)
      .where(eq(notifications.taskId, silentTaskId));
    expect(silentNotifsAfterCreate).toHaveLength(0);

    // Also update assignments in S05 drawer adding Dept B with notifyDepartmentMembers UNCHECKED -> 0 notifications
    await silentCard.locator('button.kanban-card-open').click();
    const silentDrawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
    await expect(silentDrawer).toBeVisible();
    await silentDrawer
      .locator('label', { hasText: deptBName })
      .locator('input[type="checkbox"]')
      .check();
    const drawerNotify = silentDrawer.getByLabel(viMessages.tasks.notifyDepartmentMembersLabel);
    if (await drawerNotify.isChecked()) {
      await drawerNotify.uncheck();
    }

    const updateAssigneesPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${silentTaskId}/assignees`) &&
        res.request().method() === 'PUT',
    );
    await silentDrawer
      .getByRole('button', { name: viMessages.tasks.departmentsSaveButton })
      .click();
    expect((await updateAssigneesPromise).status()).toBe(200);
    await silentDrawer.getByRole('button', { name: viMessages.common.close }).click();

    await page.reload();
    const reloadedSilentCard = getColumnSection(page, 'Todo').locator('article.kanban-card', {
      hasText: silentTitle,
    });
    await expect(reloadedSilentCard).toContainText(deptAName);
    await expect(reloadedSilentCard).toContainText(deptBName);

    const silentNotifsAfterUpdate = await db
      .select()
      .from(notifications)
      .where(eq(notifications.taskId, silentTaskId));
    expect(silentNotifsAfterUpdate).toHaveLength(0);

    await tracker.assertClean();
  });

  test('allows Dept A member with only task.update_assigned to view on /my-tasks, edit in S05 drawer, and drag-and-drop on S04 persisting UUID-only task_events', async ({
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
    await signInAs(page, memberAStudentId, '/my-tasks');
    const myRow = page.locator('.my-task-row', { hasText: initialTitle });
    await expect(myRow).toBeVisible();
    await expect(myRow).toContainText(deptAName);

    // Open S05 drawer from /my-tasks and edit title & description
    await myRow.click();
    const drawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
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

    // Navigate to S04 /boards/[id] and drag-and-drop card from Todo -> Doing
    await page.goto(`/boards/${boardId}`);
    const todoCol = getColumnSection(page, 'Todo');
    const doingCol = getColumnSection(page, 'Doing');
    const editedCard = todoCol.locator('article.kanban-card', { hasText: editedTitle });
    await expect(editedCard).toBeVisible();

    await dragCardToColumn(page, editedCard, doingCol, taskId);
    await expect(doingCol.locator('article.kanban-card', { hasText: editedTitle })).toBeVisible();

    await page.reload();
    await expect(
      getColumnSection(page, 'Doing').locator('article.kanban-card', { hasText: editedTitle }),
    ).toBeVisible();
    await expect(
      getColumnSection(page, 'Todo').locator('article.kanban-card', { hasText: editedTitle }),
    ).toHaveCount(0);

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
      const todoCol = getColumnSection(leadPage, 'Todo');
      await todoCol.getByRole('button', { name: `+ ${viMessages.boards.addTaskInColumn}` }).click();
      const modal = leadPage.getByRole('dialog');
      await modal.getByLabel(viMessages.tasks.titleLabel).fill(hiddenTitle);
      await modal
        .locator('label', { hasText: deptAName })
        .locator('input[type="checkbox"]')
        .check();
      await modal.getByLabel(viMessages.tasks.isHiddenLabel).check();
      await expect(modal.getByLabel(viMessages.tasks.notifyDepartmentMembersLabel)).toBeChecked();

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

    // 1. Outsider holding task.update_any gets 404 everywhere, sees nothing on board/my-tasks, 0 notifications
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    const outsiderTracker = await attachRuntimeErrorTracker(outsiderPage);
    try {
      await signInAs(outsiderPage, outsiderStudentId, `/boards/${boardId}`);
      await expect(
        outsiderPage.locator('article.kanban-card', { hasText: hiddenTitle }),
      ).toHaveCount(0);

      await outsiderPage.goto('/my-tasks');
      await expect(outsiderPage.locator('.my-task-row', { hasText: hiddenTitle })).toHaveCount(0);

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
    await expect(page.locator('article.kanban-card', { hasText: hiddenTitle })).toBeVisible();

    await page.goto('/my-tasks');
    await expect(page.locator('.my-task-row', { hasText: hiddenTitle })).toBeVisible();

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
    await expect(page.locator('article.kanban-card', { hasText: hiddenTitle })).toHaveCount(0);

    await page.goto('/my-tasks');
    await expect(page.locator('.my-task-row', { hasText: hiddenTitle })).toHaveCount(0);

    await tracker.assertClean();
  });

  test('renders NotificationBell badge (2 -> 1 -> 0), navigates to /boards/[id]?task=[id], auto-opens & cleanly closes drawer, marks all read, and leaks zero PII', async ({
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
    const expectedBoardHint = viMessages.notifications.openTaskHint.replace(
      '{boardName}',
      boardName,
    );

    await expect(popover).toContainText(expectedPublicMsg);
    await expect(popover).toContainText(expectedHiddenMsg);
    await expect(popover).toContainText(boardName);
    await expect(
      popover.getByRole('button', { name: new RegExp(publicTitle) }),
    ).toHaveAttribute('title', expectedBoardHint);

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

    await page.waitForURL(`${BASE_ORIGIN}/boards/${boardId}?task=${publicTaskId}`);
    const drawer = page.getByRole('dialog', { name: viMessages.tasks.drawerTitle });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(publicTitle);

    // Close drawer cleanly -> ?task= query param cleared
    await drawer.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(`${BASE_ORIGIN}/boards/${boardId}`);
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
});
