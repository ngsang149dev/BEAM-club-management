import { toClubLogoUrl, toLoginGalleryImageUrl } from '@/lib/media';
import type {
  ClubAssetMetadataRecord,
  LoginGalleryItemMetadataRecord,
} from './types';

export interface LoginGalleryItemDto {
  readonly id: string;
  readonly title: string;
  readonly caption: string | null;
  readonly imageUrl: string;
  readonly orderIndex: number;
  readonly updatedAt: string;
}

export interface BrandingDto {
  readonly logoUrl: string | null;
  readonly updatedAt: string | null;
  readonly galleryItems: readonly LoginGalleryItemDto[];
}

export type BrandingResponseDto = BrandingDto;

export interface LoginGalleryItemResponseDto {
  readonly item: LoginGalleryItemDto;
}

export interface LoginGalleryListResponseDto {
  readonly items: readonly LoginGalleryItemDto[];
}

export interface DeleteLoginGalleryItemResponseDto {
  readonly deleted: true;
  readonly id: string;
}

export function toLoginGalleryItemDto(
  record: LoginGalleryItemMetadataRecord,
): LoginGalleryItemDto {
  return {
    id: record.id,
    title: record.title,
    caption: record.caption,
    imageUrl: toLoginGalleryImageUrl(record.id, record.updatedAt),
    orderIndex: record.orderIndex,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toBrandingDto(
  asset: ClubAssetMetadataRecord | null,
  galleryItems: readonly LoginGalleryItemMetadataRecord[] = [],
): BrandingDto {
  const mappedGallery = galleryItems.map(toLoginGalleryItemDto);
  if (!asset) {
    return {
      logoUrl: null,
      updatedAt: null,
      galleryItems: mappedGallery,
    };
  }
  return {
    logoUrl: toClubLogoUrl(asset.updatedAt),
    updatedAt: asset.updatedAt.toISOString(),
    galleryItems: mappedGallery,
  };
}
