import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
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
  taskDeliverables,
  taskDepartments,
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
  returnTo = '/tasks',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

function assertNoSecretsInText(
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

test.describe('Department Leads, Task Acceptance Loop & Deliverables E2E (CR-09)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);

  const adminUserId = randomUUID();
  const creatorUserId = randomUUID();
  const leadUserId = randomUUID();
  const memberUserId = randomUUID();
  const deptMgrOnlyUserId = randomUUID();
  const outsiderUserId = randomUUID();

  const deptAId = randomUUID();

  const adminStudentId = `MSSV-CR09-ADM-${suffix}`;
  const creatorStudentId = `MSSV-CR09-CRE-${suffix}`;
  const leadStudentId = `MSSV-CR09-LEAD-${suffix}`;
  const memberStudentId = `MSSV-CR09-MEM-${suffix}`;
  const deptMgrOnlyStudentId = `MSSV-CR09-MGR-${suffix}`;
  const outsiderStudentId = `MSSV-CR09-OUT-${suffix}`;

  const adminEmail = `cr09-admin-${suffix}@eiu.edu.vn`;
  const creatorEmail = `cr09-creator-${suffix}@eiu.edu.vn`;
  const leadEmail = `cr09-lead-${suffix}@eiu.edu.vn`;
  const memberEmail = `cr09-member-${suffix}@eiu.edu.vn`;
  const deptMgrOnlyEmail = `cr09-mgr-${suffix}@eiu.edu.vn`;
  const outsiderEmail = `cr09-outsider-${suffix}@eiu.edu.vn`;

  const adminFullName = `CR09 Admin ${suffix}`;
  const creatorFullName = `CR09 Creator ${suffix}`;
  const leadFullName = `CR09 Lead ${suffix}`;
  const memberFullName = `CR09 Member ${suffix}`;
  const deptMgrOnlyFullName = `CR09 DeptMgrOnly ${suffix}`;
  const outsiderFullName = `CR09 Outsider ${suffix}`;

  const deptAName = `Ban Nội dung ${suffix}`;

  const trackedUserIds = [
    adminUserId,
    creatorUserId,
    leadUserId,
    memberUserId,
    deptMgrOnlyUserId,
    outsiderUserId,
  ];
  const trackedStudentIds = [
    adminStudentId,
    creatorStudentId,
    leadStudentId,
    memberStudentId,
    deptMgrOnlyStudentId,
    outsiderStudentId,
  ];
  const trackedDeptIds: string[] = [deptAId];
  const trackedBoardIds: string[] = [];
  const trackedTaskIds: string[] = [];
  let workspaceBoardPreexisted = false;

  const sensitiveValues = [
    adminStudentId,
    creatorStudentId,
    leadStudentId,
    memberStudentId,
    deptMgrOnlyStudentId,
    outsiderStudentId,
    adminEmail,
    creatorEmail,
    leadEmail,
    memberEmail,
    deptMgrOnlyEmail,
    outsiderEmail,
  ];

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

    const existingWorkspace = await db
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.name, 'BEAM Workspace'),
          isNull(boards.archivedAt),
          isNull(boards.purgedAt),
        ),
      )
      .limit(1);
    workspaceBoardPreexisted = existingWorkspace.length > 0;

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
        id: memberUserId,
        studentId: memberStudentId,
        email: memberEmail,
        fullName: memberFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: deptMgrOnlyUserId,
        studentId: deptMgrOnlyStudentId,
        email: deptMgrOnlyEmail,
        fullName: deptMgrOnlyFullName,
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
    ]);

    await db.insert(departments).values({
      id: deptAId,
      name: deptAName,
      leadUserId,
    });

    await db.insert(memberDepartments).values([
      { userId: leadUserId, departmentId: deptAId },
      { userId: memberUserId, departmentId: deptAId },
    ]);

    await db.insert(userPermissions).values([
      ...[
        'member.view',
        'board.create',
        'task.create',
        'task.assign',
        'task.update_any',
      ].map((code) => ({
        userId: creatorUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: leadUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: memberUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      {
        userId: deptMgrOnlyUserId,
        permissionCode: 'department.manage',
        grantedBy: adminUserId,
      },
      ...['member.view', 'task.update_any', 'comment.create'].map((code) => ({
        userId: outsiderUserId,
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
        await db.delete(taskDeliverables).where(inArray(taskDeliverables.taskId, trackedTaskIds));
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
              creatorUserId,
              leadUserId,
              memberUserId,
              deptMgrOnlyUserId,
              outsiderUserId,
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

  test('assigns and clears Department Lead on /admin/departments (persisting across reload) and lets department.manage-only users edit without /members 403', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const createdDeptName = `Ban Thiết kế ${suffix}`;
    const renamedDeptName = `Ban Thiết kế Pro ${suffix}`;

    await signInAs(page, adminStudentId, '/admin/departments');

    // 1. Admin creates department selecting active member in Trưởng ban dropdown
    await page.getByRole('button', { name: viMessages.departmentsAdmin.addDepartment }).click();
    const createModal = page.getByRole('dialog');
    await expect(createModal).toBeVisible();
    await createModal.getByLabel(viMessages.departmentsAdmin.nameLabel).fill(createdDeptName);

    const leadSelect = createModal.getByLabel(viMessages.departmentsAdmin.leadLabel, { exact: true });
    await expect(leadSelect).toBeVisible();
    await expect(leadSelect.locator(`option[value="${leadUserId}"]`)).toHaveCount(1);
    await leadSelect.selectOption(leadUserId);

    const createDeptPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/departments') && res.request().method() === 'POST',
    );
    await createModal.getByRole('button', { name: viMessages.departmentsAdmin.createSubmit }).click();
    const createDeptRes = await createDeptPromise;
    expect(createDeptRes.status()).toBe(201);
    const createDeptText = await createDeptRes.text();
    assertNoSecretsInText([createDeptText], sensitiveValues);
    const createdDeptJson = JSON.parse(createDeptText) as {
      department: { id: string; lead: { id: string; fullName: string } | null };
    };
    const createdDeptId = createdDeptJson.department.id;
    trackedDeptIds.push(createdDeptId);
    expect(createdDeptJson.department.lead).toMatchObject({
      id: leadUserId,
      fullName: leadFullName,
    });

    const expectedLeadBadge = viMessages.departmentsAdmin.leadBadge.replace('{name}', leadFullName);
    const createdRow = page.locator('li.dept-row', { hasText: createdDeptName });
    await expect(createdRow).toBeVisible();
    await expect(createdRow).toContainText(expectedLeadBadge);

    // Reload and verify Lead badge persists
    await page.reload();
    const reloadedRow = page.locator('li.dept-row', { hasText: createdDeptName });
    await expect(reloadedRow).toBeVisible();
    await expect(reloadedRow).toContainText(expectedLeadBadge);

    // 2. Edit department to clear Lead (null) -> persists across reload, then re-assign Lead
    await reloadedRow.getByRole('button', { name: viMessages.departmentsAdmin.renameAction }).click();
    const clearModal = page.getByRole('dialog');
    const clearLeadSelect = clearModal.getByLabel(viMessages.departmentsAdmin.leadLabel, {
      exact: true,
    });
    await expect(clearLeadSelect).toHaveValue(leadUserId);
    await clearLeadSelect.selectOption('');

    const clearLeadPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/departments/${createdDeptId}`) &&
        res.request().method() === 'PATCH',
    );
    await clearModal.getByRole('button', { name: viMessages.departmentsAdmin.renameSubmit }).click();
    const clearLeadRes = await clearLeadPromise;
    expect(clearLeadRes.status()).toBe(200);
    expect(clearLeadRes.request().postDataJSON()).toMatchObject({
      name: createdDeptName,
      leadUserId: null,
    });
    expect(
      (JSON.parse(await clearLeadRes.text()) as { department: { lead: unknown } }).department.lead,
    ).toBeNull();

    await expect(reloadedRow).toContainText(viMessages.departmentsAdmin.leadUnassignedBadge);
    await page.reload();
    await expect(page.locator('li.dept-row', { hasText: createdDeptName })).toContainText(
      viMessages.departmentsAdmin.leadUnassignedBadge,
    );

    // Re-assign Lead so we can verify department.manage-only rename preserves Lead
    await page
      .locator('li.dept-row', { hasText: createdDeptName })
      .getByRole('button', { name: viMessages.departmentsAdmin.renameAction })
      .click();
    const reassignModal = page.getByRole('dialog');
    await reassignModal
      .getByLabel(viMessages.departmentsAdmin.leadLabel, { exact: true })
      .selectOption(leadUserId);
    const reassignPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/departments/${createdDeptId}`) &&
        res.request().method() === 'PATCH',
    );
    await reassignModal.getByRole('button', { name: viMessages.departmentsAdmin.renameSubmit }).click();
    expect((await reassignPromise).status()).toBe(200);
    await expect(page.locator('li.dept-row', { hasText: createdDeptName })).toContainText(
      expectedLeadBadge,
    );

    // 3. department.manage-only user (NO member.view) triggers ZERO /members requests, ZERO 403s, and preserves Lead on rename
    const mgrContext = await browser.newContext();
    const mgrPage = await mgrContext.newPage();
    const mgrTracker = await attachRuntimeErrorTracker(mgrPage);
    const memberRequests: string[] = [];
    const forbiddenResponses: string[] = [];
    mgrPage.on('request', (req) => {
      if (req.url().includes('/api/v1/members')) {
        memberRequests.push(`${req.method()} ${req.url()}`);
      }
    });
    mgrPage.on('response', (res) => {
      if (res.status() === 403) {
        forbiddenResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    try {
      await signInAs(mgrPage, deptMgrOnlyStudentId, '/admin/departments');
      const targetRow = mgrPage.locator('li.dept-row', { hasText: createdDeptName });
      await expect(targetRow).toBeVisible();
      await expect(targetRow).toContainText(expectedLeadBadge);

      await targetRow.getByRole('button', { name: viMessages.departmentsAdmin.renameAction }).click();
      const mgrModal = mgrPage.getByRole('dialog');
      await expect(mgrModal).toBeVisible();
      await expect(
        mgrModal.getByLabel(viMessages.departmentsAdmin.leadLabel, { exact: true }),
      ).toHaveCount(0);

      await mgrModal.getByLabel(viMessages.departmentsAdmin.nameLabel).fill(renamedDeptName);
      const mgrRenamePromise = mgrPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/departments/${createdDeptId}`) &&
          res.request().method() === 'PATCH',
      );
      await mgrModal.getByRole('button', { name: viMessages.departmentsAdmin.renameSubmit }).click();
      const mgrRenameRes = await mgrRenamePromise;
      expect(mgrRenameRes.status()).toBe(200);
      expect(mgrRenameRes.request().postDataJSON()).toEqual({ name: renamedDeptName });

      const renamedRow = mgrPage.locator('li.dept-row', { hasText: renamedDeptName });
      await expect(renamedRow).toBeVisible();
      await expect(renamedRow).toContainText(expectedLeadBadge);

      expect(memberRequests).toEqual([]);
      expect(forbiddenResponses).toEqual([]);
      await mgrTracker.assertClean();
    } finally {
      await mgrContext.close();
    }

    await tracker.assertClean();
  });

  test('executes 3-step acceptance loop (workspace task -> PUT /acceptance -> Lead Bell task.accepted), enforces 403 for unassigned Admin/user, and submits deliverables with Lead notification', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const workspaceTaskTitle = `CR09 Workspace Flow ${suffix}`;
    const deliverableTitle = `Slide tổng kết ${suffix}`;
    const deliverableUrl = `https://drive.google.com/file/d/cr09-${suffix}`;

    // 1. Creator creates boardless workspace task assigned to deptA
    const creatorContext = await browser.newContext();
    const creatorPage = await creatorContext.newPage();
    const creatorTracker = await attachRuntimeErrorTracker(creatorPage);
    let taskId: string;
    let workspaceBoardId: string;
    try {
      await signInAs(creatorPage, creatorStudentId, '/tasks');
      const createTaskRes = await creatorPage.request.post('/api/v1/tasks', {
        data: {
          title: workspaceTaskTitle,
          departmentIds: [deptAId],
          notifyInApp: false,
          notifyEmail: false,
        },
      });
      expect(createTaskRes.status()).toBe(201);
      const createText = await createTaskRes.text();
      assertNoSecretsInText([createText], sensitiveValues);
      const createJson = JSON.parse(createText) as {
        task: { id: string; boardId: string; columnId: string };
      };
      taskId = createJson.task.id;
      workspaceBoardId = createJson.task.boardId;
      trackedTaskIds.push(taskId);
      if (!workspaceBoardPreexisted && !trackedBoardIds.includes(workspaceBoardId)) {
        trackedBoardIds.push(workspaceBoardId);
      }

      const wsCols = await db
        .select({ name: columns.name, orderIndex: columns.orderIndex })
        .from(columns)
        .where(eq(columns.boardId, workspaceBoardId));
      expect(wsCols.length).toBeGreaterThanOrEqual(2);
      await creatorTracker.assertClean();
    } finally {
      await creatorContext.close();
    }

    // 2. Unassigned Admin AND unassigned user with task.update_any receive 403 on PUT /acceptance
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminTracker = await attachRuntimeErrorTracker(adminPage);
    try {
      await signInAs(adminPage, adminStudentId, '/tasks');
      const adminAcceptRes = await adminPage.request.put(`/api/v1/tasks/${taskId}/acceptance`, {
        data: { accepted: true },
      });
      expect(adminAcceptRes.status()).toBe(403);
      await adminTracker.assertClean();
    } finally {
      await adminContext.close();
    }

    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    const outsiderTracker = await attachRuntimeErrorTracker(outsiderPage);
    try {
      await signInAs(outsiderPage, outsiderStudentId, '/tasks');
      const outsiderAcceptRes = await outsiderPage.request.put(`/api/v1/tasks/${taskId}/acceptance`, {
        data: { accepted: true },
      });
      expect(outsiderAcceptRes.status()).toBe(403);
      await outsiderTracker.assertClean();
    } finally {
      await outsiderContext.close();
    }

    // 3. Assigned Dept A member ticks acceptance via PUT /api/v1/tasks/{id}/acceptance -> task.assignees has acceptedAt !== null
    await signInAs(page, memberStudentId, '/my-tasks');
    const acceptRes = await page.request.put(`/api/v1/tasks/${taskId}/acceptance`, {
      data: { accepted: true },
    });
    expect(acceptRes.status()).toBe(200);
    const acceptText = await acceptRes.text();
    assertNoSecretsInText([acceptText], sensitiveValues);
    const acceptJson = JSON.parse(acceptText) as {
      task: { assignees: Array<{ id: string; acceptedAt: string | null }> };
      eventId: string | null;
    };
    expect(acceptJson.eventId).toBeTruthy();
    const acceptedEntry = acceptJson.task.assignees.find((a) => a.id === memberUserId);
    expect(acceptedEntry).toBeDefined();
    expect(acceptedEntry?.acceptedAt).not.toBeNull();

    // 4. Department Lead logs in (fresh context) and sees unread 'task.accepted' in Notification Bell popover
    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    try {
      await signInAs(leadPage, leadStudentId, '/tasks');
      const bellBtn = leadPage.getByRole('button', {
        name: new RegExp(viMessages.notifications.bellAriaLabel),
      });
      await expect(bellBtn).toBeVisible();
      await expect(bellBtn).toContainText('1');

      await bellBtn.click();
      const popover = leadPage.locator(`[aria-label="${viMessages.notifications.popoverAriaLabel}"]`);
      await expect(popover).toBeVisible();
      const expectedAcceptMsg = viMessages.notifications.taskAccepted
        .replace('{actorName}', memberFullName)
        .replace('{taskTitle}', workspaceTaskTitle);
      await expect(popover).toContainText(expectedAcceptMsg);
      assertNoSecretsInText([await popover.innerText()], sensitiveValues);

      // Click notification -> navigates to /tasks?task=[id] and opens near-fullscreen modal
      const markReadPromise = leadPage.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/notifications/') &&
          res.url().endsWith('/read') &&
          res.request().method() === 'POST',
      );
      await popover.getByText(expectedAcceptMsg).click();
      expect((await markReadPromise).status()).toBe(200);
      await leadPage.waitForURL(`${BASE_ORIGIN}/tasks?task=${taskId}`);
      const drawer = leadPage.locator('aside.task-modal-shell[role="dialog"]');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(workspaceTaskTitle);
      await drawer.getByRole('button', { name: viMessages.common.close }).click();

      // 5. Member submits invalid URL (400) then valid deliverable URL (201), listed on GET /deliverables
      const xssDelivRes = await page.request.post(`/api/v1/tasks/${taskId}/deliverables`, {
        data: { title: 'XSS Probe', url: 'javascript:alert(1)' },
      });
      expect(xssDelivRes.status()).toBe(400);

      const addDelivRes = await page.request.post(`/api/v1/tasks/${taskId}/deliverables`, {
        data: { title: deliverableTitle, url: deliverableUrl },
      });
      expect(addDelivRes.status()).toBe(201);
      const addDelivText = await addDelivRes.text();
      assertNoSecretsInText([addDelivText], sensitiveValues);
      const addDelivJson = JSON.parse(addDelivText) as {
        deliverable: { id: string; title: string; url: string };
        task: { deliverableCount: number };
      };
      expect(addDelivJson.task.deliverableCount).toBe(1);

      const listDelivRes = await page.request.get(`/api/v1/tasks/${taskId}/deliverables`);
      expect(listDelivRes.status()).toBe(200);
      const listDelivText = await listDelivRes.text();
      assertNoSecretsInText([listDelivText], sensitiveValues);
      expect(
        (JSON.parse(listDelivText) as { items: Array<{ id: string; url: string }> }).items,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: addDelivJson.deliverable.id, url: deliverableUrl }),
        ]),
      );

      // Lead reloads and opens Notification Bell -> sees unread 'task.deliverable_submitted'
      await leadPage.reload();
      const leadBellAfterDeliv = leadPage.getByRole('button', {
        name: new RegExp(viMessages.notifications.bellAriaLabel),
      });
      await expect(leadBellAfterDeliv).toContainText('1');
      await leadBellAfterDeliv.click();
      const popoverAfterDeliv = leadPage.locator(
        `[aria-label="${viMessages.notifications.popoverAriaLabel}"]`,
      );
      await expect(popoverAfterDeliv).toBeVisible();
      const expectedDelivMsg = viMessages.notifications.taskDeliverableSubmitted
        .replace('{actorName}', memberFullName)
        .replace('{taskTitle}', workspaceTaskTitle);
      await expect(popoverAfterDeliv).toContainText(expectedDelivMsg);
      assertNoSecretsInText([await popoverAfterDeliv.innerText()], sensitiveValues);

      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    await tracker.assertClean();
  });

  test('enforces 404 for outsider on hidden task acceptance/deliverables and redacts WQ-27 hidden titles & deliverable URLs in Lead notifications (VI/EN)', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const boardId = randomUUID();
    const todoColId = randomUUID();
    const doneColId = randomUUID();
    trackedBoardIds.push(boardId);

    const hiddenSecretTitle = `CR09_TOP_SECRET_TASK_${suffix}`;
    const hiddenDeliverableTitle = `CR09_SECRET_SPEC_${suffix}`;
    const hiddenDeliverableUrl = `https://secret.example.com/private-spec-${suffix}`;

    await db.insert(boards).values({
      id: boardId,
      name: `Board CR09 Hidden ${suffix}`,
      departmentId: null,
      createdBy: creatorUserId,
    });
    await db.insert(columns).values([
      { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
      { id: doneColId, boardId, name: 'Done', orderIndex: 1 },
    ]);

    // Creator creates hidden task assigned to deptA
    const creatorContext = await browser.newContext();
    const creatorPage = await creatorContext.newPage();
    const creatorTracker = await attachRuntimeErrorTracker(creatorPage);
    let hiddenTaskId: string;
    try {
      await signInAs(creatorPage, creatorStudentId, '/tasks');
      const createRes = await creatorPage.request.post('/api/v1/tasks', {
        data: {
          boardId,
          columnId: todoColId,
          title: hiddenSecretTitle,
          departmentIds: [deptAId],
          isHidden: true,
          notifyInApp: false,
          notifyEmail: false,
        },
      });
      expect(createRes.status()).toBe(201);
      hiddenTaskId = ((await createRes.json()) as { task: { id: string } }).task.id;
      trackedTaskIds.push(hiddenTaskId);
      await creatorTracker.assertClean();
    } finally {
      await creatorContext.close();
    }

    // Member of deptA accepts and submits deliverable on hidden task
    await signInAs(page, memberStudentId, '/tasks');
    expect(
      (
        await page.request.put(`/api/v1/tasks/${hiddenTaskId}/acceptance`, {
          data: { accepted: true },
        })
      ).status(),
    ).toBe(200);

    const hiddenDelivRes = await page.request.post(`/api/v1/tasks/${hiddenTaskId}/deliverables`, {
      data: { title: hiddenDeliverableTitle, url: hiddenDeliverableUrl },
    });
    expect(hiddenDelivRes.status()).toBe(201);
    const hiddenDelivId = (
      (await hiddenDelivRes.json()) as { deliverable: { id: string } }
    ).deliverable.id;

    // Outsider holding task.update_any gets 404 on PUT /acceptance, GET/POST /deliverables, and DELETE /deliverables/{id}
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    const outsiderTracker = await attachRuntimeErrorTracker(outsiderPage);
    try {
      await signInAs(outsiderPage, outsiderStudentId, '/tasks');
      expect(
        (
          await outsiderPage.request.put(`/api/v1/tasks/${hiddenTaskId}/acceptance`, {
            data: { accepted: true },
          })
        ).status(),
      ).toBe(404);
      expect(
        (await outsiderPage.request.get(`/api/v1/tasks/${hiddenTaskId}/deliverables`)).status(),
      ).toBe(404);
      expect(
        (
          await outsiderPage.request.post(`/api/v1/tasks/${hiddenTaskId}/deliverables`, {
            data: { title: 'Intruder', url: 'https://example.com/intruder' },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await outsiderPage.request.delete(
            `/api/v1/tasks/${hiddenTaskId}/deliverables/${hiddenDelivId}`,
          )
        ).status(),
      ).toBe(404);
      await outsiderTracker.assertClean();
    } finally {
      await outsiderContext.close();
    }

    // Verify DB notifications payload omits hidden task title and deliverable URL (WQ-27)
    const dbNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.taskId, hiddenTaskId), eq(notifications.userId, leadUserId)));
    expect(dbNotifs).toHaveLength(2);
    for (const row of dbNotifs) {
      expect(row.isHiddenTask).toBe(true);
      expect(row.payload.taskTitle ?? null).toBeNull();
      const serializedPayload = JSON.stringify(row.payload);
      expect(serializedPayload).not.toContain(hiddenSecretTitle);
      expect(serializedPayload).not.toContain(hiddenDeliverableTitle);
      expect(serializedPayload).not.toContain(hiddenDeliverableUrl);
    }

    // Department Lead opens Bell popover -> WQ-27 redacted VI and EN notifications without leaking title or URL
    const leadContext = await browser.newContext();
    const leadPage = await leadContext.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    try {
      await signInAs(leadPage, leadStudentId, '/tasks');
      const notifRes = await leadPage.request.get('/api/v1/notifications');
      expect(notifRes.status()).toBe(200);
      const notifText = await notifRes.text();
      expect(notifText).not.toContain(hiddenSecretTitle);
      expect(notifText).not.toContain(hiddenDeliverableTitle);
      expect(notifText).not.toContain(hiddenDeliverableUrl);
      assertNoSecretsInText([notifText], sensitiveValues);

      const notifJson = JSON.parse(notifText) as {
        items: Array<{ type: string; taskId: string; taskTitle: string | null; isHiddenTask: boolean }>;
      };
      const hiddenNotifs = notifJson.items.filter((i) => i.taskId === hiddenTaskId);
      expect(hiddenNotifs).toHaveLength(2);
      for (const item of hiddenNotifs) {
        expect(item.isHiddenTask).toBe(true);
        expect(item.taskTitle).toBeNull();
      }
      expect(hiddenNotifs.map((i) => i.type).sort()).toEqual([
        'task.accepted',
        'task.deliverable_submitted',
      ]);

      const viBellBtn = leadPage.getByRole('button', {
        name: new RegExp(viMessages.notifications.bellAriaLabel),
      });
      await viBellBtn.click();
      const viPopover = leadPage.locator(
        `[aria-label="${viMessages.notifications.popoverAriaLabel}"]`,
      );
      await expect(viPopover).toBeVisible();
      await expect(viPopover).toContainText(viMessages.notifications.hiddenTaskAccepted);
      await expect(viPopover).toContainText(
        viMessages.notifications.hiddenTaskDeliverableSubmitted,
      );
      const viPopoverText = await viPopover.innerText();
      expect(viPopoverText).not.toContain(hiddenSecretTitle);
      expect(viPopoverText).not.toContain(hiddenDeliverableTitle);
      expect(viPopoverText).not.toContain(hiddenDeliverableUrl);
      assertNoSecretsInText([viPopoverText], sensitiveValues);

      // Switch to EN and verify EN WQ-27 redacted strings
      const enSwitchPromise = leadPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
      );
      await leadPage
        .locator('.app-side .app-side-lang')
        .getByRole('button', { name: 'EN', exact: true })
        .click();
      expect((await enSwitchPromise).status()).toBe(200);
      await expect(leadPage.locator('.app-top-bread')).toContainText(enMessages.calendar.title);

      const enBellBtn = leadPage.getByRole('button', {
        name: new RegExp(enMessages.notifications.bellAriaLabel),
      });
      const enPopover = leadPage.locator(
        `[aria-label="${enMessages.notifications.popoverAriaLabel}"]`,
      );
      if ((await enPopover.count()) === 0) {
        await enBellBtn.click();
      }
      await expect(enPopover).toBeVisible();
      await expect(enPopover).toContainText(enMessages.notifications.hiddenTaskAccepted);
      await expect(enPopover).toContainText(
        enMessages.notifications.hiddenTaskDeliverableSubmitted,
      );
      const enPopoverText = await enPopover.innerText();
      expect(enPopoverText).not.toContain(hiddenSecretTitle);
      expect(enPopoverText).not.toContain(hiddenDeliverableTitle);
      expect(enPopoverText).not.toContain(hiddenDeliverableUrl);
      assertNoSecretsInText([enPopoverText], sensitiveValues);

      await leadTracker.assertClean();
    } finally {
      await leadContext.close();
    }

    await tracker.assertClean();
  });
});
