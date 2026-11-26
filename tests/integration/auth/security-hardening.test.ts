import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAttempts, permissions, profiles, userPermissions } from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/api/v1/auth/logout/route';
import { DELETE as logoDelete, PUT as logoPut } from '@/app/api/v1/branding/logo/route';
import { POST as archivePurgeCronPost } from '@/app/api/v1/internal/cron/archive-purge/route';
import { POST as remindersCronPost } from '@/app/api/v1/internal/cron/reminders/route';
import { PUT as meAvatarPut } from '@/app/api/v1/me/avatar/route';
import { POST as mePasswordPost } from '@/app/api/v1/me/password/route';
import { GET as meGet, PATCH as mePatch } from '@/app/api/v1/me/route';
import { GET as memberAvatarGet } from '@/app/api/v1/members/[id]/avatar/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { proxy } from '@/proxy';
import { DrizzleArchiveRepository } from '@/server/modules/archive';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import {
  buildPasswordChangeAttemptKey,
  DrizzleAuthRepository,
} from '@/server/modules/auth';
import { DrizzleBrandingRepository } from '@/server/modules/branding';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzleRemindersRepository } from '@/server/modules/reminders';
import {
  createContainer,
  setContainerForTesting,
} from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { StructuredLogger } from '@/server/shared/logger';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import type { TransactionContext } from '@/server/shared/transaction';

class TestRollbackSentinel extends Error {}

const SAMPLE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`;

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

async function withRolledBackDb(
  db: Database,
  fn: (tx: TransactionContext) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new TestRollbackSentinel();
    });
  } catch (error) {
    if (!(error instanceof TestRollbackSentinel)) {
      throw error;
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

function makeTestConfig(suffix: string): Config {
  return {
    nodeEnv: 'test',
    databaseUrl: process.env.TEST_DATABASE_URL!,
    testDatabaseUrl: process.env.TEST_DATABASE_URL!,
    sessionSecret: `hardening-test-secret-${suffix}-0123456789`,
    sessionTtlDefaultHours: 24,
    sessionTtlRememberDays: 30,
    allowedEmailDomain: 'eiu.edu.vn',
    defaultInitialPassword: DEV_SEED_PASSWORD,
    cronSecret: `hardening-cron-${suffix}`,
    smtp: {},
    appUrl: 'http://localhost:3000',
    undoToastSeconds: 10,
  };
}

describe('Security Hardening integration (E11-01 & E11-02)', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for security hardening tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('blocks cross-site CSRF writes with 403 CSRF_ORIGIN_MISMATCH, allows same-origin writes & Bearer cron, and keeps member avatar no-store', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const adminSid = `MSSV-SEC-ADMIN-${suffix}`;
    const config = makeTestConfig(suffix);
    const capturedLogs: string[] = [];

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config,
        db,
        transactionRunner: { runInTransaction: (fn) => tx.transaction(fn) },
        auditWriter: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
        brandingRepo: new DrizzleBrandingRepository(tx),
        membersRepo: new DrizzleMembersRepository(tx),
        remindersRepo: new DrizzleRemindersRepository(tx),
        archiveRepo: new DrizzleArchiveRepository(tx),
        mailer: { send: async () => undefined },
        logger: new StructuredLogger({
          writeOut: (line) => capturedLogs.push(line),
          writeErr: (line) => capturedLogs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([{ code: 'member.view', groupName: 'members', description: 'V', scopable: false }])
        .onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values({
        id: adminId,
        studentId: adminSid,
        email: `sec-admin-${suffix}@eiu.edu.vn`,
        fullName: `Sec Admin ${suffix}`,
        passwordHash: seedPasswordHash,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      });
      await tx.insert(userPermissions).values({
        userId: adminId,
        permissionCode: 'member.view',
        grantedBy: null,
      });

      // Forged cross-site POST /auth/login -> 403 CSRF_ORIGIN_MISMATCH
      const forgedLoginRes = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.example',
            'x-forwarded-for': '198.51.100.11',
          },
          body: JSON.stringify({ studentId: adminSid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(forgedLoginRes.status).toBe(403);
      expect((await forgedLoginRes.json()).error.code).toBe('CSRF_ORIGIN_MISMATCH');

      // Same-origin POST /auth/login -> 200
      const loginRes = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': '198.51.100.11',
          },
          body: JSON.stringify({ studentId: adminSid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(loginRes.status).toBe(200);
      const adminCookie = cookiePairFromLogin(loginRes);

      // Forged cross-site PUT, DELETE, PATCH, POST with valid session cookie -> 403
      const forgedPut = await logoPut(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            cookie: adminCookie,
            origin: 'https://evil.example',
          },
          body: JSON.stringify({ dataUrl: SAMPLE_PNG_DATA_URL }),
        }),
      );
      expect(forgedPut.status).toBe(403);
      expect((await forgedPut.json()).error.code).toBe('CSRF_ORIGIN_MISMATCH');

      const forgedDelete = await logoDelete(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'DELETE',
          headers: {
            cookie: adminCookie,
            'sec-fetch-site': 'cross-site',
          },
        }),
      );
      expect(forgedDelete.status).toBe(403);
      expect((await forgedDelete.json()).error.code).toBe('CSRF_ORIGIN_MISMATCH');

      const forgedPatchMe = await mePatch(
        new Request('http://localhost:3000/api/v1/me', {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            cookie: adminCookie,
            origin: 'https://evil.example',
          },
          body: JSON.stringify({ locale: 'en' }),
        }),
      );
      expect(forgedPatchMe.status).toBe(403);
      expect((await forgedPatchMe.json()).error.code).toBe('CSRF_ORIGIN_MISMATCH');

      // Forged cross-site POST /auth/logout -> 403 and MUST NOT revoke session or clear cookie
      const forgedLogout = await logoutPost(
        new Request('http://localhost:3000/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            cookie: adminCookie,
            origin: 'https://evil.example',
          },
        }),
      );
      expect(forgedLogout.status).toBe(403);
      expect((await forgedLogout.json()).error.code).toBe('CSRF_ORIGIN_MISMATCH');
      expect(forgedLogout.headers.getSetCookie()).toHaveLength(0);

      // Session is still valid after forged logout
      const meCheck = await meGet(
        new Request('http://localhost:3000/api/v1/me', {
          headers: { cookie: adminCookie },
        }),
      );
      expect(meCheck.status).toBe(200);

      // Same-origin PUT /me/avatar succeeds, and member avatar GET remains private no-store
      const sameOriginAvatarPut = await meAvatarPut(
        new Request('http://localhost:3000/api/v1/me/avatar', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            cookie: adminCookie,
            origin: 'http://localhost:3000',
          },
          body: JSON.stringify({ dataUrl: SAMPLE_PNG_DATA_URL }),
        }),
      );
      expect(sameOriginAvatarPut.status).toBe(200);

      const avatarBinRes = await memberAvatarGet(
        new Request(`http://localhost:3000/api/v1/members/${adminId}/avatar?v=123`, {
          headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ id: adminId }) },
      );
      expect(avatarBinRes.status).toBe(200);
      expect(avatarBinRes.headers.get('cache-control')).toBe('no-store');
      expect(avatarBinRes.headers.get('etag')).toBeNull();

      // Cron endpoints with Bearer CRON_SECRET are exempt from CSRF in both proxy & route handler
      const cronRemindersReq = new NextRequest(
        'http://localhost:3000/api/v1/internal/cron/reminders',
        {
          method: 'POST',
          headers: {
            origin: 'https://github.com',
            authorization: `Bearer ${config.cronSecret}`,
          },
        },
      );
      expect(proxy(cronRemindersReq).status).toBe(200);
      const cronRemindersRes = await remindersCronPost(cronRemindersReq);
      expect(cronRemindersRes.status).toBe(200);

      const cronPurgeReq = new NextRequest(
        'http://localhost:3000/api/v1/internal/cron/archive-purge',
        {
          method: 'POST',
          headers: {
            origin: 'https://github.com',
            authorization: `Bearer ${config.cronSecret}`,
          },
        },
      );
      expect(proxy(cronPurgeReq).status).toBe(200);
      const cronPurgeRes = await archivePurgeCronPost(cronPurgeReq);
      expect(cronPurgeRes.status).toBe(200);
    });
  });

  it('enforces 2-layer login rate limit (shared Wi-Fi isolation + global IP cap) and POST /me/password 429 rate limit on PostgreSQL', async () => {
    const suffix = randomUUID().slice(0, 8);
    const userAId = randomUUID();
    const userBId = randomUUID();
    const userASid = `MSSV-RL-A-${suffix}`;
    const userBSid = `MSSV-RL-B-${suffix}`;
    const sharedWifiIp = '198.51.100.41';
    const sprayIp = '198.51.100.42';
    const capturedLogs: string[] = [];

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: makeTestConfig(suffix),
        db,
        transactionRunner: { runInTransaction: (fn) => tx.transaction(fn) },
        auditWriter: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => capturedLogs.push(line),
          writeErr: (line) => capturedLogs.push(line),
        }),
      });
      setContainerForTesting(container);

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: userAId,
          studentId: userASid,
          email: `rl-a-${suffix}@eiu.edu.vn`,
          fullName: `Rate Member A ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: userBId,
          studentId: userBSid,
          email: `rl-b-${suffix}@eiu.edu.vn`,
          fullName: `Rate Member B ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
      ]);

      // 1. 5 wrong login attempts for User A on shared Wi-Fi IP -> blocks User A with 429
      for (let i = 0; i < 5; i += 1) {
        const res = await loginPost(
          new Request('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:3000',
              'x-forwarded-for': sharedWifiIp,
            },
            body: JSON.stringify({ studentId: userASid, password: 'WrongPassword#1' }),
          }),
        );
        expect(res.status).toBe(401);
      }

      const userABlocked = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': sharedWifiIp,
          },
          body: JSON.stringify({ studentId: userASid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(userABlocked.status).toBe(429);
      expect((await userABlocked.json()).error.code).toBe('RATE_LIMITED');

      // User B on the exact same shared Wi-Fi IP logs in cleanly!
      const userBLogin = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': sharedWifiIp,
          },
          body: JSON.stringify({ studentId: userBSid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(userBLogin.status).toBe(200);
      const userBCookie = cookiePairFromLogin(userBLogin);

      // 2. POST /me/password rate limit: 5 wrong currentPassword -> 400, 6th -> 429 RATE_LIMITED
      for (let i = 0; i < 5; i += 1) {
        const res = await mePasswordPost(
          new Request('http://localhost:3000/api/v1/me/password', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:3000',
              cookie: userBCookie,
              'x-forwarded-for': sharedWifiIp,
            },
            body: JSON.stringify({
              currentPassword: `WrongCurrent#${i}`,
              newPassword: 'FreshPassword#2026',
            }),
          }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('INVALID_CURRENT_PASSWORD');
      }

      const pwRateLimited = await mePasswordPost(
        new Request('http://localhost:3000/api/v1/me/password', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            cookie: userBCookie,
            'x-forwarded-for': sharedWifiIp,
          },
          body: JSON.stringify({
            currentPassword: DEV_SEED_PASSWORD,
            newPassword: 'FreshPassword#2026',
          }),
        }),
      );
      expect(pwRateLimited.status).toBe(429);
      const pwBody = (await pwRateLimited.json()) as {
        error: { code: string; details: { retryAfterSeconds: number } };
      };
      expect(pwBody.error.code).toBe('RATE_LIMITED');
      expect(pwBody.error.details.retryAfterSeconds).toBe(900);

      // Verify pwd:<userId> rows exist without storing MSSV or passwords
      const pwdKey = buildPasswordChangeAttemptKey(userBId);
      const pwdAttemptRows = await tx
        .select()
        .from(loginAttempts)
        .where(eq(loginAttempts.studentId, pwdKey));
      expect(pwdAttemptRows).toHaveLength(5);

      // 3. Global IP cap (20 failures distributed across accounts) triggers 429 for fresh account
      for (let i = 0; i < 20; i += 1) {
        const res = await loginPost(
          new Request('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:3000',
              'x-forwarded-for': sprayIp,
            },
            body: JSON.stringify({
              studentId: `MSSV-SPRAY-${Math.floor(i / 4)}-${suffix}`,
              password: 'WrongPassword#1',
            }),
          }),
        );
        expect(res.status).toBe(401);
      }

      const globalIpBlocked = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': sprayIp,
          },
          body: JSON.stringify({ studentId: userBSid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(globalIpBlocked.status).toBe(429);
      expect((await globalIpBlocked.json()).error.code).toBe('RATE_LIMITED');

      const serializedLogs = capturedLogs.join('\n');
      expect(serializedLogs).not.toContain(userASid);
      expect(serializedLogs).not.toContain(userBSid);
      expect(serializedLogs).not.toContain('WrongCurrent#0');
      expect(serializedLogs).not.toContain('FreshPassword#2026');
    });
  });

  it('prevents pwd: prefix namespace collision on PostgreSQL (cannot bypass global IP cap or DoS victim /me/password)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const victimId = randomUUID();
    const victimSid = `MSSV-VICTIM-${suffix}`;
    const victimIp = '198.51.100.61';
    const attackerIp = '198.51.100.62';

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: makeTestConfig(suffix),
        db,
        transactionRunner: { runInTransaction: (fn) => tx.transaction(fn) },
        auditWriter: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
      });
      setContainerForTesting(container);

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values({
        id: victimId,
        studentId: victimSid,
        email: `victim-${suffix}@eiu.edu.vn`,
        fullName: `Victim Member ${suffix}`,
        passwordHash: seedPasswordHash,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      });

      const victimLogin = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': victimIp,
          },
          body: JSON.stringify({ studentId: victimSid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(victimLogin.status).toBe(200);
      const victimCookie = cookiePairFromLogin(victimLogin);

      // 1. Attacker sends 5 failed logins with studentId="pwd:<victimId>"
      for (let i = 0; i < 5; i += 1) {
        const res = await loginPost(
          new Request('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:3000',
              'x-forwarded-for': attackerIp,
            },
            body: JSON.stringify({
              studentId: `pwd:${victimId}`,
              password: 'WrongPassword#1',
            }),
          }),
        );
        expect(res.status).toBe(401);
      }

      // Victim's POST /me/password MUST NOT be rate-limited!
      const victimPwRes = await mePasswordPost(
        new Request('http://localhost:3000/api/v1/me/password', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            cookie: victimCookie,
            'x-forwarded-for': victimIp,
          },
          body: JSON.stringify({
            currentPassword: DEV_SEED_PASSWORD,
            newPassword: 'VictimNewPass#2026',
          }),
        }),
      );
      expect(victimPwRes.status).toBe(200);

      // 2. Attacker sends 15 more rotating pwd:<n> / PWD:<n> logins (20 total on attackerIp)
      for (let i = 0; i < 15; i += 1) {
        const prefix = i % 2 === 0 ? 'pwd:' : 'PWD:';
        const res = await loginPost(
          new Request('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:3000',
              'x-forwarded-for': attackerIp,
            },
            body: JSON.stringify({
              studentId: `${prefix}bypass-${i}`,
              password: 'WrongPassword#1',
            }),
          }),
        );
        expect(res.status).toBe(401);
      }

      // 21st attempt from attackerIp MUST be blocked with 429 RATE_LIMITED
      const blockedRes = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': attackerIp,
          },
          body: JSON.stringify({
            studentId: 'pwd:bypass-999',
            password: 'WrongPassword#1',
          }),
        }),
      );
      expect(blockedRes.status).toBe(429);
      expect((await blockedRes.json()).error.code).toBe('RATE_LIMITED');
    });
  });
});
