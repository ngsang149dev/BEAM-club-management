import { z } from 'zod';
import { badRequest, forbidden, unauthorized } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import { type AuthActor, hasPermission } from '@/server/shared/authorize';

export interface CommentCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });

export function canDeleteComment(
  actor: AuthActor,
  comment: { readonly userId: string },
): boolean {
  if (!actor.isActive) return false;
  if (actor.isAdmin || comment.userId === actor.id) return true;
  return hasPermission(actor, 'comment.delete_any');
}

export function assertCanDeleteComment(
  actor: AuthActor,
  comment: { readonly userId: string },
): void {
  if (!actor.isActive) {
    throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
  }
  if (!canDeleteComment(actor, comment)) {
    throw forbidden('errors.forbidden', { requiredPermission: 'comment.delete_any' });
  }
}

export function encodeCommentCursor(cursor: CommentCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

function parseCommentCursorPayload(raw: string): CommentCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
    throw new Error('Non-canonical base64url cursor');
  }
  const parsed = JSON.parse(decoded) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Cursor must be object');
  }
  const candidate = parsed as { createdAt?: unknown; id?: unknown };
  const validIso = isoTimestampSchema.safeParse(candidate.createdAt);
  const validId = uuidSchema.safeParse(candidate.id);
  if (!validIso.success || !validId.success) {
    throw new Error('Invalid cursor fields');
  }
  return { createdAt: new Date(validIso.data), id: validId.data };
}

export function decodeCommentCursor(raw: string): CommentCursor {
  try {
    return parseCommentCursorPayload(raw);
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}
