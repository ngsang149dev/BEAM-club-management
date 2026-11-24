import { isApiClientError } from '@/features/shared/api/client';
import { DEFAULT_ALLOWED_EMAIL_DOMAIN } from '@/lib/members';

export interface MemberErrorDescriptor {
  key:
    | 'invalidEmailDomain'
    | 'studentIdExists'
    | 'emailExists'
    | 'lastActiveAdmin'
    | 'invalidDepartmentIds'
    | 'studentIdImmutable'
    | 'invalidCursor'
    | 'validation'
    | 'unauthorized'
    | 'forbidden'
    | 'notFound'
    | 'conflict'
    | 'network'
    | 'unknown';
  values?: {
    domain: string;
  };
}

const CODE_TO_KEY: Record<string, Exclude<MemberErrorDescriptor['key'], 'invalidEmailDomain'>> = {
  STUDENT_ID_EXISTS: 'studentIdExists',
  EMAIL_EXISTS: 'emailExists',
  LAST_ACTIVE_ADMIN: 'lastActiveAdmin',
  INVALID_DEPARTMENT_IDS: 'invalidDepartmentIds',
  STUDENT_ID_IMMUTABLE: 'studentIdImmutable',
  INVALID_CURSOR: 'invalidCursor',
  VALIDATION_ERROR: 'validation',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  CONFLICT: 'conflict',
  NETWORK_ERROR: 'network',
};

const STATUS_MAP: Record<number, Exclude<MemberErrorDescriptor['key'], 'invalidEmailDomain'>> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
};

function readAllowedDomain(details: Record<string, unknown>): string {
  const domain = details.allowedDomain;
  return typeof domain === 'string' && domain.trim().length > 0
    ? domain.trim()
    : DEFAULT_ALLOWED_EMAIL_DOMAIN;
}

export function describeMemberError(error: unknown): MemberErrorDescriptor | null {
  if (!error) return null;
  if (!isApiClientError(error)) return { key: 'unknown' };
  if (error.code === 'INVALID_EMAIL_DOMAIN') {
    return {
      key: 'invalidEmailDomain',
      values: { domain: readAllowedDomain(error.details) },
    };
  }
  const key = CODE_TO_KEY[error.code] ?? STATUS_MAP[error.status] ?? 'unknown';
  return { key };
}
