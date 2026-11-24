import { eq } from 'drizzle-orm';
import { clubAssets } from '@db/schema';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';

export const CLUB_LOGO_ASSET_KEY = 'club_logo';

export interface ClubAssetMetadataRecord {
  readonly key: string;
  readonly updatedAt: Date;
}

export interface ClubAssetBinaryRecord {
  readonly key: string;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly updatedAt: Date;
}

export interface UpsertClubAssetParams {
  readonly key: string;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly updatedBy: string;
  readonly now: Date;
}

export interface BrandingRepository {
  findMetadataByKey(key: string): Promise<ClubAssetMetadataRecord | null>;
  findAssetByKey(key: string): Promise<ClubAssetBinaryRecord | null>;
  upsertAsset(
    input: UpsertClubAssetParams,
    tx: TransactionContext,
  ): Promise<ClubAssetMetadataRecord>;
  deleteAssetByKey(key: string, tx: TransactionContext): Promise<boolean>;
}

export class DrizzleBrandingRepository implements BrandingRepository {
  constructor(private readonly db: DbExecutor) {}

  async findMetadataByKey(key: string): Promise<ClubAssetMetadataRecord | null> {
    const rows = await this.db
      .select({ key: clubAssets.key, updatedAt: clubAssets.updatedAt })
      .from(clubAssets)
      .where(eq(clubAssets.key, key))
      .limit(1);
    return rows[0] ?? null;
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
}
