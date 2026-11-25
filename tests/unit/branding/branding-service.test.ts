import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_GALLERY_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_LOGIN_GALLERY_ITEMS,
} from '@/lib/media';
import { PERMISSION_CODES } from '@/lib/permissions';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  type BrandingRepository,
  BrandingService,
  CLUB_LOGO_ASSET_KEY,
  CLUB_WORDMARK_ASSET_KEY,
  type ClubAssetBinaryRecord,
  type ClubAssetMetadataRecord,
  type CreateLoginGalleryItemParams,
  type GalleryStatsRecord,
  type LoginGalleryItemBinaryRecord,
  type LoginGalleryItemMetadataRecord,
  type UpdateLoginGalleryItemParams,
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

interface StoredGalleryItem extends LoginGalleryItemMetadataRecord {
  mimeType: string;
  data: Buffer;
}

class InMemoryBrandingRepository implements BrandingRepository {
  readonly assets = new Map<string, ClubAssetBinaryRecord>();
  readonly gallery = new Map<string, StoredGalleryItem>();

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

  async listGalleryItemsMetadata(): Promise<LoginGalleryItemMetadataRecord[]> {
    return [...this.gallery.values()]
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
      .map(({ id, title, caption, orderIndex, updatedAt }) => ({
        id,
        title,
        caption,
        orderIndex,
        updatedAt,
      }));
  }

  async findGalleryImageById(
    id: string,
  ): Promise<LoginGalleryItemBinaryRecord | null> {
    const item = this.gallery.get(id);
    if (!item) return null;
    return {
      id: item.id,
      mimeType: item.mimeType,
      data: item.data,
      updatedAt: item.updatedAt,
    };
  }

  async lockGalleryTable(): Promise<void> {}

  async findGalleryStats(): Promise<GalleryStatsRecord> {
    const values = [...this.gallery.values()];
    if (values.length === 0) {
      return { count: 0, maxOrderIndex: null };
    }
    return {
      count: values.length,
      maxOrderIndex: Math.max(...values.map((v) => v.orderIndex)),
    };
  }

  async insertGalleryItem(
    input: CreateLoginGalleryItemParams,
  ): Promise<LoginGalleryItemMetadataRecord> {
    const id = randomUUID();
    const stored: StoredGalleryItem = {
      id,
      title: input.title,
      caption: input.caption,
      mimeType: input.mimeType,
      data: Buffer.from(input.data),
      orderIndex: input.orderIndex,
      updatedAt: input.now,
    };
    this.gallery.set(id, stored);
    return {
      id: stored.id,
      title: stored.title,
      caption: stored.caption,
      orderIndex: stored.orderIndex,
      updatedAt: stored.updatedAt,
    };
  }

  async updateGalleryItem(
    input: UpdateLoginGalleryItemParams,
  ): Promise<LoginGalleryItemMetadataRecord | null> {
    const existing = this.gallery.get(input.id);
    if (!existing) return null;
    const updated: StoredGalleryItem = {
      ...existing,
      title: input.title ?? existing.title,
      caption: input.caption !== undefined ? input.caption : existing.caption,
      mimeType: input.mimeType ?? existing.mimeType,
      data: input.data ? Buffer.from(input.data) : existing.data,
      updatedAt: input.now,
    };
    this.gallery.set(input.id, updated);
    return {
      id: updated.id,
      title: updated.title,
      caption: updated.caption,
      orderIndex: updated.orderIndex,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteGalleryItemAndReindex(id: string, now: Date): Promise<boolean> {
    if (!this.gallery.delete(id)) return false;
    const remaining = [...this.gallery.values()].sort(
      (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
    );
    remaining.forEach((item, index) => {
      if (item.orderIndex !== index) {
        this.gallery.set(item.id, { ...item, orderIndex: index, updatedAt: now });
      }
    });
    return true;
  }

  async listGalleryItemIds(): Promise<string[]> {
    const items = await this.listGalleryItemsMetadata();
    return items.map((item) => item.id);
  }

  async reorderGalleryItems(
    itemIds: readonly string[],
    _updatedBy: string,
    now: Date,
  ): Promise<LoginGalleryItemMetadataRecord[]> {
    itemIds.forEach((id, index) => {
      const existing = this.gallery.get(id);
      if (existing) {
        this.gallery.set(id, { ...existing, orderIndex: index, updatedAt: now });
      }
    });
    return this.listGalleryItemsMetadata();
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
  it('returns null metadata with empty galleryItems and 404 binary when club logo or wordmark is not set', async () => {
    const { service } = createHarness();

    await expect(service.getBranding()).resolves.toEqual({
      logoUrl: null,
      wordmarkUrl: null,
      updatedAt: null,
      galleryItems: [],
    });
    await expect(service.getClubLogo()).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    await expect(service.getClubWordmark()).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
  });

  it('enforces admin-only authorization for logo, wordmark, and gallery mutations', async () => {
    const { service, auditWriter } = createHarness();
    const fakeId = '20000000-0000-4000-8000-000000000001';

    await expect(
      service.updateClubLogo({ actor: ALL_PERMS_NON_ADMIN, dataUrl: SAMPLE_PNG_DATA_URL }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.updateClubLogo({ actor: INACTIVE_ADMIN, dataUrl: SAMPLE_PNG_DATA_URL }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(
      service.removeClubLogo({ actor: ALL_PERMS_NON_ADMIN }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.removeClubLogo({ actor: INACTIVE_ADMIN }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });

    await expect(
      service.updateClubWordmark({ actor: ALL_PERMS_NON_ADMIN, dataUrl: SAMPLE_PNG_DATA_URL }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.updateClubWordmark({ actor: INACTIVE_ADMIN, dataUrl: SAMPLE_PNG_DATA_URL }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(
      service.removeClubWordmark({ actor: ALL_PERMS_NON_ADMIN }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.removeClubWordmark({ actor: INACTIVE_ADMIN }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });

    await expect(
      service.createGalleryItem({
        actor: ALL_PERMS_NON_ADMIN,
        title: 'Photo',
        dataUrl: SAMPLE_PNG_DATA_URL,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.updateGalleryItem({
        actor: ALL_PERMS_NON_ADMIN,
        itemId: fakeId,
        title: 'Edited',
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.deleteGalleryItem({ actor: ALL_PERMS_NON_ADMIN, itemId: fakeId }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.reorderGalleryItems({ actor: ALL_PERMS_NON_ADMIN, itemIds: [fakeId] }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    expect(auditWriter.entries).toHaveLength(0);
  });

  it('rejects SVG, spoofed MIME headers, and > 256 KB payloads for logo', async () => {
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

  it('uploads PNG/JPEG/WEBP, preserves galleryItems across logo mutations, and leaks zero binary/dataUrl', async () => {
    const { service, auditWriter, clock, rawLogs } = createHarness();

    const created = await service.createGalleryItem({
      actor: ADMIN_ACTOR,
      title: 'Welcome Day',
      caption: 'Club booth',
      dataUrl: SAMPLE_PNG_DATA_URL,
    });

    clock.advanceByMs(1_000);
    const pngResult = await service.updateClubLogo({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_PNG_DATA_URL,
    });
    expect(pngResult).toEqual({
      logoUrl: `/api/v1/branding/logo?v=${clock.now().getTime()}`,
      wordmarkUrl: null,
      updatedAt: clock.now().toISOString(),
      galleryItems: [created.item],
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
    expect(jpegResult.galleryItems).toEqual([created.item]);

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
    expect(removed).toEqual({
      logoUrl: null,
      wordmarkUrl: null,
      updatedAt: null,
      galleryItems: [created.item],
    });
    await expect(service.getBranding()).resolves.toEqual({
      logoUrl: null,
      wordmarkUrl: null,
      updatedAt: null,
      galleryItems: [created.item],
    });
    await expect(service.getClubLogo()).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });

    expect(auditWriter.entries.map((e) => e.action)).toEqual([
      'branding.gallery_item_created',
      'branding.logo_updated',
      'branding.logo_updated',
      'branding.logo_updated',
      'branding.logo_removed',
    ]);
    expect(auditWriter.entries[1]?.detail).toEqual({
      assetKey: CLUB_LOGO_ASSET_KEY,
      mimeType: 'image/png',
      byteLength: SAMPLE_PNG_BYTES.byteLength,
    });
    expect(auditWriter.entries[4]?.detail).toEqual({
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

  it('supports gallery CRUD, 512 KB cap, 12-item 409 limit, reorder validation, and reindexing on delete', async () => {
    const { service, auditWriter, clock, rawLogs } = createHarness();

    // 400 KB PNG (> 256 KB logo limit, <= 512 KB gallery limit) succeeds for gallery
    const largeGalleryBytes = Buffer.concat([
      SAMPLE_PNG_BYTES,
      Buffer.alloc(300_000 - SAMPLE_PNG_BYTES.length, 0x02),
    ]);
    const largeGalleryDataUrl = `data:image/png;base64,${largeGalleryBytes.toString('base64')}`;
    const first = await service.createGalleryItem({
      actor: ADMIN_ACTOR,
      title: 'Frame 1',
      caption: 'Intro',
      dataUrl: largeGalleryDataUrl,
    });
    expect(first.item.orderIndex).toBe(0);
    expect(first.item.imageUrl).toBe(
      `/api/v1/branding/gallery/${first.item.id}/image?v=${clock.now().getTime()}`,
    );

    // > 512 KB rejected
    const overGalleryBytes = Buffer.concat([
      SAMPLE_PNG_BYTES,
      Buffer.alloc(MAX_GALLERY_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x02),
    ]);
    await expect(
      service.createGalleryItem({
        actor: ADMIN_ACTOR,
        title: 'Too Big',
        dataUrl: `data:image/png;base64,${overGalleryBytes.toString('base64')}`,
      }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      code: 'IMAGE_TOO_LARGE',
      details: { maxBytes: MAX_GALLERY_IMAGE_BYTES },
    });

    clock.advanceByMs(1_000);
    const second = await service.createGalleryItem({
      actor: ADMIN_ACTOR,
      title: 'Frame 2',
      dataUrl: SAMPLE_JPEG_DATA_URL,
    });
    expect(second.item.orderIndex).toBe(1);
    expect(second.item.caption).toBeNull();

    clock.advanceByMs(1_000);
    const third = await service.createGalleryItem({
      actor: ADMIN_ACTOR,
      title: 'Frame 3',
      dataUrl: SAMPLE_WEBP_DATA_URL,
    });
    expect(third.item.orderIndex).toBe(2);

    // Update second item (clear caption, change title & image)
    clock.advanceByMs(1_000);
    const updatedSecond = await service.updateGalleryItem({
      actor: ADMIN_ACTOR,
      itemId: second.item.id,
      title: 'Frame 2 Edited',
      caption: null,
      dataUrl: SAMPLE_PNG_DATA_URL,
    });
    expect(updatedSecond.item.title).toBe('Frame 2 Edited');
    expect(updatedSecond.item.caption).toBeNull();
    expect((await service.getGalleryImage(second.item.id)).mimeType).toBe('image/png');

    await expect(
      service.updateGalleryItem({
        actor: ADMIN_ACTOR,
        itemId: '30000000-0000-4000-8000-000000000099',
        title: 'Missing',
      }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    // Reorder validation: duplicates & mismatched set -> 400 INVALID_GALLERY_ORDER
    await expect(
      service.reorderGalleryItems({
        actor: ADMIN_ACTOR,
        itemIds: [first.item.id, first.item.id, third.item.id],
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_GALLERY_ORDER' });
    await expect(
      service.reorderGalleryItems({
        actor: ADMIN_ACTOR,
        itemIds: [first.item.id, second.item.id],
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_GALLERY_ORDER' });

    clock.advanceByMs(1_000);
    const reordered = await service.reorderGalleryItems({
      actor: ADMIN_ACTOR,
      itemIds: [third.item.id, first.item.id, second.item.id],
    });
    expect(reordered.items.map((i) => [i.id, i.orderIndex])).toEqual([
      [third.item.id, 0],
      [first.item.id, 1],
      [second.item.id, 2],
    ]);

    // Delete middle item -> remaining re-indexed 0..1
    clock.advanceByMs(1_000);
    await expect(
      service.deleteGalleryItem({ actor: ADMIN_ACTOR, itemId: first.item.id }),
    ).resolves.toEqual({ deleted: true, id: first.item.id });
    await expect(service.getGalleryImage(first.item.id)).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    await expect(
      service.deleteGalleryItem({ actor: ADMIN_ACTOR, itemId: first.item.id }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    const afterDelete = await service.getBranding();
    expect(afterDelete.galleryItems.map((i) => [i.id, i.orderIndex])).toEqual([
      [third.item.id, 0],
      [second.item.id, 1],
    ]);

    // Fill up to 12 items, then 13th throws 409 GALLERY_LIMIT_REACHED
    for (let i = 2; i < MAX_LOGIN_GALLERY_ITEMS; i += 1) {
      clock.advanceByMs(100);
      await service.createGalleryItem({
        actor: ADMIN_ACTOR,
        title: `Extra ${i + 1}`,
        dataUrl: SAMPLE_PNG_DATA_URL,
      });
    }
    await expect(
      service.createGalleryItem({
        actor: ADMIN_ACTOR,
        title: 'Thirteenth',
        dataUrl: SAMPLE_PNG_DATA_URL,
      }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: 'GALLERY_LIMIT_REACHED',
      details: { maxItems: MAX_LOGIN_GALLERY_ITEMS },
    });

    const serializedAudit = JSON.stringify(auditWriter.entries);
    const serializedLogs = JSON.stringify(rawLogs);
    expect(serializedAudit).not.toContain(largeGalleryDataUrl);
    expect(serializedLogs).not.toContain(largeGalleryDataUrl);
  });

  it('supports wordmark upload/remove, rejects SVG & > 256 KB, preserves logoUrl/galleryItems, and logs clean audit entries', async () => {
    const { service, auditWriter, clock, rawLogs } = createHarness();
    const svgBase64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>BEAM</text></svg>',
    ).toString('base64');

    await expect(
      service.updateClubWordmark({
        actor: ADMIN_ACTOR,
        dataUrl: `data:image/svg+xml;base64,${svgBase64}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_IMAGE_FORMAT' });

    const oversized = Buffer.concat([
      SAMPLE_PNG_BYTES,
      Buffer.alloc(MAX_IMAGE_BYTES + 1 - SAMPLE_PNG_BYTES.length, 0x01),
    ]);
    await expect(
      service.updateClubWordmark({
        actor: ADMIN_ACTOR,
        dataUrl: `data:image/png;base64,${oversized.toString('base64')}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'IMAGE_TOO_LARGE' });

    const created = await service.createGalleryItem({
      actor: ADMIN_ACTOR,
      title: 'Showcase',
      dataUrl: SAMPLE_PNG_DATA_URL,
    });
    clock.advanceByMs(1_000);
    const withLogo = await service.updateClubLogo({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_PNG_DATA_URL,
    });

    clock.advanceByMs(2_000);
    const withWordmark = await service.updateClubWordmark({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_WEBP_DATA_URL,
    });
    expect(withWordmark).toEqual({
      logoUrl: withLogo.logoUrl,
      wordmarkUrl: `/api/v1/branding/wordmark?v=${clock.now().getTime()}`,
      updatedAt: withLogo.updatedAt,
      galleryItems: [created.item],
    });
    await expect(service.getBranding()).resolves.toEqual(withWordmark);
    const wordmarkBinary = await service.getClubWordmark();
    expect(wordmarkBinary.mimeType).toBe('image/webp');
    expect(wordmarkBinary.data.equals(SAMPLE_WEBP_BYTES)).toBe(true);

    // Updating club logo preserves wordmarkUrl
    clock.advanceByMs(3_000);
    const logoUpdated = await service.updateClubLogo({
      actor: ADMIN_ACTOR,
      dataUrl: SAMPLE_JPEG_DATA_URL,
    });
    expect(logoUpdated.wordmarkUrl).toBe(withWordmark.wordmarkUrl);
    expect(logoUpdated.galleryItems).toEqual([created.item]);

    // Removing wordmark preserves logoUrl, updatedAt, and galleryItems
    clock.advanceByMs(4_000);
    const wordmarkRemoved = await service.removeClubWordmark({
      actor: ADMIN_ACTOR,
    });
    expect(wordmarkRemoved).toEqual({
      logoUrl: logoUpdated.logoUrl,
      wordmarkUrl: null,
      updatedAt: logoUpdated.updatedAt,
      galleryItems: [created.item],
    });
    await expect(service.getClubWordmark()).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });

    expect(auditWriter.entries.map((e) => e.action)).toEqual([
      'branding.gallery_item_created',
      'branding.logo_updated',
      'branding.wordmark_updated',
      'branding.logo_updated',
      'branding.wordmark_removed',
    ]);
    expect(auditWriter.entries[2]?.detail).toEqual({
      assetKey: CLUB_WORDMARK_ASSET_KEY,
      mimeType: 'image/webp',
      byteLength: SAMPLE_WEBP_BYTES.byteLength,
    });
    expect(auditWriter.entries[4]?.detail).toEqual({
      assetKey: CLUB_WORDMARK_ASSET_KEY,
    });

    const serializedAudit = JSON.stringify(auditWriter.entries);
    const serializedLogs = JSON.stringify(rawLogs);
    expect(serializedAudit).not.toContain(SAMPLE_WEBP_DATA_URL);
    expect(serializedLogs).not.toContain(SAMPLE_WEBP_DATA_URL);
  });
});
