import { badRequest, notFound } from '@/lib/errors';
import { MAX_GALLERY_IMAGE_BYTES } from '@/lib/media';
import { type AuthActor, authorizeAdmin } from '@/server/shared/authorize';
import { parseAndValidateImageDataUrl } from '@/server/shared/media';
import {
  loadFullBrandingDto,
  persistClubAssetInTx,
  persistGalleryItemInTx,
  persistUpdatedGalleryItemInTx,
  removeClubAssetInTx,
} from './gallery-tx';
import {
  type BrandingDto,
  type DeleteLoginGalleryItemResponseDto,
  type LoginGalleryItemResponseDto,
  type LoginGalleryListResponseDto,
  toLoginGalleryItemDto,
} from './mapper';
import {
  assertExactGalleryOrderIds,
  collectUpdatedGalleryFields,
} from './policy';
import { CLUB_LOGO_ASSET_KEY, CLUB_WORDMARK_ASSET_KEY } from './repository';
import type {
  BrandingServiceDeps,
  ClubAssetBinaryRecord,
  CreateGalleryItemCommand,
  DeleteGalleryItemCommand,
  LoginGalleryItemBinaryRecord,
  RemoveClubLogoCommand,
  RemoveClubWordmarkCommand,
  ReorderGalleryItemsCommand,
  UpdateClubLogoCommand,
  UpdateClubWordmarkCommand,
  UpdateGalleryItemCommand,
} from './types';

export class BrandingService {
  constructor(private readonly deps: BrandingServiceDeps) {}

  async getBranding(): Promise<BrandingDto> {
    return loadFullBrandingDto(this.deps.brandingRepo);
  }

  async getClubLogo(): Promise<ClubAssetBinaryRecord> {
    return this.getClubAssetByKey(CLUB_LOGO_ASSET_KEY);
  }

  async getClubWordmark(): Promise<ClubAssetBinaryRecord> {
    return this.getClubAssetByKey(CLUB_WORDMARK_ASSET_KEY);
  }

  async getGalleryImage(id: string): Promise<LoginGalleryItemBinaryRecord> {
    const asset = await this.deps.brandingRepo.findGalleryImageById(id);
    if (!asset) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return asset;
  }

  async updateClubLogo(command: UpdateClubLogoCommand): Promise<BrandingDto> {
    return this.updateClubAsset(command, CLUB_LOGO_ASSET_KEY, 'branding.logo_updated', 'Club logo updated');
  }

  async removeClubLogo(command: RemoveClubLogoCommand): Promise<BrandingDto> {
    return this.removeClubAsset(command.actor, CLUB_LOGO_ASSET_KEY, 'branding.logo_removed', 'Club logo removed');
  }

  async updateClubWordmark(command: UpdateClubWordmarkCommand): Promise<BrandingDto> {
    return this.updateClubAsset(command, CLUB_WORDMARK_ASSET_KEY, 'branding.wordmark_updated', 'Club wordmark updated');
  }

  async removeClubWordmark(command: RemoveClubWordmarkCommand): Promise<BrandingDto> {
    return this.removeClubAsset(command.actor, CLUB_WORDMARK_ASSET_KEY, 'branding.wordmark_removed', 'Club wordmark removed');
  }

  private async getClubAssetByKey(assetKey: string): Promise<ClubAssetBinaryRecord> {
    const asset = await this.deps.brandingRepo.findAssetByKey(assetKey);
    if (!asset) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return asset;
  }

  private async updateClubAsset(
    command: { readonly actor: AuthActor; readonly dataUrl: string },
    assetKey: string,
    auditAction: string,
    logMessage: string,
  ): Promise<BrandingDto> {
    authorizeAdmin(command.actor);
    const parsed = parseAndValidateImageDataUrl(command.dataUrl);
    const now = this.deps.clock.now();

    const branding = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistClubAssetInTx({
        deps: this.deps,
        tx,
        actorId: command.actor.id,
        assetKey,
        auditAction,
        parsed,
        now,
      }),
    );

    this.deps.logger.info(logMessage, {
      actorId: command.actor.id,
      assetKey,
      mimeType: parsed.mimeType,
      byteLength: parsed.buffer.byteLength,
    });
    return branding;
  }

  private async removeClubAsset(
    actor: AuthActor,
    assetKey: string,
    auditAction: string,
    logMessage: string,
  ): Promise<BrandingDto> {
    authorizeAdmin(actor);
    const now = this.deps.clock.now();

    const branding = await this.deps.transactionRunner.runInTransaction((tx) =>
      removeClubAssetInTx({
        deps: this.deps,
        tx,
        actorId: actor.id,
        assetKey,
        auditAction,
        now,
      }),
    );

    this.deps.logger.info(logMessage, { actorId: actor.id, assetKey });
    return branding;
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
