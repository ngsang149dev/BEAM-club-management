import { asc, eq, inArray, sql } from 'drizzle-orm';
import { clubAssets, loginGalleryItems } from '@db/schema';
import { type DbExecutor, runExecutorQueries } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import type {
  BrandingRepository,
  ClubAssetBinaryRecord,
  ClubAssetMetadataRecord,
  CreateLoginGalleryItemParams,
  GalleryStatsRecord,
  LoginGalleryItemBinaryRecord,
  LoginGalleryItemMetadataRecord,
  UpdateLoginGalleryItemParams,
  UpsertClubAssetParams,
} from './types';

export const CLUB_LOGO_ASSET_KEY = 'club_logo';
export const CLUB_WORDMARK_ASSET_KEY = 'club_wordmark';

const GALLERY_METADATA_SELECT = {
  id: loginGalleryItems.id,
  title: loginGalleryItems.title,
  caption: loginGalleryItems.caption,
  orderIndex: loginGalleryItems.orderIndex,
  updatedAt: loginGalleryItems.updatedAt,
};

function buildGalleryUpdatePatch(input: UpdateLoginGalleryItemParams) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.mimeType !== undefined && input.data !== undefined
      ? { mimeType: input.mimeType, data: input.data }
      : {}),
    updatedBy: input.updatedBy,
    updatedAt: input.now,
  };
}

export class DrizzleBrandingRepository implements BrandingRepository {
  constructor(private readonly db: DbExecutor) {}

  async findMetadataByKey(
    key: string,
    tx?: TransactionContext,
  ): Promise<ClubAssetMetadataRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor
      .select({ key: clubAssets.key, updatedAt: clubAssets.updatedAt })
      .from(clubAssets)
      .where(eq(clubAssets.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async findBrandingAssetsMetadata(tx?: TransactionContext): Promise<{
    readonly logoAsset: ClubAssetMetadataRecord | null;
    readonly wordmarkAsset: ClubAssetMetadataRecord | null;
    readonly galleryItems: LoginGalleryItemMetadataRecord[];
  }> {
    const executor = tx ?? this.db;
    const [assetRows, galleryItems] = await runExecutorQueries(executor, [
      () =>
        executor
          .select({ key: clubAssets.key, updatedAt: clubAssets.updatedAt })
          .from(clubAssets)
          .where(inArray(clubAssets.key, [CLUB_LOGO_ASSET_KEY, CLUB_WORDMARK_ASSET_KEY])),
      () => this.listGalleryItemsMetadata(tx),
    ]);
    return {
      logoAsset: assetRows.find((r) => r.key === CLUB_LOGO_ASSET_KEY) ?? null,
      wordmarkAsset: assetRows.find((r) => r.key === CLUB_WORDMARK_ASSET_KEY) ?? null,
      galleryItems,
    };
  }

  async findAssetByKey(key: string): Promise<ClubAssetBinaryRecord | null> {
    const rows = await this.db
      .select({
        key: clubAssets.key,
        mimeType: clubAssets.mimeType,
        data: clubAssets.data,
        updatedAt: clubAssets.updatedAt,
      })
      .from(clubAssets)
      .where(eq(clubAssets.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertAsset(
    input: UpsertClubAssetParams,
    tx: TransactionContext,
  ): Promise<ClubAssetMetadataRecord> {
    const rows = await tx
      .insert(clubAssets)
      .values({
        key: input.key,
        mimeType: input.mimeType,
        data: input.data,
        updatedBy: input.updatedBy,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: clubAssets.key,
        set: {
          mimeType: input.mimeType,
          data: input.data,
          updatedBy: input.updatedBy,
          updatedAt: input.now,
        },
      })
      .returning({ key: clubAssets.key, updatedAt: clubAssets.updatedAt });
    const saved = rows[0];
    if (!saved) {
      throw new Error('Failed to persist club asset');
    }
    return saved;
  }

  async deleteAssetByKey(key: string, tx: TransactionContext): Promise<boolean> {
    const deleted = await tx
      .delete(clubAssets)
      .where(eq(clubAssets.key, key))
      .returning({ key: clubAssets.key });
    return deleted.length > 0;
  }

  async listGalleryItemsMetadata(
    tx?: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord[]> {
    const executor = tx ?? this.db;
    return executor
      .select(GALLERY_METADATA_SELECT)
      .from(loginGalleryItems)
      .orderBy(asc(loginGalleryItems.orderIndex), asc(loginGalleryItems.id));
  }

  async findGalleryImageById(
    id: string,
  ): Promise<LoginGalleryItemBinaryRecord | null> {
    const rows = await this.db
      .select({
        id: loginGalleryItems.id,
        mimeType: loginGalleryItems.mimeType,
        data: loginGalleryItems.data,
        updatedAt: loginGalleryItems.updatedAt,
      })
      .from(loginGalleryItems)
      .where(eq(loginGalleryItems.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async lockGalleryTable(tx: TransactionContext): Promise<void> {
    // EXCLUSIVE allows concurrent public ACCESS SHARE reads while serializing mutations.
    await tx.execute(sql`LOCK TABLE login_gallery_items IN EXCLUSIVE MODE`);
  }

  async findGalleryStats(tx: TransactionContext): Promise<GalleryStatsRecord> {
    const rows = await tx
      .select({
        count: sql<number>`count(*)::int`,
        maxOrderIndex: sql<number | null>`max(${loginGalleryItems.orderIndex})::int`,
      })
      .from(loginGalleryItems);
    const row = rows[0];
    return {
      count: Number(row?.count ?? 0),
      maxOrderIndex: row?.maxOrderIndex ?? null,
    };
  }

  async insertGalleryItem(
    input: CreateLoginGalleryItemParams,
    tx: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord> {
    const rows = await tx
      .insert(loginGalleryItems)
      .values({
        title: input.title,
        caption: input.caption,
        mimeType: input.mimeType,
        data: input.data,
        orderIndex: input.orderIndex,
        updatedBy: input.updatedBy,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning(GALLERY_METADATA_SELECT);
    const created = rows[0];
    if (!created) {
      throw new Error('Failed to create login gallery item');
    }
    return created;
  }

  async updateGalleryItem(
    input: UpdateLoginGalleryItemParams,
    tx: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord | null> {
    const patch = buildGalleryUpdatePatch(input);
    const rows = await tx
      .update(loginGalleryItems)
      .set(patch)
      .where(eq(loginGalleryItems.id, input.id))
      .returning(GALLERY_METADATA_SELECT);
    return rows[0] ?? null;
  }

  async deleteGalleryItemAndReindex(
    id: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<boolean> {
    const deleted = await tx
      .delete(loginGalleryItems)
      .where(eq(loginGalleryItems.id, id))
      .returning({ id: loginGalleryItems.id });
    if (deleted.length === 0) {
      return false;
    }
    await tx.execute(sql`
      WITH ranked AS (
        SELECT
          id,
          (ROW_NUMBER() OVER (ORDER BY order_index ASC, id ASC) - 1)::integer AS next_order
        FROM login_gallery_items
      )
      UPDATE login_gallery_items AS g
      SET order_index = ranked.next_order,
          updated_at = ${now.toISOString()}::timestamptz
      FROM ranked
      WHERE g.id = ranked.id
        AND g.order_index IS DISTINCT FROM ranked.next_order
    `);
    return true;
  }

  async listGalleryItemIds(tx: TransactionContext): Promise<string[]> {
    const rows = await tx
      .select({ id: loginGalleryItems.id })
      .from(loginGalleryItems)
      .orderBy(asc(loginGalleryItems.orderIndex), asc(loginGalleryItems.id));
    return rows.map((row) => row.id);
  }

  async reorderGalleryItems(
    itemIds: readonly string[],
    updatedBy: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord[]> {
    for (let index = 0; index < itemIds.length; index += 1) {
      const itemId = itemIds[index]!;
      await tx
        .update(loginGalleryItems)
        .set({ orderIndex: index, updatedBy, updatedAt: now })
        .where(eq(loginGalleryItems.id, itemId));
    }
    return this.listGalleryItemsMetadata(tx);
  }
}
