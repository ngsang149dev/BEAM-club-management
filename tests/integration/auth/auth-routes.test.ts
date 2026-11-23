import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loginAttempts,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/api/v1/auth/logout/route';
import { GET as sessionGet } from '@/app/api/v1/auth/session/route';
import { GET as meGet, PATCH as mePatch } from '@/app/api/v1/me/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  createContainer,
  type ServerContainer,
  setContainerForTesting,
} from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { StructuredLogger } from '@/server/shared/logger';

function loadEnvLocalIfMissing(): void {
  if (process.env.TEST_DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function findSetCookie(setCookies: string[], name: string): string {
  const found = setCookies.find((entry) => entry.startsWith(`${name}=`));
  expect(found).toBeDefined();
  return found!;
}

function extractCookiePair(setCookieLine: string): string {
  return setCookieLine.split(';')[0]!;
}

describe('Auth & /me Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;
  let container: ServerContainer;
  const capturedLogs: string[] = [];

  const suffix = randomUUID().slice(0, 8);
  const activeUserId = randomUUID();
  const disposableUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const activeStudentId = `MSSV-RT-${suffix}`;
  const disposableStudentId = `MSSV-RT-DISP-${suffix}`;
  const inactiveStudentId = `MSSV-RT-OFF-${suffix}`;
  const activeEmail = `rt-active-${suffix}@eiu.edu.vn`;
  const disposableEmail = `rt-disp-${suffix}@eiu.edu.vn`;
  const inactiveEmail = `rt-inactive-${suffix}@eiu.edu.vn`;
  const testIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  const rateLimitIp = `203.0.113.${Math.floor(Math.random() * 40) + 210}`;

  beforeAll(async () => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for auth routes tests');
    }

    pool = createDbPool(testDbUrl);
    db = createDb(pool);

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: testDbUrl,
      testDatabaseUrl: testDbUrl,
      sessionSecret: `route-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'route-test-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };

    container = createContainer({
      config: testConfig,
      db,
      logger: new StructuredLogger({
        writeOut: (line) => capturedLogs.push(line),
        writeErr: (line) => capturedLogs.push(line),
      }),
    });
    setContainerForTesting(container);

    await db
      .insert(permissions)
      .values([
        {
          code: 'member.view',
          groupName: 'members',
          description: 'View directory',
          scopable: false,
        },
        {
          code: 'board.create',
          groupName: 'boards',
          description: 'Create board',
          scopable: false,
        },
      ])
      .onConflictDoNothing();

    await db.insert(profiles).values([
      {
        id: activeUserId,
        studentId: activeStudentId,
        email: activeEmail,
        fullName: `Route Active ${suffix}`,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: disposableUserId,
        studentId: disposableStudentId,
        email: disposableEmail,
        fullName: `Route Disposable ${suffix}`,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: inactiveUserId,
        studentId: inactiveStudentId,
        email: inactiveEmail,
        fullName: `Route Inactive ${suffix}`,
        isAdmin: false,
        isActive: false,
        leftAt: new Date('2026-10-01T00:00:00.000Z'),
        locale: 'vi',
      },
    ]);

    await db.insert(userPermissions).values([
      { userId: activeUserId, permissionCode: 'member.view', grantedBy: null },
      { userId: activeUserId, permissionCode: 'board.create', grantedBy: null },
    ]);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    const createdUsers = [activeUserId, disposableUserId, inactiveUserId];
    if (db) {
      await db.delete(sessions).where(inArray(sessions.userId, createdUsers));
      await db
        .delete(userPermissions)
        .where(inArray(userPermissions.userId, createdUsers));
      await db
        .delete(loginAttempts)
        .where(inArray(loginAttempts.ip, [testIp, rateLimitIp]));
      await db.delete(profiles).where(inArray(profiles.id, createdUsers));
    }
    await pool?.end();
  });

  it('rejects unknown and inactive MSSV with identical generic 401 without creating profiles (AC-01, AC-02)', async () => {
    const profileCountBefore = Number(
      (await db.select({ value: count() }).from(profiles))[0]?.value ?? 0,
    );
    const attemptCountBefore = Number(
      (
        await db
          .select({ value: count() })
          .from(loginAttempts)
          .where(eq(loginAttempts.ip, testIp))
      )[0]?.value ?? 0,
    );

    const unknownRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': testIp,
          'x-request-id': 'req-unknown-01',
        },
        body: JSON.stringify({ studentId: 'MSSV-UNKNOWN-999' }),
      }),
    );
    const inactiveRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': testIp,
          'x-request-id': 'req-inactive-01',
        },
        body: JSON.stringify({ studentId: inactiveStudentId }),
      }),
    );

    expect(unknownRes.status).toBe(401);
    expect(inactiveRes.status).toBe(401);
    expect(unknownRes.headers.get('cache-control')).toBe('no-store');
    expect(unknownRes.headers.get('x-request-id')).toBe('req-unknown-01');
    expect(inactiveRes.headers.get('cache-control')).toBe('no-store');
    expect(inactiveRes.headers.get('x-request-id')).toBe('req-inactive-01');

    const unknownBody = (await unknownRes.json()) as {
      error: { code: string; messageKey: string; details: Record<string, unknown> };
    };
    const inactiveBody = (await inactiveRes.json()) as {
      error: { code: string; messageKey: string; details: Record<string, unknown> };
    };
    expect(unknownBody.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownBody.error.messageKey).toBe('auth.invalidCredentials');
    expect(inactiveBody.error.code).toBe(unknownBody.error.code);
    expect(inactiveBody.error.messageKey).toBe(unknownBody.error.messageKey);

    const profileCountAfter = Number(
      (await db.select({ value: count() }).from(profiles))[0]?.value ?? 0,
    );
    const attemptCountAfter = Number(
      (
        await db
          .select({ value: count() })
          .from(loginAttempts)
          .where(eq(loginAttempts.ip, testIp))
      )[0]?.value ?? 0,
    );
    expect(profileCountAfter).toBe(profileCountBefore);
    expect(attemptCountAfter).toBe(attemptCountBefore + 2);
  });

  it('handles AC-13 cookie persistence & sliding cookie refresh across /auth/session and /me', async () => {
    const defaultRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
        body: JSON.stringify({
          studentId: activeStudentId,
          remember: false,
          returnTo: 'https://evil.example/steal',
        }),
      }),
    );
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.headers.get('cache-control')).toBe('no-store');
    expect(defaultRes.headers.get('x-request-id')).toBeTruthy();

    const defaultCookieLine = findSetCookie(
      defaultRes.headers.getSetCookie(),
      SESSION_COOKIE_NAME,
    );
    expect(defaultCookieLine).toMatch(/HttpOnly/i);
    expect(defaultCookieLine).toMatch(/SameSite=Lax/i);
    expect(defaultCookieLine).not.toMatch(/Max-Age=/i);
    expect(defaultCookieLine).not.toMatch(/Expires=/i);
    expect(((await defaultRes.json()) as { redirectTo: string }).redirectTo).toBe('/boards');

    const defaultPair = extractCookiePair(defaultCookieLine);
    const defaultSessionRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: defaultPair },
      }),
    );
    expect(defaultSessionRes.status).toBe(200);
    expect(
      defaultSessionRes.headers
        .getSetCookie()
        .some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)),
    ).toBe(false);

    const defaultMeRes = await meGet(
      new Request('http://localhost:3000/api/v1/me', {
        headers: { cookie: defaultPair },
      }),
    );
    expect(defaultMeRes.status).toBe(200);
    expect(
      defaultMeRes.headers
        .getSetCookie()
        .some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)),
    ).toBe(false);

    const rememberRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
        body: JSON.stringify({
          studentId: activeStudentId,
          remember: true,
          returnTo: '/my-tasks',
        }),
      }),
    );
    expect(rememberRes.status).toBe(200);
    const rememberCookieLine = findSetCookie(
      rememberRes.headers.getSetCookie(),
      SESSION_COOKIE_NAME,
    );
    expect(rememberCookieLine).toMatch(/Max-Age=2592000/i);
    expect(((await rememberRes.json()) as { redirectTo: string }).redirectTo).toBe(
      '/my-tasks',
    );

    const rememberPair = extractCookiePair(rememberCookieLine);
    const refreshedSession = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: rememberPair },
      }),
    );
    expect(refreshedSession.status).toBe(200);
    expect(
      findSetCookie(refreshedSession.headers.getSetCookie(), SESSION_COOKIE_NAME),
    ).toMatch(/Max-Age=2592000/i);

    const refreshedMe = await meGet(
      new Request('http://localhost:3000/api/v1/me', {
        headers: { cookie: rememberPair },
      }),
    );
    expect(refreshedMe.status).toBe(200);
    expect(
      findSetCookie(refreshedMe.headers.getSetCookie(), SESSION_COOKIE_NAME),
    ).toMatch(/Max-Age=2592000/i);

    const refreshedPatch = await mePatch(
      new Request('http://localhost:3000/api/v1/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: rememberPair },
        body: JSON.stringify({ locale: 'vi' }),
      }),
    );
    expect(refreshedPatch.status).toBe(200);
    expect(
      findSetCookie(refreshedPatch.headers.getSetCookie(), SESSION_COOKIE_NAME),
    ).toMatch(/Max-Age=2592000/i);
  });

  it('reflects DB permission revocation immediately, updates /me locale, and invalidates on logout (AC-07)', async () => {
    const loginRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
        body: JSON.stringify({ studentId: activeStudentId }),
      }),
    );
    const sessionCookiePair = extractCookiePair(
      findSetCookie(loginRes.headers.getSetCookie(), SESSION_COOKIE_NAME),
    );

    const sessionRes1 = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: sessionCookiePair },
      }),
    );
    expect(sessionRes1.status).toBe(200);
    expect(sessionRes1.headers.get('cache-control')).toBe('no-store');
    expect(
      ((await sessionRes1.json()) as { permissions: string[] }).permissions.sort(),
    ).toEqual(['board.create', 'member.view']);

    await db
      .delete(userPermissions)
      .where(
        and(
          eq(userPermissions.userId, activeUserId),
          eq(userPermissions.permissionCode, 'board.create'),
        ),
      );

    const sessionRes2 = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: sessionCookiePair },
      }),
    );
    expect(sessionRes2.status).toBe(200);
    expect(((await sessionRes2.json()) as { permissions: string[] }).permissions).toEqual(
      ['member.view'],
    );

    const meRes = await meGet(
      new Request('http://localhost:3000/api/v1/me', {
        headers: { cookie: sessionCookiePair },
      }),
    );
    expect(meRes.status).toBe(200);
    expect(meRes.headers.get('cache-control')).toBe('no-store');
    const meBody = (await meRes.json()) as {
      profile: { studentId: string; locale: string };
    };
    expect(meBody.profile.studentId).toBe(activeStudentId);

    const patchRes = await mePatch(
      new Request('http://localhost:3000/api/v1/me', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookiePair,
        },
        body: JSON.stringify({ locale: 'en' }),
      }),
    );
    expect(patchRes.status).toBe(200);
    expect(patchRes.headers.get('cache-control')).toBe('no-store');
    expect(
      ((await patchRes.json()) as { profile: { locale: string } }).profile.locale,
    ).toBe('en');
    expect(findSetCookie(patchRes.headers.getSetCookie(), 'beam_locale')).toContain(
      'beam_locale=en',
    );

    const logoutRes = await logoutPost(
      new Request('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie: sessionCookiePair },
      }),
    );
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(findSetCookie(logoutRes.headers.getSetCookie(), SESSION_COOKIE_NAME)).toMatch(
      /Max-Age=0/i,
    );

    const afterLogoutSession = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: sessionCookiePair },
      }),
    );
    expect(afterLogoutSession.status).toBe(401);
  });

  it('rejects expired DB sessions, revoked inactive-user sessions, unauthenticated requests, and malformed inputs', async () => {
    // 1. Unauthenticated endpoints return 401 + no-store + x-request-id
    for (const call of [
      () => sessionGet(new Request('http://localhost:3000/api/v1/auth/session')),
      () => meGet(new Request('http://localhost:3000/api/v1/me')),
      () =>
        mePatch(
          new Request('http://localhost:3000/api/v1/me', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ locale: 'en' }),
          }),
        ),
    ]) {
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-request-id')).toBeTruthy();
    }

    const unauthLogout = await logoutPost(
      new Request('http://localhost:3000/api/v1/auth/logout', { method: 'POST' }),
    );
    expect(unauthLogout.status).toBe(401);
    expect(findSetCookie(unauthLogout.headers.getSetCookie(), SESSION_COOKIE_NAME)).toMatch(
      /Max-Age=0/i,
    );

    // 2. Malformed JSON / validation 400 error shape
    const badJsonRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
        body: '{invalid-json',
      }),
    );
    expect(badJsonRes.status).toBe(400);
    expect(badJsonRes.headers.get('cache-control')).toBe('no-store');
    const badJsonBody = (await badJsonRes.json()) as {
      error: { code: string; messageKey: string; details: { requestId: string } };
    };
    expect(badJsonBody.error.code).toBe('INVALID_JSON');
    expect(badJsonBody.error.details.requestId).toBeTruthy();

    // 3. Expired session in PostgreSQL -> 401 SESSION_EXPIRED
    const expLoginRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
        body: JSON.stringify({ studentId: disposableStudentId }),
      }),
    );
    const dispCookie = extractCookiePair(
      findSetCookie(expLoginRes.headers.getSetCookie(), SESSION_COOKIE_NAME),
    );

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.userId, disposableUserId));

    const expiredRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: dispCookie },
      }),
    );
    expect(expiredRes.status).toBe(401);
    expect(((await expiredRes.json()) as { error: { code: string } }).error.code).toBe(
      'SESSION_EXPIRED',
    );

    // 4. Invalid locale on PATCH /me -> 400 VALIDATION_ERROR
    const freshLogin = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
        body: JSON.stringify({ studentId: disposableStudentId }),
      }),
    );
    const freshCookie = extractCookiePair(
      findSetCookie(freshLogin.headers.getSetCookie(), SESSION_COOKIE_NAME),
    );
    const badLocaleRes = await mePatch(
      new Request('http://localhost:3000/api/v1/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: freshCookie },
        body: JSON.stringify({ locale: 'fr' }),
      }),
    );
    expect(badLocaleRes.status).toBe(400);
    expect(((await badLocaleRes.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );

    // 5. Deactivating authenticated user -> 401 ACCOUNT_INACTIVE + persists revoked_at in PostgreSQL
    await db
      .update(profiles)
      .set({ isActive: false })
      .where(eq(profiles.id, disposableUserId));

    const deactivatedSessionRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: freshCookie },
      }),
    );
    expect(deactivatedSessionRes.status).toBe(401);
    expect(
      ((await deactivatedSessionRes.json()) as { error: { code: string } }).error.code,
    ).toBe('ACCOUNT_INACTIVE');

    const dbSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, disposableUserId));
    expect(dbSessions.some((row) => row.revokedAt !== null)).toBe(true);
  });

  it('enforces IP rate limit 429 on /auth/login and never leaks PII to logs (AC-12)', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': rateLimitIp,
          },
          body: JSON.stringify({ studentId: 'MSSV-UNKNOWN-RATE' }),
        }),
      );
      expect(res.status).toBe(401);
    }

    const blockedRes = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': rateLimitIp,
        },
        body: JSON.stringify({ studentId: activeStudentId }),
      }),
    );
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('cache-control')).toBe('no-store');
    expect(blockedRes.headers.get('x-request-id')).toBeTruthy();
    const body = (await blockedRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');

    const joinedLogs = capturedLogs.join('\n');
    expect(joinedLogs).not.toContain(activeStudentId);
    expect(joinedLogs).not.toContain(disposableStudentId);
    expect(joinedLogs).not.toContain(inactiveStudentId);
    expect(joinedLogs).not.toContain(activeEmail);
    expect(joinedLogs).not.toContain(disposableEmail);
    expect(joinedLogs).not.toContain(inactiveEmail);
  });
});
