import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  clubAssets,
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
import { createSolidPngBuffer } from './helpers/media-fixtures';

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
      await db.delete(clubAssets).where(eq(clubAssets.key, 'club_logo'));
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

  test('manages permissions, immediate AC-07 effect, WQ-06 preset replacement, compact S10 layout, self-demote guard, and AC-09 409 on S10/S09', async ({
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

      // CR-02B: header shows active member without redundant editingBanner, multi-column .perm-groups, compact count bar
      await expect(page.locator('.perm-who')).toContainText(targetFullName);
      await expect(
        page.getByText(viMessages.permissionsAdmin.editingBanner.replace('{name}', targetFullName)),
      ).toHaveCount(0);

      const permGroupsLayout = await page.locator('.perm-groups').evaluate((grid) => {
        const computedCols = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
        const cards = Array.from(grid.querySelectorAll('.perm-group'));
        const distinctX = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left)));
        return {
          columnCount: computedCols.length,
          distinctXCount: distinctX.size,
          cardCount: cards.length,
        };
      });
      expect(permGroupsLayout.cardCount).toBe(6);
      expect(permGroupsLayout.columnCount).toBeGreaterThanOrEqual(2);
      expect(permGroupsLayout.distinctXCount).toBeGreaterThanOrEqual(2);

      const saveBar = page.locator('.perm-savebar');
      await expect(saveBar.locator('.perm-effective')).toContainText(
        viMessages.permissionsAdmin.effectiveSummaryCount.replace('{count}', '4'),
      );
      await expect(saveBar).not.toContainText('member.view · task.update_assigned');
      await expect(saveBar).not.toContainText(viMessages.permissionsAdmin.unsavedChanges);

      const deptManageCheckbox = page
        .locator('label.perm-row', { hasText: 'department.manage' })
        .locator('input[type="checkbox"]');
      const boardCreateCheckbox = page
        .locator('label.perm-row', { hasText: 'board.create' })
        .locator('input[type="checkbox"]');

      await deptManageCheckbox.check();
      await boardCreateCheckbox.check();
      await expect(saveBar.locator('.perm-effective')).toContainText(
        viMessages.permissionsAdmin.effectiveSummaryCount.replace('{count}', '6'),
      );
      await expect(saveBar.locator('.perm-unsaved-note')).toHaveText(
        viMessages.permissionsAdmin.unsavedChanges,
      );

      const saveGrantPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/v1/members/${targetUserId}/permissions`) &&
          res.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: viMessages.permissionsAdmin.saveChanges }).click();
      expect((await saveGrantPromise).status()).toBe(200);
      await expect(saveBar).not.toContainText(viMessages.permissionsAdmin.unsavedChanges);

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

    // Grant admin flag to another member -> now >= 2 active admins exist
    const grantAdminPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/members/${targetUserId}/admin`) &&
        res.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: viMessages.permissionsAdmin.grantAdminButton }).click();
    expect((await grantAdminPromise).status()).toBe(200);
    await expect(page.getByText(viMessages.permissionsAdmin.adminAccessNotice)).toBeVisible();

    const searchInput = page.getByLabel(viMessages.permissionsAdmin.searchLabel);
    const adminPanel = page.locator('.perm-admin-panel');
    const removeAdminBtn = adminPanel.getByRole('button', {
      name: viMessages.permissionsAdmin.removeAdminButton,
      exact: true,
    });

    // CR-02B: Admin selecting themselves with >= 2 admins sees disabled button + hint, API returns 409 CANNOT_REVOKE_OWN_ADMIN
    await searchInput.fill(adminFullName);
    const adminSelfBtn = page.getByRole('button', { name: new RegExp(adminFullName) });
    await expect(adminSelfBtn).toBeVisible();
    await adminSelfBtn.click();
    await expect(removeAdminBtn).toBeDisabled();
    await expect(adminPanel).toContainText(viMessages.permissionsAdmin.cannotRevokeSelfHint);

    const selfDemoteMultiRes = await page.request.put(`/api/v1/members/${adminUserId}/admin`, {
      data: { isAdmin: false },
    });
    expect(selfDemoteMultiRes.status()).toBe(409);
    expect(JSON.parse(await selfDemoteMultiRes.text())).toMatchObject({
      error: {
        code: 'CANNOT_REVOKE_OWN_ADMIN',
        messageKey: 'errors.cannotRevokeOwnAdmin',
      },
    });
    const [adminRowMultiCheck] = await db
      .select({ isAdmin: profiles.isAdmin })
      .from(profiles)
      .where(eq(profiles.id, adminUserId));
    expect(adminRowMultiCheck?.isAdmin).toBe(true);

    // Admin CAN still revoke admin flag on ANOTHER member (200)
    await searchInput.fill(targetFullName);
    const targetAdminBtn = page.getByRole('button', { name: new RegExp(targetFullName) });
    await expect(targetAdminBtn).toBeVisible();
    await targetAdminBtn.click();
    await expect(removeAdminBtn).toBeEnabled();
    await expect(adminPanel).not.toContainText(viMessages.permissionsAdmin.cannotRevokeSelfHint);

    const revokeAdminPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/members/${targetUserId}/admin`) &&
        res.request().method() === 'PUT',
    );
    await removeAdminBtn.click();
    expect((await revokeAdminPromise).status()).toBe(200);

    // Sole active admin: self-demote still returns 409 CANNOT_REVOKE_OWN_ADMIN + AC-09 LAST_ACTIVE_ADMIN on deactivate (API + S09 UI)
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

      await searchInput.fill(adminFullName);
      const adminBtn = page.getByRole('button', { name: new RegExp(adminFullName) });
      await expect(adminBtn).toBeVisible();
      await adminBtn.click();

      await expect(removeAdminBtn).toBeDisabled();
      await expect(adminPanel).toContainText(viMessages.permissionsAdmin.cannotRevokeSelfHint);

      const selfDemoteSoleRes = await page.request.put(`/api/v1/members/${adminUserId}/admin`, {
        data: { isAdmin: false },
      });
      expect(selfDemoteSoleRes.status()).toBe(409);
      expect(JSON.parse(await selfDemoteSoleRes.text())).toMatchObject({
        error: {
          code: 'CANNOT_REVOKE_OWN_ADMIN',
          messageKey: 'errors.cannotRevokeOwnAdmin',
        },
      });
      const [adminRowSoleCheck] = await db
        .select({ isAdmin: profiles.isAdmin })
        .from(profiles)
        .where(eq(profiles.id, adminUserId));
      expect(adminRowSoleCheck?.isAdmin).toBe(true);

      // AC-09: Deactivating sole active admin returns 409 LAST_ACTIVE_ADMIN on API and shows alert in S09 UI
      const deactivateSoleRes = await page.request.post(
        `/api/v1/members/${adminUserId}/deactivate`,
      );
      expect(deactivateSoleRes.status()).toBe(409);
      expect(JSON.parse(await deactivateSoleRes.text())).toMatchObject({
        error: {
          code: 'LAST_ACTIVE_ADMIN',
          messageKey: 'errors.lastActiveAdmin',
        },
      });
      const [adminActiveCheck] = await db
        .select({ isActive: profiles.isActive })
        .from(profiles)
        .where(eq(profiles.id, adminUserId));
      expect(adminActiveCheck?.isActive).toBe(true);

      await page.goto('/admin/members');
      await page.getByLabel(viMessages.members.searchLabel).fill(adminFullName);
      const adminRow = page.locator('.directory-table-wrap table.ui-table tbody tr', {
        hasText: adminFullName,
      });
      await expect(adminRow).toBeVisible();
      await adminRow.getByLabel(viMessages.memberAdmin.rowActionsMenu).click();
      await adminRow
        .getByRole('menuitem', { name: viMessages.memberAdmin.deactivateAction, exact: true })
        .click();

      const lastAdminModal = page.getByRole('dialog');
      const deactivateConflictPromise = page.waitForResponse(
        (res) => res.url().endsWith('/deactivate') && res.request().method() === 'POST',
      );
      await lastAdminModal
        .getByRole('button', { name: viMessages.memberAdmin.deactivateConfirm, exact: true })
        .click();
      expect((await deactivateConflictPromise).status()).toBe(409);
      await expect(lastAdminModal.getByRole('alert')).toContainText(
        viMessages.errors.lastActiveAdmin,
      );
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

  test('renders read-only audit ledger on S13 with formatted CR-01/CR-02 metadata and zero PII or binary (FR-16, AC-10, CR-02B)', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    const resetTempSecret = 'AuditResetMeta#2026';
    const pngBytes = createSolidPngBuffer(20, 20, [219, 39, 119, 255]);
    const pngBase64 = pngBytes.toString('base64');
    const pngDataUrl = `data:image/png;base64,${pngBase64}`;

    // Generate real CR-01 & CR-02 audit events using an admin session
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    try {
      await signInAs(adminPage, adminStudentId, '/admin/members');
      const logoPutRes = await adminPage.request.put('/api/v1/branding/logo', {
        data: { dataUrl: pngDataUrl },
      });
      expect(logoPutRes.status()).toBe(200);
      const logoDelRes = await adminPage.request.delete('/api/v1/branding/logo');
      expect(logoDelRes.status()).toBe(200);
      const avatarPutRes = await adminPage.request.put(`/api/v1/members/${targetUserId}/avatar`, {
        data: { dataUrl: pngDataUrl },
      });
      expect(avatarPutRes.status()).toBe(200);
      const avatarDelRes = await adminPage.request.delete(`/api/v1/members/${targetUserId}/avatar`);
      expect(avatarDelRes.status()).toBe(200);
      const resetRes = await adminPage.request.post(
        `/api/v1/members/${targetUserId}/reset-password`,
        { data: { newPassword: resetTempSecret } },
      );
      expect(resetRes.status()).toBe(200);
    } finally {
      await db.delete(clubAssets).where(eq(clubAssets.key, 'club_logo'));
      await db
        .update(profiles)
        .set({ avatarData: null, avatarMime: null, avatarUpdatedAt: null, updatedAt: new Date() })
        .where(eq(profiles.id, targetUserId));
      await adminContext.close();
    }

    const capturedAuditBodies: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/v1/audit-logs') && res.status() === 200) {
        capturedAuditBodies.push(await res.text());
      }
    });

    await signInAs(page, auditViewerStudentId, '/admin/audit');
    await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();

    const actionFilter = page.getByLabel(viMessages.auditLogs.actionFilterLabel);
    const detailPane = page.locator('aside.audit-side');

    // 1. Permission preset audit detail
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
    await expect(detailPane).toContainText(viMessages.auditLogs.detailHeading);
    await expect(detailPane).toContainText(viMessages.permissions.presets.department_lead);
    await expect(detailPane).toContainText(viMessages.auditLogs.detailPrivacyNotice);

    // 2. CR-02 branding.logo_updated formatted metadata labels (assetKey, mimeType, byteLength)
    const logoUpdRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/audit-logs') &&
        res.url().includes('action=branding.logo_updated'),
    );
    await actionFilter.selectOption('branding.logo_updated');
    expect((await logoUpdRespPromise).status()).toBe(200);

    const logoUpdRow = page
      .locator('.audit-table tbody tr', { hasText: viMessages.auditLogs.actions.brandingLogoUpdated })
      .first();
    await expect(logoUpdRow).toBeVisible();
    await logoUpdRow.click();
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.assetKey);
    await expect(detailPane).toContainText('club_logo');
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.mimeType);
    await expect(detailPane).toContainText('image/png');
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.byteLength);
    await expect(detailPane).toContainText(/\d+(\.\d+)?\s*(B|KB)/);

    // 3. CR-02 branding.logo_removed & member.avatar_removed formatted metadata labels
    const logoRemRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/audit-logs') &&
        res.url().includes('action=branding.logo_removed'),
    );
    await actionFilter.selectOption('branding.logo_removed');
    expect((await logoRemRespPromise).status()).toBe(200);

    const logoRemRow = page
      .locator('.audit-table tbody tr', { hasText: viMessages.auditLogs.actions.brandingLogoRemoved })
      .first();
    await expect(logoRemRow).toBeVisible();
    await logoRemRow.click();
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.assetKey);
    await expect(detailPane).toContainText('club_logo');

    const avatarRemRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/audit-logs') &&
        res.url().includes('action=member.avatar_removed'),
    );
    await actionFilter.selectOption('member.avatar_removed');
    expect((await avatarRemRespPromise).status()).toBe(200);

    const avatarRemRow = page.locator('.audit-table tbody tr', { hasText: targetFullName }).first();
    await expect(avatarRemRow).toBeVisible();
    await avatarRemRow.click();
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.removed);
    await expect(detailPane).toContainText(viMessages.auditLogs.detailValues.yes);

    // 4. CR-01 member.password_reset formatted metadata labels (forceChangeOnLogin, sessionsRevoked)
    const pwResetRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/audit-logs') &&
        res.url().includes('action=member.password_reset'),
    );
    await actionFilter.selectOption('member.password_reset');
    expect((await pwResetRespPromise).status()).toBe(200);

    const pwResetRow = page.locator('.audit-table tbody tr', { hasText: targetFullName }).first();
    await expect(pwResetRow).toBeVisible();
    await pwResetRow.click();
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.forceChangeOnLogin);
    await expect(detailPane).toContainText(viMessages.auditLogs.detailLabels.sessionsRevoked);
    await expect(detailPane).toContainText(viMessages.auditLogs.detailValues.yes);

    await expect(page.locator('.audit-layout button', { hasText: /xóa|delete|sửa|edit/i })).toHaveCount(0);

    const pageText = await page.locator('main').innerText();
    const forbiddenValues = [
      adminStudentId,
      targetStudentId,
      hrStudentId,
      adminEmail,
      targetEmail,
      hrEmail,
      resetTempSecret,
      DEV_SEED_PASSWORD,
      pngBase64,
      'data:image/',
    ];
    for (const sensitive of forbiddenValues) {
      expect(pageText).not.toContain(sensitive);
    }
    for (const body of capturedAuditBodies) {
      for (const sensitive of forbiddenValues) {
        expect(body).not.toContain(sensitive);
      }
      expect(body).not.toContain('"studentId"');
      expect(body).not.toContain('"email"');
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('password_hash');
    }

    await tracker.assertClean();
  });
});
