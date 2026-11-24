import { isApiClientError } from '@/features/shared/api/client';

export type PermissionsErrorKey =
  | 'lastActiveAdmin'
  | 'cannotRevokeOwnAdmin'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'conflict'
  | 'network'
  | 'unknown';

export interface PermissionsErrorDescriptor {
  readonly key: PermissionsErrorKey;
  readonly requestId?: string;
}

const CODE_TO_KEY: Record<string, PermissionsErrorKey> = {
  LAST_ACTIVE_ADMIN: 'lastActiveAdmin',
  CANNOT_REVOKE_OWN_ADMIN: 'cannotRevokeOwnAdmin',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  VALIDATION_ERROR: 'validation',
  BAD_REQUEST: 'validation',
  CONFLICT: 'conflict',
  NETWORK_ERROR: 'network',
};

const STATUS_TO_KEY: Record<number, PermissionsErrorKey> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
};

export function describePermissionsError(error: unknown): PermissionsErrorDescriptor | null {
  if (!error) return null;
  if (!isApiClientError(error)) {
    return { key: 'unknown' };
  }
  const key = CODE_TO_KEY[error.code] ?? STATUS_TO_KEY[error.status] ?? 'unknown';
  return {
    key,
    requestId: error.requestId,
  };
}
