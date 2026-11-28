import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  departments,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as sessionGet } from '@/app/api/v1/auth/session/route';
import { POST as memberActivatePost } from '@/app/api/v1/members/[id]/activate/route';
import {
  DELETE as memberAvatarDelete,
  GET as memberAvatarGet,
  PUT as memberAvatarPut,
} from '@/app/api/v1/members/[id]/avatar/route';
import { POST as memberDeactivatePost } from '@/app/api/v1/members/[id]/deactivate/route';
import { POST as memberResetPasswordPost } from '@/app/api/v1/members/[id]/reset-password/route';
import {
  GET as memberGet,
  PATCH as memberPatch,
} from '@/app/api/v1/members/[id]/route';
import {
  GET as membersGet,
  POST as membersPost,
} from '@/app/api/v1/members/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { MAX_IMAGE_BYTES } from '@/lib/media';
import { DEFAULT_MEMBER_PERMISSIONS } from '@/lib/permissions';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
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

describe('Members Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for members integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces CRUD, FR-19 defaults, AC-14 email domain, WQ-21 immutability, FR-42 PII masking, WQ-11 search, cursor pagination, AC-09 last admin, session revocation, and audit_logs without PII', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const basicViewerId = randomUUID();
    const hrNoDetailId = randomUUID();
    const noPermId = randomUUID();
    const detailViewerId = randomUUID();
    const deptAId = randomUUID();
    const deptBId = randomUUID();

    const adminSid = `MSSV-MADMIN-${suffix}`;
    const basicSid = `MSSV-MBASIC-${suffix}`;
    const hrSid = `MSSV-MHR-${suffix}`;
    const noPermSid = `MSSV-MNOPERM-${suffix}`;
    const detailSid = `MSSV-MDETAIL-${suffix}`;
    const basicEmail = `m-basic-${suffix}@eiu.edu.vn`;
    const baseHost = Math.floor(Math.random() * 150) + 10;
    const capturedLogs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `members-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      defaultInitialPassword: DEV_SEED_PASSWORD,
      cronSecret: 'members-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
        db,
        transactionRunner: { runInTransaction: (fn) => tx.transaction(fn) },
        auditWriter: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
        departmentsRepo: new DrizzleDepartmentsRepository(tx),
        membersRepo: new DrizzleMembersRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => capturedLogs.push(line),
          writeErr: (line) => capturedLogs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([
          { code: 'member.view', groupName: 'members', description: 'V', scopable: false },
          { code: 'member.view_detail', groupName: 'members', description: 'VD', scopable: false },
          { code: 'member.create', groupName: 'members', description: 'C', scopable: false },
          { code: 'member.update', groupName: 'members', description: 'U', scopable: false },
          { code: 'member.deactivate', groupName: 'members', description: 'D', scopable: false },
          { code: 'task.update_assigned', groupName: 'tasks', description: 'T', scopable: false },
          { code: 'comment.create', groupName: 'comments', description: 'CM', scopable: false },
        ])
        .onConflictDoNothing();

      await tx.insert(departments).values([
        { id: deptAId, name: `Members Dept A ${suffix}` },
        { id: deptBId, name: `Members Dept B ${suffix}` },
      ]);

      // Create sole active admin + test actors inside this rolled-back tx
      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `m-admin-${suffix}@eiu.edu.vn`,
          fullName: `AAA Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: basicViewerId,
          studentId: basicSid,
          email: basicEmail,
          fullName: `AAB Basic ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: hrNoDetailId,
          studentId: hrSid,
          email: `m-hr-${suffix}@eiu.edu.vn`,
          fullName: `AAC HR ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
        {
          id: noPermId,
          studentId: noPermSid,
          email: `m-noperm-${suffix}@eiu.edu.vn`,
          fullName: 'ZZ NoPerm Account',
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: detailViewerId,
          studentId: detailSid,
          email: `m-detail-${suffix}@eiu.edu.vn`,
          fullName: 'ZZ Detail Viewer',
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
      ]);
      await tx
        .update(profiles)
        .set({ isAdmin: false })
        .where(and(eq(profiles.isAdmin, true), ne(profiles.id, adminId)));

      await tx.insert(userPermissions).values([
        { userId: basicViewerId, permissionCode: 'member.view', grantedBy: null },
        { userId: hrNoDetailId, permissionCode: 'member.view', grantedBy: null },
        { userId: hrNoDetailId, permissionCode: 'member.create', grantedBy: null },
        { userId: hrNoDetailId, permissionCode: 'member.update', grantedBy: null },
        { userId: hrNoDetailId, permissionCode: 'member.deactivate', grantedBy: null },
        { userId: noPermId, permissionCode: 'comment.create', grantedBy: null },
        { userId: detailViewerId, permissionCode: 'member.view', grantedBy: null },
        { userId: detailViewerId, permissionCode: 'member.view_detail', grantedBy: null },
      ]);

      const loginAs = async (
        studentId: string,
        hostOffset: number,
        password = DEV_SEED_PASSWORD,
      ) =>
        cookiePairFromLogin(
          await loginPost(
            new Request('http://localhost:3000/api/v1/auth/login', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-forwarded-for': `198.51.100.${baseHost + hostOffset}`,
              },
              body: JSON.stringify({ studentId, password }),
            }),
          ),
        );

      const adminCookie = await loginAs(adminSid, 0);
      const basicCookie = await loginAs(basicSid, 1);
      const hrCookie = await loginAs(hrSid, 2);
      const noPermCookie = await loginAs(noPermSid, 3);
      const detailCookie = await loginAs(detailSid, 4);

      // 0. 401 UNAUTHORIZED & 403 FORBIDDEN on collection endpoints
      const unauthListRes = await membersGet(new Request('http://localhost:3000/api/v1/members'));
      expect(unauthListRes.status).toBe(401);
      expect(((await unauthListRes.json()) as { error: { code: string } }).error.code).toBe(
        'UNAUTHORIZED',
      );

      const unauthCreateRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            studentId: `MSSV-UNAUTH-${suffix}`,
            email: `unauth-${suffix}@eiu.edu.vn`,
            fullName: 'Unauth',
          }),
        }),
      );
      expect(unauthCreateRes.status).toBe(401);

      const forbiddenListRes = await membersGet(
        new Request('http://localhost:3000/api/v1/members', {
          headers: { cookie: noPermCookie },
        }),
      );
      expect(forbiddenListRes.status).toBe(403);
      expect(((await forbiddenListRes.json()) as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN',
      );

      const forbiddenCreateRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: basicCookie },
          body: JSON.stringify({
            studentId: `MSSV-FORB-${suffix}`,
            email: `forb-${suffix}@eiu.edu.vn`,
            fullName: 'Forbidden',
          }),
        }),
      );
      expect(forbiddenCreateRes.status).toBe(403);
      expect(((await forbiddenCreateRes.json()) as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN',
      );

      // 1. HR without member.view_detail creates member -> 201 with MemberPublicSummary (NO studentId/email)
      const createdSid = `MSSV-MNEW-${suffix}`;
      const createdEmail = `new-member-${suffix}@eiu.edu.vn`;
      const createRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({
            studentId: createdSid,
            email: createdEmail.toUpperCase(),
            fullName: `AAD Created ${suffix}`,
            departmentIds: [deptAId, deptBId],
            locale: 'en',
          }),
        }),
      );
      expect(createRes.status).toBe(201);
      const createdBody = (await createRes.json()) as {
        member: Record<string, unknown> & { id: string; departments: Array<{ id: string }> };
      };
      expect('studentId' in createdBody.member).toBe(false);
      expect('email' in createdBody.member).toBe(false);
      expect('mustChangePassword' in createdBody.member).toBe(false);
      expect('passwordHash' in createdBody.member).toBe(false);
      expect(createdBody.member.departments.map((d) => d.id)).toEqual([
        deptAId,
        deptBId,
      ]);
      const createdId = createdBody.member.id;

      // Verify FR-19 default permissions were granted in PostgreSQL
      const grantedRows = await tx
        .select()
        .from(userPermissions)
        .where(eq(userPermissions.userId, createdId));
      expect(grantedRows.map((r) => r.permissionCode).sort()).toEqual(
        [...DEFAULT_MEMBER_PERMISSIONS].sort(),
      );

      // 2. AC-14 invalid email domain, duplicate studentId, case-insensitive duplicate email
      const badDomainRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            studentId: `MSSV-BAD-${suffix}`,
            email: 'bad@gmail.com',
            fullName: 'Bad Domain',
          }),
        }),
      );
      expect(badDomainRes.status).toBe(400);
      expect(((await badDomainRes.json()) as { error: { code: string } }).error.code).toBe(
        'INVALID_EMAIL_DOMAIN',
      );

      const dupSidRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            studentId: createdSid,
            email: `other-${suffix}@eiu.edu.vn`,
            fullName: 'Dup SID',
          }),
        }),
      );
      expect(dupSidRes.status).toBe(409);
      expect(((await dupSidRes.json()) as { error: { code: string } }).error.code).toBe(
        'STUDENT_ID_EXISTS',
      );

      const dupEmailRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            studentId: `MSSV-OTHER-${suffix}`,
            email: createdEmail.toUpperCase(),
            fullName: 'Dup Email',
          }),
        }),
      );
      expect(dupEmailRes.status).toBe(409);
      expect(((await dupEmailRes.json()) as { error: { code: string } }).error.code).toBe(
        'EMAIL_EXISTS',
      );

      // 3. FR-42 / WQ-11: basic viewer cannot see or search studentId; admin can
      const basicSearchBySid = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?q=${encodeURIComponent(createdSid)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(basicSearchBySid.status).toBe(200);
      expect(
        ((await basicSearchBySid.json()) as { items: unknown[] }).items,
      ).toHaveLength(0);

      const adminSearchBySid = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?q=${encodeURIComponent(createdSid)}`,
          { headers: { cookie: adminCookie } },
        ),
      );
      expect(adminSearchBySid.status).toBe(200);
      const adminSearchBody = (await adminSearchBySid.json()) as {
        items: Array<{ id: string; studentId?: string; email?: string }>;
      };
      expect(adminSearchBody.items).toHaveLength(1);
      expect(adminSearchBody.items[0]?.studentId).toBe(createdSid);
      expect(adminSearchBody.items[0]?.email).toBe(createdEmail);

      // Cursor pagination & filter by departmentId
      const page1 = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?q=${encodeURIComponent(suffix)}&limit=2`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(page1.status).toBe(200);
      const page1Body = (await page1.json()) as {
        items: Array<Record<string, unknown>>;
        meta: { nextCursor: string | null; limit: number };
      };
      expect(page1Body.items).toHaveLength(2);
      expect(page1Body.meta.nextCursor).toBeTruthy();
      expect('studentId' in page1Body.items[0]!).toBe(false);

      const page2 = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?q=${encodeURIComponent(suffix)}&limit=2&cursor=${encodeURIComponent(page1Body.meta.nextCursor!)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(page2.status).toBe(200);
      const page2Body = (await page2.json()) as {
        items: Array<{ id: string }>;
        meta: { nextCursor: string | null };
      };
      expect(page2Body.items).toHaveLength(2);
      expect(page2Body.meta.nextCursor).toBeNull();

      // Invalid cursor & invalid isActive -> 400
      const badCursorRes = await membersGet(
        new Request('http://localhost:3000/api/v1/members?cursor=tampered', {
          headers: { cookie: basicCookie },
        }),
      );
      expect(badCursorRes.status).toBe(400);

      const badIsActiveRes = await membersGet(
        new Request('http://localhost:3000/api/v1/members?isActive=maybe', {
          headers: { cookie: basicCookie },
        }),
      );
      expect(badIsActiveRes.status).toBe(400);

      // Real PG filter by departmentId (member_departments EXISTS) & non-admin member.view_detail
      const deptABeforeRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?departmentId=${deptAId}&q=${encodeURIComponent(suffix)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(deptABeforeRes.status).toBe(200);
      expect(
        ((await deptABeforeRes.json()) as { items: Array<{ id: string }> }).items.map(
          (i) => i.id,
        ),
      ).toEqual([createdId]);

      const detailListRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?q=${encodeURIComponent(createdSid)}`,
          { headers: { cookie: detailCookie } },
        ),
      );
      expect(detailListRes.status).toBe(200);
      expect(
        ((await detailListRes.json()) as { items: Array<Record<string, unknown>> }).items[0],
      ).toMatchObject({
        id: createdId,
        studentId: createdSid,
        email: createdEmail,
        locale: 'en',
      });

      // 4. 401/403/400/404 on [id] endpoints + GET / PATCH /members/[id]
      const missingId = randomUUID();
      expect(
        (await memberGet(new Request(`http://localhost:3000/api/v1/members/${createdId}`), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);
      expect(
        (await memberPatch(new Request(`http://localhost:3000/api/v1/members/${createdId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'X' }) }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);
      expect(
        (await memberDeactivatePost(new Request(`http://localhost:3000/api/v1/members/${createdId}/deactivate`, { method: 'POST' }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);
      expect(
        (await memberActivatePost(new Request(`http://localhost:3000/api/v1/members/${createdId}/activate`, { method: 'POST' }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);

      expect(
        (await memberGet(new Request(`http://localhost:3000/api/v1/members/${createdId}`, { headers: { cookie: noPermCookie } }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(403);
      expect(
        (await memberPatch(new Request(`http://localhost:3000/api/v1/members/${createdId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: basicCookie }, body: JSON.stringify({ fullName: 'X' }) }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(403);
      expect(
        (await memberDeactivatePost(new Request(`http://localhost:3000/api/v1/members/${createdId}/deactivate`, { method: 'POST', headers: { cookie: basicCookie } }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(403);
      expect(
        (await memberActivatePost(new Request(`http://localhost:3000/api/v1/members/${createdId}/activate`, { method: 'POST', headers: { cookie: basicCookie } }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(403);

      expect(
        (await memberGet(new Request('http://localhost:3000/api/v1/members/not-a-uuid', { headers: { cookie: basicCookie } }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status,
      ).toBe(400);
      expect(
        (await memberPatch(new Request('http://localhost:3000/api/v1/members/not-a-uuid', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: hrCookie }, body: JSON.stringify({ fullName: 'X' }) }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status,
      ).toBe(400);
      expect(
        (await memberDeactivatePost(new Request('http://localhost:3000/api/v1/members/not-a-uuid/deactivate', { method: 'POST', headers: { cookie: hrCookie } }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status,
      ).toBe(400);
      expect(
        (await memberActivatePost(new Request('http://localhost:3000/api/v1/members/not-a-uuid/activate', { method: 'POST', headers: { cookie: hrCookie } }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status,
      ).toBe(400);

      expect(
        (await memberGet(new Request(`http://localhost:3000/api/v1/members/${missingId}`, { headers: { cookie: basicCookie } }), { params: Promise.resolve({ id: missingId }) })).status,
      ).toBe(404);
      expect(
        (await memberPatch(new Request(`http://localhost:3000/api/v1/members/${missingId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: hrCookie }, body: JSON.stringify({ fullName: 'X' }) }), { params: Promise.resolve({ id: missingId }) })).status,
      ).toBe(404);
      expect(
        (await memberDeactivatePost(new Request(`http://localhost:3000/api/v1/members/${missingId}/deactivate`, { method: 'POST', headers: { cookie: hrCookie } }), { params: Promise.resolve({ id: missingId }) })).status,
      ).toBe(404);
      expect(
        (await memberActivatePost(new Request(`http://localhost:3000/api/v1/members/${missingId}/activate`, { method: 'POST', headers: { cookie: hrCookie } }), { params: Promise.resolve({ id: missingId }) })).status,
      ).toBe(404);

      const getSingleBasic = await memberGet(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          headers: { cookie: basicCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(getSingleBasic.status).toBe(200);
      expect('studentId' in ((await getSingleBasic.json()) as { member: object }).member).toBe(
        false,
      );

      const getSingleDetail = await memberGet(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          headers: { cookie: detailCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(getSingleDetail.status).toBe(200);
      expect(
        ((await getSingleDetail.json()) as { member: Record<string, unknown> }).member,
      ).toMatchObject({
        id: createdId,
        studentId: createdSid,
        email: createdEmail,
        locale: 'en',
        isAdmin: false,
        mustChangePassword: true,
      });

      const badPatchSid = await memberPatch(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ studentId: 'MSSV-HACK' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(badPatchSid.status).toBe(400);

      const badPatchDomain = await memberPatch(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ email: 'outside@gmail.com' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(badPatchDomain.status).toBe(400);
      expect(((await badPatchDomain.json()) as { error: { code: string } }).error.code).toBe(
        'INVALID_EMAIL_DOMAIN',
      );

      const dupPatchEmail = await memberPatch(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ email: basicEmail.toUpperCase() }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(dupPatchEmail.status).toBe(409);
      expect(((await dupPatchEmail.json()) as { error: { code: string } }).error.code).toBe(
        'EMAIL_EXISTS',
      );

      const badPatchDept = await memberPatch(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ departmentIds: [randomUUID()] }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(badPatchDept.status).toBe(400);
      expect(((await badPatchDept.json()) as { error: { code: string } }).error.code).toBe(
        'INVALID_DEPARTMENT_IDS',
      );

      const patchOk = await memberPatch(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({
            fullName: `AAD Updated ${suffix}`,
            departmentIds: [deptBId],
          }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(patchOk.status).toBe(200);
      const patchOkBody = (await patchOk.json()) as {
        member: Record<string, unknown> & { fullName: string; departments: Array<{ id: string }> };
      };
      expect(patchOkBody.member.fullName).toBe(`AAD Updated ${suffix}`);
      expect(patchOkBody.member.departments.map((d) => d.id)).toEqual([deptBId]);
      expect('studentId' in patchOkBody.member).toBe(false);

      const deptAAfterRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?departmentId=${deptAId}&q=${encodeURIComponent(suffix)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(deptAAfterRes.status).toBe(200);
      expect(((await deptAAfterRes.json()) as { items: unknown[] }).items).toHaveLength(0);

      const deptBAfterRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?departmentId=${deptBId}&q=${encodeURIComponent(suffix)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(deptBAfterRes.status).toBe(200);
      expect(
        ((await deptBAfterRes.json()) as { items: Array<{ id: string }> }).items.map(
          (i) => i.id,
        ),
      ).toEqual([createdId]);

      // 5. AC-09 last active admin protection
      const lastAdminRes = await memberDeactivatePost(
        new Request(`http://localhost:3000/api/v1/members/${adminId}/deactivate`, {
          method: 'POST',
          headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ id: adminId }) },
      );
      expect(lastAdminRes.status).toBe(409);
      expect(((await lastAdminRes.json()) as { error: { code: string } }).error.code).toBe(
        'LAST_ACTIVE_ADMIN',
      );

      // 6. Deactivate revokes live sessions, masks PII for HR, & isActive filter reflects DB state
      const createdCookie = await loginAs(createdSid, 5);
      const activeSessionRes = await sessionGet(
        new Request('http://localhost:3000/api/v1/auth/session', {
          headers: { cookie: createdCookie },
        }),
      );
      expect(activeSessionRes.status).toBe(200);

      const deactRes = await memberDeactivatePost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/deactivate`, {
          method: 'POST',
          headers: { cookie: hrCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(deactRes.status).toBe(200);
      const deactBody = (await deactRes.json()) as {
        member: Record<string, unknown> & { isActive: boolean; leftAt: string | null };
      };
      expect(deactBody.member.isActive).toBe(false);
      expect(deactBody.member.leftAt).toBeTruthy();
      expect('studentId' in deactBody.member).toBe(false);
      expect('email' in deactBody.member).toBe(false);

      const inactiveFilterRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?isActive=false&q=${encodeURIComponent(suffix)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(inactiveFilterRes.status).toBe(200);
      expect(
        ((await inactiveFilterRes.json()) as { items: Array<{ id: string }> }).items.map(
          (i) => i.id,
        ),
      ).toEqual([createdId]);

      const activeFilterWhileLeftRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?isActive=true&q=${encodeURIComponent(suffix)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(activeFilterWhileLeftRes.status).toBe(200);
      expect(
        ((await activeFilterWhileLeftRes.json()) as { items: Array<{ id: string }> }).items.map(
          (i) => i.id,
        ),
      ).toHaveLength(3);

      const revokedSessionRes = await sessionGet(
        new Request('http://localhost:3000/api/v1/auth/session', {
          headers: { cookie: createdCookie },
        }),
      );
      expect(revokedSessionRes.status).toBe(401);

      const dbSessions = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.userId, createdId));
      expect(dbSessions.every((s) => s.revokedAt !== null)).toBe(true);

      const actRes = await memberActivatePost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/activate`, {
          method: 'POST',
          headers: { cookie: hrCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(actRes.status).toBe(200);
      const actBody = (await actRes.json()) as {
        member: Record<string, unknown> & { isActive: boolean; leftAt: string | null };
      };
      expect(actBody.member.isActive).toBe(true);
      expect(actBody.member.leftAt).toBeNull();
      expect('studentId' in actBody.member).toBe(false);
      expect('email' in actBody.member).toBe(false);

      const activeFilterRestoredRes = await membersGet(
        new Request(
          `http://localhost:3000/api/v1/members?isActive=true&q=${encodeURIComponent(suffix)}`,
          { headers: { cookie: basicCookie } },
        ),
      );
      expect(activeFilterRestoredRes.status).toBe(200);
      expect(
        ((await activeFilterRestoredRes.json()) as { items: Array<{ id: string }> }).items,
      ).toHaveLength(4);

      // 7. Verify admin-only reset-password route (401/403 for non-admin even with member.update, 400/404, session revocation, audit_logs)
      const resetUnauth = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newPassword: 'ResetByAdmin#2026' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(resetUnauth.status).toBe(401);

      const resetNoPerm = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: basicCookie },
          body: JSON.stringify({ newPassword: 'ResetByAdmin#2026' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(resetNoPerm.status).toBe(403);

      const resetBadBody = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ newPassword: 'short' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(resetBadBody.status).toBe(400);

      const resetMissing = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${missingId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ newPassword: 'ResetByAdmin#2026' }),
        }),
        { params: Promise.resolve({ id: missingId }) },
      );
      expect(resetMissing.status).toBe(404);

      // Non-admin with member.update CANNOT reset an Admin's OR a regular member's password -> 403
      const hrResetAdmin = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${adminId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ newPassword: 'AttemptAdminReset#2026' }),
        }),
        { params: Promise.resolve({ id: adminId }) },
      );
      expect(hrResetAdmin.status).toBe(403);
      expect(
        (await sessionGet(new Request('http://localhost:3000/api/v1/auth/session', { headers: { cookie: adminCookie } }))).status,
      ).toBe(200);

      // Regular member logs in with initial default password -> gets active session & /profile?changePassword=1
      const initialLoginRes = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `198.51.100.${baseHost + 6}`,
          },
          body: JSON.stringify({ studentId: createdSid, password: DEV_SEED_PASSWORD }),
        }),
      );
      expect(initialLoginRes.status).toBe(200);
      expect(((await initialLoginRes.json()) as { redirectTo: string }).redirectTo).toBe(
        '/profile?changePassword=1',
      );
      const createdLiveCookie = cookiePairFromLogin(initialLoginRes);

      const hrResetMember = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ newPassword: 'AttemptHrMemberReset#2026' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(hrResetMember.status).toBe(403);
      expect(
        (await sessionGet(new Request('http://localhost:3000/api/v1/auth/session', { headers: { cookie: createdLiveCookie } }))).status,
      ).toBe(200);

      // Admin resets regular member password -> 200 MemberDetail, revokes member session, sets mustChangePassword=true
      const adminResetMember = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ newPassword: 'ResetMemberByAdmin#2026' }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(adminResetMember.status).toBe(200);
      expect(adminResetMember.headers.get('cache-control')).toBe('no-store');
      const adminResetMemberBody = (await adminResetMember.json()) as {
        member: Record<string, unknown> & { mustChangePassword: boolean };
      };
      expect(adminResetMemberBody.member.mustChangePassword).toBe(true);
      expect('passwordHash' in adminResetMemberBody.member).toBe(false);

      expect(
        (await sessionGet(new Request('http://localhost:3000/api/v1/auth/session', { headers: { cookie: createdLiveCookie } }))).status,
      ).toBe(401);

      const postResetLoginRes = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `198.51.100.${baseHost + 7}`,
          },
          body: JSON.stringify({ studentId: createdSid, password: 'ResetMemberByAdmin#2026' }),
        }),
      );
      expect(postResetLoginRes.status).toBe(200);
      expect(((await postResetLoginRes.json()) as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(
        true,
      );

      // 7b. Member avatars (/api/v1/members/{id}/avatar GET/PUT/DELETE)
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const jpegDataUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
      const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;

      expect(
        (await memberAvatarGet(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);
      expect(
        (await memberAvatarPut(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl: jpegDataUrl }) }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);
      expect(
        (await memberAvatarDelete(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { method: 'DELETE' }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(401);

      expect(
        (await memberAvatarPut(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: basicCookie }, body: JSON.stringify({ dataUrl: jpegDataUrl }) }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(403);
      expect(
        (await memberAvatarDelete(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { method: 'DELETE', headers: { cookie: basicCookie } }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(403);

      expect(
        (await memberAvatarGet(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { headers: { cookie: noPermCookie } }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(404);
      expect(
        (await memberAvatarGet(new Request('http://localhost:3000/api/v1/members/not-a-uuid/avatar', { headers: { cookie: noPermCookie } }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status,
      ).toBe(400);

      expect(
        (await memberAvatarPut(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: hrCookie }, body: JSON.stringify({ dataUrl: svgDataUrl }) }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(400);
      const bigPayload = Buffer.concat([jpegBytes, Buffer.alloc(MAX_IMAGE_BYTES + 1 - jpegBytes.length, 0x01)]);
      expect(
        (await memberAvatarPut(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: hrCookie }, body: JSON.stringify({ dataUrl: `data:image/jpeg;base64,${bigPayload.toString('base64')}` }) }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(400);

      const avatarPutRes = await memberAvatarPut(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({ dataUrl: jpegDataUrl }),
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(avatarPutRes.status).toBe(200);
      const avatarPutBody = (await avatarPutRes.json()) as {
        member: Record<string, unknown> & { avatarUrl: string | null };
      };
      expect(avatarPutBody.member.avatarUrl).toMatch(
        new RegExp(`^/api/v1/members/${createdId}/avatar\\?v=\\d+$`),
      );
      expect('studentId' in avatarPutBody.member).toBe(false);
      expect('email' in avatarPutBody.member).toBe(false);

      const avatarBinRes = await memberAvatarGet(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, {
          headers: { cookie: noPermCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(avatarBinRes.status).toBe(200);
      expect(avatarBinRes.headers.get('content-type')).toBe('image/jpeg');
      expect(avatarBinRes.headers.get('x-content-type-options')).toBe('nosniff');
      expect(avatarBinRes.headers.get('cache-control')).toBe('no-store');
      expect(Buffer.from(await avatarBinRes.arrayBuffer()).equals(jpegBytes)).toBe(true);

      const getWithAvatar = await memberGet(
        new Request(`http://localhost:3000/api/v1/members/${createdId}`, {
          headers: { cookie: basicCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(
        ((await getWithAvatar.json()) as { member: { avatarUrl: string | null } }).member
          .avatarUrl,
      ).toBe(avatarPutBody.member.avatarUrl);

      const listWithAvatar = await membersGet(
        new Request(`http://localhost:3000/api/v1/members?q=${encodeURIComponent(suffix)}`, {
          headers: { cookie: basicCookie },
        }),
      );
      expect(
        ((await listWithAvatar.json()) as {
          items: Array<{ id: string; avatarUrl: string | null }>;
        }).items.find((i) => i.id === createdId)?.avatarUrl,
      ).toBe(avatarPutBody.member.avatarUrl);

      const avatarDelRes = await memberAvatarDelete(
        new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, {
          method: 'DELETE',
          headers: { cookie: hrCookie },
        }),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(avatarDelRes.status).toBe(200);
      const avatarDelBody = (await avatarDelRes.json()) as {
        member: Record<string, unknown> & { avatarUrl: string | null };
      };
      expect(avatarDelBody.member.avatarUrl).toBeNull();
      expect('studentId' in avatarDelBody.member).toBe(false);
      expect(
        (await memberAvatarGet(new Request(`http://localhost:3000/api/v1/members/${createdId}/avatar`, { headers: { cookie: noPermCookie } }), { params: Promise.resolve({ id: createdId }) })).status,
      ).toBe(404);

      // Admin resets Admin password -> 200 MemberDetail with mustChangePassword=true & revokes admin session
      const adminResetSelf = await memberResetPasswordPost(
        new Request(`http://localhost:3000/api/v1/members/${adminId}/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ newPassword: 'ResetByAdmin#2026' }),
        }),
        { params: Promise.resolve({ id: adminId }) },
      );
      expect(adminResetSelf.status).toBe(200);
      const adminResetBody = (await adminResetSelf.json()) as {
        member: Record<string, unknown> & { mustChangePassword: boolean };
      };
      expect(adminResetBody.member.mustChangePassword).toBe(true);
      expect('passwordHash' in adminResetBody.member).toBe(false);
      expect(
        (await sessionGet(new Request('http://localhost:3000/api/v1/auth/session', { headers: { cookie: adminCookie } }))).status,
      ).toBe(401);

      // Custom initialPassword on POST /members lets new user log in and triggers /profile?changePassword=1
      const customPwSid = `MSSV-MCUSTOM-${suffix}`;
      const customCreateRes = await membersPost(
        new Request('http://localhost:3000/api/v1/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: hrCookie },
          body: JSON.stringify({
            studentId: customPwSid,
            email: `custom-init-${suffix}@eiu.edu.vn`,
            fullName: `Custom Init ${suffix}`,
            initialPassword: 'InitialCustom#2026',
          }),
        }),
      );
      expect(customCreateRes.status).toBe(201);
      const customLoginRes = await loginPost(
        new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `198.51.100.${baseHost + 8}`,
          },
          body: JSON.stringify({
            studentId: customPwSid,
            password: 'InitialCustom#2026',
          }),
        }),
      );
      expect(customLoginRes.status).toBe(200);
      expect(
        ((await customLoginRes.json()) as {
          redirectTo: string;
          user: { mustChangePassword: boolean };
        }),
      ).toMatchObject({
        redirectTo: '/profile?changePassword=1',
        user: { mustChangePassword: true },
      });

      // 8. Verify audit_logs and logs contain ZERO studentId, email, password, hash, or binary/dataUrl
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(inArray(auditLogs.targetUserId, [createdId, adminId]));
      expect(
        auditRows
          .filter((r) => r.targetUserId === createdId)
          .map((r) => r.action)
          .sort(),
      ).toEqual([
        'member.activated',
        'member.avatar_removed',
        'member.avatar_updated',
        'member.created',
        'member.deactivated',
        'member.password_reset',
        'member.updated',
      ]);
      const resetAudits = auditRows.filter((r) => r.action === 'member.password_reset');
      expect(resetAudits).toHaveLength(2);
      for (const row of resetAudits) {
        expect(row.detail).toEqual({
          forceChangeOnLogin: true,
          sessionsRevoked: true,
        });
      }

      const serializedAudits = JSON.stringify(auditRows);
      const serializedLogs = capturedLogs.join('\n');
      for (const secretPii of [
        adminSid,
        basicSid,
        hrSid,
        noPermSid,
        detailSid,
        createdSid,
        createdEmail,
        basicEmail,
        DEV_SEED_PASSWORD,
        seedPasswordHash,
        'ResetMemberByAdmin#2026',
        'ResetByAdmin#2026',
        'AttemptAdminReset#2026',
        'AttemptHrMemberReset#2026',
        'InitialCustom#2026',
        jpegDataUrl,
      ]) {
        expect(serializedAudits).not.toContain(secretPii);
        expect(serializedLogs).not.toContain(secretPii);
      }

      // 9. Verify repository maps concurrent FK 23503 on member_departments -> 400 INVALID_DEPARTMENT_IDS
      const directRepo = new DrizzleMembersRepository(tx);
      await expect(
        tx.transaction((subTx) =>
          directRepo.createMember(
            {
              studentId: `MSSV-FK-${suffix}`,
              email: `fk-${suffix}@eiu.edu.vn`,
              fullName: 'FK Race Member',
              passwordHash: seedPasswordHash,
              mustChangePassword: true,
              locale: 'vi',
              departmentIds: [randomUUID()],
              defaultPermissions: [],
              grantedBy: adminId,
              now: new Date(),
            },
            subTx,
          ),
        ),
      ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DEPARTMENT_IDS' });
    });
  });
});
