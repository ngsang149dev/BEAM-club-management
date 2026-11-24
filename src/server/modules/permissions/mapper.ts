import type { PermissionCode, PermissionPresetCode } from '@/lib/permissions';
import {
  dedupeCanonicalPermissions,
  getPermissionSortOrder,
  getPresetSortOrder,
} from './policy';
import type {
  PermissionCatalogRecord,
  PermissionPresetRecord,
  TargetMemberPermissionsRecord,
} from './repository';

export interface PermissionDto {
  readonly code: PermissionCode;
  readonly groupName: string;
  readonly description: string;
  readonly scopable: boolean;
}

export interface PermissionCatalogResponseDto {
  readonly items: PermissionDto[];
}

export interface MemberPermissionsResponseDto {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissionCodes: PermissionCode[];
}

export interface PermissionPresetDto {
  readonly id: string;
  readonly code: PermissionPresetCode;
  readonly name: string;
  readonly description: string | null;
  readonly permissionCodes: PermissionCode[];
}

export interface PermissionPresetListResponseDto {
  readonly items: PermissionPresetDto[];
}

export interface UpdateAdminFlagResponseDto {
  readonly userId: string;
  readonly isAdmin: boolean;
}

export function toPermissionCatalogResponseDto(
  records: readonly PermissionCatalogRecord[],
): PermissionCatalogResponseDto {
  const sorted = [...records].sort(
    (a, b) => getPermissionSortOrder(a.code) - getPermissionSortOrder(b.code),
  );
  return {
    items: sorted.map((record) => ({
      code: record.code,
      groupName: record.groupName,
      description: record.description,
      scopable: record.scopable,
    })),
  };
}

export function toMemberPermissionsResponseDto(
  record: TargetMemberPermissionsRecord,
): MemberPermissionsResponseDto {
  return {
    userId: record.userId,
    isAdmin: record.isAdmin,
    permissionCodes: dedupeCanonicalPermissions(record.permissionCodes),
  };
}

export function toPermissionPresetListResponseDto(
  records: readonly PermissionPresetRecord[],
): PermissionPresetListResponseDto {
  const sorted = [...records].sort(
    (a, b) => getPresetSortOrder(a.code) - getPresetSortOrder(b.code),
  );
  return {
    items: sorted.map((preset) => ({
      id: preset.id,
      code: preset.code,
      name: preset.name,
      description: preset.description,
      permissionCodes: dedupeCanonicalPermissions(preset.permissionCodes),
    })),
  };
}

export function toUpdateAdminFlagResponseDto(
  userId: string,
  isAdmin: boolean,
): UpdateAdminFlagResponseDto {
  return { userId, isAdmin };
}
