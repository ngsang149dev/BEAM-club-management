import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  clubAssets,
  loginGalleryItems,
  permissions,
  profiles,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as galleryImageGet } from '@/app/api/v1/branding/gallery/[id]/image/route';
import {
  DELETE as galleryItemDelete,
  PATCH as galleryItemPatch,
} from '@/app/api/v1/branding/gallery/[id]/route';
import { PUT as galleryOrderPut } from '@/app/api/v1/branding/gallery/order/route';
import { POST as galleryPost } from '@/app/api/v1/branding/gallery/route';
import {
  DELETE as logoDelete,
  GET as logoGet,
  PUT as logoPut,
} from '@/app/api/v1/branding/logo/route';
import { GET as brandingGet } from '@/app/api/v1/branding/route';
import {
  DELETE as wordmarkDelete,
  GET as wordmarkGet,
  PUT as wordmarkPut,
} from '@/app/api/v1/branding/wordmark/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  MAX_GALLERY_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_LOGIN_GALLERY_ITEMS,
} from '@/lib/media';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import {
  DrizzleBrandingRepository,
  type LoginGalleryItemDto,
} from '@/server/modules/branding';
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
const SAMPLE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
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

function makeTestConfig(suffix: string): Config {
  return {
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

  it('verifies 0006_login_gallery migration, SQL constraints, set_updated_at trigger, and ON DELETE SET NULL', async () => {
    await withRolledBackDb(db, async (tx) => {
      const migResult = await tx.execute(
        sql`SELECT version FROM schema_migrations WHERE version = '0006_login_gallery'`,
      );
      expect(migResult.rows).toHaveLength(1);

      const updaterId = randomUUID();
      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values({
        id: updaterId,
        studentId: `MSSV-LG-REF-${updaterId.slice(0, 8)}`,
        email: `lg-ref-${updaterId.slice(0, 8)}@eiu.edu.vn`,
        fullName: 'Gallery Ref User',
        passwordHash: seedPasswordHash,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      });

      const inserted = await tx
        .insert(loginGalleryItems)
        .values({
          title: 'Trigger Check',
          caption: 'Initial',
          mimeType: 'image/png',
          data: SAMPLE_PNG_BYTES,
          orderIndex: 0,
          updatedBy: updaterId,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        })
        .returning({ id: loginGalleryItems.id, updatedAt: loginGalleryItems.updatedAt });
      const rowId = inserted[0]!.id;

      await tx
        .update(loginGalleryItems)
        .set({ title: 'Trigger Updated' })
        .where(eq(loginGalleryItems.id, rowId));
      const afterUpdate = await tx
        .select({ updatedAt: loginGalleryItems.updatedAt })
        .from(loginGalleryItems)
        .where(eq(loginGalleryItems.id, rowId));
      expect(afterUpdate[0]!.updatedAt.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00.000Z').getTime(),
      );

      // Deleting updater profile sets login_gallery_items.updated_by = NULL cleanly
      await tx.delete(profiles).where(eq(profiles.id, updaterId));
      const afterUserDel = await tx
        .select({ updatedBy: loginGalleryItems.updatedBy })
        .from(loginGalleryItems)
        .where(eq(loginGalleryItems.id, rowId));
      expect(afterUserDel[0]!.updatedBy).toBeNull();

      // DB constraints reject invalid mime_type and > 512 KB bytea
      await expect(
        tx.execute(
          sql`INSERT INTO login_gallery_items (title, mime_type, data, order_index) VALUES ('Bad', 'image/svg+xml', ${SAMPLE_PNG_BYTES}, 1)`,
        ),
      ).rejects.toThrow();

      const tooBig = Buffer.alloc(MAX_GALLERY_IMAGE_BYTES + 1, 0x01);
      await expect(
        tx.execute(
          sql`INSERT INTO login_gallery_items (title, mime_type, data, order_index) VALUES ('Big', 'image/png', ${tooBig}, 1)`,
        ),
      ).rejects.toThrow();
    });
  });

  it('serves public branding metadata & binary logo, preserves galleryItems across logo updates, and enforces admin-only logo routes', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const memberId = randomUUID();
    const adminSid = `MSSV-BR-ADMIN-${suffix}`;
    const memberSid = `MSSV-BR-MEM-${suffix}`;
    const baseHost = Math.floor(Math.random() * 150) + 20;
    const capturedLogs: string[] = [];

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: makeTestConfig(suffix),
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
      await tx
        .delete(clubAssets)
        .where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
      await tx.delete(loginGalleryItems);

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
      expect(await initialMetaRes.json()).toEqual({
        logoUrl: null,
        wordmarkUrl: null,
        updatedAt: null,
        galleryItems: [],
      });

      const missingLogoRes = await logoGet(
        new Request('http://localhost:3000/api/v1/branding/logo'),
      );
      expect(missingLogoRes.status).toBe(404);
      const missingWordmarkRes = await wordmarkGet(
        new Request('http://localhost:3000/api/v1/branding/wordmark'),
      );
      expect(missingWordmarkRes.status).toBe(404);

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

      // Create 1 gallery item to ensure PUT/DELETE /branding/logo preserve galleryItems
      const galleryCreateRes = await galleryPost(
        new Request('http://localhost:3000/api/v1/branding/gallery', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ title: 'Welcome', dataUrl: pngDataUrl }),
        }),
      );
      expect(galleryCreateRes.status).toBe(201);
      const { item: galleryItem } = (await galleryCreateRes.json()) as {
        item: LoginGalleryItemDto;
      };

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
        wordmarkUrl: string | null;
        updatedAt: string | null;
        galleryItems: LoginGalleryItemDto[];
      };
      expect(putPngBody.logoUrl).toMatch(/^\/api\/v1\/branding\/logo\?v=\d+$/);
      expect(putPngBody.wordmarkUrl).toBeNull();
      expect(putPngBody.updatedAt).toBeTruthy();
      expect(putPngBody.galleryItems).toEqual([galleryItem]);

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

      // 5. Delete club logo -> resets to null & 404 binary, preserving galleryItems
      const delRes = await logoDelete(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'DELETE',
          headers: { cookie: adminCookie },
        }),
      );
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({
        logoUrl: null,
        wordmarkUrl: null,
        updatedAt: null,
        galleryItems: [galleryItem],
      });
      expect(
        (await logoGet(new Request('http://localhost:3000/api/v1/branding/logo'))).status,
      ).toBe(404);
      expect(
        await (
          await brandingGet(new Request('http://localhost:3000/api/v1/branding'))
        ).json(),
      ).toEqual({
        logoUrl: null,
        wordmarkUrl: null,
        updatedAt: null,
        galleryItems: [galleryItem],
      });

      // 6. Verify audit_logs and logs contain zero binary, base64 dataUrl, or PII
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, adminId));
      expect(auditRows.map((r) => r.action).sort()).toEqual([
        'branding.gallery_item_created',
        'branding.logo_removed',
        'branding.logo_updated',
        'branding.logo_updated',
      ]);

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

  it('supports login gallery CRUD, reorder, 512 KB cap, 12-item 409 limit, public binary image headers, and clean audit_logs', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const memberId = randomUUID();
    const adminSid = `MSSV-GL-ADMIN-${suffix}`;
    const memberSid = `MSSV-GL-MEM-${suffix}`;
    const baseHost = Math.floor(Math.random() * 150) + 20;
    const capturedLogs: string[] = [];

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: makeTestConfig(suffix),
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
          { code: 'member.view', groupName: 'members', description: 'V', scopable: false },
        ])
        .onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `gl-admin-${suffix}@eiu.edu.vn`,
          fullName: `Gallery Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: memberId,
          studentId: memberSid,
          email: `gl-mem-${suffix}@eiu.edu.vn`,
          fullName: `Gallery Member ${suffix}`,
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
        { userId: memberId, permissionCode: 'member.view', grantedBy: null },
      ]);
      await tx.delete(loginGalleryItems);

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

      const largeValidPng = Buffer.concat([
        SAMPLE_PNG_BYTES,
        Buffer.alloc(320_000 - SAMPLE_PNG_BYTES.length, 0x05),
      ]);
      const largePngDataUrl = `data:image/png;base64,${largeValidPng.toString('base64')}`;
      const jpegDataUrl = `data:image/jpeg;base64,${SAMPLE_JPEG_BYTES.toString('base64')}`;
      const webpDataUrl = `data:image/webp;base64,${SAMPLE_WEBP_BYTES.toString('base64')}`;
      const missingId = randomUUID();

      // 1. Auth & admin-only checks across all gallery write routes
      expect(
        (
          await galleryPost(
            new Request('http://localhost:3000/api/v1/branding/gallery', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title: 'A', dataUrl: jpegDataUrl }),
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await galleryPost(
            new Request('http://localhost:3000/api/v1/branding/gallery', {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: memberCookie },
              body: JSON.stringify({ title: 'A', dataUrl: jpegDataUrl }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await galleryItemPatch(
            new Request(`http://localhost:3000/api/v1/branding/gallery/${missingId}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json', cookie: memberCookie },
              body: JSON.stringify({ title: 'B' }),
            }),
            { params: Promise.resolve({ id: missingId }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await galleryItemDelete(
            new Request(`http://localhost:3000/api/v1/branding/gallery/${missingId}`, {
              method: 'DELETE',
              headers: { cookie: memberCookie },
            }),
            { params: Promise.resolve({ id: missingId }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await galleryOrderPut(
            new Request('http://localhost:3000/api/v1/branding/gallery/order', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: memberCookie },
              body: JSON.stringify({ itemIds: [missingId] }),
            }),
          )
        ).status,
      ).toBe(403);

      // 2. Reject SVG & > 512 KB
      const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString(
        'base64',
      );
      expect(
        (
          await galleryPost(
            new Request('http://localhost:3000/api/v1/branding/gallery', {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: adminCookie },
              body: JSON.stringify({
                title: 'SVG',
                dataUrl: `data:image/svg+xml;base64,${svgBase64}`,
              }),
            }),
          )
        ).status,
      ).toBe(400);

      const over512 = Buffer.concat([
        SAMPLE_PNG_BYTES,
        Buffer.alloc(MAX_GALLERY_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x03),
      ]);
      expect(
        (
          await galleryPost(
            new Request('http://localhost:3000/api/v1/branding/gallery', {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: adminCookie },
              body: JSON.stringify({
                title: 'Too Big',
                dataUrl: `data:image/png;base64,${over512.toString('base64')}`,
              }),
            }),
          )
        ).status,
      ).toBe(400);

      // 3. Create 3 items (320 KB PNG, JPEG, WEBP)
      const createItem = async (payload: {
        title: string;
        caption?: string | null;
        dataUrl: string;
      }) => {
        const res = await galleryPost(
          new Request('http://localhost:3000/api/v1/branding/gallery', {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: adminCookie },
            body: JSON.stringify(payload),
          }),
        );
        expect(res.status).toBe(201);
        return ((await res.json()) as { item: LoginGalleryItemDto }).item;
      };

      const item0 = await createItem({
        title: '  Hackathon 2026  ',
        caption: '  Opening ceremony  ',
        dataUrl: largePngDataUrl,
      });
      const item1 = await createItem({
        title: 'Workshop',
        caption: '   ',
        dataUrl: jpegDataUrl,
      });
      const item2 = await createItem({
        title: 'Demo Day',
        dataUrl: webpDataUrl,
      });

      expect(item0.title).toBe('Hackathon 2026');
      expect(item0.caption).toBe('Opening ceremony');
      expect(item0.orderIndex).toBe(0);
      expect(item1.caption).toBeNull();
      expect(item1.orderIndex).toBe(1);
      expect(item2.orderIndex).toBe(2);

      // 4. Public image endpoint: 400 malformed UUID, 404 missing UUID, 200 binary + CSP/nosniff
      expect(
        (
          await galleryImageGet(
            new Request('http://localhost:3000/api/v1/branding/gallery/not-a-uuid/image'),
            { params: Promise.resolve({ id: 'not-a-uuid' }) },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await galleryImageGet(
            new Request(`http://localhost:3000/api/v1/branding/gallery/${missingId}/image`),
            { params: Promise.resolve({ id: missingId }) },
          )
        ).status,
      ).toBe(404);

      const imgRes = await galleryImageGet(
        new Request(`http://localhost:3000/api/v1/branding/gallery/${item0.id}/image`),
        { params: Promise.resolve({ id: item0.id }) },
      );
      expect(imgRes.status).toBe(200);
      expect(imgRes.headers.get('content-type')).toBe('image/png');
      expect(imgRes.headers.get('x-content-type-options')).toBe('nosniff');
      expect(imgRes.headers.get('content-security-policy')).toBe(
        "default-src 'none'; sandbox",
      );
      expect(imgRes.headers.get('cache-control')).toBe('no-store');
      expect(Buffer.from(await imgRes.arrayBuffer()).equals(largeValidPng)).toBe(true);

      // 5. PATCH update & 404 on missing
      expect(
        (
          await galleryItemPatch(
            new Request(`http://localhost:3000/api/v1/branding/gallery/${missingId}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json', cookie: adminCookie },
              body: JSON.stringify({ title: 'Missing' }),
            }),
            { params: Promise.resolve({ id: missingId }) },
          )
        ).status,
      ).toBe(404);

      const patchRes = await galleryItemPatch(
        new Request(`http://localhost:3000/api/v1/branding/gallery/${item1.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            title: 'Workshop Updated',
            caption: 'Full house',
            dataUrl: webpDataUrl,
          }),
        }),
        { params: Promise.resolve({ id: item1.id }) },
      );
      expect(patchRes.status).toBe(200);
      const patched = ((await patchRes.json()) as { item: LoginGalleryItemDto }).item;
      expect(patched.title).toBe('Workshop Updated');
      expect(patched.caption).toBe('Full house');

      // 6. Reorder validation & success
      const badOrderRes = await galleryOrderPut(
        new Request('http://localhost:3000/api/v1/branding/gallery/order', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ itemIds: [item0.id, item0.id, item2.id] }),
        }),
      );
      expect(badOrderRes.status).toBe(400);
      expect((await badOrderRes.json()).error.code).toBe('INVALID_GALLERY_ORDER');

      const orderRes = await galleryOrderPut(
        new Request('http://localhost:3000/api/v1/branding/gallery/order', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ itemIds: [item2.id, item0.id, item1.id] }),
        }),
      );
      expect(orderRes.status).toBe(200);
      const orderBody = (await orderRes.json()) as { items: LoginGalleryItemDto[] };
      expect(orderBody.items.map((i) => [i.id, i.orderIndex])).toEqual([
        [item2.id, 0],
        [item0.id, 1],
        [item1.id, 2],
      ]);

      // 7. Delete middle item (item0) -> re-normalizes remaining orderIndex to 0..1
      expect(
        (
          await galleryItemDelete(
            new Request(`http://localhost:3000/api/v1/branding/gallery/${missingId}`, {
              method: 'DELETE',
              headers: { cookie: adminCookie },
            }),
            { params: Promise.resolve({ id: missingId }) },
          )
        ).status,
      ).toBe(404);

      const delRes = await galleryItemDelete(
        new Request(`http://localhost:3000/api/v1/branding/gallery/${item0.id}`, {
          method: 'DELETE',
          headers: { cookie: adminCookie },
        }),
        { params: Promise.resolve({ id: item0.id }) },
      );
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ deleted: true, id: item0.id });

      const metaAfterDel = (await (
        await brandingGet(new Request('http://localhost:3000/api/v1/branding'))
      ).json()) as { galleryItems: LoginGalleryItemDto[] };
      expect(metaAfterDel.galleryItems.map((i) => [i.id, i.orderIndex])).toEqual([
        [item2.id, 0],
        [item1.id, 1],
      ]);

      // 8. Fill up to 12 items, then 13th returns 409 GALLERY_LIMIT_REACHED
      for (let i = 2; i < MAX_LOGIN_GALLERY_ITEMS; i += 1) {
        await createItem({ title: `Slide ${i + 1}`, dataUrl: jpegDataUrl });
      }
      const thirteenthRes = await galleryPost(
        new Request('http://localhost:3000/api/v1/branding/gallery', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ title: 'Slide 13', dataUrl: jpegDataUrl }),
        }),
      );
      expect(thirteenthRes.status).toBe(409);
      expect((await thirteenthRes.json()).error.code).toBe('GALLERY_LIMIT_REACHED');

      // 9. Verify audit_logs and logs contain zero binary, base64, or PII
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, adminId));
      const actions = new Set(auditRows.map((r) => r.action));
      expect(actions).toEqual(
        new Set([
          'branding.gallery_item_created',
          'branding.gallery_item_updated',
          'branding.gallery_reordered',
          'branding.gallery_item_deleted',
        ]),
      );

      const serializedAudits = JSON.stringify(auditRows);
      const serializedLogs = capturedLogs.join('\n');
      for (const forbidden of [
        largePngDataUrl,
        jpegDataUrl,
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

  it('serves public wordmark binary, enforces admin-only wordmark routes, preserves logoUrl & galleryItems, and logs clean audit_logs', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const memberId = randomUUID();
    const adminSid = `MSSV-WM-ADMIN-${suffix}`;
    const memberSid = `MSSV-WM-MEM-${suffix}`;
    const baseHost = Math.floor(Math.random() * 150) + 20;
    const capturedLogs: string[] = [];

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: makeTestConfig(suffix),
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
          { code: 'member.view', groupName: 'members', description: 'V', scopable: false },
        ])
        .onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `wm-admin-${suffix}@eiu.edu.vn`,
          fullName: `Wordmark Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: memberId,
          studentId: memberSid,
          email: `wm-mem-${suffix}@eiu.edu.vn`,
          fullName: `Wordmark Member ${suffix}`,
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
        { userId: memberId, permissionCode: 'member.view', grantedBy: null },
      ]);
      await tx
        .delete(clubAssets)
        .where(inArray(clubAssets.key, ['club_logo', 'club_wordmark']));
      await tx.delete(loginGalleryItems);

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
      const pngDataUrl = `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`;
      const webpDataUrl = `data:image/webp;base64,${SAMPLE_WEBP_BYTES.toString('base64')}`;

      // 1. Missing wordmark returns 404; unauthenticated & non-admin mutations return 401/403
      expect(
        (await wordmarkGet(new Request('http://localhost:3000/api/v1/branding/wordmark')))
          .status,
      ).toBe(404);
      expect(
        (
          await wordmarkPut(
            new Request('http://localhost:3000/api/v1/branding/wordmark', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataUrl: pngDataUrl }),
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await wordmarkDelete(
            new Request('http://localhost:3000/api/v1/branding/wordmark', {
              method: 'DELETE',
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await wordmarkPut(
            new Request('http://localhost:3000/api/v1/branding/wordmark', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: memberCookie },
              body: JSON.stringify({ dataUrl: pngDataUrl }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await wordmarkDelete(
            new Request('http://localhost:3000/api/v1/branding/wordmark', {
              method: 'DELETE',
              headers: { cookie: memberCookie },
            }),
          )
        ).status,
      ).toBe(403);

      // 2. Reject SVG & > 256 KB
      const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString(
        'base64',
      );
      expect(
        (
          await wordmarkPut(
            new Request('http://localhost:3000/api/v1/branding/wordmark', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: adminCookie },
              body: JSON.stringify({
                dataUrl: `data:image/svg+xml;base64,${svgBase64}`,
              }),
            }),
          )
        ).status,
      ).toBe(400);

      const oversized = Buffer.concat([
        SAMPLE_PNG_BYTES,
        Buffer.alloc(MAX_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x01),
      ]);
      expect(
        (
          await wordmarkPut(
            new Request('http://localhost:3000/api/v1/branding/wordmark', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: adminCookie },
              body: JSON.stringify({
                dataUrl: `data:image/png;base64,${oversized.toString('base64')}`,
              }),
            }),
          )
        ).status,
      ).toBe(400);

      // 3. Seed logo + gallery item, then upload wordmark & verify preservation
      const galleryRes = await galleryPost(
        new Request('http://localhost:3000/api/v1/branding/gallery', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ title: 'Wordmark Showcase', dataUrl: pngDataUrl }),
        }),
      );
      expect(galleryRes.status).toBe(201);
      const { item: galleryItem } = (await galleryRes.json()) as {
        item: LoginGalleryItemDto;
      };

      const logoRes = await logoPut(
        new Request('http://localhost:3000/api/v1/branding/logo', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ dataUrl: pngDataUrl }),
        }),
      );
      expect(logoRes.status).toBe(200);
      const logoBody = (await logoRes.json()) as {
        logoUrl: string | null;
        wordmarkUrl: string | null;
        updatedAt: string | null;
        galleryItems: LoginGalleryItemDto[];
      };

      const putWordmarkRes = await wordmarkPut(
        new Request('http://localhost:3000/api/v1/branding/wordmark', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ dataUrl: webpDataUrl }),
        }),
      );
      expect(putWordmarkRes.status).toBe(200);
      const putWordmarkBody = (await putWordmarkRes.json()) as typeof logoBody;
      expect(putWordmarkBody.logoUrl).toBe(logoBody.logoUrl);
      expect(putWordmarkBody.updatedAt).toBe(logoBody.updatedAt);
      expect(putWordmarkBody.wordmarkUrl).toMatch(
        /^\/api\/v1\/branding\/wordmark\?v=\d+$/,
      );
      expect(putWordmarkBody.galleryItems).toEqual([galleryItem]);

      const metaRes = await brandingGet(
        new Request('http://localhost:3000/api/v1/branding'),
      );
      expect(metaRes.status).toBe(200);
      expect(await metaRes.json()).toEqual(putWordmarkBody);

      const getWordmarkRes = await wordmarkGet(
        new Request('http://localhost:3000/api/v1/branding/wordmark'),
      );
      expect(getWordmarkRes.status).toBe(200);
      expect(getWordmarkRes.headers.get('content-type')).toBe('image/webp');
      expect(getWordmarkRes.headers.get('x-content-type-options')).toBe('nosniff');
      expect(getWordmarkRes.headers.get('content-security-policy')).toBe(
        "default-src 'none'; sandbox",
      );
      expect(getWordmarkRes.headers.get('cache-control')).toBe('no-store');
      expect(
        Buffer.from(await getWordmarkRes.arrayBuffer()).equals(SAMPLE_WEBP_BYTES),
      ).toBe(true);

      // 4. Delete wordmark -> wordmarkUrl resets to null & GET returns 404, preserving logoUrl & galleryItems
      const delWordmarkRes = await wordmarkDelete(
        new Request('http://localhost:3000/api/v1/branding/wordmark', {
          method: 'DELETE',
          headers: { cookie: adminCookie },
        }),
      );
      expect(delWordmarkRes.status).toBe(200);
      expect(await delWordmarkRes.json()).toEqual({
        logoUrl: logoBody.logoUrl,
        wordmarkUrl: null,
        updatedAt: logoBody.updatedAt,
        galleryItems: [galleryItem],
      });
      expect(
        (await wordmarkGet(new Request('http://localhost:3000/api/v1/branding/wordmark')))
          .status,
      ).toBe(404);

      // 5. Verify audit_logs and logs contain zero binary, base64 dataUrl, or PII
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, adminId));
      expect(auditRows.map((r) => r.action).sort()).toEqual([
        'branding.gallery_item_created',
        'branding.logo_updated',
        'branding.wordmark_removed',
        'branding.wordmark_updated',
      ]);

      const serializedAudits = JSON.stringify(auditRows);
      const serializedLogs = capturedLogs.join('\n');
      for (const forbidden of [
        pngDataUrl,
        webpDataUrl,
        SAMPLE_PNG_BYTES.toString('base64'),
        SAMPLE_WEBP_BYTES.toString('base64'),
        adminSid,
        memberSid,
      ]) {
        expect(serializedAudits).not.toContain(forbidden);
        expect(serializedLogs).not.toContain(forbidden);
      }
    });
  });
});
