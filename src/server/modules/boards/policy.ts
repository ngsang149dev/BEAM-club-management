import { z } from 'zod';
import { badRequest, conflict, forbidden, unauthorized } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import type { AuthActor } from '@/server/shared/authorize';

export interface BoardListCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });

export function encodeBoardCursor(cursor: BoardListCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeBoardCursor(raw: string): BoardListCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
      throw new Error('Non-canonical base64url cursor');
    }
    const parsed = JSON.parse(decoded) as { createdAt?: unknown; id?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid cursor object');
    }
    const iso = isoTimestampSchema.parse(parsed.createdAt);
    const id = uuidSchema.parse(parsed.id);
    return { createdAt: new Date(iso), id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function assertCanIncludeArchived(actor: AuthActor, includeArchived: boolean): void {
  if (!actor.isActive) {
    throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
  }
  if (includeArchived && !actor.isAdmin) {
    throw forbidden('errors.forbidden', { requiresAdmin: true });
  }
}

export function assertColumnOrderMatches(
  existingIds: readonly string[],
  requestedIds: readonly string[],
): void {
  const requestedSet = new Set(requestedIds);
  if (
    requestedSet.size !== requestedIds.length ||
    existingIds.length !== requestedIds.length ||
    !existingIds.every((id) => requestedSet.has(id))
  ) {
    throw badRequest('errors.invalidColumnOrder', {}, 'INVALID_COLUMN_ORDER');
  }
}

export function assertColumnCanBeDeleted(activeTaskCount: number): void {
  if (activeTaskCount > 0) {
    throw conflict('errors.columnNotEmpty', { activeTaskCount }, 'COLUMN_NOT_EMPTY');
  }
}
