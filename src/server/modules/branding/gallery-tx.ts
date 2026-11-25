import { notFound } from '@/lib/errors';
import type { ParsedImageAsset } from '@/server/shared/media';
import type { TransactionContext } from '@/server/shared/transaction';
import {
  assertGalleryCapacity,
  computeNextGalleryOrderIndex,
} from './policy';
import { CLUB_LOGO_ASSET_KEY } from './repository';
import type {
  BrandingServiceDeps,
  CreateGalleryItemCommand,
  LoginGalleryItemMetadataRecord,
  UpdateClubLogoCommand,
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

export async function persistClubLogoInTx(params: {
  readonly deps: Pick<BrandingServiceDeps, 'brandingRepo' | 'auditWriter'>;
  readonly tx: TransactionContext;
  readonly command: UpdateClubLogoCommand;
  readonly parsed: ParsedImageAsset;
  readonly now: Date;
}) {
  const { deps, tx, command, parsed, now } = params;
  const record = await deps.brandingRepo.upsertAsset(
    {
      key: CLUB_LOGO_ASSET_KEY,
      mimeType: parsed.mimeType,
      data: parsed.buffer,
      updatedBy: command.actor.id,
      now,
    },
    tx,
  );
  await deps.auditWriter.record(
    {
      actorId: command.actor.id,
      action: 'branding.logo_updated',
      detail: {
        assetKey: CLUB_LOGO_ASSET_KEY,
        mimeType: parsed.mimeType,
        byteLength: parsed.buffer.byteLength,
      },
      createdAt: now,
    },
    tx,
  );
  const galleryItems = await deps.brandingRepo.listGalleryItemsMetadata(tx);
  return { record, galleryItems };
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
