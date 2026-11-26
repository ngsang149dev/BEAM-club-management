import { isApiClientError } from '@/features/shared/api/client';

export interface DepartmentErrorDescriptor {
  key:
    | 'departmentInUse'
    | 'departmentNameExists'
    | 'invalidDepartmentLead'
    | 'validation'
    | 'unauthorized'
    | 'forbidden'
    | 'notFound'
    | 'conflict'
    | 'network'
    | 'unknown';
  values?: {
    memberCount: number;
    boardCount: number;
  };
}

function readCountDetail(details: Record<string, unknown>, field: string): number {
  const raw = details[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

const CODE_MAP: Record<string, Exclude<DepartmentErrorDescriptor['key'], 'departmentInUse'>> = {
  DEPARTMENT_NAME_EXISTS: 'departmentNameExists',
  INVALID_DEPARTMENT_LEAD: 'invalidDepartmentLead',
  VALIDATION_ERROR: 'validation',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  CONFLICT: 'conflict',
  NETWORK_ERROR: 'network',
};

const STATUS_MAP: Record<number, Exclude<DepartmentErrorDescriptor['key'], 'departmentInUse'>> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
};

export function describeDepartmentError(error: unknown): DepartmentErrorDescriptor | null {
  if (!error) return null;
  if (!isApiClientError(error)) return { key: 'unknown' };
  if (error.code === 'DEPARTMENT_IN_USE') {
    return {
      key: 'departmentInUse',
      values: {
        memberCount: readCountDetail(error.details, 'memberCount'),
        boardCount: readCountDetail(error.details, 'boardCount'),
      },
    };
  }
  const key = CODE_MAP[error.code] ?? STATUS_MAP[error.status] ?? 'unknown';
  return { key };
}
