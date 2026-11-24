import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '@/lib/media';
import { PERMISSION_CODES } from '@/lib/permissions';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  type BrandingRepository,
  BrandingService,
  CLUB_LOGO_ASSET_KEY,
  type ClubAssetBinaryRecord,
  type ClubAssetMetadataRecord,
  type UpsertClubAssetParams,
} from '@/server/modules/branding';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type {
  TransactionContext,
  TransactionRunner,
} from '@/server/shared/transaction';

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

const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`;
const SAMPLE_JPEG_DATA_URL = `data:image/jpeg;base64,${SAMPLE_JPEG_BYTES.toString('base64')}`;
const SAMPLE_WEBP_DATA_URL = `data:image/webp;base64,${SAMPLE_WEBP_BYTES.toString('base64')}`;

class InMemoryBrandingRepository implements BrandingRepository {
  readonly assets = new Map<string, ClubAssetBinaryRecord>();

  async findMetadataByKey(key: string): Promise<ClubAssetMetadataRecord | null> {
    const asset = this.assets.get(key);
    return asset ? { key: asset.key, updatedAt: asset.updatedAt } : null;
  }

  async findAssetByKey(key: string): Promise<ClubAssetBinaryRecord | null> {
    return this.assets.get(key) ?? null;
  }

  async upsertAsset(
    input: UpsertClubAssetParams,
  ): Promise<ClubAssetMetadataRecord> {
    const record: ClubAssetBinaryRecord = {
      key: input.key,
      mimeType: input.mimeType,
      data: Buffer.from(input.data),
      updatedAt: input.now,
    };
    this.assets.set(input.key, record);
    return { key: record.key, updatedAt: record.updatedAt };
  }

  async deleteAssetByKey(key: string): Promise<boolean> {
    return this.assets.delete(key);
  }
}

class SpyAuditWriter implements AuditLogWriter {
  readonly entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

const ADMIN_ACTOR: AuthActor = {
  id: '10000000-0000-4000-8000-000000000001',
  isActive: true,
  isAdmin: true,
  permissions: [],
};

const ALL_PERMS_NON_ADMIN: AuthActor = {
  id: '10000000-0000-4000-8000-000000000002',
  isActive: true,
  isAdmin: false,
  permissions: [...PERMISSION_CODES],
};

const INACTIVE_ADMIN: AuthActor = {
  id: '10000000-0000-4000-8000-000000000003',
  isActive: false,
  isAdmin: true,
  permissions: [],
};

function createHarness() {
  const repo = new InMemoryBrandingRepository();
  const auditWriter = new SpyAuditWriter();
  const clock = new FakeClock('2026-11-24T10:00:00.000Z');
  const rawLogs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => rawLogs.push(line),
    writeErr: (line) => rawLogs.push(line),
  });
  const service = new BrandingService({
    brandingRepo: repo,
    auditWriter,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
  });
  return { repo, auditWriter, clock, rawLogs, service };
}

describe('BrandingService', () => {
  it('returns null metadata and 404 binary when club logo is not set', async () => {
    const { service } = createHarness();

    await expect(service.getBranding()).resolves.toEqual({
      logoUrl: null,
      updatedAt: null,
    });
    await expect(service.getClubLogo()).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
  });

  it('enforces admin-only authorization for updateClubLogo and removeClubLogo', async () => {
    const { service, auditWriter } = createHarness();

    await expect(
      service.updateClubLogo({
        actor: ALL_PERMS_NON_ADMIN,
        dataUrl: SAMPLE_PNG_DATA_URL,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.updateClubLogo({
        actor: INACTIVE_ADMIN,
        dataUrl: SAMPLE_PNG_DATA_URL,
      }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });

    await expect(
      service.removeClubLogo({ actor: ALL_PERMS_NON_ADMIN }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.removeClubLogo({ actor: INACTIVE_ADMIN }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });

    expect(auditWriter.entries).toHaveLength(0);
  });

  it('rejects SVG, spoofed MIME headers, and > 256 KB payloads', async () => {
    const { service, auditWriter } = createHarness();
    const svgBase64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ).toString('base64');

    await expect(
      service.updateClubLogo({
        actor: ADMIN_ACTOR,
        dataUrl: `data:image/svg+xml;base64,${svgBase64}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_IMAGE_FORMAT' });

    await expect(
      service.updateClubLogo({
        actor: ADMIN_ACTOR,
        dataUrl: `data:image/png;base64,${svgBase64}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_IMAGE_FORMAT' });

    await expect(
      service.updateClubLogo({
        actor: ADMIN_ACTOR,
        dataUrl: `data:image/jpeg;base64,${SAMPLE_PNG_BYTES.toString('base64')}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_IMAGE_FORMAT' });

    const oversized = Buffer.concat([
      SAMPLE_PNG_BYTES,
      Buffer.alloc(MAX_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x01),
    ]);
    await expect(
      service.updateClubLogo({
        actor: ADMIN_ACTOR,
        dataUrl: `data:image/png;base64,${oversized.toString('base64')}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'IMAGE_TOO_LARGE' });

    expect(auditWriter.entries).toHaveLength(0);
  });

  it('uploads PNG/JPEG/WEBP, removes club logo, writes clean audit_logs, and leaks zero binary/dataUrl', async () => {
    const { service, auditWriter, clock, rawLogs } = createHarness();

    const pngResult = await service.updateClubLogo({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_PNG_DATA_URL,
    });
    expect(pngResult).toEqual({
      logoUrl: `/api/v1/branding/logo?v=${clock.now().getTime()}`,
      updatedAt: '2026-11-24T10:00:00.000Z',
    });
    await expect(service.getBranding()).resolves.toEqual(pngResult);
    const pngBinary = await service.getClubLogo();
    expect(pngBinary.mimeType).toBe('image/png');
    expect(pngBinary.data.equals(SAMPLE_PNG_BYTES)).toBe(true);

    clock.advanceByMs(5_000);
    const jpegResult = await service.updateClubLogo({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_JPEG_DATA_URL,
    });
    expect(jpegResult.logoUrl).toBe(
      `/api/v1/branding/logo?v=${clock.now().getTime()}`,
    );

    clock.advanceByMs(5_000);
    const webpResult = await service.updateClubLogo({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_WEBP_DATA_URL,
    });
    expect(webpResult.logoUrl).toBe(
      `/api/v1/branding/logo?v=${clock.now().getTime()}`,
    );
    const webpBinary = await service.getClubLogo();
    expect(webpBinary.mimeType).toBe('image/webp');
    expect(webpBinary.data.equals(SAMPLE_WEBP_BYTES)).toBe(true);

    clock.advanceByMs(5_000);
    const removed = await service.removeClubLogo({ actor: ADMIN_ACTOR });
    expect(removed).toEqual({ logoUrl: null, updatedAt: null });
    await expect(service.getBranding()).resolves.toEqual({
      logoUrl: null,
      updatedAt: null,
    });
    await expect(service.getClubLogo()).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });

    expect(auditWriter.entries.map((e) => e.action)).toEqual([
      'branding.logo_updated',
      'branding.logo_updated',
      'branding.logo_updated',
      'branding.logo_removed',
    ]);
    expect(auditWriter.entries[0]?.detail).toEqual({
      assetKey: CLUB_LOGO_ASSET_KEY,
      mimeType: 'image/png',
      byteLength: SAMPLE_PNG_BYTES.byteLength,
    });
    expect(auditWriter.entries[3]?.detail).toEqual({
      assetKey: CLUB_LOGO_ASSET_KEY,
    });

    const serializedAudit = JSON.stringify(auditWriter.entries);
    const serializedLogs = JSON.stringify(rawLogs);
    for (const secret of [
      SAMPLE_PNG_DATA_URL,
      SAMPLE_JPEG_DATA_URL,
      SAMPLE_WEBP_DATA_URL,
      SAMPLE_PNG_BYTES.toString('base64'),
    ]) {
      expect(serializedAudit).not.toContain(secret);
      expect(serializedLogs).not.toContain(secret);
    }
  });
});
