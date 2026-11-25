import { badRequest, conflict } from '@/lib/errors';
import { MAX_LOGIN_GALLERY_ITEMS } from '@/lib/media';

export function assertGalleryCapacity(currentCount: number): void {
  if (currentCount >= MAX_LOGIN_GALLERY_ITEMS) {
    throw conflict(
      'errors.galleryLimitReached',
      { maxItems: MAX_LOGIN_GALLERY_ITEMS },
      'GALLERY_LIMIT_REACHED',
    );
  }
}

export function computeNextGalleryOrderIndex(
  maxOrderIndex: number | null,
): number {
  if (maxOrderIndex === null || maxOrderIndex < 0) {
    return 0;
  }
  return maxOrderIndex + 1;
}

export function assertExactGalleryOrderIds(
  requestedIds: readonly string[],
  existingIds: readonly string[],
): void {
  if (requestedIds.length === 0) {
    throw badRequest(
      'errors.validation',
      { field: 'itemIds' },
      'INVALID_GALLERY_ORDER',
    );
  }
  const uniqueRequested = new Set(requestedIds);
  if (
    uniqueRequested.size !== requestedIds.length ||
    uniqueRequested.size !== existingIds.length
  ) {
    throw badRequest(
      'errors.validation',
      { field: 'itemIds' },
      'INVALID_GALLERY_ORDER',
    );
  }
  const existingSet = new Set(existingIds);
  for (const id of uniqueRequested) {
    if (!existingSet.has(id)) {
      throw badRequest(
        'errors.validation',
        { field: 'itemIds' },
        'INVALID_GALLERY_ORDER',
      );
    }
  }
}

export function collectUpdatedGalleryFields(input: {
  readonly title?: string;
  readonly caption?: string | null;
  readonly hasImage: boolean;
}): string[] {
  const fields: string[] = [];
  if (input.title !== undefined) {
    fields.push('title');
  }
  if (input.caption !== undefined) {
    fields.push('caption');
  }
  if (input.hasImage) {
    fields.push('image');
  }
  return fields;
}
