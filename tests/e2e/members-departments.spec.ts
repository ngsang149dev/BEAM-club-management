import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  auditLogs,
  clubAssets,
  departments,
  loginAttempts,
  memberDepartments,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import viMessages from '../../messages/vi.json';
import {
  createCanvasWebpBuffer,
  createSolidPngBuffer,
  expectColorfulInitialsAvatar,
  expectLoadedAvatarImage,
  expectSafeBinaryHeaders,
} from './helpers/media-fixtures';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];

function assertNoSecretsInText(payload: string, secrets: readonly string[]): void {
  expect(payload).not.toContain('passwordHash');
  expect(payload).not.toContain('password_hash');
  expect(payload).not.toContain('scrypt$');
  for (const secret of secrets) {
    expect(payload).not.toContain(secret);
  }
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
  returnTo = '/members',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

async function openMemberRowMenu(row: Locator): Promise<void> {
  const trigger = row.getByLabel(viMessages.memberAdmin.rowActionsMenu);
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(row.locator('details.ui-action-menu')).toHaveAttribute('open', '');
}

test.describe('Members & Departments E2E (S07, S09, S11, CR-01)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const hrDetailUserId = randomUUID();
  const basicUserId = randomUUID();
  const resetTargetUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const busyDeptId = randomUUID();
  const s11BusyDeptId = randomUUID();

  const adminStudentId = `MSSV-E3-ADM-${suffix}`;
  const hrDetailStudentId = `MSSV-E3-HRD-${suffix}`;
  const basicStudentId = `MSSV-E3-BAS-${suffix}`;
  const resetTargetStudentId = `MSSV-E3-RST-${suffix}`;
  const inactiveStudentId = `MSSV-E3-OFF-${suffix}`;
  const newStudentId = `MSSV-E3-NEW-${suffix}`;
  const onboardStudentId = `MSSV-E3-ONB-${suffix}`;

  const adminEmail = `e3-admin-${suffix}@eiu.edu.vn`;
  const hrDetailEmail = `e3-hrd-${suffix}@eiu.edu.vn`;
  const basicEmail = `e3-basic-${suffix}@eiu.edu.vn`;
  const resetTargetEmail = `e3-reset-${suffix}@eiu.edu.vn`;
  const newEmail = `e3-new-${suffix}@eiu.edu.vn`;
  const onboardEmail = `e3-onboard-${suffix}@eiu.edu.vn`;

  const adminFullName = `E3 Admin ${suffix}`;
  const hrDetailFullName = `E3 HR Detail ${suffix}`;
  const basicFullName = `E3 Basic ${suffix}`;
  const resetTargetFullName = `E3 Reset Target ${suffix}`;
  const inactiveFullName = `E3 Inactive ${suffix}`;
  const newFullName = `E3 Created ${suffix}`;
  const updatedFullName = `E3 Updated ${suffix}`;
  const onboardFullName = `E3 Onboard ${suffix}`;

  const busyDeptName = `Ban E3 Busy ${suffix}`;
  const s11BusyDeptName = `Ban S11 Busy ${suffix}`;
  const createdDeptName = `Ban E3 New ${suffix}`;
  const renamedDeptName = `Ban E3 Renamed ${suffix}`;

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    await db.delete(clubAssets).where(eq(clubAssets.key, 'club_logo'));
    const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

    await db
      .insert(permissions)
      .values([
        { code: 'member.view', groupName: 'members', description: 'View directory', scopable: false },
        { code: 'member.view_detail', groupName: 'members', description: 'View details', scopable: false },
        { code: 'member.update', groupName: 'members', description: 'Update members', scopable: false },
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
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: hrDetailUserId,
        studentId: hrDetailStudentId,
        email: hrDetailEmail,
        fullName: hrDetailFullName,
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
      {
        id: resetTargetUserId,
        studentId: resetTargetStudentId,
        email: resetTargetEmail,
        fullName: resetTargetFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveUserId,
        studentId: inactiveStudentId,
        email: `e3-inactive-${suffix}@eiu.edu.vn`,
        fullName: inactiveFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: false,
        leftAt: new Date('2026-09-01T00:00:00.000Z'),
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: hrDetailUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: hrDetailUserId, permissionCode: 'member.view_detail', grantedBy: adminUserId },
      { userId: hrDetailUserId, permissionCode: 'member.update', grantedBy: adminUserId },
      { userId: basicUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: basicUserId, permissionCode: 'task.update_assigned', grantedBy: adminUserId },
      { userId: basicUserId, permissionCode: 'comment.create', grantedBy: adminUserId },
      { userId: resetTargetUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: resetTargetUserId, permissionCode: 'task.update_assigned', grantedBy: adminUserId },
      { userId: resetTargetUserId, permissionCode: 'comment.create', grantedBy: adminUserId },
    ]);

    await db.insert(departments).values([
      {
        id: busyDeptId,
        name: busyDeptName,
      },
      {
        id: s11BusyDeptId,
        name: s11BusyDeptName,
      },
    ]);

    await db.insert(memberDepartments).values([
      {
        userId: basicUserId,
        departmentId: busyDeptId,
      },
      {
        userId: basicUserId,
        departmentId: s11BusyDeptId,
      },
      {
        userId: resetTargetUserId,
        departmentId: s11BusyDeptId,
      },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, [
            adminStudentId,
            hrDetailStudentId,
            basicStudentId,
            resetTargetStudentId,
            inactiveStudentId,
            newStudentId,
            onboardStudentId,
          ]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const createdProfiles = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(inArray(profiles.studentId, [newStudentId, onboardStudentId]));
      const cleanupIds = [
        adminUserId,
        hrDetailUserId,
        basicUserId,
        resetTargetUserId,
        inactiveUserId,
        ...createdProfiles.map((row) => row.id),
      ];
      await db.delete(clubAssets).where(eq(clubAssets.key, 'club_logo'));
      await db.delete(sessions).where(inArray(sessions.userId, cleanupIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, cleanupIds));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [
              adminStudentId,
              hrDetailStudentId,
              basicStudentId,
              resetTargetStudentId,
              inactiveStudentId,
              newStudentId,
              onboardStudentId,
            ]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .update(profiles)
        .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
        .where(
          inArray(profiles.id, [
            hrDetailUserId,
            basicUserId,
            resetTargetUserId,
            ...createdProfiles.map((row) => row.id),
          ]),
        );

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

  test('hides MSSV/email/mustChangePassword in MemberPublicSummary, disables MSSV search, shows left badge on S07, and returns 403 on admin routes for basic member (AC-11, WQ-11, FR-43)', async ({
    page,
  }) => {
    const membersRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/members') && res.request().method() === 'GET' && res.status() === 200,
    );

    await signInAs(page, basicStudentId, '/members');

    const table = page.locator('.directory-table-wrap table.ui-table');
    await expect(table).toBeVisible();
    await expect(page.getByText(viMessages.members.privacyHint)).toBeVisible();

    await expect(table.locator('thead')).not.toContainText(viMessages.members.colStudentId);
    await expect(table.locator('thead')).not.toContainText(viMessages.members.colEmail);

    const payload = await (await membersRespPromise).text();
    assertNoSecretsInText(payload, [DEV_SEED_PASSWORD, basicStudentId, basicEmail, adminStudentId, adminEmail]);
    expect(payload).not.toContain('"studentId"');
    expect(payload).not.toContain('"email"');
    expect(payload).not.toContain('"mustChangePassword"');
    expect(payload).not.toContain('"isAdmin"');
    const parsed = JSON.parse(payload) as { items: Array<Record<string, unknown>> };
    expect(parsed.items.length).toBeGreaterThan(0);
    for (const item of parsed.items) {
      expect(Object.keys(item).sort()).toEqual([
        'avatarUrl',
        'departments',
        'fullName',
        'id',
        'isActive',
        'leftAt',
      ]);
    }

    const basicRow = table.locator('tbody tr', { hasText: basicFullName });
    await expect(basicRow).toBeVisible();
    await expectColorfulInitialsAvatar(basicRow.locator('.ui-avatar'), basicUserId, basicFullName);

    const mainContent = await page.locator('#main-content').innerText();
    expect(mainContent).toContain(basicFullName);
    expect(mainContent).toContain(adminFullName);
    expect(mainContent).not.toContain(basicStudentId);
    expect(mainContent).not.toContain(basicEmail);
    expect(mainContent).not.toContain(adminStudentId);
    expect(mainContent).not.toContain(adminEmail);
    assertNoSecretsInText(mainContent, [DEV_SEED_PASSWORD]);

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

  test('manages members on S09: domain check, create with initialPassword, locked MSSV edit, session revocation on deactivate, and last-admin 409 (FR-10, AC-09, AC-14, WQ-21, FR-43)', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const createdInitialPassword = 'InitS09Member#2026';
    await signInAs(page, adminStudentId, '/admin/members');

    await page.getByRole('button', { name: viMessages.memberAdmin.addMember }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await drawer.getByLabel(viMessages.memberAdmin.studentIdLabel, { exact: true }).fill(newStudentId);
    await drawer.getByLabel(viMessages.memberAdmin.fullNameLabel, { exact: true }).fill(newFullName);
    await drawer.getByLabel(viMessages.memberAdmin.emailLabel, { exact: true }).fill(`bad-${suffix}@gmail.com`);
    await drawer
      .getByLabel(viMessages.memberAdmin.initialPasswordLabel, { exact: true })
      .fill(createdInitialPassword);
    await drawer.getByRole('button', { name: viMessages.memberAdmin.createSubmit }).click();
    await expect(drawer.locator('.ui-field-error')).toContainText('eiu.edu.vn');

    await drawer.getByLabel(viMessages.memberAdmin.emailLabel, { exact: true }).fill(newEmail);
    await drawer.getByLabel(busyDeptName).check();
    const createRespPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/members') && res.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: viMessages.memberAdmin.createSubmit }).click();
    const createResp = await createRespPromise;
    expect(createResp.status()).toBe(201);
    assertNoSecretsInText(await createResp.text(), [createdInitialPassword]);
    await expect(drawer).not.toBeVisible();

    const table = page.locator('.directory-table-wrap table.ui-table');
    await page.getByLabel(viMessages.members.searchLabel).fill(newFullName);
    const createdRow = table.locator('tbody tr', { hasText: newFullName });
    await expect(createdRow).toBeVisible();
    await expect(createdRow).toContainText(newStudentId);
    await expect(createdRow).toContainText(newEmail);
    await expect(createdRow).toContainText(busyDeptName);

    await expect(createdRow.getByRole('menuitem', { name: viMessages.memberAdmin.editAction, exact: true })).not.toBeVisible();
    await openMemberRowMenu(createdRow);
    await createdRow.getByRole('menuitem', { name: viMessages.memberAdmin.editAction, exact: true }).click();
    const editDrawer = page.getByRole('dialog');
    const sidInput = editDrawer.getByLabel(viMessages.memberAdmin.studentIdLabel, { exact: true });
    await expect(sidInput).toHaveValue(newStudentId);
    await expect(sidInput).toBeDisabled();

    await editDrawer.getByLabel(viMessages.memberAdmin.fullNameLabel, { exact: true }).fill(updatedFullName);
    const updateRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/members/') && res.request().method() === 'PATCH',
    );
    await editDrawer.getByRole('button', { name: viMessages.memberAdmin.updateSubmit }).click();
    expect((await updateRespPromise).status()).toBe(200);
    await expect(editDrawer).not.toBeVisible();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await signInAs(memberPage, newStudentId, '/profile', createdInitialPassword);
      await expect(memberPage.locator('.profile-main')).toContainText(updatedFullName);

      await page.getByLabel(viMessages.members.searchLabel).fill(updatedFullName);
      const updatedRow = table.locator('tbody tr', { hasText: updatedFullName });
      await expect(updatedRow).toBeVisible();
      await openMemberRowMenu(updatedRow);
      await updatedRow.getByRole('menuitem', { name: viMessages.memberAdmin.deactivateAction, exact: true }).click();
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

      await openMemberRowMenu(updatedRow);
      await updatedRow.getByRole('menuitem', { name: viMessages.memberAdmin.activateAction, exact: true }).click();
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
      await openMemberRowMenu(adminRow);
      await adminRow.getByRole('menuitem', { name: viMessages.memberAdmin.deactivateAction, exact: true }).click();

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

  test('onboards member with explicit initialPassword, redirects to /profile?changePassword=1, enforces 400 INVALID_CURRENT_PASSWORD without logout, updates password cleanly, and relogs directly to /boards (CR-01)', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const initialSecret = 'OnboardInit#2026';
    const wrongCurrentSecret = 'WrongCurrent#2026';
    const updatedSecret = 'OnboardFresh#2026';

    const adminMembersPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/members') && res.request().method() === 'GET' && res.status() === 200,
    );

    await signInAs(page, adminStudentId, '/admin/members');
    const adminMembersPayload = await (await adminMembersPromise).text();
    assertNoSecretsInText(adminMembersPayload, [DEV_SEED_PASSWORD, initialSecret, updatedSecret]);
    const parsedAdminMembers = JSON.parse(adminMembersPayload) as { items: Array<Record<string, unknown>> };
    expect(parsedAdminMembers.items.length).toBeGreaterThan(0);
    expect(typeof parsedAdminMembers.items[0]?.mustChangePassword).toBe('boolean');

    await page.getByRole('button', { name: viMessages.memberAdmin.addMember }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByLabel(viMessages.memberAdmin.studentIdLabel, { exact: true }).fill(onboardStudentId);
    await drawer.getByLabel(viMessages.memberAdmin.fullNameLabel, { exact: true }).fill(onboardFullName);
    await drawer.getByLabel(viMessages.memberAdmin.emailLabel, { exact: true }).fill(onboardEmail);
    await drawer
      .getByLabel(viMessages.memberAdmin.initialPasswordLabel, { exact: true })
      .fill(initialSecret);

    const createRespPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/members') && res.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: viMessages.memberAdmin.createSubmit }).click();
    const createResp = await createRespPromise;
    expect(createResp.status()).toBe(201);
    const createText = await createResp.text();
    assertNoSecretsInText(createText, [initialSecret]);
    expect((JSON.parse(createText) as { member: { mustChangePassword: boolean } }).member.mustChangePassword).toBe(
      true,
    );
    await expect(drawer).not.toBeVisible();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const memberTracker = await attachRuntimeErrorTracker(memberPage);
    try {
      await memberPage.goto('/login');
      const firstLoginPromise = memberPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
      );
      await memberPage.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(onboardStudentId);
      await memberPage.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(initialSecret);
      await memberPage.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
      const firstLoginResp = await firstLoginPromise;
      expect(firstLoginResp.status()).toBe(200);
      const firstLoginText = await firstLoginResp.text();
      assertNoSecretsInText(firstLoginText, [initialSecret]);
      expect(JSON.parse(firstLoginText)).toMatchObject({
        redirectTo: '/profile?changePassword=1',
        user: { mustChangePassword: true },
      });

      await memberPage.waitForURL(`${BASE_ORIGIN}/profile?changePassword=1`);
      const passwordCard = memberPage.locator('#change-password');
      await expect(passwordCard).toBeVisible();
      await expect(passwordCard).toHaveClass(/is-highlighted/);
      const forceAlert = passwordCard.locator('.ui-banner.is-warn');
      await expect(forceAlert).toBeVisible();
      await expect(forceAlert).toContainText(viMessages.profile.forceChangePasswordTitle);
      await expect(forceAlert).toContainText(viMessages.profile.forceChangePasswordBody);

      const initialMeRes = await memberPage.request.get('/api/v1/me');
      expect(initialMeRes.status()).toBe(200);
      const initialMeText = await initialMeRes.text();
      assertNoSecretsInText(initialMeText, [initialSecret]);
      expect((JSON.parse(initialMeText) as { profile: { mustChangePassword: boolean } }).profile.mustChangePassword).toBe(
        true,
      );

      // Wrong currentPassword returns 400 INVALID_CURRENT_PASSWORD inline WITHOUT logging out
      await passwordCard
        .getByLabel(viMessages.profile.currentPasswordLabel, { exact: true })
        .fill(wrongCurrentSecret);
      await passwordCard
        .getByLabel(viMessages.profile.newPasswordLabel, { exact: true })
        .fill(updatedSecret);
      await passwordCard
        .getByLabel(viMessages.profile.confirmPasswordLabel, { exact: true })
        .fill(updatedSecret);

      const badChangePromise = memberPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/me/password') && res.request().method() === 'POST',
      );
      await passwordCard
        .getByRole('button', { name: viMessages.profile.changePasswordButton, exact: true })
        .click();
      const badChangeResp = await badChangePromise;
      expect(badChangeResp.status()).toBe(400);
      expect(JSON.parse(await badChangeResp.text())).toMatchObject({
        error: {
          code: 'INVALID_CURRENT_PASSWORD',
          messageKey: 'errors.invalidCurrentPassword',
        },
      });

      const inlineErrorBanner = passwordCard.locator('.ui-banner.is-danger');
      await expect(inlineErrorBanner).toBeVisible();
      await expect(inlineErrorBanner).toContainText(viMessages.errors.invalidCurrentPassword);
      expect(memberPage.url()).toBe(`${BASE_ORIGIN}/profile?changePassword=1`);
      expect((await memberPage.request.get('/api/v1/me')).status()).toBe(200);

      // Correct currentPassword clears forced banner and sets mustChangePassword=false
      await passwordCard
        .getByLabel(viMessages.profile.currentPasswordLabel, { exact: true })
        .fill(initialSecret);
      const okChangePromise = memberPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/me/password') && res.request().method() === 'POST',
      );
      await passwordCard
        .getByRole('button', { name: viMessages.profile.changePasswordButton, exact: true })
        .click();
      const okChangeResp = await okChangePromise;
      expect(okChangeResp.status()).toBe(200);
      const okChangeText = await okChangeResp.text();
      assertNoSecretsInText(okChangeText, [initialSecret, updatedSecret, wrongCurrentSecret]);
      expect((JSON.parse(okChangeText) as { profile: { mustChangePassword: boolean } }).profile.mustChangePassword).toBe(
        false,
      );

      await memberPage.waitForURL(`${BASE_ORIGIN}/profile`);
      await expect(passwordCard.locator('.ui-banner.is-warn')).toHaveCount(0);
      await expect(passwordCard).not.toHaveClass(/is-highlighted/);
      await expect(passwordCard.locator('.ui-banner.is-success')).toContainText(
        viMessages.profile.passwordChangedBanner,
      );

      const postChangeMeRes = await memberPage.request.get('/api/v1/me');
      expect(postChangeMeRes.status()).toBe(200);
      expect(
        (JSON.parse(await postChangeMeRes.text()) as { profile: { mustChangePassword: boolean } }).profile
          .mustChangePassword,
      ).toBe(false);

      // Sign out -> old password rejected 401 -> new password lands directly on /boards
      await memberPage.locator('.profile-signout').click();
      await memberPage.waitForURL(`${BASE_ORIGIN}/login`);

      const rejectedOldPromise = memberPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
      );
      await memberPage.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(onboardStudentId);
      await memberPage.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(initialSecret);
      await memberPage.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
      expect((await rejectedOldPromise).status()).toBe(401);

      const reloginPromise = memberPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
      );
      await memberPage.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(updatedSecret);
      await memberPage.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
      const reloginResp = await reloginPromise;
      expect(reloginResp.status()).toBe(200);
      expect(JSON.parse(await reloginResp.text())).toMatchObject({
        redirectTo: '/boards',
        user: { mustChangePassword: false },
      });
      await memberPage.waitForURL(`${BASE_ORIGIN}/boards`);
      await memberTracker.assertClean();
    } finally {
      await memberContext.close();
    }

    await tracker.assertClean();
  });

  test('enforces admin-only RBAC on password reset, revokes active sessions immediately via ResetPasswordModal, records clean audit_logs, and forces password change on next login (CR-01, CR-02)', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const hrAttemptRegularSecret = 'HrAttemptRegular#2026';
    const hrAttemptAdminSecret = 'HrAttemptAdmin#2026';
    const adminResetSecret = 'AdminReset#2026';

    // 1. Non-admin with member.update + member.view + member.view_detail:
    //    sees ZERO Reset Password buttons on BOTH Admin and regular member rows in S09,
    //    and direct POST /api/v1/members/{id}/reset-password returns 403 FORBIDDEN for BOTH.
    const hrContext = await browser.newContext();
    const hrPage = await hrContext.newPage();
    const hrTracker = await attachRuntimeErrorTracker(hrPage);
    try {
      await signInAs(hrPage, hrDetailStudentId, '/admin/members');
      const hrTable = hrPage.locator('.directory-table-wrap table.ui-table');
      await expect(hrTable).toBeVisible();

      await hrPage.getByLabel(viMessages.members.searchLabel).fill(adminFullName);
      const adminRowForHr = hrTable.locator('tbody tr', { hasText: adminFullName });
      await expect(adminRowForHr).toBeVisible();
      await openMemberRowMenu(adminRowForHr);
      await expect(
        adminRowForHr.getByRole('menuitem', { name: viMessages.memberAdmin.editAction, exact: true }),
      ).toBeVisible();
      await expect(
        adminRowForHr.getByRole('menuitem', { name: viMessages.memberAdmin.resetPasswordAction, exact: true }),
      ).toHaveCount(0);
      await expect(
        adminRowForHr.getByText(viMessages.memberAdmin.resetPasswordAction, { exact: true }),
      ).toHaveCount(0);

      await hrPage.getByLabel(viMessages.members.searchLabel).fill(resetTargetFullName);
      const targetRowForHr = hrTable.locator('tbody tr', { hasText: resetTargetFullName });
      await expect(targetRowForHr).toBeVisible();
      await openMemberRowMenu(targetRowForHr);
      await expect(
        targetRowForHr.getByRole('menuitem', { name: viMessages.memberAdmin.editAction, exact: true }),
      ).toBeVisible();
      await expect(
        targetRowForHr.getByRole('menuitem', { name: viMessages.memberAdmin.resetPasswordAction, exact: true }),
      ).toHaveCount(0);
      await expect(
        targetRowForHr.getByText(viMessages.memberAdmin.resetPasswordAction, { exact: true }),
      ).toHaveCount(0);

      const directAdminResetRes = await hrPage.request.post(
        `/api/v1/members/${adminUserId}/reset-password`,
        { data: { newPassword: hrAttemptAdminSecret } },
      );
      expect(directAdminResetRes.status()).toBe(403);
      expect(JSON.parse(await directAdminResetRes.text())).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      const directRegularResetRes = await hrPage.request.post(
        `/api/v1/members/${resetTargetUserId}/reset-password`,
        { data: { newPassword: hrAttemptRegularSecret } },
      );
      expect(directRegularResetRes.status()).toBe(403);
      expect(JSON.parse(await directRegularResetRes.text())).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      await hrTracker.assertClean();
    } finally {
      await hrContext.close();
    }

    // 2. Target member logs in (active session) while Active Admin resets their password via ResetPasswordModal
    const targetContext = await browser.newContext();
    const targetPage = await targetContext.newPage();
    const targetTracker = await attachRuntimeErrorTracker(targetPage);
    try {
      await signInAs(targetPage, resetTargetStudentId, '/profile', DEV_SEED_PASSWORD);
      expect((await targetPage.request.get('/api/v1/me')).status()).toBe(200);

      await signInAs(page, adminStudentId, '/admin/members');
      const adminTable = page.locator('.directory-table-wrap table.ui-table');
      await page.getByLabel(viMessages.members.searchLabel).fill(resetTargetFullName);
      const targetRow = adminTable.locator('tbody tr', { hasText: resetTargetFullName });
      await expect(targetRow).toBeVisible();

      await openMemberRowMenu(targetRow);
      const adminResetBtn = targetRow.getByRole('menuitem', {
        name: viMessages.memberAdmin.resetPasswordAction,
        exact: true,
      });
      await expect(adminResetBtn).toBeVisible();
      await adminResetBtn.click();

      const resetModal = page.getByRole('dialog');
      await expect(resetModal).toBeVisible();
      await resetModal
        .getByLabel(viMessages.memberAdmin.newPasswordLabel, { exact: true })
        .fill(adminResetSecret);
      await resetModal
        .getByLabel(viMessages.memberAdmin.confirmNewPasswordLabel, { exact: true })
        .fill(adminResetSecret);

      const adminResetPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${resetTargetUserId}/reset-password`) &&
          res.request().method() === 'POST',
      );
      await resetModal
        .getByRole('button', { name: viMessages.memberAdmin.resetPasswordSubmit, exact: true })
        .click();
      const adminResetResp = await adminResetPromise;
      expect(adminResetResp.status()).toBe(200);
      const adminResetText = await adminResetResp.text();
      assertNoSecretsInText(adminResetText, [adminResetSecret, hrAttemptRegularSecret, hrAttemptAdminSecret]);
      expect((JSON.parse(adminResetText) as { member: { mustChangePassword: boolean } }).member.mustChangePassword).toBe(
        true,
      );
      await expect(resetModal).not.toBeVisible();

      // Target's active API session immediately returns 401 & reload redirects to /login?expired=1
      expect((await targetPage.request.get('/api/v1/me')).status()).toBe(401);
      await targetPage.reload();
      await targetPage.waitForURL(`${BASE_ORIGIN}/login?expired=1&returnTo=%2Fprofile`);

      // Inspect /admin/audit + DB audit_logs for member.password_reset without plaintext/hash/PII
      await page.goto('/admin/audit');
      await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();

      const filteredAuditPromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/audit-logs') &&
          res.url().includes('action=member.password_reset') &&
          res.status() === 200,
      );
      await page
        .getByLabel(viMessages.auditLogs.actionFilterLabel, { exact: true })
        .selectOption('member.password_reset');
      const auditResponseBody = await (await filteredAuditPromise).text();

      const auditRow = page.locator('.audit-table tbody tr', { hasText: resetTargetFullName }).first();
      await expect(auditRow).toBeVisible();
      await expect(auditRow).toContainText(viMessages.auditLogs.actions.memberPasswordReset);
      await auditRow.click();

      const detailPane = page.locator('aside.audit-side');
      await expect(detailPane).toContainText(viMessages.auditLogs.actions.memberPasswordReset);
      await expect(detailPane).toContainText(resetTargetFullName);

      const auditDomText = await page.locator('main').innerText();
      const forbiddenArtifacts = [
        adminResetSecret,
        hrAttemptRegularSecret,
        hrAttemptAdminSecret,
        DEV_SEED_PASSWORD,
        adminStudentId,
        hrDetailStudentId,
        resetTargetStudentId,
        adminEmail,
        hrDetailEmail,
        resetTargetEmail,
      ];
      assertNoSecretsInText(auditResponseBody, forbiddenArtifacts);
      assertNoSecretsInText(auditDomText, forbiddenArtifacts);
      expect(auditResponseBody).not.toContain('"studentId"');
      expect(auditResponseBody).not.toContain('"email"');

      const dbAuditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.targetUserId, resetTargetUserId),
            eq(auditLogs.action, 'member.password_reset'),
          ),
        );
      expect(dbAuditRows).toHaveLength(1);
      expect(dbAuditRows[0]?.detail).toEqual({
        forceChangeOnLogin: true,
        sessionsRevoked: true,
      });
      assertNoSecretsInText(JSON.stringify(dbAuditRows), forbiddenArtifacts);

      // Target cannot log in with previous password, and unsafe returnTo cannot bypass /profile?changePassword=1
      await targetPage.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fphish');
      const oldLoginPromise = targetPage.waitForResponse(
        (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
      );
      await targetPage.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(resetTargetStudentId);
      await targetPage.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(DEV_SEED_PASSWORD);
      await targetPage.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
      expect((await oldLoginPromise).status()).toBe(401);

      await targetPage.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(adminResetSecret);
      await targetPage.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
      await targetPage.waitForURL(`${BASE_ORIGIN}/profile?changePassword=1`);
      await expect(targetPage.locator('#change-password .ui-banner.is-warn')).toContainText(
        viMessages.profile.forceChangePasswordTitle,
      );

      await targetTracker.assertClean();
    } finally {
      await targetContext.close();
    }

    await tracker.assertClean();
  });

  test('no longer renders Logo CLB in /admin/members after CR-07 moved club branding to /admin/branding', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);

    // Non-admin holding member.update does not see Logo CLB button in /admin/members or Giao dien CLB in sidebar
    const hrContext = await browser.newContext();
    const hrPage = await hrContext.newPage();
    const hrTracker = await attachRuntimeErrorTracker(hrPage);
    try {
      await signInAs(hrPage, hrDetailStudentId, '/admin/members');
      await expect(
        hrPage.getByRole('button', { name: viMessages.memberAdmin.clubLogoButton, exact: true }),
      ).toHaveCount(0);
      await expect(
        hrPage.locator('.app-side').getByRole('link', { name: viMessages.nav.branding, exact: true }),
      ).toHaveCount(0);
      await hrTracker.assertClean();
    } finally {
      await hrContext.close();
    }

    // Admin also does not see Logo CLB button in /admin/members, and can reach /admin/branding from sidebar
    await signInAs(page, adminStudentId, '/admin/members');
    await expect(
      page.getByRole('button', { name: viMessages.memberAdmin.clubLogoButton, exact: true }),
    ).toHaveCount(0);
    const brandingNavLink = page
      .locator('.app-side')
      .getByRole('link', { name: viMessages.nav.branding, exact: true });
    await expect(brandingNavLink).toBeVisible();
    await brandingNavLink.click();
    await page.waitForURL(`${BASE_ORIGIN}/admin/branding`);
    await expect(page.getByRole('heading', { name: viMessages.branding.modalTitle, exact: true })).toBeVisible();

    await tracker.assertClean();
  });

  test('allows member.update holder to upload, replace (WEBP), and remove member avatar via S09 MemberFormDrawer, reverting cleanly to colorful initials and auditing safely (CR-02)', async ({
    page,
    browser,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const pngBytes = createSolidPngBuffer(24, 24, [124, 58, 237, 255]);
    const pngBase64 = pngBytes.toString('base64');

    const hrContext = await browser.newContext();
    const hrPage = await hrContext.newPage();
    const hrTracker = await attachRuntimeErrorTracker(hrPage);
    let webpBase64 = '';
    try {
      await signInAs(hrPage, hrDetailStudentId, '/admin/members');
      const hrTable = hrPage.locator('.directory-table-wrap table.ui-table');
      await hrPage.getByLabel(viMessages.members.searchLabel).fill(basicFullName);
      const targetRow = hrTable.locator('tbody tr', { hasText: basicFullName });
      await expect(targetRow).toBeVisible();
      await expectColorfulInitialsAvatar(targetRow.locator('.ui-avatar'), basicUserId, basicFullName);

      await openMemberRowMenu(targetRow);
      await targetRow.getByRole('menuitem', { name: viMessages.memberAdmin.editAction, exact: true }).click();
      const editDrawer = hrPage.getByRole('dialog');
      await expect(editDrawer).toBeVisible();
      await expectColorfulInitialsAvatar(
        editDrawer.locator('.avatar-upload-row .ui-avatar'),
        basicUserId,
        basicFullName,
      );

      // Upload PNG
      const uploadPngPromise = hrPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${basicUserId}/avatar`) &&
          res.request().method() === 'PUT',
      );
      await editDrawer.locator('input[type="file"]').setInputFiles({
        name: 'member-avatar.png',
        mimeType: 'image/png',
        buffer: pngBytes,
      });
      const uploadPngRes = await uploadPngPromise;
      expect(uploadPngRes.status()).toBe(200);
      const firstSrc = await expectLoadedAvatarImage(
        editDrawer.locator('.avatar-upload-row .ui-avatar'),
        `/api/v1/members/${basicUserId}/avatar?v=`,
      );

      // Replace with WEBP
      const webpBuffer = await createCanvasWebpBuffer(hrPage);
      webpBase64 = webpBuffer.toString('base64');
      const uploadWebpPromise = hrPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${basicUserId}/avatar`) &&
          res.request().method() === 'PUT',
      );
      await editDrawer.locator('input[type="file"]').setInputFiles({
        name: 'member-avatar.webp',
        mimeType: 'image/webp',
        buffer: webpBuffer,
      });
      const uploadWebpRes = await uploadWebpPromise;
      expect(uploadWebpRes.status()).toBe(200);
      const secondSrc = await expectLoadedAvatarImage(
        editDrawer.locator('.avatar-upload-row .ui-avatar'),
        `/api/v1/members/${basicUserId}/avatar?v=`,
      );
      expect(secondSrc).not.toBe(firstSrc);

      // Verify binary avatar response headers
      const binRes = await hrPage.request.get(`/api/v1/members/${basicUserId}/avatar`);
      expect(binRes.status()).toBe(200);
      expectSafeBinaryHeaders(binRes.headers(), 'image/webp');

      // Remove avatar -> reverts cleanly to colorful initials in Drawer and Table
      const removePromise = hrPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${basicUserId}/avatar`) &&
          res.request().method() === 'DELETE',
      );
      await editDrawer.getByRole('button', { name: viMessages.media.removePhoto, exact: true }).click();
      expect((await removePromise).status()).toBe(200);
      await expectColorfulInitialsAvatar(
        editDrawer.locator('.avatar-upload-row .ui-avatar'),
        basicUserId,
        basicFullName,
      );

      await editDrawer.getByRole('button', { name: viMessages.common.cancel, exact: true }).click();
      await expect(editDrawer).not.toBeVisible();
      await expectColorfulInitialsAvatar(targetRow.locator('.ui-avatar'), basicUserId, basicFullName);
      expect((await hrPage.request.get(`/api/v1/members/${basicUserId}/avatar`)).status()).toBe(404);

      await hrTracker.assertClean();
    } finally {
      await db
        .update(profiles)
        .set({ avatarData: null, avatarMime: null, avatarUpdatedAt: null, updatedAt: new Date() })
        .where(eq(profiles.id, basicUserId));
      await hrContext.close();
    }

    // Verify /admin/audit shows member.avatar_updated and member.avatar_removed cleanly
    await signInAs(page, adminStudentId, '/admin/audit');
    await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();
    const forbiddenAuditArtifacts = [
      pngBase64,
      webpBase64,
      'data:image/',
      adminStudentId,
      hrDetailStudentId,
      basicStudentId,
      adminEmail,
      hrDetailEmail,
      basicEmail,
    ];

    for (const item of [
      { action: 'member.avatar_updated', label: viMessages.auditLogs.actions.memberAvatarUpdated },
      { action: 'member.avatar_removed', label: viMessages.auditLogs.actions.memberAvatarRemoved },
    ]) {
      const respPromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/audit-logs') &&
          res.url().includes(`action=${item.action}`) &&
          res.status() === 200,
      );
      await page.getByLabel(viMessages.auditLogs.actionFilterLabel, { exact: true }).selectOption(item.action);
      const rawBody = await (await respPromise).text();
      assertNoSecretsInText(rawBody, forbiddenAuditArtifacts);
      expect(rawBody).not.toContain('"studentId"');
      expect(rawBody).not.toContain('"email"');
      const row = page.locator('.audit-table tbody tr', { hasText: basicFullName }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText(item.label);
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

    const busyRow = page.locator('li.dept-row', { hasText: s11BusyDeptName });
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
