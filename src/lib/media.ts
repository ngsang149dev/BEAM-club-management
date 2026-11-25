import { z } from 'zod';

export const MAX_IMAGE_BYTES = 262_144;
export const MAX_IMAGE_DATA_URL_LENGTH = 400_000;
export const MAX_GALLERY_IMAGE_BYTES = 524_288;
export const MAX_GALLERY_DATA_URL_LENGTH = 760_000;
export const MAX_LOGIN_GALLERY_ITEMS = 12;
export const LOGIN_GALLERY_TITLE_MAX = 80;
export const LOGIN_GALLERY_CAPTION_MAX = 240;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const IMAGE_FILE_ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(',');

export const imageUploadRequestSchema = z
  .object({
    dataUrl: z.string().trim().min(1).max(MAX_IMAGE_DATA_URL_LENGTH),
  })
  .strict();

export type ImageUploadRequestInput = z.infer<typeof imageUploadRequestSchema>;

export const galleryTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(LOGIN_GALLERY_TITLE_MAX);

export const galleryCaptionSchema = z
  .string()
  .trim()
  .max(LOGIN_GALLERY_CAPTION_MAX)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const galleryImageDataUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_GALLERY_DATA_URL_LENGTH);

export const createLoginGalleryItemRequestSchema = z
  .object({
    title: galleryTitleSchema,
    caption: galleryCaptionSchema.optional(),
    dataUrl: galleryImageDataUrlSchema,
  })
  .strict();

export type CreateLoginGalleryItemRequestInput = z.infer<
  typeof createLoginGalleryItemRequestSchema
>;

export const updateLoginGalleryItemRequestSchema = z
  .object({
    title: galleryTitleSchema.optional(),
    caption: galleryCaptionSchema.optional(),
    dataUrl: galleryImageDataUrlSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.caption !== undefined ||
      value.dataUrl !== undefined,
    { message: 'At least one field must be provided' },
  );

export type UpdateLoginGalleryItemRequestInput = z.infer<
  typeof updateLoginGalleryItemRequestSchema
>;

export const reorderLoginGalleryRequestSchema = z
  .object({
    itemIds: z.array(z.uuid()).min(1).max(MAX_LOGIN_GALLERY_ITEMS),
  })
  .strict();

export type ReorderLoginGalleryRequestInput = z.infer<
  typeof reorderLoginGalleryRequestSchema
>;

export interface AvatarTone {
  readonly bg: string;
  readonly fg: string;
}

export const AVATAR_PALETTE: readonly AvatarTone[] = [
  { bg: '#DB2777', fg: '#FFFFFF' },
  { bg: '#111827', fg: '#FFFFFF' },
  { bg: '#7C3AED', fg: '#FFFFFF' },
  { bg: '#0F766E', fg: '#FFFFFF' },
  { bg: '#B45309', fg: '#FFFFFF' },
  { bg: '#BE123C', fg: '#FFFFFF' },
  { bg: '#1D4ED8', fg: '#FFFFFF' },
  { bg: '#4338CA', fg: '#FFFFFF' },
] as const;

export function isAllowedImageMimeType(
  value: string,
): value is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(
    value.toLowerCase(),
  );
}

export function getMemberInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0);
  if (!first) {
    return 'BM';
  }
  const last = parts.at(-1);
  if (parts.length === 1 || !last) {
    return first.slice(0, 2).toUpperCase();
  }
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function getAvatarColorIndex(seed: string): number {
  const normalized = seed.trim() || 'beam';
  let hash = 2_166_136_261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % AVATAR_PALETTE.length;
}

export function getAvatarTone(seed: string): AvatarTone {
  const paletteIndex = getAvatarColorIndex(seed);
  return AVATAR_PALETTE[paletteIndex] ?? AVATAR_PALETTE[0]!;
}

function toEpochVersion(updatedAt: Date | string | null | undefined): number | null {
  if (!updatedAt) {
    return null;
  }
  const epochMs =
    typeof updatedAt === 'string' ? Date.parse(updatedAt) : updatedAt.getTime();
  return Number.isFinite(epochMs) ? epochMs : 0;
}

export function toMemberAvatarUrl(
  memberId: string,
  updatedAt: Date | string | null | undefined,
): string | null {
  const version = toEpochVersion(updatedAt);
  if (version === null) {
    return null;
  }
  return `/api/v1/members/${encodeURIComponent(memberId)}/avatar?v=${version}`;
}

export function toClubLogoUrl(
  updatedAt: Date | string | null | undefined,
): string | null {
  const version = toEpochVersion(updatedAt);
  if (version === null) {
    return null;
  }
  return `/api/v1/branding/logo?v=${version}`;
}

export function toLoginGalleryImageUrl(
  itemId: string,
  updatedAt: Date | string,
): string {
  const version = toEpochVersion(updatedAt) ?? 0;
  return `/api/v1/branding/gallery/${encodeURIComponent(itemId)}/image?v=${version}`;
}
