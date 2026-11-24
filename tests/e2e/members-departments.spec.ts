import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  departments,
  loginAttempts,
  memberDepartments,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
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

async function signInAs(page: Page, studentId: string, returnTo = '/members'): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel).fill(studentId);
  await page.getByRole('button', { name: viMessages.auth.signInButton }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

test.describe('Members & Departments E2E (S07, S09, S11)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const basicUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const busyDeptId = randomUUID();

  const adminStudentId = `MSSV-E3-ADM-${suffix}`;
  const basicStudentId = `MSSV-E3-BAS-${suffix}`;
  const inactiveStudentId = `MSSV-E3-OFF-${suffix}`;
  const newStudentId = `MSSV-E3-NEW-${suffix}`;

  const adminEmail = `e3-admin-${suffix}@eiu.edu.vn`;
  const basicEmail = `e3-basic-${suffix}@eiu.edu.vn`;
  const newEmail = `e3-new-${suffix}@eiu.edu.vn`;

  const adminFullName = `E3 Admin ${suffix}`;
  const basicFullName = `E3 Basic ${suffix}`;
  const inactiveFullName = `E3 Inactive ${suffix}`;
  const newFullName = `E3 Created ${suffix}`;
  const updatedFullName = `E3 Updated ${suffix}`;

  const busyDeptName = `Ban E3 Busy ${suffix}`;
  const createdDeptName = `Ban E3 New ${suffix}`;
  const renamedDeptName = `Ban E3 Renamed ${suffix}`;

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);

    await db
      .insert(permissions)
      .values([
        { code: 'member.view', groupName: 'members', description: 'View directory', scopable: false },
        {
          code: 'task.update_assigned',
          groupName: 'tasks',
          description: 'Update assigned tasks',
          scopable: false,
        },
        { code: 'comment.create', groupName: 'comments', description: 'Create comments', scopable: false },
      ])
      .onConflictDoNothing();

    await db.insert(profiles).values([
      {
        id: adminUserId,
        studentId: adminStudentId,
        email: adminEmail,
        fullName: adminFullName,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: basicUserId,
        studentId: basicStudentId,
        email: basicEmail,
        fullName: basicFullName,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveUserId,
        studentId: inactiveStudentId,
        email: `e3-inactive-${suffix}@eiu.edu.vn`,
        fullName: inactiveFullName,
        isAdmin: false,
        isActive: false,
        leftAt: new Date('2026-09-01T00:00:00.000Z'),
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: basicUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: basicUserId, permissionCode: 'task.update_assigned', grantedBy: adminUserId },
      { userId: basicUserId, permissionCode: 'comment.create', grantedBy: adminUserId },
    ]);

    await db.insert(departments).values({
      id: busyDeptId,
      name: busyDeptName,
    });

    await db.insert(memberDepartments).values({
      userId: basicUserId,
      departmentId: busyDeptId,
    });
  });

  test.beforeEach(async () => {
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, [
            adminStudentId,
            basicStudentId,
            inactiveStudentId,
            newStudentId,
          ]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const cleanupIds = [adminUserId, basicUserId, inactiveUserId];
      await db.delete(sessions).where(inArray(sessions.userId, cleanupIds));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [
              adminStudentId,
              basicStudentId,
              inactiveStudentId,
              newStudentId,
            ]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .update(profiles)
        .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
        .where(eq(profiles.studentId, newStudentId));

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

  test('hides MSSV/email, disables MSSV search, shows left badge on S07, and returns 403 on admin routes for basic member (AC-11, WQ-11, FR-43)', async ({
    page,
  }) => {
    await signInAs(page, basicStudentId, '/members');

    const table = page.locator('.directory-table-wrap table.ui-table');
    await expect(table).toBeVisible();
    await expect(page.getByText(viMessages.members.privacyHint)).toBeVisible();

    await expect(table.locator('thead')).not.toContainText(viMessages.members.colStudentId);
    await expect(table.locator('thead')).not.toContainText(viMessages.members.colEmail);

    const mainContent = await page.locator('#main-content').innerText();
    expect(mainContent).toContain(basicFullName);
    expect(mainContent).toContain(adminFullName);
    expect(mainContent).not.toContain(basicStudentId);
    expect(mainContent).not.toContain(basicEmail);
    expect(mainContent).not.toContain(adminStudentId);
    expect(mainContent).not.toContain(adminEmail);

    await page.getByRole('button', { name: viMessages.members.statusAll }).click();
    const searchInput = page.getByLabel(viMessages.members.searchLabel);
    await searchInput.fill(inactiveFullName);
    const inactiveRow = table.locator('tbody tr', { hasText: inactiveFullName });
    await expect(inactiveRow).toBeVisible();
    await expect(inactiveRow).toContainText(viMessages.member.leftBadge);
    await searchInput.fill('');

    const deptSelect = page.getByLabel(viMessages.members.departmentFilterLabel);
    await deptSelect.selectOption(busyDeptId);
    await expect(table.locator('tbody tr', { hasText: basicFullName })).toBeVisible();
    await expect(table.locator('tbody tr', { hasText: adminFullName })).toHaveCount(0);
    await deptSelect.selectOption('');

    await searchInput.fill(basicStudentId);
    await expect(page.getByText(viMessages.members.emptyTitle)).toBeVisible();

    await page.goto('/admin/members');
    await expect(page.getByText(viMessages.errors['403'].title)).toBeVisible();

    await page.goto('/admin/departments');
    await expect(page.getByText(viMessages.errors['403'].title)).toBeVisible();
  });

  test('manages members on S09: domain check, create, locked MSSV edit, session revocation on deactivate, and last-admin 409 (FR-10, AC-09, AC-14, WQ-21, FR-43)', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await signInAs(page, adminStudentId, '/admin/members');

    await page.getByRole('button', { name: viMessages.memberAdmin.addMember }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await drawer.getByLabel(viMessages.memberAdmin.studentIdLabel).fill(newStudentId);
    await drawer.getByLabel(viMessages.memberAdmin.fullNameLabel).fill(newFullName);
    await drawer.getByLabel(viMessages.memberAdmin.emailLabel).fill(`bad-${suffix}@gmail.com`);
    await drawer.getByRole('button', { name: viMessages.memberAdmin.createSubmit }).click();
    await expect(drawer.locator('.ui-field-error')).toContainText('eiu.edu.vn');

    await drawer.getByLabel(viMessages.memberAdmin.emailLabel).fill(newEmail);
    await drawer.getByLabel(busyDeptName).check();
    const createRespPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/members') && res.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: viMessages.memberAdmin.createSubmit }).click();
    expect((await createRespPromise).status()).toBe(201);
    await expect(drawer).not.toBeVisible();

    const table = page.locator('.directory-table-wrap table.ui-table');
    await page.getByLabel(viMessages.members.searchLabel).fill(newFullName);
    const createdRow = table.locator('tbody tr', { hasText: newFullName });
    await expect(createdRow).toBeVisible();
    await expect(createdRow).toContainText(newStudentId);
    await expect(createdRow).toContainText(newEmail);
    await expect(createdRow).toContainText(busyDeptName);

    await createdRow.getByRole('button', { name: viMessages.memberAdmin.editAction }).click();
    const editDrawer = page.getByRole('dialog');
    const sidInput = editDrawer.getByLabel(viMessages.memberAdmin.studentIdLabel);
    await expect(sidInput).toHaveValue(newStudentId);
    await expect(sidInput).toBeDisabled();

    await editDrawer.getByLabel(viMessages.memberAdmin.fullNameLabel).fill(updatedFullName);
    const updateRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/members/') && res.request().method() === 'PATCH',
    );
    await editDrawer.getByRole('button', { name: viMessages.memberAdmin.updateSubmit }).click();
    expect((await updateRespPromise).status()).toBe(200);
    await expect(editDrawer).not.toBeVisible();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await signInAs(memberPage, newStudentId, '/profile');
      await expect(memberPage.locator('.profile-main')).toContainText(updatedFullName);

      await page.getByLabel(viMessages.members.searchLabel).fill(updatedFullName);
      const updatedRow = table.locator('tbody tr', { hasText: updatedFullName });
      await expect(updatedRow).toBeVisible();
      await updatedRow.getByRole('button', { name: viMessages.memberAdmin.deactivateAction }).click();
      const statusModal = page.getByRole('dialog');
      const deactivateRespPromise = page.waitForResponse(
        (res) => res.url().endsWith('/deactivate') && res.request().method() === 'POST',
      );
      await statusModal.getByRole('button', { name: viMessages.memberAdmin.deactivateConfirm }).click();
      expect((await deactivateRespPromise).status()).toBe(200);
      await expect(statusModal).not.toBeVisible();
      await expect(updatedRow).toContainText(viMessages.member.leftBadge);

      await memberPage.reload();
      await memberPage.waitForURL(`${BASE_ORIGIN}/login?expired=1&returnTo=%2Fprofile`);

      await updatedRow.getByRole('button', { name: viMessages.memberAdmin.activateAction }).click();
      const reactivateModal = page.getByRole('dialog');
      const activateRespPromise = page.waitForResponse(
        (res) => res.url().endsWith('/activate') && res.request().method() === 'POST',
      );
      await reactivateModal.getByRole('button', { name: viMessages.memberAdmin.activateConfirm }).click();
      expect((await activateRespPromise).status()).toBe(200);
    } finally {
      await memberContext.close();
    }

    const otherAdmins = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true), ne(profiles.id, adminUserId)));
    const otherAdminIds = otherAdmins.map((row) => row.id);

    try {
      if (otherAdminIds.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(inArray(profiles.id, otherAdminIds));
      }

      await page.getByLabel(viMessages.members.searchLabel).fill(adminFullName);
      const adminRow = table.locator('tbody tr', { hasText: adminFullName });
      await expect(adminRow).toBeVisible();
      await adminRow.getByRole('button', { name: viMessages.memberAdmin.deactivateAction }).click();

      const lastAdminModal = page.getByRole('dialog');
      const conflictRespPromise = page.waitForResponse(
        (res) => res.url().endsWith('/deactivate') && res.request().method() === 'POST',
      );
      await lastAdminModal.getByRole('button', { name: viMessages.memberAdmin.deactivateConfirm }).click();
      expect((await conflictRespPromise).status()).toBe(409);

      await expect(lastAdminModal.getByRole('alert')).toContainText(viMessages.errors.lastActiveAdmin);
      await lastAdminModal.getByRole('button', { name: viMessages.common.cancel }).click();
    } finally {
      if (otherAdminIds.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: true, leftAt: null, updatedAt: new Date() })
          .where(inArray(profiles.id, otherAdminIds));
      }
    }
    await tracker.assertClean();
  });

  test('manages departments on S11: create, rename, block 409 deletion when in use, and delete unused (FR-13, WQ-10)', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await signInAs(page, adminStudentId, '/admin/departments');

    await page.getByRole('button', { name: viMessages.departmentsAdmin.addDepartment }).click();
    const createModal = page.getByRole('dialog');
    await createModal.getByLabel(viMessages.departmentsAdmin.nameLabel).fill(createdDeptName);
    const createDeptResp = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/departments') && res.request().method() === 'POST',
    );
    await createModal.getByRole('button', { name: viMessages.departmentsAdmin.createSubmit }).click();
    expect((await createDeptResp).status()).toBe(201);

    const createdRow = page.locator('li.dept-row', { hasText: createdDeptName });
    await expect(createdRow).toBeVisible();

    await createdRow.getByRole('button', { name: viMessages.departmentsAdmin.renameAction }).click();
    const renameModal = page.getByRole('dialog');
    await renameModal.getByLabel(viMessages.departmentsAdmin.nameLabel).fill(renamedDeptName);
    const renameResp = page.waitForResponse(
      (res) => res.url().includes('/api/v1/departments/') && res.request().method() === 'PATCH',
    );
    await renameModal.getByRole('button', { name: viMessages.departmentsAdmin.renameSubmit }).click();
    expect((await renameResp).status()).toBe(200);

    const renamedRow = page.locator('li.dept-row', { hasText: renamedDeptName });
    await expect(renamedRow).toBeVisible();

    const busyRow = page.locator('li.dept-row', { hasText: busyDeptName });
    await expect(busyRow).toBeVisible();
    await busyRow.getByRole('button', { name: viMessages.departmentsAdmin.deleteAction }).click();

    const busyDeleteModal = page.getByRole('dialog');
    const busyDeleteResp = page.waitForResponse(
      (res) => res.url().includes('/api/v1/departments/') && res.request().method() === 'DELETE',
    );
    await busyDeleteModal.getByRole('button', { name: viMessages.departmentsAdmin.deleteConfirm }).click();
    expect((await busyDeleteResp).status()).toBe(409);
    await expect(busyDeleteModal.getByRole('alert')).toContainText('2 thành viên và 0 board');
    await busyDeleteModal.getByRole('button', { name: viMessages.common.cancel }).click();

    await renamedRow.getByRole('button', { name: viMessages.departmentsAdmin.deleteAction }).click();
    const emptyDeleteModal = page.getByRole('dialog');
    const emptyDeleteResp = page.waitForResponse(
      (res) => res.url().includes('/api/v1/departments/') && res.request().method() === 'DELETE',
    );
    await emptyDeleteModal.getByRole('button', { name: viMessages.departmentsAdmin.deleteConfirm }).click();
    expect((await emptyDeleteResp).status()).toBe(200);
    await expect(renamedRow).toHaveCount(0);
    await tracker.assertClean();
  });
});
