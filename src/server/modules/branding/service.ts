import { badRequest, notFound } from '@/lib/errors';
import { MAX_GALLERY_IMAGE_BYTES } from '@/lib/media';
import { authorizeAdmin } from '@/server/shared/authorize';
import { parseAndValidateImageDataUrl } from '@/server/shared/media';
import {
  persistClubLogoInTx,
  persistGalleryItemInTx,
  persistUpdatedGalleryItemInTx,
} from './gallery-tx';
import {
  type BrandingDto,
  type DeleteLoginGalleryItemResponseDto,
  type LoginGalleryItemResponseDto,
  type LoginGalleryListResponseDto,
  toBrandingDto,
  toLoginGalleryItemDto,
} from './mapper';
import {
  assertExactGalleryOrderIds,
  collectUpdatedGalleryFields,
} from './policy';
import { CLUB_LOGO_ASSET_KEY } from './repository';
import type {
  BrandingServiceDeps,
  CreateGalleryItemCommand,
  DeleteGalleryItemCommand,
  LoginGalleryItemBinaryRecord,
  RemoveClubLogoCommand,
  ReorderGalleryItemsCommand,
  UpdateClubLogoCommand,
  UpdateGalleryItemCommand,
} from './types';

export class BrandingService {
  constructor(private readonly deps: BrandingServiceDeps) {}

  async getBranding(): Promise<BrandingDto> {
    const [asset, galleryItems] = await Promise.all([
      this.deps.brandingRepo.findMetadataByKey(CLUB_LOGO_ASSET_KEY),
      this.deps.brandingRepo.listGalleryItemsMetadata(),
    ]);
    return toBrandingDto(asset, galleryItems);
  }

  async getClubLogo() {
    const asset = await this.deps.brandingRepo.findAssetByKey(CLUB_LOGO_ASSET_KEY);
    if (!asset) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return asset;
  }

  async getGalleryImage(id: string): Promise<LoginGalleryItemBinaryRecord> {
    const asset = await this.deps.brandingRepo.findGalleryImageById(id);
    if (!asset) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return asset;
  }

  async updateClubLogo(command: UpdateClubLogoCommand): Promise<BrandingDto> {
    authorizeAdmin(command.actor);
    const parsed = parseAndValidateImageDataUrl(command.dataUrl);
    const now = this.deps.clock.now();

    const { record, galleryItems } =
      await this.deps.transactionRunner.runInTransaction((tx) =>
        persistClubLogoInTx({ deps: this.deps, tx, command, parsed, now }),
      );

    this.deps.logger.info('Club logo updated', {
      actorId: command.actor.id,
      assetKey: CLUB_LOGO_ASSET_KEY,
      mimeType: parsed.mimeType,
      byteLength: parsed.buffer.byteLength,
    });
    return toBrandingDto(record, galleryItems);
  }

  async removeClubLogo(command: RemoveClubLogoCommand): Promise<BrandingDto> {
    authorizeAdmin(command.actor);
    const now = this.deps.clock.now();

    const galleryItems = await this.deps.transactionRunner.runInTransaction(
      async (tx) => {
        await this.deps.brandingRepo.deleteAssetByKey(CLUB_LOGO_ASSET_KEY, tx);
        await this.deps.auditWriter.record(
          {
            actorId: command.actor.id,
            action: 'branding.logo_removed',
            detail: { assetKey: CLUB_LOGO_ASSET_KEY },
            createdAt: now,
          },
          tx,
        );
        return this.deps.brandingRepo.listGalleryItemsMetadata(tx);
      },
    );

    this.deps.logger.info('Club logo removed', {
      actorId: command.actor.id,
      assetKey: CLUB_LOGO_ASSET_KEY,
    });
    return toBrandingDto(null, galleryItems);
  }

  async createGalleryItem(
    command: CreateGalleryItemCommand,
  ): Promise<LoginGalleryItemResponseDto> {
    authorizeAdmin(command.actor);
    const parsed = parseAndValidateImageDataUrl(
      command.dataUrl,
      MAX_GALLERY_IMAGE_BYTES,
    );
    const now = this.deps.clock.now();

    const created = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistGalleryItemInTx({ deps: this.deps, tx, command, parsed, now }),
    );

    this.deps.logger.info('Login gallery item created', {
      actorId: command.actor.id,
      itemId: created.id,
      mimeType: parsed.mimeType,
      byteLength: parsed.buffer.byteLength,
      orderIndex: created.orderIndex,
    });
    return { item: toLoginGalleryItemDto(created) };
  }

  async updateGalleryItem(
    command: UpdateGalleryItemCommand,
  ): Promise<LoginGalleryItemResponseDto> {
    authorizeAdmin(command.actor);
    const parsed =
      command.dataUrl !== undefined
        ? parseAndValidateImageDataUrl(command.dataUrl, MAX_GALLERY_IMAGE_BYTES)
        : null;
    const updatedFields = collectUpdatedGalleryFields({
      title: command.title,
      caption: command.caption,
      hasImage: parsed !== null,
    });
    if (updatedFields.length === 0) {
      throw badRequest('errors.validation', {}, 'VALIDATION_ERROR');
    }
    const now = this.deps.clock.now();

    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistUpdatedGalleryItemInTx({
        deps: this.deps,
        tx,
        command,
        parsed,
        updatedFields,
        now,
      }),
    );

    this.deps.logger.info('Login gallery item updated', {
      actorId: command.actor.id,
      itemId: command.itemId,
      updatedFields,
    });
    return { item: toLoginGalleryItemDto(updated) };
  }

  async deleteGalleryItem(
    command: DeleteGalleryItemCommand,
  ): Promise<DeleteLoginGalleryItemResponseDto> {
    authorizeAdmin(command.actor);
    const now = this.deps.clock.now();

    await this.deps.transactionRunner.runInTransaction(async (tx) => {
      await this.deps.brandingRepo.lockGalleryTable(tx);
      const deleted = await this.deps.brandingRepo.deleteGalleryItemAndReindex(
        command.itemId,
        now,
        tx,
      );
      if (!deleted) {
        throw notFound('errors.notFound', {}, 'NOT_FOUND');
      }
      await this.deps.auditWriter.record(
        {
          actorId: command.actor.id,
          action: 'branding.gallery_item_deleted',
          detail: { itemId: command.itemId },
          createdAt: now,
        },
        tx,
      );
    });

    this.deps.logger.info('Login gallery item deleted', {
      actorId: command.actor.id,
      itemId: command.itemId,
    });
    return { deleted: true, id: command.itemId };
  }

  async reorderGalleryItems(
    command: ReorderGalleryItemsCommand,
  ): Promise<LoginGalleryListResponseDto> {
    authorizeAdmin(command.actor);
    const now = this.deps.clock.now();

    const items = await this.deps.transactionRunner.runInTransaction(
      async (tx) => {
        await this.deps.brandingRepo.lockGalleryTable(tx);
        const existingIds = await this.deps.brandingRepo.listGalleryItemIds(tx);
        assertExactGalleryOrderIds(command.itemIds, existingIds);
        const reordered = await this.deps.brandingRepo.reorderGalleryItems(
          command.itemIds,
          command.actor.id,
          now,
          tx,
        );
        await this.deps.auditWriter.record(
          {
            actorId: command.actor.id,
            action: 'branding.gallery_reordered',
            detail: { itemIds: [...command.itemIds] },
            createdAt: now,
          },
          tx,
        );
        return reordered;
      },
    );

    this.deps.logger.info('Login gallery reordered', {
      actorId: command.actor.id,
      count: items.length,
    });
    return { items: items.map(toLoginGalleryItemDto) };
  }
}
