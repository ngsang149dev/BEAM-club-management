import {
  resolveImageUploadErrorKey,
  type ImageUploadErrorKey,
} from '@/features/shared/image-compress';

export type BrandingErrorKey = ImageUploadErrorKey;

export function describeBrandingError(error: unknown): BrandingErrorKey | null {
  return resolveImageUploadErrorKey(error);
}
