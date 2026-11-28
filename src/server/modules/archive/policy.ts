import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  type ArchiveRetentionDays,
  type ArchiveTab,
  PURGED_MEMBER_DISPLAY_NAME,
  archiveRetentionDaysSchema,
} from '@/lib/archive';
import { badRequest, forbidden, unauthorized } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import type { PermissionCode } from '@/lib/permissions';
import { assertActorActive } from '@/server/modules/tasks';
import {
  type AuthActor,
  authorize,
  hasPermission,
} from '@/server/shared/authorize';

export interface ArchiveTasksCursor {
  readonly tab: 'tasks';
  readonly deletedAt: Date;
  readonly id: string;
}

export interface ArchiveMembersCursor {
  readonly tab: 'members';
  readonly leftAt: Date | null;
  readonly id: string;
}

export interface ArchiveBoardsCursor {
  readonly tab: 'boards';
  readonly archivedAt: Date;
  readonly id: string;
}

export interface AnonymizedProfilePatch {
  readonly fullName: string;
  readonly studentId: string;
  readonly email: string;
  readonly passwordHash: null;
  readonly mustChangePassword: false;
  readonly avatarData: null;
  readonly avatarMime: null;
  readonly avatarUpdatedAt: null;
  readonly isAdmin: false;
  readonly isActive: false;
  readonly purgedAt: Date;
  readonly updatedAt: Date;
}

const MS_PER_DAY = 86_400_000;
const isoTimestampSchema = z.iso.datetime({ offset: true });

const ARCHIVE_TAB_PERMISSIONS: Record<ArchiveTab, PermissionCode> = {
  tasks: 'task.delete',
  members: 'member.deactivate',
  boards: 'board.delete',
};

export { escapeLikePattern } from '@/lib/query-params';

export function assertCanViewArchiveTab(
  actor: AuthActor,
  tab: ArchiveTab,
): void {
  authorize(actor, ARCHIVE_TAB_PERMISSIONS[tab]);
}

export function assertCanViewRetentionSettings(actor: AuthActor): void {
  assertActorActive(actor);
  const allowed =
    actor.isAdmin ||
    hasPermission(actor, 'task.delete') ||
    hasPermission(actor, 'member.deactivate') ||
    hasPermission(actor, 'board.delete');
  if (!allowed) {
    throw forbidden('errors.forbidden', {
      requiredAnyPermission: ['task.delete', 'member.deactivate', 'board.delete'],
    });
  }
}

export function assertCanManageArchiveAdmin(actor: AuthActor): void {
  assertActorActive(actor);
  if (!actor.isAdmin) {
    throw forbidden('errors.forbidden', { requiredPermission: 'admin' });
  }
}

export function assertValidCronAuthorization(
  authHeader: string | null | undefined,
  expectedSecret: string,
): void {
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader?.trim() ?? '');
  const provided = match?.[1] ?? '';
  if (!provided || !expectedSecret) {
    throw unauthorized('errors.unauthorized', {}, 'UNAUTHORIZED');
  }
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256')
    .update(expectedSecret, 'utf8')
    .digest();
  if (!timingSafeEqual(providedDigest, expectedDigest)) {
    throw unauthorized('errors.unauthorized', {}, 'UNAUTHORIZED');
  }
}

function encodeJsonCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCanonicalCursorObject(
  raw: string,
  expectedTab: ArchiveTab,
): Record<string, unknown> {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
    throw new Error('Non-canonical base64url cursor');
  }
  const parsed = JSON.parse(decoded) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid cursor payload');
  }
  const record = parsed as Record<string, unknown>;
  if (record.tab !== expectedTab) {
    throw new Error('Cursor tab mismatch');
  }
  return record;
}

export function encodeArchiveTaskCursor(cursor: ArchiveTasksCursor): string {
  return encodeJsonCursor({
    tab: 'tasks',
    deletedAt: cursor.deletedAt.toISOString(),
    id: cursor.id,
  });
}

export function decodeArchiveTaskCursor(raw: string): ArchiveTasksCursor {
  try {
    const parsed = decodeCanonicalCursorObject(raw, 'tasks');
    const deletedAt = new Date(isoTimestampSchema.parse(parsed.deletedAt));
    const id = uuidSchema.parse(parsed.id);
    return { tab: 'tasks', deletedAt, id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function encodeArchiveMemberCursor(cursor: ArchiveMembersCursor): string {
  return encodeJsonCursor({
    tab: 'members',
    leftAt: cursor.leftAt ? cursor.leftAt.toISOString() : null,
    id: cursor.id,
  });
}

export function decodeArchiveMemberCursor(raw: string): ArchiveMembersCursor {
  try {
    const parsed = decodeCanonicalCursorObject(raw, 'members');
    const leftAt =
      parsed.leftAt === null
        ? null
        : new Date(isoTimestampSchema.parse(parsed.leftAt));
    const id = uuidSchema.parse(parsed.id);
    return { tab: 'members', leftAt, id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function encodeArchiveBoardCursor(cursor: ArchiveBoardsCursor): string {
  return encodeJsonCursor({
    tab: 'boards',
    archivedAt: cursor.archivedAt.toISOString(),
    id: cursor.id,
  });
}

export function decodeArchiveBoardCursor(raw: string): ArchiveBoardsCursor {
  try {
    const parsed = decodeCanonicalCursorObject(raw, 'boards');
    const archivedAt = new Date(isoTimestampSchema.parse(parsed.archivedAt));
    const id = uuidSchema.parse(parsed.id);
    return { tab: 'boards', archivedAt, id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function parseStoredRetentionDays(raw: unknown): ArchiveRetentionDays {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = (raw as { retentionDays?: unknown }).retentionDays;
  const parsed = archiveRetentionDaysSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function computeArchiveCutoff(
  now: Date,
  retentionDays: Exclude<ArchiveRetentionDays, null>,
): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

export function buildAnonymizedProfilePatch(
  memberId: string,
  now: Date,
): AnonymizedProfilePatch {
  return {
    fullName: PURGED_MEMBER_DISPLAY_NAME,
    studentId: `PURGED-${memberId}`,
    email: `purged+${memberId}@redacted.local`,
    passwordHash: null,
    mustChangePassword: false,
    avatarData: null,
    avatarMime: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    isActive: false,
    purgedAt: now,
    updatedAt: now,
  };
}
