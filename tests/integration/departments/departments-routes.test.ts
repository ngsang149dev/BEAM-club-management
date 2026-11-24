import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  boards,
  memberDepartments,
  permissions,
  profiles,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import {
  DELETE as departmentDelete,
  PATCH as departmentPatch,
} from '@/app/api/v1/departments/[id]/route';
import {
  GET as departmentsGet,
  POST as departmentsPost,
} from '@/app/api/v1/departments/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
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

describe('Departments Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for departments integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces authz, aggregates memberCount/boardCount, enforces lower(btrim(name)) uniqueness, WQ-10 delete block, and audit_logs', async () => {
    const suffix = randomUUID().slice(0, 8);
    const basicUserId = randomUUID();
    const mgrUserId = randomUUID();
    const basicSid = `MSSV-DBASIC-${suffix}`;
    const mgrSid = `MSSV-DMGR-${suffix}`;
    const testIp = `198.51.100.${Math.floor(Math.random() * 180) + 10}`;
    const logs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `dept-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'dept-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
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
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([
          {
            code: 'member.view',
            groupName: 'members',
            description: 'View',
            scopable: false,
          },
          {
            code: 'department.manage',
            groupName: 'departments',
            description: 'Manage',
            scopable: false,
          },
        ])
        .onConflictDoNothing();

      await tx.insert(profiles).values([
        {
          id: basicUserId,
          studentId: basicSid,
          email: `dept-basic-${suffix}@eiu.edu.vn`,
          fullName: `Dept Basic ${suffix}`,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: mgrUserId,
          studentId: mgrSid,
          email: `dept-mgr-${suffix}@eiu.edu.vn`,
          fullName: `Dept Manager ${suffix}`,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
      ]);

      await tx.insert(userPermissions).values([
        { userId: basicUserId, permissionCode: 'member.view', grantedBy: null },
        { userId: mgrUserId, permissionCode: 'department.manage', grantedBy: null },
      ]);

      const basicCookie = cookiePairFromLogin(
        await loginPost(
          new Request('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
            body: JSON.stringify({ studentId: basicSid }),
          }),
        ),
      );
      const mgrCookie = cookiePairFromLogin(
        await loginPost(
          new Request('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
            body: JSON.stringify({ studentId: mgrSid }),
          }),
        ),
      );

      // Unauthenticated GET/POST/PATCH/DELETE -> 401 UNAUTHORIZED
      const unauthGet = await departmentsGet(
        new Request('http://localhost:3000/api/v1/departments'),
      );
      expect(unauthGet.status).toBe(401);
      expect(((await unauthGet.json()) as { error: { code: string } }).error.code).toBe(
        'UNAUTHORIZED',
      );
      const unauthPost = await departmentsPost(
        new Request('http://localhost:3000/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `Dept Unauth ${suffix}` }),
        }),
      );
      expect(unauthPost.status).toBe(401);
      expect(((await unauthPost.json()) as { error: { code: string } }).error.code).toBe(
        'UNAUTHORIZED',
      );

      // Basic member cannot POST department -> 403 FORBIDDEN
      const forbiddenPost = await departmentsPost(
        new Request('http://localhost:3000/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: basicCookie },
          body: JSON.stringify({ name: `Dept One ${suffix}` }),
        }),
      );
      expect(forbiddenPost.status).toBe(403);
      expect(((await forbiddenPost.json()) as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN',
      );

      // Manager creates department -> 201
      const deptName = `Dept Alpha ${suffix}`;
      const createRes = await departmentsPost(
        new Request('http://localhost:3000/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: mgrCookie },
          body: JSON.stringify({ name: deptName }),
        }),
      );
      expect(createRes.status).toBe(201);
      const createdBody = (await createRes.json()) as {
        department: { id: string; name: string; memberCount: number; boardCount: number };
      };
      expect(createdBody.department.name).toBe(deptName);
      const deptId = createdBody.department.id;

      // Case-insensitive & trimmed duplicate -> 409 DEPARTMENT_NAME_EXISTS
      const dupRes = await departmentsPost(
        new Request('http://localhost:3000/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: mgrCookie },
          body: JSON.stringify({ name: `  ${deptName.toLowerCase()}  ` }),
        }),
      );
      expect(dupRes.status).toBe(409);
      expect(((await dupRes.json()) as { error: { code: string } }).error.code).toBe(
        'DEPARTMENT_NAME_EXISTS',
      );

      // Link 2 members and 1 board -> verify exact counts via basic user's GET /departments
      await tx.insert(memberDepartments).values([
        { userId: basicUserId, departmentId: deptId },
        { userId: mgrUserId, departmentId: deptId },
      ]);
      const boardId = randomUUID();
      await tx.insert(boards).values({
        id: boardId,
        name: `Dept Board ${suffix}`,
        departmentId: deptId,
        createdBy: mgrUserId,
      });

      const listRes = await departmentsGet(
        new Request('http://localhost:3000/api/v1/departments', {
          headers: { cookie: basicCookie },
        }),
      );
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        items: Array<{ id: string; memberCount: number; boardCount: number }>;
      };
      const target = listBody.items.find((d) => d.id === deptId);
      expect(target).toMatchObject({ id: deptId, memberCount: 2, boardCount: 1 });

      // Rename with malformed UUID -> 400, missing UUID -> 404, valid -> 200
      const badUuidPatch = await departmentPatch(
        new Request('http://localhost:3000/api/v1/departments/not-a-uuid', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: mgrCookie },
          body: JSON.stringify({ name: 'Ignored' }),
        }),
        { params: Promise.resolve({ id: 'not-a-uuid' }) },
      );
      expect(badUuidPatch.status).toBe(400);

      const missingPatch = await departmentPatch(
        new Request(`http://localhost:3000/api/v1/departments/${randomUUID()}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: mgrCookie },
          body: JSON.stringify({ name: `Missing ${suffix}` }),
        }),
        { params: Promise.resolve({ id: randomUUID() }) },
      );
      expect(missingPatch.status).toBe(404);

      const unauthPatch = await departmentPatch(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `Unauth ${suffix}` }),
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(unauthPatch.status).toBe(401);

      const forbiddenPatch = await departmentPatch(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: basicCookie },
          body: JSON.stringify({ name: `Forbidden ${suffix}` }),
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(forbiddenPatch.status).toBe(403);
      expect(((await forbiddenPatch.json()) as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN',
      );

      const unauthDelete = await departmentDelete(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'DELETE',
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(unauthDelete.status).toBe(401);

      const forbiddenDelete = await departmentDelete(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'DELETE',
          headers: { cookie: basicCookie },
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(forbiddenDelete.status).toBe(403);
      expect(((await forbiddenDelete.json()) as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN',
      );

      const renamedName = `Dept Renamed ${suffix}`;
      const renameRes = await departmentPatch(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: mgrCookie },
          body: JSON.stringify({ name: renamedName }),
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(renameRes.status).toBe(200);
      expect(
        ((await renameRes.json()) as { department: { name: string; memberCount: number } })
          .department,
      ).toMatchObject({ name: renamedName, memberCount: 2 });

      // Delete while non-empty -> 409 DEPARTMENT_IN_USE (WQ-10)
      const deleteBusyRes = await departmentDelete(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'DELETE',
          headers: { cookie: mgrCookie },
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(deleteBusyRes.status).toBe(409);
      expect(
        ((await deleteBusyRes.json()) as { error: { code: string } }).error.code,
      ).toBe('DEPARTMENT_IN_USE');

      // Remove linked members & board -> DELETE succeeds
      await tx.delete(boards).where(eq(boards.id, boardId));
      await tx
        .delete(memberDepartments)
        .where(eq(memberDepartments.departmentId, deptId));

      const deleteOkRes = await departmentDelete(
        new Request(`http://localhost:3000/api/v1/departments/${deptId}`, {
          method: 'DELETE',
          headers: { cookie: mgrCookie },
        }),
        { params: Promise.resolve({ id: deptId }) },
      );
      expect(deleteOkRes.status).toBe(200);
      expect(await deleteOkRes.json()).toEqual({ deleted: true, id: deptId });

      // Verify audit_logs entries
      const writtenAudits = await tx
        .select()
        .from(auditLogs)
        .where(inArray(auditLogs.actorId, [mgrUserId]));
      expect(writtenAudits.map((row) => row.action).sort()).toEqual([
        'department.created',
        'department.deleted',
        'department.updated',
      ]);
      expect(logs.join('\n')).not.toContain(mgrSid);
    });
  });
});
