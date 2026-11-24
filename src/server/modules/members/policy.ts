import { badRequest, forbidden, unauthorized } from '@/lib/errors';
import { isAllowedEmailDomain, uuidSchema } from '@/lib/members';
import type { AuthActor } from '@/server/shared/authorize';

export interface MemberCursor {
  readonly fullName: string;
  readonly id: string;
}

export function canViewMemberDetail(actor: AuthActor): boolean {
  if (!actor.isActive) {
    return false;
  }
  return actor.isAdmin || actor.permissions.includes('member.view_detail');
}

export function assertCanResetMemberPassword(actor: AuthActor): void {
  if (!actor.isActive) {
    throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
  }
  if (!actor.isAdmin) {
    throw forbidden('errors.forbidden', { requiresAdmin: true });
  }
}

export function assertAllowedEmailDomain(
  email: string,
  allowedDomain: string,
): void {
  if (!isAllowedEmailDomain(email, allowedDomain)) {
    throw badRequest(
      'errors.invalidEmailDomain',
      { allowedDomain },
      'INVALID_EMAIL_DOMAIN',
    );
  }
}

export function encodeMemberCursor(cursor: MemberCursor): string {
  return Buffer.from(
    JSON.stringify({ fullName: cursor.fullName, id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeMemberCursor(raw: string): MemberCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
      throw new Error('Non-canonical base64url cursor');
    }
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Cursor must be object');
    }
    const candidate = parsed as { fullName?: unknown; id?: unknown };
    if (
      typeof candidate.fullName !== 'string' ||
      candidate.fullName.length === 0
    ) {
      throw new Error('Invalid cursor fullName');
    }
    const validId = uuidSchema.safeParse(candidate.id);
    if (!validId.success) {
      throw new Error('Invalid cursor id');
    }
    return { fullName: candidate.fullName, id: validId.data };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
