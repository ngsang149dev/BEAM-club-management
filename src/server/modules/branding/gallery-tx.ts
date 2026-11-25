import { notFound } from '@/lib/errors';
import type { ParsedImageAsset } from '@/server/shared/media';
import type { TransactionContext } from '@/server/shared/transaction';
import { type BrandingDto, toBrandingDto } from './mapper';
import {
  assertGalleryCapacity,
  computeNextGalleryOrderIndex,
} from './policy';
import { CLUB_LOGO_ASSET_KEY, CLUB_WORDMARK_ASSET_KEY } from './repository';
import type {
  BrandingRepository,
  BrandingServiceDeps,
  CreateGalleryItemCommand,
  LoginGalleryItemMetadataRecord,
  UpdateGalleryItemCommand,
} from './types';

function buildUpdatedGalleryAuditDetail(
  itemId: string,
  updatedFields: readonly string[],
  parsed: ParsedImageAsset | null,
): Record<string, unknown> {
  return {
    itemId,
    updatedFields: [...updatedFields],
    ...(parsed
      ? { mimeType: parsed.mimeType, byteLength: parsed.buffer.byteLength }
      : {}),
  };
}

export async function loadFullBrandingDto(
  brandingRepo: BrandingRepository,
  tx?: TransactionContext,
): Promise<BrandingDto> {
  const [logoAsset, wordmarkAsset, galleryItems] = await Promise.all([
    brandingRepo.findMetadataByKey(CLUB_LOGO_ASSET_KEY, tx),
    brandingRepo.findMetadataByKey(CLUB_WORDMARK_ASSET_KEY, tx),
    brandingRepo.listGalleryItemsMetadata(tx),
  ]);
  return toBrandingDto({ logoAsset, wordmarkAsset, galleryItems });
}

export async function persistClubAssetInTx(params: {
  readonly deps: Pick<BrandingServiceDeps, 'brandingRepo' | 'auditWriter'>;
  readonly tx: TransactionContext;
  readonly actorId: string;
  readonly assetKey: string;
  readonly auditAction: string;
  readonly parsed: ParsedImageAsset;
  readonly now: Date;
}): Promise<BrandingDto> {
  const { deps, tx, actorId, assetKey, auditAction, parsed, now } = params;
  await deps.brandingRepo.upsertAsset(
    {
      key: assetKey,
      mimeType: parsed.mimeType,
      data: parsed.buffer,
      updatedBy: actorId,
      now,
    },
    tx,
  );
  await deps.auditWriter.record(
    {
      actorId,
      action: auditAction,
      detail: {
        assetKey,
        mimeType: parsed.mimeType,
        byteLength: parsed.buffer.byteLength,
      },
      createdAt: now,
    },
    tx,
  );
  return loadFullBrandingDto(deps.brandingRepo, tx);
}

export async function removeClubAssetInTx(params: {
  readonly deps: Pick<BrandingServiceDeps, 'brandingRepo' | 'auditWriter'>;
  readonly tx: TransactionContext;
  readonly actorId: string;
  readonly assetKey: string;
  readonly auditAction: string;
  readonly now: Date;
}): Promise<BrandingDto> {
  const { deps, tx, actorId, assetKey, auditAction, now } = params;
  await deps.brandingRepo.deleteAssetByKey(assetKey, tx);
  await deps.auditWriter.record(
    {
      actorId,
      action: auditAction,
      detail: { assetKey },
      createdAt: now,
    },
    tx,
  );
  return loadFullBrandingDto(deps.brandingRepo, tx);
}

export async function persistGalleryItemInTx(params: {
  readonly deps: Pick<BrandingServiceDeps, 'brandingRepo' | 'auditWriter'>;
  readonly tx: TransactionContext;
  readonly command: CreateGalleryItemCommand;
  readonly parsed: ParsedImageAsset;
  readonly now: Date;
}): Promise<LoginGalleryItemMetadataRecord> {
  const { deps, tx, command, parsed, now } = params;
  await deps.brandingRepo.lockGalleryTable(tx);
  const stats = await deps.brandingRepo.findGalleryStats(tx);
  assertGalleryCapacity(stats.count);
  const orderIndex = computeNextGalleryOrderIndex(stats.maxOrderIndex);
  const item = await deps.brandingRepo.insertGalleryItem(
    {
      title: command.title,
      caption: command.caption ?? null,
      mimeType: parsed.mimeType,
      data: parsed.buffer,
      orderIndex,
      updatedBy: command.actor.id,
      now,
    },
    tx,
  );
  await deps.auditWriter.record(
    {
      actorId: command.actor.id,
      action: 'branding.gallery_item_created',
      detail: {
        itemId: item.id,
        mimeType: parsed.mimeType,
        byteLength: parsed.buffer.byteLength,
        orderIndex: item.orderIndex,
      },
      createdAt: now,
    },
    tx,
  );
  return item;
}

export async function persistUpdatedGalleryItemInTx(params: {
  readonly deps: Pick<BrandingServiceDeps, 'brandingRepo' | 'auditWriter'>;
  readonly tx: TransactionContext;
  readonly command: UpdateGalleryItemCommand;
  readonly parsed: ParsedImageAsset | null;
  readonly updatedFields: readonly string[];
  readonly now: Date;
}): Promise<LoginGalleryItemMetadataRecord> {
  const { deps, tx, command, parsed, updatedFields, now } = params;
  const item = await deps.brandingRepo.updateGalleryItem(
    {
      id: command.itemId,
      title: command.title,
      caption: command.caption,
      mimeType: parsed?.mimeType,
      data: parsed?.buffer,
      updatedBy: command.actor.id,
      now,
    },
    tx,
  );
  if (!item) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
  await deps.auditWriter.record(
    {
      actorId: command.actor.id,
      action: 'branding.gallery_item_updated',
      detail: buildUpdatedGalleryAuditDetail(
        command.itemId,
        updatedFields,
        parsed,
      ),
      createdAt: now,
    },
    tx,
  );
  return item;
}
