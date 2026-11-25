import { isApiClientError } from '@/features/shared/api/client';
import {
  resolveImageUploadErrorKey,
  type ImageUploadErrorKey,
} from '@/features/shared/image-compress';

export type BrandingErrorKey = ImageUploadErrorKey | 'invalidGalleryOrder';

const BRANDING_CODE_MAP: Record<string, BrandingErrorKey> = {
  GALLERY_LIMIT_REACHED: 'galleryLimitReached',
  INVALID_GALLERY_ORDER: 'invalidGalleryOrder',
};

export function describeBrandingError(error: unknown): BrandingErrorKey | null {
  if (!error) {
    return null;
  }
  if (isApiClientError(error)) {
    const mapped = BRANDING_CODE_MAP[error.code];
    if (mapped) {
      return mapped;
    }
  }
  return resolveImageUploadErrorKey(error);
}
