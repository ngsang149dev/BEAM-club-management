import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  departments,
  loginAttempts,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { DEFAULT_MEMBER_PERMISSIONS } from '@/lib/permissions';
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
  returnTo = '/admin/permissions',
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${returnTo}`);
}

test.describe('Permissions & Audit Log E2E (S10, S13)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const hrUpdaterUserId = randomUUID();
  const targetUserId = randomUUID();
  const auditViewerUserId = randomUUID();

  const adminStudentId = `MSSV-E4-ADM-${suffix}`;
  const hrStudentId = `MSSV-E4-HR-${suffix}`;
  const targetStudentId = `MSSV-E4-TGT-${suffix}`;
  const auditViewerStudentId = `MSSV-E4-AUD-${suffix}`;

  const adminEmail = `e4-admin-${suffix}@eiu.edu.vn`;
  const hrEmail = `e4-hr-${suffix}@eiu.edu.vn`;
  const targetEmail = `e4-target-${suffix}@eiu.edu.vn`;
  const auditViewerEmail = `e4-audit-${suffix}@eiu.edu.vn`;

  const adminFullName = `E4 Admin ${suffix}`;
  const hrFullName = `E4 HR Updater ${suffix}`;
  const targetFullName = `E4 Target ${suffix}`;
  const auditViewerFullName = `E4 Audit Viewer ${suffix}`;

  const tempDeptName = `Ban E4 Temp ${suffix}`;

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
      .values([
        { code: 'member.view', groupName: 'members', description: 'View directory', scopable: false },
        { code: 'member.view_detail', groupName: 'members', description: 'View details', scopable: false },
        { code: 'member.update', groupName: 'members', description: 'Update members', scopable: false },
        { code: 'department.manage', groupName: 'departments', description: 'Manage departments', scopable: false },
        { code: 'board.create', groupName: 'boards', description: 'Create boards', scopable: false },
        { code: 'task.update_assigned', groupName: 'tasks', description: 'Update assigned tasks', scopable: false },
        { code: 'task.delete', groupName: 'tasks', description: 'Delete tasks', scopable: false },
        { code: 'comment.create', groupName: 'comments', description: 'Create comments', scopable: false },
        { code: 'audit.view', groupName: 'system', description: 'View audit logs', scopable: false },
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
        id: hrUpdaterUserId,
        studentId: hrStudentId,
        email: hrEmail,
        fullName: hrFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: targetUserId,
        studentId: targetStudentId,
        email: targetEmail,
        fullName: targetFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: auditViewerUserId,
        studentId: auditViewerStudentId,
        email: auditViewerEmail,
        fullName: auditViewerFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: hrUpdaterUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: hrUpdaterUserId, permissionCode: 'member.view_detail', grantedBy: adminUserId },
      { userId: hrUpdaterUserId, permissionCode: 'member.update', grantedBy: adminUserId },
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: targetUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      { userId: targetUserId, permissionCode: 'task.delete', grantedBy: adminUserId },
      { userId: auditViewerUserId, permissionCode: 'audit.view', grantedBy: adminUserId },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, [
            adminStudentId,
            hrStudentId,
            targetStudentId,
            auditViewerStudentId,
          ]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const cleanupIds = [adminUserId, hrUpdaterUserId, targetUserId, auditViewerUserId];
      await db.delete(sessions).where(inArray(sessions.userId, cleanupIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, cleanupIds));
      await db.delete(departments).where(eq(departments.name, tempDeptName));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [
              adminStudentId,
              hrStudentId,
              targetStudentId,
              auditViewerStudentId,
            ]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .update(profiles)
        .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
        .where(inArray(profiles.id, [hrUpdaterUserId, targetUserId, auditViewerUserId]));

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

  test('blocks non-admin member.update holder on S10 & API and blocks audit log without audit.view (AC-08)', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await signInAs(page, hrStudentId, '/admin/permissions');

    await expect(page.getByText(viMessages.permissionsAdmin.forbiddenTitle)).toBeVisible();
    await expect(page.getByText(viMessages.permissionsAdmin.forbiddenDescription)).toBeVisible();

    const permPutStatus = await page.evaluate(async (uid) => {
      const res = await fetch(`/api/v1/members/${uid}/permissions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissionCodes: ['member.view'] }),
      });
      return res.status;
    }, targetUserId);
    expect(permPutStatus).toBe(403);

    const adminPutStatus = await page.evaluate(async (uid) => {
      const res = await fetch(`/api/v1/members/${uid}/admin`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isAdmin: true }),
      });
      return res.status;
    }, hrUpdaterUserId);
    expect(adminPutStatus).toBe(403);

    await page.goto('/admin/audit');
    await expect(page.getByText(viMessages.auditLogs.forbiddenTitle)).toBeVisible();

    await tracker.assertClean();
  });

  test('manages permissions, immediate AC-07 effect, WQ-06 preset replacement, and 409 last admin on S10', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await signInAs(page, adminStudentId, '/admin/permissions');

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await signInAs(memberPage, targetStudentId, '/profile');

      const searchInput = page.getByLabel(viMessages.permissionsAdmin.searchLabel);
      await searchInput.fill(targetFullName);
      const targetBtn = page.getByRole('button', { name: new RegExp(targetFullName) });
      await expect(targetBtn).toBeVisible();
      await targetBtn.click();

      await expect(
        page.getByText(viMessages.permissionsAdmin.editingBanner.replace('{name}', targetFullName)),
      ).toBeVisible();

      const deptManageCheckbox = page
        .locator('label.perm-row', { hasText: 'department.manage' })
        .locator('input[type="checkbox"]');
      const boardCreateCheckbox = page
        .locator('label.perm-row', { hasText: 'board.create' })
        .locator('input[type="checkbox"]');

      await deptManageCheckbox.check();
      await boardCreateCheckbox.check();

      const saveGrantPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${targetUserId}/permissions`) &&
          res.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: viMessages.permissionsAdmin.saveChanges }).click();
      expect((await saveGrantPromise).status()).toBe(200);

      // AC-07: live session picks up newly granted permissions immediately without re-login
      const createDeptStatus = await memberPage.evaluate(async (name) => {
        const res = await fetch('/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        return res.status;
      }, tempDeptName);
      expect(createDeptStatus).toBe(201);

      await deptManageCheckbox.uncheck();
      const saveRevokePromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${targetUserId}/permissions`) &&
          res.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: viMessages.permissionsAdmin.saveChanges }).click();
      expect((await saveRevokePromise).status()).toBe(200);

      // AC-07: open session immediately receives 403 once permission is revoked
      const deniedDeptStatus = await memberPage.evaluate(async (name) => {
        const res = await fetch('/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `${name}-2` }),
        });
        return res.status;
      }, tempDeptName);
      expect(deniedDeptStatus).toBe(403);
    } finally {
      await memberContext.close();
    }

    // WQ-06: preset confirmation replaces all permissions with +5 added / -1 removed (task.delete dropped)
    await page
      .locator('.perm-preset', { hasText: viMessages.permissions.presets.department_lead })
      .click();
    const presetModal = page.getByRole('dialog');
    await expect(presetModal).toContainText('+5');
    await expect(presetModal).toContainText('-1');

    const applyPresetPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/members/${targetUserId}/permissions/apply-preset`) &&
        res.request().method() === 'POST',
    );
    await presetModal
      .getByRole('button', { name: viMessages.permissionsAdmin.presetConfirmButton })
      .click();
    expect((await applyPresetPromise).status()).toBe(200);
    await expect(presetModal).not.toBeVisible();
    await expect(page.locator('.perm-effective')).toContainText(
      viMessages.permissionsAdmin.effectiveSummaryCount.replace('{count}', '9'),
    );

    // Grant then revoke admin flag for target member
    const grantAdminPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/members/${targetUserId}/admin`) &&
        res.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: viMessages.permissionsAdmin.grantAdminButton }).click();
    expect((await grantAdminPromise).status()).toBe(200);
    await expect(page.getByText(viMessages.permissionsAdmin.adminAccessNotice)).toBeVisible();

    const revokeAdminPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/members/${targetUserId}/admin`) &&
        res.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: viMessages.permissionsAdmin.removeAdminButton }).click();
    expect((await revokeAdminPromise).status()).toBe(200);

    // AC-09: block demoting the last active admin (409)
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

      const searchInput = page.getByLabel(viMessages.permissionsAdmin.searchLabel);
      await searchInput.fill(adminFullName);
      const adminBtn = page.getByRole('button', { name: new RegExp(adminFullName) });
      await expect(adminBtn).toBeVisible();
      await adminBtn.click();

      const conflictPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${adminUserId}/admin`) &&
          res.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: viMessages.permissionsAdmin.removeAdminButton }).click();
      expect((await conflictPromise).status()).toBe(409);

      const adminAlert = page.locator('.perm-admin-panel').getByRole('alert');
      await expect(adminAlert).toContainText(viMessages.permissionsAdmin.lastAdminBannerTitle);
      await expect(adminAlert).toContainText(viMessages.errors.lastActiveAdmin);
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

  test('renders read-only audit ledger on S13 without PII or edit controls (FR-16, AC-10)', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);

    let auditApiBody = '';
    page.on('response', async (res) => {
      if (res.url().includes('/api/v1/audit-logs') && res.status() === 200) {
        auditApiBody = await res.text();
      }
    });

    await signInAs(page, auditViewerStudentId, '/admin/audit');
    await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();

    const actionFilter = page.getByLabel(viMessages.auditLogs.actionFilterLabel);
    const filteredRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/audit-logs') &&
        res.url().includes('action=permissions.preset_applied'),
    );
    await actionFilter.selectOption('permissions.preset_applied');
    expect((await filteredRespPromise).status()).toBe(200);

    const presetRow = page.locator('.audit-table tbody tr', { hasText: targetFullName }).first();
    await expect(presetRow).toBeVisible();
    await presetRow.click();

    const detailPane = page.locator('aside.audit-side');
    await expect(detailPane).toContainText(viMessages.auditLogs.detailHeading);
    await expect(detailPane).toContainText(viMessages.permissions.presets.department_lead);
    await expect(detailPane).toContainText(viMessages.auditLogs.detailPrivacyNotice);

    await expect(page.locator('.audit-layout button', { hasText: /xóa|delete|sửa|edit/i })).toHaveCount(0);

    const pageText = await page.locator('main').innerText();
    for (const sensitive of [adminStudentId, targetStudentId, hrStudentId, adminEmail, targetEmail, hrEmail]) {
      expect(pageText).not.toContain(sensitive);
      expect(auditApiBody).not.toContain(sensitive);
    }
    expect(auditApiBody).not.toContain('"studentId"');
    expect(auditApiBody).not.toContain('"email"');
    expect(auditApiBody).not.toContain('passwordHash');
    expect(auditApiBody).not.toContain('password_hash');
    expect(auditApiBody).not.toContain(DEV_SEED_PASSWORD);

    await tracker.assertClean();
  });
});
