import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAttempts, permissions, profiles, sessions, userPermissions } from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as sessionGet } from '@/app/api/v1/auth/session/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { FakeClock } from '@/server/shared/clock';
import {
  createContainer,
  type ServerContainer,
  setContainerForTesting,
} from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { StructuredLogger } from '@/server/shared/logger';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';

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

function cookiePairFromLogin(res: Response): string {
  const line = res.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(line).toBeDefined();
  return line!.split(';')[0]!;
}

describe('CR-08 Single Active Session, 30m Sliding TTL & Background-Poll Exemption integration', () => {
  let pool: Pool;
  let db: Database;
  let container: ServerContainer;
  const clock = new FakeClock('2026-11-24T00:00:00.000Z');
  const suffix = randomUUID().slice(0, 8);
  const userAId = randomUUID();
  const userBId = randomUUID();
  const userASid = `MSSV-CR08-A-${suffix}`;
  const userBSid = `MSSV-CR08-B-${suffix}`;
  const testIp = `203.0.113.${Math.floor(Math.random() * 100) + 10}`;

  beforeAll(async () => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for CR-08 integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: testDbUrl,
      testDatabaseUrl: testDbUrl,
      sessionSecret: `cr08-int-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: `cr08-cron-${suffix}`,
      smtp: {},
      appUrl: 'http://localhost:3000',
    };

    container = createContainer({
      config: testConfig,
      clock,
      db,
      logger: new StructuredLogger({ writeOut: () => {}, writeErr: () => {} }),
    });
    setContainerForTesting(container);

    await db
      .insert(permissions)
      .values([{ code: 'member.view', groupName: 'members', description: 'View', scopable: false }])
      .onConflictDoNothing();

    const pwHash = await hashPassword(DEV_SEED_PASSWORD);
    await db.insert(profiles).values([
      {
        id: userAId,
        studentId: userASid,
        email: `cr08-a-${suffix}@eiu.edu.vn`,
        fullName: `CR08 User A ${suffix}`,
        passwordHash: pwHash,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: userBId,
        studentId: userBSid,
        email: `cr08-b-${suffix}@eiu.edu.vn`,
        fullName: `CR08 User B ${suffix}`,
        passwordHash: pwHash,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);
    await db.insert(userPermissions).values([
      { userId: userAId, permissionCode: 'member.view', grantedBy: null },
      { userId: userBId, permissionCode: 'member.view', grantedBy: null },
    ]);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    if (db) {
      await db.delete(sessions).where(inArray(sessions.userId, [userAId, userBId]));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, [userAId, userBId]));
      await db.delete(loginAttempts).where(eq(loginAttempts.ip, testIp));
      await db.delete(profiles).where(inArray(profiles.id, [userAId, userBId]));
    }
    await pool?.end();
  });

  async function loginAs(studentId: string): Promise<string> {
    const res = await loginPost(
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD, remember: true }),
      }),
    );
    expect(res.status).toBe(200);
    return cookiePairFromLogin(res);
  }

  it('enforces sequential single active session without disturbing other users and detects revocation on background poll', async () => {
    clock.setNow('2026-11-24T00:00:00.000Z');
    const cookieA1 = await loginAs(userASid);
    const cookieB1 = await loginAs(userBSid);

    const pollA1Ok = await notificationsGet(
      new Request('http://localhost:3000/api/v1/notifications', {
        headers: { cookie: cookieA1, 'x-beam-background': '1' },
      }),
    );
    expect(pollA1Ok.status).toBe(200);

    clock.advanceByMs(60_000);
    const cookieA2 = await loginAs(userASid);

    const oldSessionRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: cookieA1 },
      }),
    );
    expect(oldSessionRes.status).toBe(401);
    expect(((await oldSessionRes.json()) as { error: { code: string } }).error.code).toBe(
      'SESSION_EXPIRED',
    );

    const oldPollRes = await notificationsGet(
      new Request('http://localhost:3000/api/v1/notifications', {
        headers: { cookie: cookieA1, 'x-beam-background': '1' },
      }),
    );
    expect(oldPollRes.status).toBe(401);
    expect(((await oldPollRes.json()) as { error: { code: string } }).error.code).toBe(
      'SESSION_EXPIRED',
    );

    const newSessionRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: cookieA2 },
      }),
    );
    expect(newSessionRes.status).toBe(200);

    const userBSessionRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie: cookieB1 },
      }),
    );
    expect(userBSessionRes.status).toBe(200);
  });

  it('serializes concurrent logins for the same account so PostgreSQL retains strictly 1 active session', async () => {
    await db.delete(sessions).where(eq(sessions.userId, userAId));
    clock.setNow('2026-11-24T01:00:00.000Z');

    const cookies = await Promise.all([
      loginAs(userASid),
      loginAs(userASid),
      loginAs(userASid),
      loginAs(userASid),
    ]);

    const allRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userAId));
    expect(allRows).toHaveLength(4);
    expect(allRows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect(allRows.filter((row) => row.revokedAt !== null)).toHaveLength(3);

    const statuses = await Promise.all(
      cookies.map(async (cookie) =>
        (
          await sessionGet(
            new Request('http://localhost:3000/api/v1/auth/session', {
              headers: { cookie },
            }),
          )
        ).status,
      ),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(3);
  });

  it('slides 30m TTL on active requests, keeps expires_at untouched on x-beam-background: 1, and rejects idle or deactivated sessions', async () => {
    await db.delete(sessions).where(eq(sessions.userId, userAId));
    clock.setNow('2026-11-24T02:00:00.000Z');

    const cookie = await loginAs(userASid);
    const [initialRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userAId));
    expect(initialRow?.rememberMe).toBe(false);
    expect(initialRow?.expiresAt.toISOString()).toBe('2026-11-24T02:30:00.000Z');

    // +20m active request (notifications WITHOUT background header) -> slides to 02:50:00
    clock.advanceByMs(20 * 60_000);
    const activeNotifRes = await notificationsGet(
      new Request('http://localhost:3000/api/v1/notifications', {
        headers: { cookie },
      }),
    );
    expect(activeNotifRes.status).toBe(200);
    const [afterActiveRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, initialRow!.id));
    expect(afterActiveRow?.expiresAt.toISOString()).toBe('2026-11-24T02:50:00.000Z');
    expect(afterActiveRow?.lastSeenAt.toISOString()).toBe('2026-11-24T02:20:00.000Z');

    // +5m background poll (WITH x-beam-background: 1) -> 200, expiresAt & lastSeenAt unchanged
    clock.advanceByMs(5 * 60_000);
    const bgPollRes = await notificationsGet(
      new Request('http://localhost:3000/api/v1/notifications', {
        headers: { cookie, 'x-beam-background': '1' },
      }),
    );
    expect(bgPollRes.status).toBe(200);
    const [afterPollRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, initialRow!.id));
    expect(afterPollRow?.expiresAt.toISOString()).toBe('2026-11-24T02:50:00.000Z');
    expect(afterPollRow?.lastSeenAt.toISOString()).toBe('2026-11-24T02:20:00.000Z');

    // +25m more (02:50:00 — 30m idle since last active touch) -> background poll & session return 401
    clock.advanceByMs(25 * 60_000);
    const expiredBgRes = await notificationsGet(
      new Request('http://localhost:3000/api/v1/notifications', {
        headers: { cookie, 'x-beam-background': '1' },
      }),
    );
    expect(expiredBgRes.status).toBe(401);
    expect(((await expiredBgRes.json()) as { error: { code: string } }).error.code).toBe(
      'SESSION_EXPIRED',
    );

    const expiredSessionRes = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { cookie },
      }),
    );
    expect(expiredSessionRes.status).toBe(401);
    expect(
      ((await expiredSessionRes.json()) as { error: { code: string } }).error.code,
    ).toBe('SESSION_EXPIRED');

    // Deactivated account on background poll -> immediately 401 ACCOUNT_INACTIVE
    clock.setNow('2026-11-24T03:00:00.000Z');
    const activeCookie = await loginAs(userASid);
    await db
      .update(profiles)
      .set({ isActive: false })
      .where(eq(profiles.id, userAId));

    const inactiveBgRes = await notificationsGet(
      new Request('http://localhost:3000/api/v1/notifications', {
        headers: { cookie: activeCookie, 'x-beam-background': '1' },
      }),
    );
    expect(inactiveBgRes.status).toBe(401);
    expect(((await inactiveBgRes.json()) as { error: { code: string } }).error.code).toBe(
      'ACCOUNT_INACTIVE',
    );
  });
});
