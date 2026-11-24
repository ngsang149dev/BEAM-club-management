import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  departments,
  memberDepartments,
  permissions,
  profiles,
  userPermissions,
} from '@db/schema';
import { GET as auditLogsGet } from '@/app/api/v1/audit-logs/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { createContainer, setContainerForTesting } from '@/server/shared/composition';
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
    if (!(error instanceof TestRollbackSentinel)) throw error;
  }
}

function cookiePairFromLogin(res: Response): string {
  const line = res.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(line).toBeDefined();
  return line!.split(';')[0]!;
}

describe('Audit Logs Route Handler integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for audit integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces 401/403, filters, cursor pagination with tie-break, date range validation, and zero PII', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const auditViewerId = randomUUID();
    const noPermId = randomUUID();
    const leftTargetId = randomUUID();
    const deptId = randomUUID();

    const adminSid = `MSSV-AADMIN-${suffix}`;
    const viewerSid = `MSSV-AVIEW-${suffix}`;
    const noPermSid = `MSSV-ANONE-${suffix}`;
    const leftSid = `MSSV-ALEFT-${suffix}`;
    const adminEmail = `a-admin-${suffix}@eiu.edu.vn`;
    const viewerEmail = `a-view-${suffix}@eiu.edu.vn`;
    const leftEmail = `a-left-${suffix}@eiu.edu.vn`;
    const baseHost = Math.floor(Math.random() * 140) + 10;

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `audit-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'audit-cron-secret',
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
        auditRepo: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
        departmentsRepo: new DrizzleDepartmentsRepository(tx),
        membersRepo: new DrizzleMembersRepository(tx),
        permissionsRepo: new DrizzlePermissionsRepository(tx),
        logger: new StructuredLogger({ writeOut: () => undefined, writeErr: () => undefined }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([
          { code: 'member.view', groupName: 'members', description: 'V', scopable: false },
          { code: 'audit.view', groupName: 'system', description: 'A', scopable: false },
        ])
        .onConflictDoNothing();

      await tx.insert(departments).values({ id: deptId, name: `Audit Dept ${suffix}` });
      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: adminEmail,
          fullName: `Audit Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: auditViewerId,
          studentId: viewerSid,
          email: viewerEmail,
          fullName: `Audit Viewer ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
        {
          id: noPermId,
          studentId: noPermSid,
          email: `a-none-${suffix}@eiu.edu.vn`,
          fullName: `Audit NoPerm ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: leftTargetId,
          studentId: leftSid,
          email: leftEmail,
          fullName: `Audit Left ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: false,
          leftAt: new Date('2026-11-10T00:00:00.000Z'),
          locale: 'vi',
        },
      ]);
      await tx.insert(memberDepartments).values([
        { userId: adminId, departmentId: deptId },
        { userId: leftTargetId, departmentId: deptId },
      ]);
      await tx.insert(userPermissions).values([
        { userId: auditViewerId, permissionCode: 'audit.view', grantedBy: null },
        { userId: noPermId, permissionCode: 'member.view', grantedBy: null },
      ]);

      const loginAs = async (studentId: string, hostOffset: number) =>
        cookiePairFromLogin(
          await loginPost(
            new Request('http://localhost:3000/api/v1/auth/login', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-forwarded-for': `198.51.100.${baseHost + hostOffset}`,
              },
              body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
            }),
          ),
        );

      const adminCookie = await loginAs(adminSid, 0);
      const viewerCookie = await loginAs(viewerSid, 1);
      const noPermCookie = await loginAs(noPermSid, 2);

      // Insert 4 synthetic audit logs with identical tie timestamp + distinct timestamps
      const t1 = new Date('2026-11-24T01:00:00.000Z');
      const t2 = new Date('2026-11-24T02:00:00.000Z');
      const t3 = new Date('2026-11-24T03:00:00.000Z');
      const tieAId = `${suffix}-0000-4000-8000-00000000000a`;
      const tieBId = `${suffix}-0000-4000-8000-00000000000b`;
      const row3Id = `${suffix}-0000-4000-8000-00000000000c`;
      const row4Id = `${suffix}-0000-4000-8000-00000000000d`;

      await tx.insert(auditLogs).values([
        {
          id: tieAId,
          actorId: adminId,
          targetUserId: leftTargetId,
          action: 'permissions.updated',
          detail: { added: ['board.create'], removed: [], totalCount: 1 },
          createdAt: t1,
        },
        {
          id: tieBId,
          actorId: adminId,
          targetUserId: null,
          action: 'department.created',
          detail: { name: `Audit Dept ${suffix}` },
          createdAt: t1,
        },
        {
          id: row3Id,
          actorId: auditViewerId,
          targetUserId: leftTargetId,
          action: 'permissions.preset_applied',
          detail: { presetCode: 'basic_member', added: [], removed: [] },
          createdAt: t2,
        },
        {
          id: row4Id,
          actorId: adminId,
          targetUserId: leftTargetId,
          action: 'admin.granted',
          // Simulate raw DB jsonb holding accidental email to verify read-time scrubbing
          detail: { isAdmin: true, studentId: leftSid, email: leftEmail, rawText: leftEmail },
          createdAt: t3,
        },
      ]);

      // 1. 401 & 403 & 400 validation errors
      expect((await auditLogsGet(new Request('http://localhost:3000/api/v1/audit-logs'))).status).toBe(401);
      expect(
        (await auditLogsGet(new Request('http://localhost:3000/api/v1/audit-logs?from=2026-11-24T12:00:00Z&to=2026-11-24T01:00:00Z'))).status,
      ).toBe(401);

      const forbiddenRes = await auditLogsGet(
        new Request('http://localhost:3000/api/v1/audit-logs', { headers: { cookie: noPermCookie } }),
      );
      expect(forbiddenRes.status).toBe(403);

      const badRangeRes = await auditLogsGet(
        new Request(
          'http://localhost:3000/api/v1/audit-logs?from=2026-11-24T12:00:00Z&to=2026-11-24T01:00:00Z',
          { headers: { cookie: viewerCookie } },
        ),
      );
      expect(badRangeRes.status).toBe(400);
      expect(((await badRangeRes.json()) as { error: { code: string } }).error.code).toBe(
        'INVALID_DATE_RANGE',
      );

      const badCursorRes = await auditLogsGet(
        new Request('http://localhost:3000/api/v1/audit-logs?cursor=tampered', {
          headers: { cookie: viewerCookie },
        }),
      );
      expect(badCursorRes.status).toBe(400);
      expect(((await badCursorRes.json()) as { error: { code: string } }).error.code).toBe(
        'INVALID_CURSOR',
      );

      const badActorFilterRes = await auditLogsGet(
        new Request('http://localhost:3000/api/v1/audit-logs?actorId=not-a-uuid', {
          headers: { cookie: viewerCookie },
        }),
      );
      expect(badActorFilterRes.status).toBe(400);
      expect(((await badActorFilterRes.json()) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_ERROR',
      );

      // 2. Cursor pagination & PublicSummary + zero PII across all 4 rows bounded by [t1, t3]
      const rangeQuery = `from=${encodeURIComponent(t1.toISOString())}&to=${encodeURIComponent(t3.toISOString())}&limit=2`;
      const page1Res = await auditLogsGet(
        new Request(`http://localhost:3000/api/v1/audit-logs?${rangeQuery}`, {
          headers: { cookie: viewerCookie },
        }),
      );
      expect(page1Res.status).toBe(200);
      const page1Body = (await page1Res.json()) as {
        items: Array<{
          id: string;
          action: string;
          actor: Record<string, unknown>;
          targetUser: Record<string, unknown> | null;
          detail: Record<string, unknown>;
        }>;
        meta: { nextCursor: string | null; limit: number };
      };
      expect(page1Body.items.map((i) => i.id)).toEqual([row4Id, row3Id]);
      expect(page1Body.meta.nextCursor).toBeTruthy();

      // Verify zero PII & strict MemberPublicSummary keys
      expect(Object.keys(page1Body.items[0]!.actor).sort()).toEqual([
        'departments',
        'fullName',
        'id',
        'isActive',
        'leftAt',
      ]);
      expect(page1Body.items[0]!.targetUser).toMatchObject({
        id: leftTargetId,
        isActive: false,
        leftAt: '2026-11-10T00:00:00.000Z',
        departments: [{ id: deptId, name: `Audit Dept ${suffix}` }],
      });
      expect(page1Body.items[0]!.detail).toEqual({
        isAdmin: true,
        studentId: '[REDACTED]',
        email: '[REDACTED]',
        rawText: '[REDACTED_EMAIL]',
      });

      const page2Res = await auditLogsGet(
        new Request(
          `http://localhost:3000/api/v1/audit-logs?${rangeQuery}&cursor=${encodeURIComponent(page1Body.meta.nextCursor!)}`,
          { headers: { cookie: viewerCookie } },
        ),
      );
      expect(page2Res.status).toBe(200);
      const page2Body = (await page2Res.json()) as {
        items: Array<{ id: string; targetUser: unknown }>;
        meta: { nextCursor: string | null };
      };
      // Identical createdAt t1 breaks tie deterministically by id DESC (tieBId > tieAId)
      expect(page2Body.items.map((i) => i.id)).toEqual([tieBId, tieAId]);
      expect(page2Body.items[0]!.targetUser).toBeNull();
      expect(page2Body.meta.nextCursor).toBeNull();

      // 3. Filters: actorId, targetUserId, action (admin access)
      const filteredRes = await auditLogsGet(
        new Request(
          `http://localhost:3000/api/v1/audit-logs?actorId=${adminId}&targetUserId=${leftTargetId}&action=permissions.updated`,
          { headers: { cookie: adminCookie } },
        ),
      );
      expect(filteredRes.status).toBe(200);
      const filteredBody = (await filteredRes.json()) as { items: Array<{ id: string }> };
      expect(filteredBody.items.map((i) => i.id)).toEqual([tieAId]);

      const serialized = JSON.stringify([page1Body, page2Body, filteredBody]);
      for (const secret of [adminSid, viewerSid, noPermSid, leftSid, adminEmail, viewerEmail, leftEmail]) {
        expect(serialized).not.toContain(secret);
      }
    });
  });
});
