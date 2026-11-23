import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { eq, inArray, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import { loginAttempts, permissions, profiles, sessions, userPermissions } from '@db/schema';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import viMessages from '../../messages/vi.json';
import enMessages from '../../messages/en.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];

test.describe('Auth & Session E2E (S01, S08)', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const activeUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const activeStudentId = `MSSV-E2E-${suffix}`;
  const inactiveStudentId = `MSSV-E2E-OFF-${suffix}`;
  const unknownStudentId = `MSSV-E2E-UNK-${suffix}`;
  const activeEmail = `e2e-active-${suffix}@eiu.edu.vn`;
  const activeFullName = `E2E Active ${suffix}`;

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
        id: activeUserId,
        studentId: activeStudentId,
        email: activeEmail,
        fullName: activeFullName,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveUserId,
        studentId: inactiveStudentId,
        email: `e2e-inactive-${suffix}@eiu.edu.vn`,
        fullName: `E2E Inactive ${suffix}`,
        isAdmin: false,
        isActive: false,
        leftAt: new Date('2026-09-01T00:00:00.000Z'),
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: activeUserId, permissionCode: 'member.view', grantedBy: null },
      { userId: activeUserId, permissionCode: 'task.update_assigned', grantedBy: null },
      { userId: activeUserId, permissionCode: 'comment.create', grantedBy: null },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(sessions)
      .where(inArray(sessions.userId, [activeUserId, inactiveUserId]));
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, [activeStudentId, inactiveStudentId, unknownStudentId]),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
    await db
      .update(profiles)
      .set({ locale: 'vi', updatedAt: new Date() })
      .where(eq(profiles.id, activeUserId));
  });

  test.afterAll(async () => {
    if (db) {
      await db
        .delete(sessions)
        .where(inArray(sessions.userId, [activeUserId, inactiveUserId]));
      await db
        .delete(userPermissions)
        .where(inArray(userPermissions.userId, [activeUserId, inactiveUserId]));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, [activeStudentId, inactiveStudentId, unknownStudentId]),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .delete(profiles)
        .where(inArray(profiles.id, [activeUserId, inactiveUserId]));
    }
    await pool?.end();
  });

  test('redirects unauthenticated access to /profile back to /login with expired notice and no password field (AC-05, WQ-09, WQ-20)', async ({
    page,
  }) => {
    await page.goto('/profile');
    await page.waitForURL(`${BASE_ORIGIN}/login?expired=1&returnTo=%2Fprofile`);

    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const alert = page.locator('.login-form').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(viMessages.auth.sessionExpiredTitle);
    await expect(alert).toContainText(viMessages.auth.sessionExpiredBody);
  });

  test('shows identical generic error for unknown and inactive student IDs (AC-01, AC-02)', async ({
    page,
  }) => {
    await page.goto('/login');

    const studentInput = page.getByLabel(viMessages.auth.studentIdLabel);
    const submitBtn = page.getByRole('button', { name: viMessages.auth.signInButton });
    const alert = page.locator('.login-form').getByRole('alert');

    const unknownRespPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
    );
    await studentInput.fill(unknownStudentId);
    await submitBtn.click();
    expect((await unknownRespPromise).status()).toBe(401);

    await expect(alert).toBeVisible();
    const unknownText = (await alert.innerText()).trim();
    expect(unknownText).toContain(viMessages.auth.invalidCredentials);

    const inactiveRespPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST',
    );
    await studentInput.fill(inactiveStudentId);
    await submitBtn.click();
    expect((await inactiveRespPromise).status()).toBe(401);

    await expect(alert).toBeVisible();
    const inactiveText = (await alert.innerText()).trim();
    expect(inactiveText).toBe(unknownText);
    expect(page.url()).toBe(`${BASE_ORIGIN}/login`);
  });

  test('blocks open-redirect returnTo and issues session cookie when remember=false (AC-13, WQ-09, WQ-15)', async ({
    page,
    context,
  }) => {
    await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fphish');

    const rememberCheckbox = page.getByRole('checkbox');
    await expect(rememberCheckbox).not.toBeChecked();

    await page.getByLabel(viMessages.auth.studentIdLabel).fill(activeStudentId);
    await page.getByRole('button', { name: viMessages.auth.signInButton }).click();

    await page.waitForURL(`${BASE_ORIGIN}/boards`);
    expect(new URL(page.url()).origin).toBe(BASE_ORIGIN);

    const cookies = await context.cookies(BASE_ORIGIN);
    const sessionCookie = cookies.find((cookie) => cookie.name === 'beam_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');
    expect(sessionCookie?.expires).toBe(-1);
  });

  test('supports remember=true persistent cookie, renders S08 profile details, persists locale, and signs out (AC-13, FR-50, WQ-19)', async ({
    page,
    context,
  }) => {
    await page.goto('/login?returnTo=%2Fprofile');

    const rememberCheckbox = page.getByRole('checkbox');
    await rememberCheckbox.check();
    await expect(rememberCheckbox).toBeChecked();

    await page.getByLabel(viMessages.auth.studentIdLabel).fill(activeStudentId);
    await page.getByRole('button', { name: viMessages.auth.signInButton }).click();

    await page.waitForURL(`${BASE_ORIGIN}/profile`);

    await expect(page.getByRole('heading', { level: 1, name: viMessages.profile.title })).toBeVisible();
    await expect(page.locator('.profile-main')).toContainText(activeFullName);
    await expect(page.locator('.profile-main')).toContainText(activeStudentId);
    await expect(page.locator('.profile-main')).toContainText(activeEmail);
    await expect(page.locator('.profile-perms')).toContainText('member.view');
    await expect(page.locator('.profile-perms')).toContainText('task.update_assigned');
    await expect(page.locator('.profile-perms')).toContainText('comment.create');

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
