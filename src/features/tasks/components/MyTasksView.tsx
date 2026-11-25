'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { TASK_PRIORITIES, type TaskPriority } from '@/lib/tasks';
import { describeTaskError } from '../error-mapping';
import { PRIORITY_MESSAGE_KEY, isTaskOverdue, normalizeTaskPriority } from '../formatters';
import {
  DEFAULT_MY_TASKS_FILTERS,
  useMyTasksInfiniteQuery,
  useTaskDepartmentsQuery,
  type DepartmentDto,
  type MyTasksFiltersState,
  type TaskDto,
} from '../hooks/useTasks';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TaskDepartmentChips, TaskDueBadge, TaskPriorityBadge } from './TaskPriorityBadge';

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
  const tPrio = useTranslations('priority');

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
        <div className="directory-filter-select">
          <select
            className="ui-select"
            value={filters.priority === '' ? '' : String(filters.priority)}
            onChange={(e) => {
              const raw = e.target.value;
              const next: '' | TaskPriority = raw ? (Number(raw) as TaskPriority) : '';
              onFiltersChange((prev) => ({ ...prev, priority: next }));
            }}
            aria-label={t('priorityFilterLabel')}
          >
            <option value="">{t('allPriorities')}</option>
            {[...TASK_PRIORITIES].reverse().map((level) => (
              <option key={level} value={String(level)}>{tPrio(PRIORITY_MESSAGE_KEY[level])}</option>
            ))}
          </select>
        </div>
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

function MyTaskRow({ task, onSelect }: { task: TaskDto; onSelect: () => void }) {
  const tTasks = useTranslations('tasks');
  const level = normalizeTaskPriority(task.priority);
  const overdue = isTaskOverdue(task.dueAt);
  const rowClass = `my-task-row prio-p${level}${overdue ? ' is-overdue' : ''}`;

  return (
    <button type="button" className={rowClass} onClick={onSelect}>
      <span className="my-task-row-prio"><TaskPriorityBadge priority={task.priority} /></span>
      <span className="my-task-row-main">
        <span className="my-task-row-title">
          {task.title}
          {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
        </span>
        {task.assignedDepartments.length > 0 ? (
          <TaskDepartmentChips departments={task.assignedDepartments} />
        ) : null}
        <span className="my-task-row-meta">{tTasks('commentsCount', { count: task.commentCount })}</span>
      </span>
      <span className="my-task-row-due"><TaskDueBadge dueAt={task.dueAt} /></span>
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
        <Link href="/boards" className="ui-btn primary is-sm">{t('openBoards')}</Link>
        <button type="button" className="ui-btn ghost is-sm" onClick={onResetFilters}>{t('resetFilters')}</button>
      </div>
    </div>
  );
}

function MyTasksListBody({
  tasksQuery,
  onSelectTask,
  onResetFilters,
}: {
  tasksQuery: ReturnType<typeof useMyTasksInfiniteQuery>;
  onSelectTask: (id: string) => void;
  onResetFilters: () => void;
}) {
  const t = useTranslations('myTasks');
  const tCommon = useTranslations('common');

  if (tasksQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (tasksQuery.isError) {
    return <MyTasksQueryErrorState error={tasksQuery.error} onRetry={() => tasksQuery.refetch()} />;
  }

  const tasks = tasksQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (tasks.length === 0) {
    return <MyTasksEmptyState onResetFilters={onResetFilters} />;
  }

  return (
    <div className="admin-card directory-list-card">
      <div className="my-tasks-list">
        {tasks.map((task) => (
          <MyTaskRow key={task.id} task={task} onSelect={() => onSelectTask(task.id)} />
        ))}
      </div>
      {tasksQuery.hasNextPage ? (
        <div className="directory-load-more">
          <button type="button" className="ui-btn ghost" onClick={() => tasksQuery.fetchNextPage()} disabled={tasksQuery.isFetchingNextPage}>
            {tasksQuery.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
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
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const tasksQuery = useMyTasksInfiniteQuery(filters, true);
  const count = tasksQuery.data?.pages.flatMap((page) => page.items).length ?? 0;

  return (
    <div className="admin-page-stack">
      <div className="directory-header-row is-end">
        <span className="ui-chip">{t('summaryCount', { count })}</span>
      </div>
      <MyTasksToolbar
        filters={filters}
        departments={departmentsQuery.data?.items ?? []}
        onFiltersChange={setFilters}
      />
      <MyTasksListBody
        tasksQuery={tasksQuery}
        onSelectTask={setSelectedTaskId}
        onResetFilters={() => setFilters(DEFAULT_MY_TASKS_FILTERS)}
      />
      <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </div>
  );
}
