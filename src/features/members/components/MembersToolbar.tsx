'use client';

import { useTranslations } from 'next-intl';
import type { DepartmentDto } from '@/features/departments/hooks/useDepartments';
import type { MemberStatusFilter, MembersFilterState } from '../hooks/useMembers';

export function getMemberInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0);
  if (!first) {
    return 'BM';
  }
  const last = parts.at(-1);
  if (parts.length === 1 || !last) {
    return first.slice(0, 2).toUpperCase();
  }
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export interface MembersToolbarProps {
  filters: MembersFilterState;
  departments: DepartmentDto[];
  onQueryChange: (q: string) => void;
  onDepartmentChange: (departmentId: string) => void;
  onStatusChange: (status: MemberStatusFilter) => void;
  rightAction?: React.ReactNode;
}

const STATUS_OPTIONS: { value: MemberStatusFilter; key: 'statusActive' | 'statusInactive' | 'statusAll' }[] = [
  { value: 'active', key: 'statusActive' },
  { value: 'inactive', key: 'statusInactive' },
  { value: 'all', key: 'statusAll' },
];

export function MembersToolbar({
  filters,
  departments,
  onQueryChange,
  onDepartmentChange,
  onStatusChange,
  rightAction,
}: MembersToolbarProps) {
  const t = useTranslations('members');

  return (
    <div className="directory-toolbar-stack">
      <div className="directory-toolbar">
        <div className="directory-search">
          <input
            className="ui-input"
            type="search"
            value={filters.q}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
          />
        </div>
        <div className="directory-filter-select">
          <select
            className="ui-select"
            value={filters.departmentId}
            onChange={(event) => onDepartmentChange(event.target.value)}
            aria-label={t('departmentFilterLabel')}
          >
            <option value="">{t('allDepartments')}</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-segmented" role="group" aria-label={t('statusLabel')}>
          {STATUS_OPTIONS.map((option) => {
            const selected = filters.status === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                className={selected ? 'ui-seg-btn is-active' : 'ui-seg-btn'}
                onClick={() => onStatusChange(option.value)}
              >
                {t(option.key)}
              </button>
            );
          })}
        </div>
        {rightAction}
      </div>
    </div>
  );
}
