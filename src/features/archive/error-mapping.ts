import { isApiClientError } from '@/features/shared/api/client';

export type ArchiveErrorKey =
  | 'boardArchived'
  | 'boardHasNoColumns'
  | 'taskNotDeleted'
  | 'memberAlreadyActive'
  | 'boardNotArchived'
  | 'entityNotArchived'
  | 'invalidCursor'
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'network'
  | 'unknown';

export interface ArchiveErrorDescriptor {
  readonly key: ArchiveErrorKey;
  readonly requestId?: string;
}

const CODE_TO_KEY: Record<string, ArchiveErrorKey> = {
  BOARD_ARCHIVED: 'boardArchived',
  BOARD_HAS_NO_COLUMNS: 'boardHasNoColumns',
  TASK_NOT_DELETED: 'taskNotDeleted',
  MEMBER_ALREADY_ACTIVE: 'memberAlreadyActive',
  BOARD_NOT_ARCHIVED: 'boardNotArchived',
  ENTITY_NOT_ARCHIVED: 'entityNotArchived',
  INVALID_CURSOR: 'invalidCursor',
  VALIDATION_ERROR: 'validation',
  BAD_REQUEST: 'validation',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  CONFLICT: 'conflict',
  NETWORK_ERROR: 'network',
};

const STATUS_TO_KEY: Record<number, ArchiveErrorKey> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
};

export function describeArchiveError(error: unknown): ArchiveErrorDescriptor | null {
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

export function resolveArchiveErrorMessage(
  error: unknown,
  tErr: (key: ArchiveErrorKey) => string
): string | null {
  const descriptor = describeArchiveError(error);
  if (!descriptor) return null;
  return tErr(descriptor.key);
}
