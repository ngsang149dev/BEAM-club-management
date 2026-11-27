'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { describeTaskError } from '../error-mapping';
import { getCalendarDeadlineTier, getTodayVnIso } from '../formatters';
import {
  DEFAULT_MY_TASKS_FILTERS,
  useMyTasksInfiniteQuery,
  useTaskDepartmentsQuery,
  type DepartmentDto,
  type MyTasksDeadlineFilter,
  type MyTasksFiltersState,
  type TaskDto,
} from '../hooks/useTasks';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TaskDeadlineBadge, TaskDepartmentChips } from './TaskPriorityBadge';

const DEADLINE_OPTIONS: readonly { readonly value: MyTasksDeadlineFilter; readonly key: string }[] = [
  { value: 'overdue', key: 'deadlineOverdue' },
  { value: 'urgent', key: 'deadlineUrgent' },
  { value: 'soon', key: 'deadlineSoon' },
  { value: 'safe', key: 'deadlineSafe' },
  { value: 'done', key: 'deadlineDone' },
];

function MyTasksDepartmentSelect({
  value,
  departments,
  onChange,
}: {
  value: string;
  departments: readonly DepartmentDto[];
  onChange: (departmentId: string) => void;
}) {
  const t = useTranslations('myTasks');
  return (
    <div className="directory-filter-select">
      <select
        className="ui-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('departmentFilterLabel')}
      >
        <option value="">{t('allDepartments')}</option>
        {departments.map((dept) => (
          <option key={dept.id} value={dept.id}>{dept.name}</option>
        ))}
      </select>
    </div>
  );
}

function MyTasksDeadlineSelect({
  value,
  onChange,
}: {
  readonly value: MyTasksDeadlineFilter;
  readonly onChange: (next: MyTasksDeadlineFilter) => void;
}) {
  const t = useTranslations('myTasks');
  return (
    <div className="directory-filter-select">
      <select
        className="ui-select"
        value={value}
        onChange={(e) => onChange(e.target.value as MyTasksDeadlineFilter)}
        aria-label={t('deadlineFilterLabel')}
      >
        <option value="">{t('allDeadlines')}</option>
        {DEADLINE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
        ))}
      </select>
    </div>
  );
}

function MyTasksToolbar({
  filters,
  departments,
  onFiltersChange,
}: {
  filters: MyTasksFiltersState;
  departments: readonly DepartmentDto[];
  onFiltersChange: (updater: (prev: MyTasksFiltersState) => MyTasksFiltersState) => void;
}) {
  const t = useTranslations('myTasks');

  return (
    <div className="directory-toolbar-stack">
      <div className="directory-toolbar">
        <div className="directory-search">
          <input
            className="ui-input"
            type="search"
            value={filters.q}
            onChange={(e) => onFiltersChange((prev) => ({ ...prev, q: e.target.value }))}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
          />
        </div>
        <MyTasksDepartmentSelect
          value={filters.departmentId}
          departments={departments}
          onChange={(departmentId) => onFiltersChange((prev) => ({ ...prev, departmentId }))}
        />
        <MyTasksDeadlineSelect
          value={filters.deadlineFilter}
          onChange={(deadlineFilter) => onFiltersChange((prev) => ({ ...prev, deadlineFilter }))}
        />
        <label className="ui-check-inline">
          <input
            type="checkbox"
            checked={filters.includeDone}
            onChange={(e) => onFiltersChange((prev) => ({ ...prev, includeDone: e.target.checked }))}
          />
          <span>{t('includeDoneLabel')}</span>
        </label>
      </div>
    </div>
  );
}

function MyTaskRow({
  task,
  currentUserId,
  todayIso,
  onSelect,
}: {
  readonly task: TaskDto;
  readonly currentUserId: string | undefined;
  readonly todayIso: string;
  readonly onSelect: () => void;
}) {
  const t = useTranslations('myTasks');
  const tTasks = useTranslations('tasks');
  const tier = getCalendarDeadlineTier(task, todayIso);
  const myAssignee = currentUserId ? task.assignees.find((a) => a.id === currentUserId) : undefined;
  const accepted = Boolean(myAssignee?.acceptedAt);
  const rowClass = `my-task-row deadline-${tier}`;

  return (
    <button type="button" className={rowClass} onClick={onSelect}>
      <span className="my-task-row-main">
        <span className="my-task-row-title">
          <span>{task.title}</span>
          {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
        </span>
        {task.assignedDepartments.length > 0 ? (
          <TaskDepartmentChips departments={task.assignedDepartments} />
        ) : null}
        <span className="my-task-row-meta">
          <span className={`task-accept-pill ${accepted ? 'is-accepted' : 'is-pending'}`}>
            {accepted ? t('acceptedBadge') : t('pendingAcceptBadge')}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t('deliverableCount', { count: task.deliverableCount })}</span>
          <span aria-hidden="true">·</span>
          <span>{tTasks('commentsCount', { count: task.commentCount })}</span>
        </span>
      </span>
      <span className="my-task-row-due">
        <TaskDeadlineBadge dueAt={task.dueAt} isCompleted={task.isCompleted} todayIso={todayIso} />
      </span>
    </button>
  );
}

function MyTasksQueryErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('myTasks');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeTaskError(error);

  return (
    <ErrorState
      variant="500"
      title={t('loadError')}
      description={tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function MyTasksEmptyState({ onResetFilters }: { onResetFilters: () => void }) {
  const t = useTranslations('myTasks');

  return (
    <div className="admin-card admin-empty-box">
      <h2 className="admin-card-title">{t('emptyTitle')}</h2>
      <p className="admin-card-hint">{t('emptyDescription')}</p>
      <div className="admin-row-actions">
        <Link href="/tasks" className="ui-btn primary is-sm">{t('openCalendar')}</Link>
        <button type="button" className="ui-btn ghost is-sm" onClick={onResetFilters}>{t('resetFilters')}</button>
      </div>
    </div>
  );
}

function MyTasksListBody(props: {
  readonly tasks: readonly TaskDto[];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly currentUserId: string | undefined;
  readonly todayIso: string;
  readonly onRetry: () => void;
  readonly onFetchNext: () => void;
  readonly onSelectTask: (id: string) => void;
  readonly onResetFilters: () => void;
}) {
  const t = useTranslations('myTasks');
  const tCommon = useTranslations('common');

  if (props.isPending) return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  if (props.isError) return <MyTasksQueryErrorState error={props.error} onRetry={props.onRetry} />;
  if (props.tasks.length === 0) return <MyTasksEmptyState onResetFilters={props.onResetFilters} />;

  return (
    <div className="admin-card directory-list-card">
      <div className="my-tasks-list">
        {props.tasks.map((task) => (
          <MyTaskRow
            key={task.id}
            task={task}
            currentUserId={props.currentUserId}
            todayIso={props.todayIso}
            onSelect={() => props.onSelectTask(task.id)}
          />
        ))}
      </div>
      {props.hasNextPage ? (
        <div className="directory-load-more">
          <button type="button" className="ui-btn ghost" onClick={props.onFetchNext} disabled={props.isFetchingNextPage}>
            {props.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function MyTasksView() {
  const t = useTranslations('myTasks');
  const [filters, setFilters] = useState<MyTasksFiltersState>(DEFAULT_MY_TASKS_FILTERS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const meQuery = useMeQuery(true);
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const tasksQuery = useMyTasksInfiniteQuery(filters, true);
  const todayIso = getTodayVnIso();
  const rawTasks = tasksQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const visibleTasks = filters.deadlineFilter
    ? rawTasks.filter((task) => getCalendarDeadlineTier(task, todayIso) === filters.deadlineFilter)
    : rawTasks;

  return (
    <div className="admin-page-stack">
      <div className="directory-header-row is-end">
        <span className="ui-chip">{t('summaryCount', { count: visibleTasks.length })}</span>
      </div>
      <MyTasksToolbar
        filters={filters}
        departments={departmentsQuery.data?.items ?? []}
        onFiltersChange={setFilters}
      />
      <MyTasksListBody
        tasks={visibleTasks}
        isPending={tasksQuery.isPending}
        isError={tasksQuery.isError}
        error={tasksQuery.error}
        hasNextPage={Boolean(tasksQuery.hasNextPage)}
        isFetchingNextPage={tasksQuery.isFetchingNextPage}
        currentUserId={meQuery.data?.profile.id}
        todayIso={todayIso}
        onRetry={() => tasksQuery.refetch()}
        onFetchNext={() => tasksQuery.fetchNextPage()}
        onSelectTask={setSelectedTaskId}
        onResetFilters={() => setFilters(DEFAULT_MY_TASKS_FILTERS)}
      />
      <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </div>
  );
}
