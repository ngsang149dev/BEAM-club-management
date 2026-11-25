'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PRIORITY_MESSAGE_KEY } from '@/features/tasks/formatters';
import type { DepartmentDto, MemberPublicSummary } from '@/features/tasks/hooks/useTasks';
import {
  TASK_DUE_STATUSES,
  TASK_PRIORITIES,
  TASK_SORT_BY_VALUES,
  TASK_SORT_ORDER_VALUES,
  type TaskDueStatus,
  type TaskPriority,
  type TaskSortBy,
  type TaskSortOrder,
} from '@/lib/tasks';
import type { BoardFiltersState } from '../filters';
import type { ColumnDto } from '../hooks/useBoards';

export interface BoardFilterBarProps {
  readonly filters: BoardFiltersState;
  readonly columns: readonly ColumnDto[];
  readonly departments: readonly DepartmentDto[];
  readonly members: readonly MemberPublicSummary[];
  readonly canViewMembers: boolean;
  readonly dndPaused: boolean;
  readonly isFiltering?: boolean;
  readonly onUpdateFilters: (patch: Partial<BoardFiltersState>) => void;
  readonly onResetFilters: () => void;
}

const DUE_STATUS_LABEL_KEY: Record<TaskDueStatus, string> = {
  overdue: 'dueStatusOverdue',
  upcoming: 'dueStatusUpcoming',
  no_due: 'dueStatusNoDue',
};

const SORT_BY_LABEL_KEY: Record<TaskSortBy, string> = {
  position: 'sortByPosition',
  priority: 'sortByPriority',
  dueAt: 'sortByDueAt',
  createdAt: 'sortByCreatedAt',
};

const SORT_ORDER_LABEL_KEY: Record<TaskSortOrder, string> = {
  asc: 'sortOrderAsc',
  desc: 'sortOrderDesc',
};

function FilterSelectField({
  value,
  ariaLabel,
  onChange,
  children,
}: {
  readonly value: string;
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="board-filter-control">
      <select
        className="ui-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      >
        {children}
      </select>
    </div>
  );
}

function BoardScopeSelects({
  filters,
  columns,
  departments,
  members,
  canViewMembers,
  onUpdateFilters,
}: Pick<
  BoardFilterBarProps,
  'filters' | 'columns' | 'departments' | 'members' | 'canViewMembers' | 'onUpdateFilters'
>) {
  const t = useTranslations('boards');

  return (
    <>
      <FilterSelectField
        value={filters.departmentId}
        ariaLabel={t('filterDepartmentLabel')}
        onChange={(departmentId) => onUpdateFilters({ departmentId })}
      >
        <option value="">{t('filterAllDepartments')}</option>
        {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
      </FilterSelectField>
      {canViewMembers ? (
        <FilterSelectField
          value={filters.assigneeId}
          ariaLabel={t('filterAssigneeLabel')}
          onChange={(assigneeId) => onUpdateFilters({ assigneeId })}
        >
          <option value="">{t('filterAllAssignees')}</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
        </FilterSelectField>
      ) : null}
      <FilterSelectField
        value={filters.columnId}
        ariaLabel={t('filterColumnLabel')}
        onChange={(columnId) => onUpdateFilters({ columnId })}
      >
        <option value="">{t('filterAllColumns')}</option>
        {columns.map((col) => <option key={col.id} value={col.id}>{col.name}</option>)}
      </FilterSelectField>
    </>
  );
}

function BoardTaskMetaSelects({
  filters,
  onUpdateFilters,
}: Pick<BoardFilterBarProps, 'filters' | 'onUpdateFilters'>) {
  const t = useTranslations('boards');
  const tPrio = useTranslations('priority');

  return (
    <>
      <FilterSelectField
        value={filters.priority === '' ? '' : String(filters.priority)}
        ariaLabel={t('filterPriorityLabel')}
        onChange={(raw) => onUpdateFilters({ priority: raw ? (Number(raw) as TaskPriority) : '' })}
      >
        <option value="">{t('filterAllPriorities')}</option>
        {[...TASK_PRIORITIES].reverse().map((level) => (
          <option key={level} value={String(level)}>{tPrio(PRIORITY_MESSAGE_KEY[level])}</option>
        ))}
      </FilterSelectField>
      <FilterSelectField
        value={filters.dueStatus}
        ariaLabel={t('filterDueLabel')}
        onChange={(dueStatus) => onUpdateFilters({ dueStatus: dueStatus as '' | TaskDueStatus })}
      >
        <option value="">{t('filterAllDue')}</option>
        {TASK_DUE_STATUSES.map((status) => (
          <option key={status} value={status}>{t(DUE_STATUS_LABEL_KEY[status])}</option>
        ))}
      </FilterSelectField>
      <FilterSelectField
        value={filters.sortBy}
        ariaLabel={t('sortByLabel')}
        onChange={(sortBy) => onUpdateFilters({ sortBy: sortBy as TaskSortBy })}
      >
        {TASK_SORT_BY_VALUES.map((key) => <option key={key} value={key}>{t(SORT_BY_LABEL_KEY[key])}</option>)}
      </FilterSelectField>
      <FilterSelectField
        value={filters.sortOrder}
        ariaLabel={t('sortOrderLabel')}
        onChange={(sortOrder) => onUpdateFilters({ sortOrder: sortOrder as TaskSortOrder })}
      >
        {TASK_SORT_ORDER_VALUES.map((order) => (
          <option key={order} value={order}>{t(SORT_ORDER_LABEL_KEY[order])}</option>
        ))}
      </FilterSelectField>
    </>
  );
}

export function BoardFilterBar({
  filters,
  columns,
  departments,
  members,
  canViewMembers,
  dndPaused,
  isFiltering = false,
  onUpdateFilters,
  onResetFilters,
}: BoardFilterBarProps) {
  const t = useTranslations('boards');

  return (
    <div className="board-filter-stack">
      <div className="board-filter-bar" role="search">
        <div className="board-filter-search">
          <input
            className="ui-input"
            type="search"
            value={filters.q}
            onChange={(e) => onUpdateFilters({ q: e.target.value })}
            placeholder={t('filterSearchPlaceholder')}
            aria-label={t('filterSearchLabel')}
          />
        </div>
        <BoardScopeSelects
          filters={filters}
          columns={columns}
          departments={departments}
          members={members}
          canViewMembers={canViewMembers}
          onUpdateFilters={onUpdateFilters}
        />
        <BoardTaskMetaSelects filters={filters} onUpdateFilters={onUpdateFilters} />
        {dndPaused ? (
          <button type="button" className="ui-btn ghost is-sm" onClick={onResetFilters}>
            {t('clearFilters')}
          </button>
        ) : null}
      </div>
      {dndPaused ? (
        <div className="ui-banner is-warn board-dnd-notice" role="status">
          <div className="ui-banner-body board-dnd-notice-body">
            <span className="ui-banner-text">
              {t('dndPausedNotice')}
              {isFiltering ? ` · ${t('filteredLoading')}` : ''}
            </span>
          </div>
          <button type="button" className="ui-btn secondary is-sm" onClick={onResetFilters}>
            {t('dndPausedReset')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
