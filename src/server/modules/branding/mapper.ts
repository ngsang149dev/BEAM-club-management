import { toClubLogoUrl } from '@/lib/media';
import type { ClubAssetMetadataRecord } from './repository';

export interface BrandingDto {
  readonly logoUrl: string | null;
  readonly updatedAt: string | null;
}

export type BrandingResponseDto = BrandingDto;

export function toBrandingDto(
  asset: ClubAssetMetadataRecord | null,
): BrandingDto {
  if (!asset) {
    return {
      logoUrl: null,
      updatedAt: null,
    };
  }
  return {
    logoUrl: toClubLogoUrl(asset.updatedAt),
    updatedAt: asset.updatedAt.toISOString(),
  };
}
