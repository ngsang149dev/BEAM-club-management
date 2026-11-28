import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  columns,
  comments,
  departments,
  loginAttempts,
  memberDepartments,
  notifications,
  permissions,
  profiles,
  sessions,
  taskAssignees,
  taskDeliverables,
  taskDepartments,
  tasks,
  userPermissions,
} from '@db/schema';
import { PERMISSIONS } from '@/lib/permissions';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import enMessages from '../../messages/en.json';
import viMessages from '../../messages/vi.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const VN_OFFSET_MS = 7 * 3_600_000;

function vnMidnightUtc(offsetDays: number): Date {
  const vnNow = new Date(Date.now() + VN_OFFSET_MS);
  const shifted = new Date(
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + offsetDays),
  );
  const iso = shifted.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00.000+07:00`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function attachRuntimeTracker(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const url = msg.location()?.url ?? '';
      consoleErrors.push(url ? `${msg.text()} (${url})` : msg.text());
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
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
      expect(consoleErrors).toEqual([]);
      expect(serverErrors).toEqual([]);
    },
  };
}

async function signInAs(
  page: Page,
  studentId: string,
  expectedPath: string,
  returnTo?: string,
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  const loginUrl = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login';
  await page.goto(loginUrl);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${expectedPath}`);
}

function assertNoRawTranslationKeys(text: string): void {
  for (const prefix of ['progress.', 'reminders.', 'errors.', 'common.', 'nav.', 'member.', 'tasks.']) {
    expect(text).not.toContain(prefix);
  }
}

function assertZeroSecrets(payloads: readonly string[], secrets: readonly string[]): void {
  for (const body of payloads) {
    for (const secret of secrets) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('scrypt$');
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

async function selectFilterTab(page: Page, label: string): Promise<void> {
  const tab = page.locator('.prog-filter-tabs').getByRole('tab', { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openMemberCombobox(page: Page): Promise<Locator> {
  const trigger = page.getByRole('button', { name: viMessages.progress.memberPickerLabel, exact: true });
  await trigger.click();
  const listbox = page.locator('.prog-popover[role="listbox"]');
  await expect(listbox).toBeVisible();
  return listbox;
}

test.describe('CR-12 & CR-13 Member Progress Master-Detail, PII/Hidden Isolation & Reminder Preview E2E', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);

  const adminId = randomUUID();
  const member1Id = randomUUID(); // NO member.view
  const viewerId = randomUUID(); // HAS member.view, NO member.view_detail
  const detailViewerId = randomUUID(); // HAS member.view + member.view_detail

  const adminSid = `MSSV-CR13-ADM-${suffix}`;
  const member1Sid = `MSSV-CR13-M1-${suffix}`;
  const viewerSid = `MSSV-CR13-VW-${suffix}`;
  const detailViewerSid = `MSSV-CR13-DV-${suffix}`;

  const adminEmail = `cr13-adm-${suffix}@eiu.edu.vn`;
  const member1Email = `cr13-m1-${suffix}@eiu.edu.vn`;
  const viewerEmail = `cr13-vw-${suffix}@eiu.edu.vn`;
  const detailViewerEmail = `cr13-dv-${suffix}@eiu.edu.vn`;

  const adminName = `CR13 Admin ${suffix}`;
  const member1Name = `CR13 MemberOne ${suffix}`;
  const viewerName = `CR13 ViewerOnly ${suffix}`;
  const detailViewerName = `CR13 DetailViewer ${suffix}`;

  const dept1Id = randomUUID();
  const dept2Id = randomUUID();
  const dept1Name = `Ban Nội dung CR13 ${suffix}`;
  const dept2Name = `Ban Truyền thông CR13 ${suffix}`;

  const boardId = randomUUID();
  const todoColId = randomUUID();
  const doneColId = randomUUID();

  const directOverdueTaskId = randomUUID();
  const directSoonTaskId = randomUUID();
  const directDoneTaskId = randomUUID();
  const deptOnlyTaskId = randomUUID();
  const hiddenM1TaskId = randomUUID();
  const viewerSafeTaskId = randomUUID();

  const directOverdueTitle = `CR13 Direct Overdue ${suffix}`;
  const directSoonTitle = `CR13 Direct Soon ${suffix}`;
  const directDoneTitle = `CR13 Direct Done ${suffix}`;
  const deptOnlyTitle = `CR13 Dept Only Excluded ${suffix}`;
  const hiddenM1Title = `CR13_SECRET_HIDDEN_TASK_${suffix}`;
  const viewerSafeTitle = `CR13 Viewer Safe ${suffix}`;

  const trackedUserIds = [adminId, member1Id, viewerId, detailViewerId];
  const trackedStudentIds = [adminSid, member1Sid, viewerSid, detailViewerSid];
  const trackedDeptIds = [dept1Id, dept2Id];
  const trackedBoardIds = [boardId];
  const trackedTaskIds = [
    directOverdueTaskId,
    directSoonTaskId,
    directDoneTaskId,
    deptOnlyTaskId,
    hiddenM1TaskId,
    viewerSafeTaskId,
  ];

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }
    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    const seedHash = await hashPassword(DEV_SEED_PASSWORD);

    await db
      .insert(permissions)
      .values(
        PERMISSIONS.map((p) => ({
          code: p.code,
          groupName: p.group,
          description: p.code,
          scopable: false,
        })),
      )
      .onConflictDoNothing();

    await db.insert(profiles).values([
      {
        id: adminId,
        studentId: adminSid,
        email: adminEmail,
        fullName: adminName,
        passwordHash: seedHash,
        mustChangePassword: false,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: member1Id,
        studentId: member1Sid,
        email: member1Email,
        fullName: member1Name,
        passwordHash: seedHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: viewerId,
        studentId: viewerSid,
        email: viewerEmail,
        fullName: viewerName,
        passwordHash: seedHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: detailViewerId,
        studentId: detailViewerSid,
        email: detailViewerEmail,
        fullName: detailViewerName,
        passwordHash: seedHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(departments).values([
      { id: dept1Id, name: dept1Name },
      { id: dept2Id, name: dept2Name },
    ]);

    await db.insert(memberDepartments).values([
      { userId: member1Id, departmentId: dept1Id },
      { userId: viewerId, departmentId: dept2Id },
      { userId: detailViewerId, departmentId: dept2Id },
    ]);

    await db.insert(userPermissions).values([
      ...(['task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: member1Id,
        permissionCode: code,
        grantedBy: adminId,
      })),
      ...(['member.view', 'task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: viewerId,
        permissionCode: code,
        grantedBy: adminId,
      })),
      ...(['member.view', 'member.view_detail', 'task.update_assigned', 'comment.create'] as const).map((code) => ({
        userId: detailViewerId,
        permissionCode: code,
        grantedBy: adminId,
      })),
    ]);

    await db.insert(boards).values({
      id: boardId,
      name: `Board CR13 ${suffix}`,
      createdBy: adminId,
    });
    await db.insert(columns).values([
      { id: todoColId, boardId, name: 'Đang thực hiện', orderIndex: 0 },
      { id: doneColId, boardId, name: 'Done', orderIndex: 1 },
    ]);

    await db.insert(tasks).values([
      {
        id: directOverdueTaskId,
        boardId,
        columnId: todoColId,
        title: directOverdueTitle,
        description: `Overdue direct description ${suffix}`,
        startAt: vnMidnightUtc(-5),
        dueAt: vnMidnightUtc(-2),
        isCompleted: false,
        priority: 3,
        position: '1000',
        isHidden: false,
        createdBy: adminId,
      },
      {
        id: directSoonTaskId,
        boardId,
        columnId: todoColId,
        title: directSoonTitle,
        description: `Soon direct description ${suffix}`,
        startAt: vnMidnightUtc(-1),
        dueAt: vnMidnightUtc(2),
        isCompleted: false,
        priority: 2,
        position: '2000',
        isHidden: false,
        createdBy: adminId,
      },
      {
        id: directDoneTaskId,
        boardId,
        columnId: doneColId,
        title: directDoneTitle,
        description: `Completed direct task ${suffix}`,
        startAt: vnMidnightUtc(-3),
        dueAt: vnMidnightUtc(0),
        isCompleted: true,
        completedAt: new Date(),
        priority: 1,
        position: '3000',
        isHidden: false,
        createdBy: adminId,
      },
      {
        id: deptOnlyTaskId,
        boardId,
        columnId: todoColId,
        title: deptOnlyTitle,
        description: `Department-only scope test ${suffix}`,
        startAt: vnMidnightUtc(0),
        dueAt: vnMidnightUtc(3),
        isCompleted: false,
        priority: 2,
        position: '4000',
        isHidden: false,
        createdBy: adminId,
      },
      {
        id: hiddenM1TaskId,
        boardId,
        columnId: todoColId,
        title: hiddenM1Title,
        description: `Hidden task secret ${suffix}`,
        startAt: vnMidnightUtc(0),
        dueAt: vnMidnightUtc(4),
        isCompleted: false,
        priority: 4,
        position: '5000',
        isHidden: true,
        createdBy: adminId,
      },
      {
        id: viewerSafeTaskId,
        boardId,
        columnId: todoColId,
        title: viewerSafeTitle,
        description: `Safe viewer task ${suffix}`,
        startAt: vnMidnightUtc(0),
        dueAt: vnMidnightUtc(7),
        isCompleted: false,
        priority: 1,
        position: '6000',
        isHidden: false,
        createdBy: adminId,
      },
    ]);

    await db.insert(taskAssignees).values([
      { taskId: directOverdueTaskId, userId: member1Id },
      { taskId: directSoonTaskId, userId: member1Id },
      { taskId: directDoneTaskId, userId: member1Id, acceptedAt: new Date() },
      { taskId: hiddenM1TaskId, userId: member1Id },
      { taskId: viewerSafeTaskId, userId: viewerId },
    ]);

    await db.insert(taskDepartments).values([
      { taskId: deptOnlyTaskId, departmentId: dept1Id },
      { taskId: directOverdueTaskId, departmentId: dept1Id },
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
      await db.delete(comments).where(inArray(comments.taskId, trackedTaskIds));
      await db.delete(taskDeliverables).where(inArray(taskDeliverables.taskId, trackedTaskIds));
      await db.delete(taskDepartments).where(inArray(taskDepartments.taskId, trackedTaskIds));
      await db.delete(taskAssignees).where(inArray(taskAssignees.taskId, trackedTaskIds));
      await db.delete(notifications).where(inArray(notifications.taskId, trackedTaskIds));
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

      await db
        .delete(notifications)
        .where(
          or(
            inArray(notifications.userId, trackedUserIds),
            inArray(notifications.actorId, trackedUserIds),
          ),
        );
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
        .where(and(inArray(profiles.id, [member1Id, viewerId, detailViewerId]), isNull(profiles.purgedAt)));

      const remainingAdmins = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true), ne(profiles.id, adminId)));
      if (remainingAdmins.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: false, leftAt: now, updatedAt: now })
          .where(eq(profiles.id, adminId));
      }
    }
    await pool?.end();
  });

  test('verifies /my-tasks consolidation into /progress (redirect + sidebar), Của tôi vs Thành viên CLB scopes, Master-Detail actions, Deliverables card, Comments modal, no /members calls without member.view, and 375x812 responsive layout', async ({
    page,
  }) => {
    const tracker = await attachRuntimeTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const memberApiRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/members')) {
        memberApiRequests.push(req.url());
      }
    });

    await signInAs(page, member1Sid, '/tasks');

    // 1. Sidebar omits /my-tasks and displays /progress; visiting /my-tasks redirects to /progress
    await expect(page.locator('.app-side a[href="/my-tasks"]')).toHaveCount(0);
    await expect(page.locator('.app-mtabs a[href="/my-tasks"]')).toHaveCount(0);
    const sideProgress = page.locator('.app-side a.app-nav-item[href="/progress"]');
    await expect(sideProgress).toHaveText(viMessages.nav.progress);

    await page.goto('/my-tasks');
    await page.waitForURL(`${BASE_ORIGIN}/progress`);

    // 2. /progress defaults to Của tôi -> Đang làm (excludes completed, includes direct & dept tasks); NO mode switcher (since basic member lacks member.view/lead), ZERO /api/v1/members requests
    await expect(page.getByRole('button', { name: viMessages.progress.modeMine, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: viMessages.progress.modeTeam, exact: true })).toHaveCount(0);
    expect(memberApiRequests).toEqual([]);

    // Self PII visible in member banner
    const banner = page.locator('.prog-member-banner');
    await expect(banner).toContainText(member1Name);
    await expect(banner).toContainText(member1Sid);
    await expect(banner).toContainText(member1Email);

    // Của tôi (Đang làm) shows direct open tasks AND department-assigned task with "Giao cho Ban" pill, excluding Done
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directSoonTitle })).toBeVisible();
    const deptOnlyRow = page.locator('.prog-row', { hasText: deptOnlyTitle });
    await expect(deptOnlyRow).toBeVisible();
    await expect(deptOnlyRow.locator('.prog-dept-pill')).toHaveText(viMessages.progress.deptAssignedPill);
    await expect(page.locator('.prog-row', { hasText: directDoneTitle })).toHaveCount(0);

    // 3. Filter tabs ("Việc của Ban", "Quá hạn", "Chưa nhận", "Đã xong", "Tất cả") & search
    await selectFilterTab(page, viMessages.progress.filterDepartment);
    await expect(page.locator('.prog-row', { hasText: deptOnlyTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directSoonTitle })).toHaveCount(0);

    await selectFilterTab(page, viMessages.progress.filterOverdue);
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directSoonTitle })).toHaveCount(0);

    await selectFilterTab(page, viMessages.progress.filterUnaccepted);
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directSoonTitle })).toBeVisible();

    await selectFilterTab(page, viMessages.progress.filterDone);
    await expect(page.locator('.prog-row', { hasText: directDoneTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toHaveCount(0);

    await selectFilterTab(page, viMessages.progress.filterAll);
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directDoneTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: deptOnlyTitle })).toBeVisible();

    const searchInput = page.getByLabel(viMessages.progress.taskSearchLabel, { exact: true });
    await searchInput.fill(directSoonTitle);
    await expect(page.locator('.prog-row', { hasText: directSoonTitle })).toBeVisible();
    await expect(page.locator('.prog-row', { hasText: directOverdueTitle })).toHaveCount(0);
    await searchInput.fill('');
    await selectFilterTab(page, viMessages.progress.filterOpen);

    // 4. Select overdue task -> verify dynamic deadline bar, acceptance toggle (persists reload), complete/reopen, expand drawer
    const overdueRow = page.locator('.prog-row', { hasText: directOverdueTitle });
    await overdueRow.locator('.prog-row-btn').click();
    const summaryCard = page.locator('.prog-summary-card');
    await expect(summaryCard).toContainText(directOverdueTitle);
    await expect(summaryCard.locator('.prog-deadline-box.is-overdue')).toBeVisible();

    // Switch to soon task -> color changes to .is-soon
    const soonRow = page.locator('.prog-row', { hasText: directSoonTitle });
    await soonRow.locator('.prog-row-btn').click();
    await expect(summaryCard).toContainText(directSoonTitle);
    await expect(summaryCard.locator('.prog-deadline-box.is-soon')).toBeVisible();

    // Toggle "Nhận việc" and verify persistence across reload
    const acceptPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${directSoonTaskId}/acceptance`) && res.request().method() === 'PUT',
    );
    await summaryCard.getByRole('button', { name: viMessages.progress.acceptButton, exact: true }).click();
    expect((await acceptPromise).status()).toBe(200);
    await expect(summaryCard.locator('.prog-accept-btn.is-accepted')).toBeVisible();
    await expect(soonRow.locator('.prog-accept-chip.is-accepted')).toBeVisible();

    await page.reload();
    await page.locator('.prog-row', { hasText: directSoonTitle }).locator('.prog-row-btn').click();
    await expect(summaryCard.locator('.prog-accept-btn.is-accepted')).toBeVisible();

    // Toggle "Hoàn thành" -> deadline bar switches to .is-done -> reopen back to active
    const completePromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${directSoonTaskId}`) && res.request().method() === 'PATCH',
    );
    await summaryCard.getByRole('button', { name: viMessages.progress.completeButton, exact: true }).click();
    expect((await completePromise).status()).toBe(200);
    await selectFilterTab(page, viMessages.progress.filterDone);
    await page.locator('.prog-row', { hasText: directSoonTitle }).locator('.prog-row-btn').click();
    await expect(summaryCard.locator('.prog-deadline-box.is-done')).toBeVisible();

    const reopenPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${directSoonTaskId}`) && res.request().method() === 'PATCH',
    );
    await summaryCard.getByRole('button', { name: viMessages.progress.reopenButton, exact: true }).click();
    expect((await reopenPromise).status()).toBe(200);
    await selectFilterTab(page, viMessages.progress.filterOpen);
    await page.locator('.prog-row', { hasText: directSoonTitle }).locator('.prog-row-btn').click();

    // Expand ⤢ opens TaskDetailDrawer
    await summaryCard.getByRole('button', { name: viMessages.progress.expandDetail, exact: true }).click();
    const drawerModal = page.locator('aside.task-modal-shell[role="dialog"]');
    await expect(drawerModal).toBeVisible();
    await expect(drawerModal.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(directSoonTitle);
    await drawerModal.getByRole('button', { name: viMessages.common.close }).click();
    await expect(drawerModal).toHaveCount(0);

    // 5. Dedicated Deliverables Card: submit new link -> hostname ↗ -> delete link
    const delivCard = page.locator('.prog-deliv-card');
    await expect(delivCard).toBeVisible();
    const delivTitle = `Progress Spec ${suffix}`;
    const delivUrl = `https://docs.google.com/document/d/cr13-${suffix}`;

    await delivCard.getByRole('button', { name: viMessages.progress.deliverableAddToggle, exact: true }).click();
    await delivCard.getByLabel(viMessages.tasks.deliverableTitlePlaceholder, { exact: true }).fill(delivTitle);
    await delivCard.getByLabel(viMessages.tasks.deliverableUrlPlaceholder, { exact: true }).fill(delivUrl);
    const addDelivPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${directSoonTaskId}/deliverables`) && res.request().method() === 'POST',
    );
    await delivCard.getByRole('button', { name: viMessages.common.save, exact: true }).click();
    expect((await addDelivPromise).status()).toBe(201);

    const delivLink = delivCard.locator('a.prog-deliv-link', { hasText: delivTitle });
    await expect(delivLink).toBeVisible();
    await expect(delivLink).toContainText('docs.google.com ↗');
    await expect(delivLink).toHaveAttribute('target', '_blank');
    await expect(delivLink).toHaveAttribute('rel', 'noopener noreferrer');

    const delDelivPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${directSoonTaskId}/deliverables/`) &&
        res.request().method() === 'DELETE',
    );
    await delivCard
      .getByRole('button', { name: `${viMessages.tasks.deliverableDelete}: ${delivTitle}`, exact: true })
      .click();
    expect((await delDelivPromise).status()).toBe(200);
    await expect(delivCard.locator('a.prog-deliv-link', { hasText: delivTitle })).toHaveCount(0);

    // 6. Separate Comments Modal: open, post comment, count increments, close with Escape & ✕
    const commentBody = `CR13 progress modal comment ${suffix}`;
    await summaryCard
      .getByRole('button', { name: new RegExp(escapeRegex('Bình luận (0)')) })
      .click();
    const commentsModal = page.locator('.prog-modal-shell[role="dialog"]');
    await expect(commentsModal).toBeVisible();
    await expect(commentsModal).toHaveAttribute('aria-modal', 'true');
    await expect(commentsModal).toContainText(directSoonTitle);

    await commentsModal.getByLabel(viMessages.comments.composerLabel).fill(commentBody);
    const commentPostPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${directSoonTaskId}/comments`) && res.request().method() === 'POST',
    );
    await commentsModal.getByRole('button', { name: viMessages.comments.submit, exact: true }).click();
    expect((await commentPostPromise).status()).toBe(201);
    await expect(commentsModal.getByText(commentBody)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(commentsModal).toHaveCount(0);
    await expect(summaryCard.locator('.prog-comments-trigger')).toContainText('(1)');

    // Open via list row pill and close with ✕
    await page.locator('.prog-row', { hasText: directSoonTitle }).locator('.prog-comment-pill').click();
    await expect(commentsModal).toBeVisible();
    await commentsModal.locator('.prog-modal-close').click();
    await expect(commentsModal).toHaveCount(0);

    // 7. Mobile 375x812 responsive check (zero horizontal overflow & zero raw translation keys)
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('.prog-list-pane')).toBeVisible();
    const mobileMetrics = await page.evaluate(() => ({
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mainOverflow:
        (document.querySelector('#main-content')?.scrollWidth ?? 0) >
        (document.querySelector('#main-content')?.clientWidth ?? 0),
    }));
    expect(mobileMetrics.docOverflow).toBe(false);
    expect(mobileMetrics.mainOverflow).toBe(false);
    assertNoRawTranslationKeys(await page.locator('#main-content').innerText());
    expect(memberApiRequests).toEqual([]);
    await tracker.assertClean();
  });

  test('enforces Thành viên CLB RBAC, Searchable Combobox + stepper, zero PII without member.view_detail, visible PII with member.view_detail, and hidden-task isolation', async ({
    browser,
  }) => {
    // A. Member WITH member.view ONLY (NO member.view_detail): sees Thành viên CLB, zero PII of peers, zero invisible hidden tasks
    const viewerCtx = await browser.newContext();
    const viewerPage = await viewerCtx.newPage();
    const viewerTracker = await attachRuntimeTracker(viewerPage);
    const viewerPayloads: string[] = [];
    viewerPage.on('response', (res) => {
      if (res.url().includes('/api/v1/members') || res.url().includes('/api/v1/tasks')) {
        void res.text().then((body) => viewerPayloads.push(body)).catch(() => {});
      }
    });

    try {
      await viewerPage.setViewportSize({ width: 1280, height: 800 });
      await signInAs(viewerPage, viewerSid, '/tasks');
      await viewerPage.locator('.app-side a.app-nav-item[href="/progress"]').click();
      await viewerPage.waitForURL(`${BASE_ORIGIN}/progress`);

      const teamBtn = viewerPage.getByRole('button', { name: viMessages.progress.modeTeam, exact: true });
      await expect(teamBtn).toBeVisible();
      await teamBtn.click();
      await expect(teamBtn).toHaveAttribute('aria-pressed', 'true');

      // Dept filter, Combobox & stepper present
      const deptSelect = viewerPage.getByLabel(viMessages.progress.departmentFilterLabel, { exact: true });
      await expect(deptSelect).toBeVisible();
      await expect(viewerPage.locator('.prog-stepper')).toBeVisible();

      // Filter by Ban Nội dung (dept1), open Combobox, toggle "Có việc trễ hạn", search member1Name & select
      await deptSelect.selectOption(dept1Id);
      const listbox = await openMemberCombobox(viewerPage);
      await listbox.getByRole('button', { name: viMessages.progress.popoverFilterOverdue, exact: true }).click();
      await listbox.getByLabel(viMessages.progress.memberSearchLabel, { exact: true }).fill(member1Name);
      const memberOption = listbox.getByRole('option', { name: new RegExp(escapeRegex(member1Name)) });
      await expect(memberOption).toBeVisible();
      await memberOption.click();
      await expect(listbox).toHaveCount(0);

      // Banner displays member1Name with ZERO studentId / email in DOM
      const banner = viewerPage.locator('.prog-member-banner');
      await expect(banner).toContainText(member1Name);
      const bannerText = await banner.innerText();
      expect(bannerText).not.toContain(member1Sid);
      expect(bannerText).not.toContain(member1Email);

      // Sees member1's direct public tasks, NEVER sees dept-only task or hidden task
      await expect(viewerPage.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
      await selectFilterTab(viewerPage, viMessages.progress.filterAll);
      await expect(viewerPage.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
      await expect(viewerPage.locator('.prog-row', { hasText: deptOnlyTitle })).toHaveCount(0);
      await expect(viewerPage.locator('.prog-row', { hasText: hiddenM1Title })).toHaveCount(0);

      // Stepper changes member index when multiple members exist in "Tất cả ban"
      await deptSelect.selectOption('');
      const stepIndexBefore = await viewerPage.locator('.prog-step-index').innerText();
      expect(stepIndexBefore).toMatch(/^\d+\/\d+$/);
      await viewerPage.getByRole('button', { name: viMessages.progress.nextMemberAria, exact: true }).click();
      await expect(viewerPage.locator('.prog-step-index')).not.toHaveText(stepIndexBefore);

      const mainText = await viewerPage.locator('#main-content').innerText();
      expect(mainText).not.toContain(hiddenM1Title);
      assertZeroSecrets(
        [mainText, ...viewerPayloads],
        [member1Sid, member1Email, adminSid, adminEmail, detailViewerSid, detailViewerEmail, hiddenM1Title],
      );
      await viewerTracker.assertClean();
    } finally {
      await viewerCtx.close();
    }

    // B. Member WITH member.view_detail: DOES see peer's studentId & email in banner, still NEVER sees hidden task
    const detailCtx = await browser.newContext();
    const detailPage = await detailCtx.newPage();
    const detailTracker = await attachRuntimeTracker(detailPage);
    try {
      await detailPage.setViewportSize({ width: 1280, height: 800 });
      await signInAs(detailPage, detailViewerSid, '/progress', '/progress');

      await detailPage.getByRole('button', { name: viMessages.progress.modeTeam, exact: true }).click();
      await detailPage.getByLabel(viMessages.progress.departmentFilterLabel, { exact: true }).selectOption(dept1Id);
      const listbox = await openMemberCombobox(detailPage);
      await listbox.getByRole('option', { name: new RegExp(escapeRegex(member1Name)) }).click();

      const banner = detailPage.locator('.prog-member-banner');
      await expect(banner).toContainText(member1Name);
      await expect(banner).toContainText(member1Sid);
      await expect(banner).toContainText(member1Email);

      await selectFilterTab(detailPage, viMessages.progress.filterAll);
      await expect(detailPage.locator('.prog-row', { hasText: directOverdueTitle })).toBeVisible();
      await expect(detailPage.locator('.prog-row', { hasText: hiddenM1Title })).toHaveCount(0);
      await detailTracker.assertClean();
    } finally {
      await detailCtx.close();
    }
  });

  test('verifies CR-12/CR-14 /admin/reminders live sample preview sync (Pink->Coral header, zero Priority pills, zero .rem-email-foot, /progress CTA, app locale sync)', async ({
    page,
  }) => {
    const tracker = await attachRuntimeTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAs(page, adminSid, '/admin/reminders', '/admin/reminders');

    const previewAside = page.locator('aside.rem-side');
    const emailCard = previewAside.locator('article.rem-email[data-component="ReminderEmail"]');
    await expect(emailCard).toBeVisible();

    // Simplified CR-14 preview: no preview controls, language switcher, .rem-email-lang, or sample toggle/chip
    await expect(previewAside.locator('.rem-preview-controls')).toHaveCount(0);
    await expect(previewAside.locator('[role="group"]')).toHaveCount(0);
    await expect(previewAside.locator('.rem-email-lang')).toHaveCount(0);
    await expect(previewAside.locator('.rem-sample-chip')).toHaveCount(0);
    await expect(previewAside.getByTestId('reminders-sample-chip')).toHaveCount(0);

    // Header gradient check & absence of old Priority pills and footer explanation
    const headerBg = await emailCard
      .locator('.rem-email-top')
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(headerBg).toContain('linear-gradient');
    await expect(emailCard.locator('.ui-prio, .rem-email-task-prio')).toHaveCount(0);
    await expect(emailCard.locator('.rem-email-foot')).toHaveCount(0);
    await expect(emailCard.locator('a.rem-email-cta')).toHaveAttribute('href', '/progress');

    const viText = await emailCard.innerText();
    expect(viText).toContain(viMessages.reminders.emailContent.vi.sampleTaskSoon);
    expect(viText).not.toContain('Mỗi người một email, mỗi ngày.');
    assertNoRawTranslationKeys(viText);

    // Switch app language via .app-side .app-side-lang to EN and assert zero Priority labels or footer explanation
    const enSwitchPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
    );
    await page.locator('.app-side .app-side-lang').getByRole('button', { name: 'EN', exact: true }).click();
    expect((await enSwitchPromise).status()).toBe(200);
    await expect(emailCard).toContainText(enMessages.reminders.emailContent.en.subject);
    await expect(emailCard).toContainText(enMessages.reminders.emailContent.en.sampleTaskSoon);
    await expect(emailCard.locator('.ui-prio, .rem-email-task-prio')).toHaveCount(0);
    await expect(emailCard.locator('.rem-email-foot')).toHaveCount(0);
    await expect(emailCard.locator('a.rem-email-cta')).toHaveAttribute('href', '/progress');
    const enText = await emailCard.innerText();
    expect(enText).not.toContain('One email per person, per day.');
    assertNoRawTranslationKeys(enText);

    // Switch back to VI
    const viSwitchPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH',
    );
    await page.locator('.app-side .app-side-lang').getByRole('button', { name: 'VI', exact: true }).click();
    expect((await viSwitchPromise).status()).toBe(200);

    await tracker.assertClean();
  });
});
