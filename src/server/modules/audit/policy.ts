import { z } from 'zod';
import { badRequest } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';

export interface AuditLogCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });

export function encodeAuditCursor(cursor: AuditLogCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

function parseAuditCursorPayload(raw: string): AuditLogCursor {
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

export function decodeAuditCursor(raw: string): AuditLogCursor {
  try {
    return parseAuditCursorPayload(raw);
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function assertValidAuditDateRange(from?: Date, to?: Date): void {
  if (from && to && from.getTime() > to.getTime()) {
    throw badRequest('errors.invalidDateRange', {}, 'INVALID_DATE_RANGE');
  }
}
