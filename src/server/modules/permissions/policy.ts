import { conflict } from '@/lib/errors';
import {
  computePermissionDiff,
  dedupeCanonicalPermissions,
  isPermissionCode,
  PERMISSION_CODES,
  PERMISSION_PRESET_CODES,
  type PermissionCode,
  type PermissionPresetCode,
} from '@/lib/permissions';

export { computePermissionDiff, dedupeCanonicalPermissions };

const PERMISSION_ORDER = new Map<string, number>(
  PERMISSION_CODES.map((code, index) => [code, index]),
);

const PRESET_ORDER = new Map<string, number>(
  PERMISSION_PRESET_CODES.map((code, index) => [code, index]),
);

const PRESET_CODE_SET: ReadonlySet<string> = new Set(PERMISSION_PRESET_CODES);

export function isPermissionPresetCode(value: string): value is PermissionPresetCode {
  return PRESET_CODE_SET.has(value);
}

export function getPermissionSortOrder(code: PermissionCode): number {
  return PERMISSION_ORDER.get(code) ?? Number.MAX_SAFE_INTEGER;
}

export function getPresetSortOrder(code: PermissionPresetCode): number {
  return PRESET_ORDER.get(code) ?? Number.MAX_SAFE_INTEGER;
}

export function normalizeStoredPermissions(codes: readonly string[]): PermissionCode[] {
  return dedupeCanonicalPermissions(codes.filter(isPermissionCode));
}

export interface AdminFlagCheckInput {
  readonly actorId: string;
  readonly targetUserId: string;
  readonly currentIsAdmin: boolean;
  readonly nextIsAdmin: boolean;
  readonly targetIsActive: boolean;
  readonly activeAdminCount: number;
}

export function assertAdminFlagChangeAllowed(input: AdminFlagCheckInput): void {
  if (
    input.actorId === input.targetUserId &&
    input.currentIsAdmin &&
    !input.nextIsAdmin
  ) {
    throw conflict('errors.cannotRevokeOwnAdmin', {}, 'CANNOT_REVOKE_OWN_ADMIN');
  }

  if (
    input.currentIsAdmin &&
    !input.nextIsAdmin &&
    input.targetIsActive &&
    input.activeAdminCount <= 1
  ) {
    throw conflict('errors.lastActiveAdmin', {}, 'LAST_ACTIVE_ADMIN');
  }
}
