import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  clubAssets,
  permissions,
  profiles,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import {
  DELETE as logoDelete,
  GET as logoGet,
  PUT as logoPut,
} from '@/app/api/v1/branding/logo/route';
import { GET as brandingGet } from '@/app/api/v1/branding/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { MAX_IMAGE_BYTES } from '@/lib/media';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBrandingRepository } from '@/server/modules/branding';
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
const SAMPLE_WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
]);

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

describe('Branding Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for branding integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('serves public branding metadata & binary logo, enforces admin-only PUT/DELETE, validates magic bytes/size, and writes clean audit_logs', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const memberId = randomUUID();
    const adminSid = `MSSV-BR-ADMIN-${suffix}`;
    const memberSid = `MSSV-BR-MEM-${suffix}`;
    const baseHost = Math.floor(Math.random() * 150) + 20;
    const capturedLogs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `branding-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      defaultInitialPassword: DEV_SEED_PASSWORD,
      cronSecret: 'branding-cron-secret',
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
        brandingRepo: new DrizzleBrandingRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => capturedLogs.push(line),
          writeErr: (line) => capturedLogs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([
          { code: 'member.update', groupName: 'members', description: 'U', scopable: false },
          { code: 'member.view', groupName: 'members', description: 'V', scopable: false },
        ])
        .onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `br-admin-${suffix}@eiu.edu.vn`,
          fullName: `Branding Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: memberId,
          studentId: memberSid,
          email: `br-mem-${suffix}@eiu.edu.vn`,
          fullName: `Branding Member ${suffix}`,
          passwordHash: seedPasswordHash,
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
        { userId: memberId, permissionCode: 'member.update', grantedBy: null },
        { userId: memberId, permissionCode: 'member.view', grantedBy: null },
      ]);
      await tx.delete(clubAssets).where(eq(clubAssets.key, 'club_logo'));

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
      const memberCookie = await loginAs(memberSid, 1);

      // 1. Public default state
      const initialMetaRes = await brandingGet(
        new Request('http://localhost:3000/api/v1/branding'),
      );
      expect(initialMetaRes.status).toBe(200);
      expect(initialMetaRes.headers.get('cache-control')).toBe('no-store');
      expect(await initialMetaRes.json()).toEqual({ logoUrl: null, updatedAt: null });

      const missingLogoRes = await logoGet(
        new Request('http://localhost:3000/api/v1/branding/logo'),
      );
      expect(missingLogoRes.status).toBe(404);

      const pngDataUrl = `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`;
      const webpDataUrl = `data:image/webp;base64,${SAMPLE_WEBP_BYTES.toString('base64')}`;

      // 2. Auth & Admin-only enforcement
      expect(
        (
          await logoPut(
            new Request('http://localhost:3000/api/v1/branding/logo', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataUrl: pngDataUrl }),
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await logoDelete(
            new Request('http://localhost:3000/api/v1/branding/logo', { method: 'DELETE' }),
          )
        ).status,
      ).toBe(401);

      expect(
        (
          await logoPut(
            new Request('http://localhost:3000/api/v1/branding/logo', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: memberCookie },
              body: JSON.stringify({ dataUrl: pngDataUrl }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await logoDelete(
            new Request('http://localhost:3000/api/v1/branding/logo', {
              method: 'DELETE',
              headers: { cookie: memberCookie },
            }),
          )
        ).status,
      ).toBe(403);

      // 3. Reject SVG, spoofed MIME, and > 256 KB
      const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString(
        'base64',
      );
      for (const badDataUrl of [
        `data:image/svg+xml;base64,${svgBase64}`,
        `data:image/png;base64,${svgBase64}`,
        `data:image/jpeg;base64,${SAMPLE_PNG_BYTES.toString('base64')}`,
      ]) {
        const res = await logoPut(
          new Request('http://localhost:3000/api/v1/branding/logo', {
            method: 'PUT',
            headers: { 'content-type': 'application/json', cookie: adminCookie },
            body: JSON.stringify({ dataUrl: badDataUrl }),
          }),
        );
        expect(res.status).toBe(400);
      }

      const oversized = Buffer.concat([
        SAMPLE_PNG_BYTES,
        Buffer.alloc(MAX_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x01),
      ]);
      const oversizedRes = await logoPut(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            dataUrl: `data:image/png;base64,${oversized.toString('base64')}`,
          }),
        }),
      );
      expect(oversizedRes.status).toBe(400);

      // 4. Upload PNG, verify public metadata & binary headers, then replace with WEBP
      const putPngRes = await logoPut(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ dataUrl: pngDataUrl }),
        }),
      );
      expect(putPngRes.status).toBe(200);
      const putPngBody = (await putPngRes.json()) as {
        logoUrl: string | null;
        updatedAt: string | null;
      };
      expect(putPngBody.logoUrl).toMatch(/^\/api\/v1\/branding\/logo\?v=\d+$/);
      expect(putPngBody.updatedAt).toBeTruthy();

      const publicMetaAfter = await brandingGet(
        new Request('http://localhost:3000/api/v1/branding'),
      );
      expect(publicMetaAfter.status).toBe(200);
      expect(await publicMetaAfter.json()).toEqual(putPngBody);

      const getPngRes = await logoGet(
        new Request('http://localhost:3000/api/v1/branding/logo'),
      );
      expect(getPngRes.status).toBe(200);
      expect(getPngRes.headers.get('content-type')).toBe('image/png');
      expect(getPngRes.headers.get('x-content-type-options')).toBe('nosniff');
      expect(getPngRes.headers.get('content-security-policy')).toContain(
        "default-src 'none'",
      );
      expect(getPngRes.headers.get('cache-control')).toBe('no-store');
      expect(Buffer.from(await getPngRes.arrayBuffer()).equals(SAMPLE_PNG_BYTES)).toBe(
        true,
      );

      const putWebpRes = await logoPut(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ dataUrl: webpDataUrl }),
        }),
      );
      expect(putWebpRes.status).toBe(200);
      const getWebpRes = await logoGet(
        new Request('http://localhost:3000/api/v1/branding/logo'),
      );
      expect(getWebpRes.status).toBe(200);
      expect(getWebpRes.headers.get('content-type')).toBe('image/webp');
      expect(Buffer.from(await getWebpRes.arrayBuffer()).equals(SAMPLE_WEBP_BYTES)).toBe(
        true,
      );

      // 5. Delete club logo -> resets to null & 404 binary
      const delRes = await logoDelete(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'DELETE',
          headers: { cookie: adminCookie },
        }),
      );
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ logoUrl: null, updatedAt: null });
      expect(
        (await logoGet(new Request('http://localhost:3000/api/v1/branding/logo'))).status,
      ).toBe(404);
      expect(
        await (
          await brandingGet(new Request('http://localhost:3000/api/v1/branding'))
        ).json(),
      ).toEqual({ logoUrl: null, updatedAt: null });

      // 6. Verify audit_logs and logs contain zero binary, base64 dataUrl, or PII
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, adminId));
      expect(auditRows.map((r) => r.action).sort()).toEqual([
        'branding.logo_removed',
        'branding.logo_updated',
        'branding.logo_updated',
      ]);
      const pngAudit = auditRows.find(
        (r) =>
          r.action === 'branding.logo_updated' &&
          (r.detail as { mimeType?: string }).mimeType === 'image/png',
      );
      const removedAudit = auditRows.find((r) => r.action === 'branding.logo_removed');
      expect(pngAudit?.detail).toEqual({
        assetKey: 'club_logo',
        mimeType: 'image/png',
        byteLength: SAMPLE_PNG_BYTES.byteLength,
      });
      expect(removedAudit?.detail).toEqual({ assetKey: 'club_logo' });

      const serializedAudits = JSON.stringify(auditRows);
      const serializedLogs = capturedLogs.join('\n');
      for (const forbidden of [
        pngDataUrl,
        webpDataUrl,
        SAMPLE_PNG_BYTES.toString('base64'),
        adminSid,
        memberSid,
      ]) {
        expect(serializedAudits).not.toContain(forbidden);
        expect(serializedLogs).not.toContain(forbidden);
      }
    });
  });
});
