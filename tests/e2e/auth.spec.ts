import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import { clubAssets, loginAttempts, permissions, profiles, sessions, userPermissions } from '@db/schema';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import { expectColorfulInitialsAvatar } from './helpers/media-fixtures';
import viMessages from '../../messages/vi.json';
import enMessages from '../../messages/en.json';

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

test.describe('Auth & Session E2E (S01, S08)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const adminUserId = randomUUID();
  const activeUserId = randomUUID();
  const mustChangeUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const adminStudentId = `MSSV-E2E-ADM-${suffix}`;
  const activeStudentId = `MSSV-E2E-${suffix}`;
  const mustChangeStudentId = `MSSV-E2E-PWD-${suffix}`;
  const inactiveStudentId = `MSSV-E2E-OFF-${suffix}`;
  const unknownStudentId = `MSSV-E2E-UNK-${suffix}`;
  const adminEmail = `e2e-admin-${suffix}@eiu.edu.vn`;
  const activeEmail = `e2e-active-${suffix}@eiu.edu.vn`;
  const mustChangeEmail = `e2e-pwd-${suffix}@eiu.edu.vn`;
  const activeFullName = `E2E Active ${suffix}`;

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
        fullName: `E2E Admin ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: activeUserId,
        studentId: activeStudentId,
        email: activeEmail,
        fullName: activeFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: mustChangeUserId,
        studentId: mustChangeStudentId,
        email: mustChangeEmail,
        fullName: `E2E MustChange ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: true,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveUserId,
        studentId: inactiveStudentId,
        email: `e2e-inactive-${suffix}@eiu.edu.vn`,
        fullName: `E2E Inactive ${suffix}`,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: false,
        leftAt: new Date('2026-09-01T00:00:00.000Z'),
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: activeUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: activeUserId, permissionCode: 'task.update_assigned', grantedBy: adminUserId },
      { userId: activeUserId, permissionCode: 'comment.create', grantedBy: adminUserId },
      { userId: mustChangeUserId, permissionCode: 'member.view', grantedBy: adminUserId },
      { userId: mustChangeUserId, permissionCode: 'task.update_assigned', grantedBy: adminUserId },
      { userId: mustChangeUserId, permissionCode: 'comment.create', grantedBy: adminUserId },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(sessions)
      .where(inArray(sessions.userId, [adminUserId, activeUserId, mustChangeUserId, inactiveUserId]));
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, [
            adminStudentId,
            activeStudentId,
            mustChangeStudentId,
            inactiveStudentId,
            unknownStudentId,
          ]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
    await db
      .update(profiles)
      .set({ locale: 'vi', mustChangePassword: false, updatedAt: new Date() })
      .where(eq(profiles.id, activeUserId));
  });

  test.afterAll(async () => {
    if (db) {
      await db
        .delete(sessions)
        .where(inArray(sessions.userId, [adminUserId, activeUserId, mustChangeUserId, inactiveUserId]));
      await db
        .delete(userPermissions)
        .where(inArray(userPermissions.userId, [adminUserId, activeUserId, mustChangeUserId, inactiveUserId]));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [
              adminStudentId,
              activeStudentId,
              mustChangeStudentId,
              inactiveStudentId,
              unknownStudentId,
            ]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .delete(profiles)
        .where(inArray(profiles.id, [activeUserId, mustChangeUserId, inactiveUserId]));

      const remainingAdmins = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true), ne(profiles.id, adminUserId)));
      if (remainingAdmins.length > 0) {
        await db.delete(profiles).where(eq(profiles.id, adminUserId));
      }
    }
    await pool?.end();
  });

  test('redirects root / immediately to /login when unauthenticated, /boards when active, and /profile?changePassword=1 when mustChangePassword=true (CR-02B)', async ({
    page,
    context,
    browser,
  }) => {
    // 1. Unauthenticated visitor -> /login cleanly (no welcome cards)
    const anonRootRes = await page.request.get('/', { maxRedirects: 0 });
    expect([303, 307, 308]).toContain(anonRootRes.status());
    const anonLocation = anonRootRes.headers()['location'] ?? '';
    const anonParsed = new URL(anonLocation, BASE_ORIGIN);
    expect(`${anonParsed.pathname}${anonParsed.search}`).toBe('/login');

    await page.goto('/');
    await page.waitForURL(`${BASE_ORIGIN}/login`);
    await expect(page.locator('.home-card')).toHaveCount(0);
    await expect(page.getByLabel(viMessages.auth.studentIdLabel, { exact: true })).toBeVisible();
    await expect(page.getByLabel(viMessages.auth.passwordLabel, { exact: true })).toBeVisible();

    // Invalid/stale session cookie on / also redirects cleanly to /login
    await context.addCookies([
      { name: 'beam_session', value: 'stale-invalid-token', url: BASE_ORIGIN },
    ]);
    await page.goto('/');
    await page.waitForURL(`${BASE_ORIGIN}/login`);
    await context.clearCookies();

    // 2. Authenticated active visitor -> /boards (and AppShell brand link points to /boards)
    await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(activeStudentId);
    await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(DEV_SEED_PASSWORD);
    await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
    await page.waitForURL(`${BASE_ORIGIN}/boards`);
    await expect(page.locator('.app-side a.app-brand')).toHaveAttribute('href', '/boards');

    const activeRootRes = await page.request.get('/', { maxRedirects: 0 });
    expect([303, 307, 308]).toContain(activeRootRes.status());
    const activeLocation = activeRootRes.headers()['location'] ?? '';
    const activeParsed = new URL(activeLocation, BASE_ORIGIN);
    expect(`${activeParsed.pathname}${activeParsed.search}`).toBe('/boards');

    await page.goto('/profile');
    await page.waitForURL(`${BASE_ORIGIN}/profile`);
    await page.goto('/');
    await page.waitForURL(`${BASE_ORIGIN}/boards`);

    // 3. Authenticated mustChangePassword=true visitor -> /profile?changePassword=1
    const mustChangeContext = await browser.newContext();
    const mustChangePage = await mustChangeContext.newPage();
    try {
      await mustChangePage.goto('/login');
      await mustChangePage
        .getByLabel(viMessages.auth.studentIdLabel, { exact: true })
        .fill(mustChangeStudentId);
      await mustChangePage
        .getByLabel(viMessages.auth.passwordLabel, { exact: true })
        .fill(DEV_SEED_PASSWORD);
      await mustChangePage
        .getByRole('button', { name: viMessages.auth.signInButton, exact: true })
        .click();
      await mustChangePage.waitForURL(`${BASE_ORIGIN}/profile?changePassword=1`);

      const mustChangeRootRes = await mustChangePage.request.get('/', { maxRedirects: 0 });
      expect([303, 307, 308]).toContain(mustChangeRootRes.status());
      const mustChangeLocation = mustChangeRootRes.headers()['location'] ?? '';
      const mustChangeParsed = new URL(mustChangeLocation, BASE_ORIGIN);
      expect(`${mustChangeParsed.pathname}${mustChangeParsed.search}`).toBe(
        '/profile?changePassword=1',
      );

      await mustChangePage.goto('/');
      await mustChangePage.waitForURL(`${BASE_ORIGIN}/profile?changePassword=1`);
      await expect(mustChangePage.locator('#change-password .ui-banner.is-warn')).toBeVisible();
    } finally {
      await mustChangeContext.close();
    }
  });

  test('redirects unauthenticated access to /profile back to /login with expired notice and password field (AC-05, CR-01, WQ-09)', async ({
    page,
  }) => {
    await page.goto('/profile');
    await page.waitForURL(`${BASE_ORIGIN}/login?expired=1&returnTo=%2Fprofile`);

    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    const alert = page.locator('.login-form').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(viMessages.auth.sessionExpiredTitle);
    await expect(alert).toContainText(viMessages.auth.sessionExpiredBody);
  });

  test('toggles password visibility and returns identical 401 INVALID_CREDENTIALS for unknown, inactive, and wrong-password admin/member logins (AC-01, AC-02, CR-01)', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.locator('.login-left .ui-logo i')).toHaveCount(4);
    await expect(page.locator('.login-left img.club-logo-img')).toHaveCount(0);

    const studentInput = page.getByLabel(viMessages.auth.studentIdLabel, { exact: true });
    const passwordInput = page.getByLabel(viMessages.auth.passwordLabel, { exact: true });
    const submitBtn = page.getByRole('button', { name: viMessages.auth.signInButton, exact: true });
    const alert = page.locator('.login-form').getByRole('alert');

    // Eye toggle show/hide password behavior
    await expect(passwordInput).toHaveAttribute('type', 'password');
    const showBtn = page.getByRole('button', { name: viMessages.auth.showPassword, exact: true });
    await expect(showBtn).toHaveAttribute('aria-pressed', 'false');
    await passwordInput.fill('ToggleCheck#2026');
    await showBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(passwordInput).toHaveValue('ToggleCheck#2026');

    const hideBtn = page.getByRole('button', { name: viMessages.auth.hidePassword, exact: true });
    await expect(hideBtn).toHaveAttribute('aria-pressed', 'true');
    await hideBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(
      page.getByRole('button', { name: viMessages.auth.showPassword, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');

    const submitAndAssertGeneric401 = async (
      sid: string,
      pwd: string,
    ): Promise<string> => {
      const respPromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
      );
      await studentInput.fill(sid);
      await passwordInput.fill(pwd);
      await submitBtn.click();
      const resp = await respPromise;
      expect(resp.status()).toBe(401);
      const rawBody = await resp.text();
      assertNoSecretsInText(rawBody, [
        pwd,
        DEV_SEED_PASSWORD,
        adminStudentId,
        activeStudentId,
        inactiveStudentId,
        adminEmail,
        activeEmail,
      ]);
      const parsed = JSON.parse(rawBody) as { error: { code: string } };
      expect(parsed.error.code).toBe('INVALID_CREDENTIALS');

      await expect(alert).toBeVisible();
      const alertText = (await alert.innerText()).trim();
      expect(alertText).toContain(viMessages.auth.invalidCredentials);
      expect(page.url()).toBe(`${BASE_ORIGIN}/login`);
      return alertText;
    };

    const unknownText = await submitAndAssertGeneric401(unknownStudentId, DEV_SEED_PASSWORD);
    const inactiveText = await submitAndAssertGeneric401(inactiveStudentId, DEV_SEED_PASSWORD);
    const wrongMemberText = await submitAndAssertGeneric401(activeStudentId, 'WrongMember#2026');
    const wrongAdminText = await submitAndAssertGeneric401(adminStudentId, 'WrongAdmin#2026');

    expect(inactiveText).toBe(unknownText);
    expect(wrongMemberText).toBe(unknownText);
    expect(wrongAdminText).toBe(unknownText);
  });

  test('blocks open-redirect returnTo, issues session cookie when remember=false, and leaks zero password fields in /auth/login (AC-13, WQ-09, WQ-15)', async ({
    page,
    context,
  }) => {
    await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fphish');

    const rememberCheckbox = page.getByRole('checkbox');
    await expect(rememberCheckbox).not.toBeChecked();

    const loginRespPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
    );
    await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(activeStudentId);
    await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(DEV_SEED_PASSWORD);
    await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
    const loginResp = await loginRespPromise;
    expect(loginResp.status()).toBe(200);
    const loginText = await loginResp.text();
    assertNoSecretsInText(loginText, [DEV_SEED_PASSWORD]);
    expect((JSON.parse(loginText) as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(
      false,
    );

    await page.waitForURL(`${BASE_ORIGIN}/boards`);
    expect(new URL(page.url()).origin).toBe(BASE_ORIGIN);

    const cookies = await context.cookies(BASE_ORIGIN);
    const sessionCookie = cookies.find((cookie) => cookie.name === 'beam_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');
    expect(sessionCookie?.expires).toBe(-1);
  });

  test('supports remember=true persistent cookie, renders S08 profile details without secrets, persists locale, and signs out (AC-13, FR-50, WQ-19)', async ({
    page,
    context,
  }) => {
    await page.goto('/login?returnTo=%2Fprofile');

    const rememberCheckbox = page.getByRole('checkbox');
    await rememberCheckbox.check();
    await expect(rememberCheckbox).toBeChecked();

    const meResponsePromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'GET' && res.status() === 200,
    );

    await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(activeStudentId);
    await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(DEV_SEED_PASSWORD);
    await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();

    await page.waitForURL(`${BASE_ORIGIN}/profile`);
    const mePayload = await (await meResponsePromise).text();

    await expect(page.getByRole('heading', { level: 1, name: viMessages.profile.title })).toBeVisible();
    await expect(page.locator('.profile-main')).toContainText(activeFullName);
    await expect(page.locator('.profile-main')).toContainText(activeStudentId);
    await expect(page.locator('.profile-main')).toContainText(activeEmail);
    await expect(page.locator('.profile-perms')).toContainText('member.view');
    await expect(page.locator('.profile-perms')).toContainText('task.update_assigned');
    await expect(page.locator('.profile-perms')).toContainText('comment.create');

    await expectColorfulInitialsAvatar(page.locator('.profile-hero .ui-avatar'), activeUserId, activeFullName);
    await expectColorfulInitialsAvatar(page.locator('.app-side .app-user .ui-avatar'), activeUserId, activeFullName);

    expect(mePayload.length).toBeGreaterThan(0);
    assertNoSecretsInText(mePayload, [DEV_SEED_PASSWORD]);
    expect((JSON.parse(mePayload) as { profile: { mustChangePassword: boolean } }).profile.mustChangePassword).toBe(
      false,
    );
    assertNoSecretsInText(await page.locator('main').innerText(), [DEV_SEED_PASSWORD]);

    const cookies = await context.cookies(BASE_ORIGIN);
    const sessionCookie = cookies.find((cookie) => cookie.name === 'beam_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');
    expect(sessionCookie?.expires).toBeGreaterThan(Date.now() / 1000 + 20 * 86_400);

    const patchPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/me') && response.request().method() === 'PATCH',
    );
    await page.locator('.profile-side').getByRole('button', { name: 'EN', exact: true }).click();
    const patchResponse = await patchPromise;
    expect(patchResponse.status()).toBe(200);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: enMessages.profile.title })).toBeVisible();

    await page.locator('.profile-signout').click();
    await page.waitForURL(`${BASE_ORIGIN}/login`);

    await page.goto('/profile');
    await page.waitForURL(`${BASE_ORIGIN}/login?expired=1&returnTo=%2Fprofile`);
  });
});
