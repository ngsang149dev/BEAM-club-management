import { isApiClientError } from '@/features/shared/api/client';

export type AuditErrorKey =
  | 'unauthorized'
  | 'forbidden'
  | 'invalidCursor'
  | 'invalidDateRange'
  | 'validation'
  | 'network'
  | 'unknown';

export interface AuditErrorDescriptor {
  readonly key: AuditErrorKey;
  readonly requestId?: string;
}

const CODE_TO_KEY: Record<string, AuditErrorKey> = {
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  INVALID_CURSOR: 'invalidCursor',
  INVALID_DATE_RANGE: 'invalidDateRange',
  VALIDATION_ERROR: 'validation',
  BAD_REQUEST: 'validation',
  NETWORK_ERROR: 'network',
};

const STATUS_TO_KEY: Record<number, AuditErrorKey> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
};

export function describeAuditError(error: unknown): AuditErrorDescriptor | null {
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
