'use client';

import { useTranslations } from 'next-intl';
import type { PermissionCode } from '@/features/shared/permissions/can';
import { PERMISSIONS, type PermissionDefinition, type PermissionGroup } from '@/lib/permissions';
import type { PermissionDto } from '../hooks/usePermissionsAdmin';

const GROUP_ORDER: readonly PermissionGroup[] = [
  'members',
  'departments',
  'boards',
  'tasks',
  'comments',
  'system',
];

const CATALOG_KEY_MAP = new Map<PermissionCode, string>(
  PERMISSIONS.map((perm) => [perm.code, perm.descriptionKey.replace('permissions.catalog.', '')])
);

const GROUP_NAME_SET = new Set<string>(GROUP_ORDER);

function isPermissionGroup(value: string): value is PermissionGroup {
  return GROUP_NAME_SET.has(value);
}

function buildGroupedPermissions(
  catalogItems?: readonly PermissionDto[]
): Map<PermissionGroup, { code: PermissionCode; descriptionKey: string }[]> {
  const grouped = new Map<PermissionGroup, { code: PermissionCode; descriptionKey: string }[]>();
  for (const group of GROUP_ORDER) {
    grouped.set(group, []);
  }

  const source: readonly PermissionDefinition[] =
    catalogItems && catalogItems.length > 0
      ? catalogItems.map((item) => ({
          code: item.code,
          group: isPermissionGroup(item.groupName) ? item.groupName : 'system',
          descriptionKey: `permissions.catalog.${CATALOG_KEY_MAP.get(item.code) ?? item.code.replace('.', '_')}`,
        }))
      : PERMISSIONS;

  for (const perm of source) {
    grouped.get(perm.group)?.push({
      code: perm.code,
      descriptionKey: CATALOG_KEY_MAP.get(perm.code) ?? perm.code.replace('.', '_'),
    });
  }
  return grouped;
}

function PermissionMatrixRow({
  code,
  descriptionKey,
  checked,
  disabled,
  onToggle,
}: {
  code: PermissionCode;
  descriptionKey: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (code: PermissionCode) => void;
}) {
  const tPerm = useTranslations('permissions');
  const description = tPerm(`catalog.${descriptionKey}` as `catalog.${string}`);

  return (
    <label className={checked ? 'perm-row is-on' : 'perm-row'}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(code)}
      />
      <span className="perm-row-text">
        <b>{code}</b>
        <span>{description}</span>
      </span>
    </label>
  );
}

export interface PermissionMatrixGroupsProps {
  catalogItems?: readonly PermissionDto[];
  selectedCodes: readonly PermissionCode[];
  disabled?: boolean;
  isLoading?: boolean;
  onTogglePermission: (code: PermissionCode) => void;
}

export function PermissionMatrixGroups({
  catalogItems,
  selectedCodes,
  disabled = false,
  isLoading = false,
  onTogglePermission,
}: PermissionMatrixGroupsProps) {
  const tPerm = useTranslations('permissions');
  const tCommon = useTranslations('common');

  if (isLoading) {
    return (
      <p className="auth-loading" role="status">
        {tCommon('loading')}
      </p>
    );
  }

  const selectedSet = new Set<PermissionCode>(selectedCodes);
  const grouped = buildGroupedPermissions(catalogItems);

  return (
    <div className="perm-groups">
      {GROUP_ORDER.map((group) => {
        const items = grouped.get(group) ?? [];
        return (
          <section key={group} className="perm-group">
            <header className="perm-group-head">
              <h3>{tPerm(`groups.${group}`)}</h3>
              <span>{items.length}</span>
            </header>
            {items.map((item) => (
              <PermissionMatrixRow
                key={item.code}
                code={item.code}
                descriptionKey={item.descriptionKey}
                checked={selectedSet.has(item.code)}
                disabled={disabled}
                onToggle={onTogglePermission}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
