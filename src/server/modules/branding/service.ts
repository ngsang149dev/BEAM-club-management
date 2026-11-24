import { notFound } from '@/lib/errors';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type AuthActor, authorizeAdmin } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import { parseAndValidateImageDataUrl } from '@/server/shared/media';
import type { TransactionRunner } from '@/server/shared/transaction';
import { type BrandingDto, toBrandingDto } from './mapper';
import {
  type BrandingRepository,
  CLUB_LOGO_ASSET_KEY,
  type ClubAssetBinaryRecord,
} from './repository';

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

export class BrandingService {
  constructor(private readonly deps: BrandingServiceDeps) {}

  async getBranding(): Promise<BrandingDto> {
    const asset = await this.deps.brandingRepo.findMetadataByKey(
      CLUB_LOGO_ASSET_KEY,
    );
    return toBrandingDto(asset);
  }

  async getClubLogo(): Promise<ClubAssetBinaryRecord> {
    const asset = await this.deps.brandingRepo.findAssetByKey(CLUB_LOGO_ASSET_KEY);
    if (!asset) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return asset;
  }

  async updateClubLogo(command: UpdateClubLogoCommand): Promise<BrandingDto> {
    authorizeAdmin(command.actor);
    const parsed = parseAndValidateImageDataUrl(command.dataUrl);
    const now = this.deps.clock.now();

    const saved = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const record = await this.deps.brandingRepo.upsertAsset(
        {
          key: CLUB_LOGO_ASSET_KEY,
          mimeType: parsed.mimeType,
          data: parsed.buffer,
          updatedBy: command.actor.id,
          now,
        },
        tx,
      );
      await this.deps.auditWriter.record(
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
      return record;
    });

    this.deps.logger.info('Club logo updated', {
      actorId: command.actor.id,
      assetKey: CLUB_LOGO_ASSET_KEY,
      mimeType: parsed.mimeType,
      byteLength: parsed.buffer.byteLength,
    });
    return toBrandingDto(saved);
  }

  async removeClubLogo(command: RemoveClubLogoCommand): Promise<BrandingDto> {
    authorizeAdmin(command.actor);
    const now = this.deps.clock.now();

    await this.deps.transactionRunner.runInTransaction(async (tx) => {
      await this.deps.brandingRepo.deleteAssetByKey(CLUB_LOGO_ASSET_KEY, tx);
      await this.deps.auditWriter.record(
        {
          actorId: command.actor.id,
          action: 'branding.logo_removed',
          detail: {
            assetKey: CLUB_LOGO_ASSET_KEY,
          },
          createdAt: now,
        },
        tx,
      );
    });

    this.deps.logger.info('Club logo removed', {
      actorId: command.actor.id,
      assetKey: CLUB_LOGO_ASSET_KEY,
    });
    return {
      logoUrl: null,
      updatedAt: null,
    };
  }
}
