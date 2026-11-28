import type { AuditLogWriter } from '@/server/modules/audit';
import type { AuthActor } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

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

export interface LoginGalleryItemMetadataRecord {
  readonly id: string;
  readonly title: string;
  readonly caption: string | null;
  readonly orderIndex: number;
  readonly updatedAt: Date;
}

export interface LoginGalleryItemBinaryRecord {
  readonly id: string;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly updatedAt: Date;
}

export interface GalleryStatsRecord {
  readonly count: number;
  readonly maxOrderIndex: number | null;
}

export interface CreateLoginGalleryItemParams {
  readonly title: string;
  readonly caption: string | null;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly orderIndex: number;
  readonly updatedBy: string;
  readonly now: Date;
}

export interface UpdateLoginGalleryItemParams {
  readonly id: string;
  readonly title?: string;
  readonly caption?: string | null;
  readonly mimeType?: string;
  readonly data?: Buffer;
  readonly updatedBy: string;
  readonly now: Date;
}

export interface BrandingRepository {
  findMetadataByKey(
    key: string,
    tx?: TransactionContext,
  ): Promise<ClubAssetMetadataRecord | null>;
  findBrandingAssetsMetadata?(
    tx?: TransactionContext,
  ): Promise<{
    readonly logoAsset: ClubAssetMetadataRecord | null;
    readonly wordmarkAsset: ClubAssetMetadataRecord | null;
    readonly galleryItems: LoginGalleryItemMetadataRecord[];
  }>;
  findAssetByKey(key: string): Promise<ClubAssetBinaryRecord | null>;
  upsertAsset(
    input: UpsertClubAssetParams,
    tx: TransactionContext,
  ): Promise<ClubAssetMetadataRecord>;
  deleteAssetByKey(key: string, tx: TransactionContext): Promise<boolean>;
  listGalleryItemsMetadata(
    tx?: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord[]>;
  findGalleryImageById(id: string): Promise<LoginGalleryItemBinaryRecord | null>;
  lockGalleryTable(tx: TransactionContext): Promise<void>;
  findGalleryStats(tx: TransactionContext): Promise<GalleryStatsRecord>;
  insertGalleryItem(
    input: CreateLoginGalleryItemParams,
    tx: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord>;
  updateGalleryItem(
    input: UpdateLoginGalleryItemParams,
    tx: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord | null>;
  deleteGalleryItemAndReindex(
    id: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<boolean>;
  listGalleryItemIds(tx: TransactionContext): Promise<string[]>;
  reorderGalleryItems(
    itemIds: readonly string[],
    updatedBy: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<LoginGalleryItemMetadataRecord[]>;
}

export interface BrandingServiceDeps {
  readonly brandingRepo: BrandingRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface UpdateClubLogoCommand {
  readonly actor: AuthActor;
  readonly dataUrl: string;
}

export interface RemoveClubLogoCommand {
  readonly actor: AuthActor;
}

export interface UpdateClubWordmarkCommand {
  readonly actor: AuthActor;
  readonly dataUrl: string;
}

export interface RemoveClubWordmarkCommand {
  readonly actor: AuthActor;
}

export interface CreateGalleryItemCommand {
  readonly actor: AuthActor;
  readonly title: string;
  readonly caption?: string | null;
  readonly dataUrl: string;
}

export interface UpdateGalleryItemCommand {
  readonly actor: AuthActor;
  readonly itemId: string;
  readonly title?: string;
  readonly caption?: string | null;
  readonly dataUrl?: string;
}

export interface DeleteGalleryItemCommand {
  readonly actor: AuthActor;
  readonly itemId: string;
}

export interface ReorderGalleryItemsCommand {
  readonly actor: AuthActor;
  readonly itemIds: readonly string[];
}
