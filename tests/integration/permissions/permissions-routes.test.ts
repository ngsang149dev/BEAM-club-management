import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as sessionGet } from '@/app/api/v1/auth/session/route';
import { POST as departmentsPost } from '@/app/api/v1/departments/route';
import { GET as meGet } from '@/app/api/v1/me/route';
import { PUT as memberAdminPut } from '@/app/api/v1/members/[id]/admin/route';
import { POST as memberPresetPost } from '@/app/api/v1/members/[id]/permissions/apply-preset/route';
import {
  GET as memberPermsGet,
  PUT as memberPermsPut,
} from '@/app/api/v1/members/[id]/permissions/route';
import { GET as permissionPresetsGet } from '@/app/api/v1/permission-presets/route';
import { GET as permissionsGet } from '@/app/api/v1/permissions/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { PERMISSION_CODES, PERMISSION_PRESETS, PERMISSIONS } from '@/lib/permissions';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { createContainer, setContainerForTesting } from '@/server/shared/composition';
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

async function seedCatalogAndPresets(tx: TransactionContext): Promise<void> {
  await tx
    .insert(permissions)
    .values(
      PERMISSIONS.map((perm) => ({
        code: perm.code,
        groupName: perm.group,
        description: perm.descriptionKey,
        scopable: false,
      })),
    )
    .onConflictDoNothing();

  for (const preset of PERMISSION_PRESETS) {
    const existing = await tx
      .select({ id: permissionPresets.id })
      .from(permissionPresets)
      .where(eq(permissionPresets.code, preset.code))
      .limit(1);
    let presetId = existing[0]?.id;
    if (!presetId) {
      const [inserted] = await tx
        .insert(permissionPresets)
        .values({ code: preset.code, name: preset.code, description: preset.nameKey })
        .returning({ id: permissionPresets.id });
      presetId = inserted!.id;
    }
    await tx
      .insert(presetPermissions)
      .values(preset.permissions.map((permissionCode) => ({ presetId, permissionCode })))
      .onConflictDoNothing();
  }
}

describe('Permissions & Admin Flag Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for permissions integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces 401/403 AC-08, AC-07 immediate session effect, WQ-06 preset replacement, AC-09 last active admin, and AC-10 audit_logs', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const updaterId = randomUUID();
    const targetId = randomUUID();
    const adminSid = `MSSV-PADMIN-${suffix}`;
    const updaterSid = `MSSV-PUPD-${suffix}`;
    const targetSid = `MSSV-PTARG-${suffix}`;
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `perms-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'perms-cron-secret',
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
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);
      await seedCatalogAndPresets(tx);

      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `p-admin-${suffix}@eiu.edu.vn`,
          fullName: `Perm Admin ${suffix}`,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: updaterId,
          studentId: updaterSid,
          email: `p-upd-${suffix}@eiu.edu.vn`,
          fullName: `Perm HR ${suffix}`,
          isAdmin: false,
          isActive: true,
          locale: 'en',
        },
        {
          id: targetId,
          studentId: targetSid,
          email: `p-targ-${suffix}@eiu.edu.vn`,
          fullName: `Perm Target ${suffix}`,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
      ]);
      await tx
        .update(profiles)
        .set({ isAdmin: false })
        .where(and(eq(profiles.isAdmin, true), ne(profiles.id, adminId)));

      await tx.insert(userPermissions).values([
        { userId: updaterId, permissionCode: 'member.view', grantedBy: null },
        { userId: updaterId, permissionCode: 'member.create', grantedBy: null },
        { userId: updaterId, permissionCode: 'member.update', grantedBy: null },
        { userId: targetId, permissionCode: 'department.manage', grantedBy: null },
        { userId: targetId, permissionCode: 'board.create', grantedBy: null },
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
              body: JSON.stringify({ studentId }),
            }),
          ),
        );

      const adminCookie = await loginAs(adminSid, 0);
      const updaterCookie = await loginAs(updaterSid, 1);
      const targetCookie = await loginAs(targetSid, 2);

      // 1. 401 UNAUTHORIZED on all 6 endpoints
      expect((await permissionsGet(new Request('http://localhost:3000/api/v1/permissions'))).status).toBe(401);
      expect((await permissionPresetsGet(new Request('http://localhost:3000/api/v1/permission-presets'))).status).toBe(401);
      expect((await memberPermsGet(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`), { params: Promise.resolve({ id: targetId }) })).status).toBe(401);
      expect((await memberPermsPut(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissionCodes: [] }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(401);
      expect((await memberPresetPost(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions/apply-preset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presetCode: 'basic_member' }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(401);
      expect((await memberAdminPut(new Request(`http://localhost:3000/api/v1/members/${targetId}/admin`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(401);

      // 2. 403 FORBIDDEN for member.update holder (AC-08)
      expect((await permissionsGet(new Request('http://localhost:3000/api/v1/permissions', { headers: { cookie: updaterCookie } }))).status).toBe(403);
      expect((await permissionPresetsGet(new Request('http://localhost:3000/api/v1/permission-presets', { headers: { cookie: updaterCookie } }))).status).toBe(403);
      expect((await memberPermsGet(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`, { headers: { cookie: updaterCookie } }), { params: Promise.resolve({ id: targetId }) })).status).toBe(403);
      expect((await memberPermsPut(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: updaterCookie }, body: JSON.stringify({ permissionCodes: [] }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(403);
      expect((await memberPresetPost(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions/apply-preset`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: updaterCookie }, body: JSON.stringify({ presetCode: 'basic_member' }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(403);
      expect((await memberAdminPut(new Request(`http://localhost:3000/api/v1/members/${targetId}/admin`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: updaterCookie }, body: JSON.stringify({ isAdmin: true }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(403);

      // 3. 400 VALIDATION_ERROR & 404 NOT_FOUND
      const missingId = randomUUID();
      expect((await memberPermsGet(new Request('http://localhost:3000/api/v1/members/not-a-uuid/permissions', { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400);
      expect((await memberPermsPut(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ permissionCodes: ['unknown.perm'] }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(400);
      expect((await memberPresetPost(new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions/apply-preset`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ presetCode: 'unknown_preset' }) }), { params: Promise.resolve({ id: targetId }) })).status).toBe(400);
      expect((await memberPermsGet(new Request(`http://localhost:3000/api/v1/members/${missingId}/permissions`, { headers: { cookie: adminCookie } }), { params: Promise.resolve({ id: missingId }) })).status).toBe(404);
      expect((await memberPermsPut(new Request(`http://localhost:3000/api/v1/members/${missingId}/permissions`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ permissionCodes: [] }) }), { params: Promise.resolve({ id: missingId }) })).status).toBe(404);
      expect((await memberPresetPost(new Request(`http://localhost:3000/api/v1/members/${missingId}/permissions/apply-preset`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ presetCode: 'basic_member' }) }), { params: Promise.resolve({ id: missingId }) })).status).toBe(404);
      expect((await memberAdminPut(new Request(`http://localhost:3000/api/v1/members/${missingId}/admin`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ isAdmin: true }) }), { params: Promise.resolve({ id: missingId }) })).status).toBe(404);

      // 4. Catalog & Presets
      const catalogRes = await permissionsGet(
        new Request('http://localhost:3000/api/v1/permissions', { headers: { cookie: adminCookie } }),
      );
      expect(catalogRes.status).toBe(200);
      const catalogBody = (await catalogRes.json()) as {
        items: Array<{ code: string; groupName: string; description: string; scopable: boolean }>;
      };
      expect(catalogBody.items.map((i) => i.code)).toEqual([...PERMISSION_CODES]);

      const presetsRes = await permissionPresetsGet(
        new Request('http://localhost:3000/api/v1/permission-presets', { headers: { cookie: adminCookie } }),
      );
      expect(presetsRes.status).toBe(200);
      const presetsBody = (await presetsRes.json()) as {
        items: Array<{ code: string; permissionCodes: string[] }>;
      };
      expect(presetsBody.items.map((p) => p.code)).toEqual([
        'basic_member',
        'department_lead',
        'hr_manager',
      ]);

      // 5. AC-07 immediate effect without re-login
      const deptBeforeRes = await departmentsPost(
        new Request('http://localhost:3000/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: targetCookie },
          body: JSON.stringify({ name: `AC07 Dept ${suffix}` }),
        }),
      );
      expect(deptBeforeRes.status).toBe(201);

      const getBeforeRes = await memberPermsGet(
        new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`, {
          headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ id: targetId }) },
      );
      expect(getBeforeRes.status).toBe(200);
      expect(await getBeforeRes.json()).toEqual({
        userId: targetId,
        isAdmin: false,
        permissionCodes: ['department.manage', 'board.create'],
      });

      const putRevokeRes = await memberPermsPut(
        new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ permissionCodes: ['board.create', 'audit.view', 'board.create'] }),
        }),
        { params: Promise.resolve({ id: targetId }) },
      );
      expect(putRevokeRes.status).toBe(200);
      expect(await putRevokeRes.json()).toEqual({
        userId: targetId,
        isAdmin: false,
        permissionCodes: ['board.create', 'audit.view'],
      });

      const sessionAfter = await sessionGet(
        new Request('http://localhost:3000/api/v1/auth/session', { headers: { cookie: targetCookie } }),
      );
      expect(sessionAfter.status).toBe(200);
      expect(((await sessionAfter.json()) as { permissions: string[] }).permissions).toEqual([
        'board.create',
        'audit.view',
      ]);

      const meAfter = await meGet(
        new Request('http://localhost:3000/api/v1/me', { headers: { cookie: targetCookie } }),
      );
      expect(meAfter.status).toBe(200);
      expect(((await meAfter.json()) as { permissions: string[] }).permissions).toEqual([
        'board.create',
        'audit.view',
      ]);

      const deptAfterRes = await departmentsPost(
        new Request('http://localhost:3000/api/v1/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: targetCookie },
          body: JSON.stringify({ name: `AC07 Blocked ${suffix}` }),
        }),
      );
      expect(deptAfterRes.status).toBe(403);

      // 6. WQ-06 Apply preset replaces ALL existing grants
      const presetAppliedRes = await memberPresetPost(
        new Request(`http://localhost:3000/api/v1/members/${targetId}/permissions/apply-preset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ presetCode: 'hr_manager' }),
        }),
        { params: Promise.resolve({ id: targetId }) },
      );
      expect(presetAppliedRes.status).toBe(200);
      expect(await presetAppliedRes.json()).toEqual({
        userId: targetId,
        isAdmin: false,
        permissionCodes: [
          'member.view',
          'member.view_detail',
          'member.create',
          'member.update',
          'member.deactivate',
          'task.update_assigned',
          'comment.create',
        ],
      });

      // 7. AC-09 last active admin 409 + DB trigger + grant/revoke admin flag
      const lastAdminDemoteRes = await memberAdminPut(
        new Request(`http://localhost:3000/api/v1/members/${adminId}/admin`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ isAdmin: false }),
        }),
        { params: Promise.resolve({ id: adminId }) },
      );
      expect(lastAdminDemoteRes.status).toBe(409);
      expect(((await lastAdminDemoteRes.json()) as { error: { code: string } }).error.code).toBe(
        'LAST_ACTIVE_ADMIN',
      );

      // Verify PostgreSQL trigger directly rejects raw SQL demotion of last active admin
      let triggerErr: unknown = null;
      try {
        await tx.transaction((subTx) =>
          subTx.update(profiles).set({ isAdmin: false }).where(eq(profiles.id, adminId)),
        );
      } catch (error) {
        triggerErr = error;
      }
      expect(triggerErr).not.toBeNull();
      let pgCause: unknown = triggerErr;
      for (let i = 0; i < 4 && typeof pgCause === 'object' && pgCause !== null; i += 1) {
        if ('code' in pgCause && typeof (pgCause as { code?: unknown }).code === 'string') break;
        pgCause = (pgCause as { cause?: unknown }).cause;
      }
      expect(pgCause).toMatchObject({
        code: 'P0001',
        hint: 'LAST_ACTIVE_ADMIN',
        message: expect.stringMatching(/last active admin/i),
      });

      const grantAdminRes = await memberAdminPut(
        new Request(`http://localhost:3000/api/v1/members/${targetId}/admin`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ isAdmin: true }),
        }),
        { params: Promise.resolve({ id: targetId }) },
      );
      expect(grantAdminRes.status).toBe(200);
      expect(await grantAdminRes.json()).toEqual({ userId: targetId, isAdmin: true });

      const revokeAdminRes = await memberAdminPut(
        new Request(`http://localhost:3000/api/v1/members/${targetId}/admin`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ isAdmin: false }),
        }),
        { params: Promise.resolve({ id: targetId }) },
      );
      expect(revokeAdminRes.status).toBe(200);
      expect(await revokeAdminRes.json()).toEqual({ userId: targetId, isAdmin: false });

      // 8. Verify AC-10 audit_logs & logs have ZERO PII
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(inArray(auditLogs.targetUserId, [targetId]));
      expect(auditRows.map((row) => row.action).sort()).toEqual([
        'admin.granted',
        'admin.revoked',
        'permissions.preset_applied',
        'permissions.updated',
      ]);
      const serializedAudits = JSON.stringify(auditRows);
      const serializedLogs = logs.join('\n');
      for (const secret of [adminSid, updaterSid, targetSid, `p-admin-${suffix}`, `p-targ-${suffix}`]) {
        expect(serializedAudits).not.toContain(secret);
        expect(serializedLogs).not.toContain(secret);
      }
    });
  });
});
