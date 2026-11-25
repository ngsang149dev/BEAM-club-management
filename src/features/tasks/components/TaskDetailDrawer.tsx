'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { TaskCommentsSection } from '@/features/comments/components/TaskCommentsSection';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { usePermissions } from '@/features/shared/permissions/can';
import { describeTaskError } from '../error-mapping';
import { formatTaskDateTime } from '../formatters';
import { useTaskDetailQuery, type TaskDto } from '../hooks/useTasks';
import {
  TaskAssigneesSection,
  TaskDeleteSection,
  TaskEditFormSection,
} from './TaskDrawerSections';
import { canToggleTaskHidden, TaskHiddenSection } from './TaskHiddenSection';
import {
  MemberInlineName,
  TaskAssigneeChips,
  TaskDepartmentChips,
  TaskDueBadge,
  TaskPriorityBadge,
} from './TaskPriorityBadge';

function TaskDrawerReadOnlyBody({ task }: { task: TaskDto }) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-readonly-box">
      <div className="ui-banner" role="status">
        <div className="ui-banner-body"><span className="ui-banner-text">{tTasks('readOnlyNotice')}</span></div>
      </div>
      <h3 className="task-detail-title">{task.title}</h3>
      <p className="task-detail-desc">{task.description || '—'}</p>
    </div>
  );
}

function resolveCanEditTask({
  isAdmin,
  can,
  currentUserId,
  currentDepartmentIds,
  assignees,
  assignedDepartments,
}: {
  isAdmin: boolean;
  can: ReturnType<typeof usePermissions>['can'];
  currentUserId: string | null | undefined;
  currentDepartmentIds: readonly string[];
  assignees: TaskDto['assignees'];
  assignedDepartments: TaskDto['assignedDepartments'];
}): boolean {
  if (isAdmin || can('task.update_any')) return true;
  if (!can('task.update_assigned') || !currentUserId) return false;
  return (
    assignees.some((assignee) => assignee.id === currentUserId) ||
    assignedDepartments.some((dept) => currentDepartmentIds.includes(dept.id))
  );
}

function TaskDrawerHiddenBanner({ isHidden }: { isHidden: boolean }) {
  const tTasks = useTranslations('tasks');
  if (!isHidden) return null;

  return (
    <div className="ui-banner is-warn" role="status">
      <div className="ui-banner-body">
        <span className="ui-banner-title">{tTasks('hiddenBannerTitle')}</span>
        <span className="ui-banner-text">{tTasks('hiddenBannerBody')}</span>
      </div>
    </div>
  );
}

function TaskDrawerLoaded({
  task,
  onReload,
  onClose,
}: {
  task: TaskDto;
  onReload: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const tTasks = useTranslations('tasks');
  const { isAdmin, can } = usePermissions();
  const meQuery = useMeQuery(true);
  const currentUserId = meQuery.data?.profile.id;
  const currentDepartmentIds = meQuery.data?.profile.departments?.map((dept) => dept.id) ?? [];
  const canEdit = resolveCanEditTask({
    isAdmin,
    can,
    currentUserId,
    currentDepartmentIds,
    assignees: task.assignees,
    assignedDepartments: task.assignedDepartments,
  });
  const canToggleHidden = canToggleTaskHidden({ isAdmin, creatorId: task.creator.id, currentUserId });

  return (
    <div className="ui-drawer-body">
      <div className="task-drawer-grid">
        <div className="task-drawer-col-main">
          <TaskDrawerHiddenBanner isHidden={task.isHidden} />
          <div className="task-drawer-badges">
            <TaskPriorityBadge priority={task.priority} />
            <TaskDueBadge dueAt={task.dueAt} />
            <span className="ui-chip">{tTasks('commentsCount', { count: task.commentCount })}</span>
          </div>
          <div className="task-drawer-meta-grid">
            <div><span>{tTasks('creatorLabel')}</span><b><MemberInlineName member={task.creator} /></b></div>
            <div><span>{tTasks('createdAtLabel')}</span><b className="mono">{formatTaskDateTime(task.createdAt, locale)}</b></div>
          </div>
          {canEdit ? <TaskEditFormSection task={task} onReload={onReload} /> : <TaskDrawerReadOnlyBody task={task} />}
          <TaskCommentsSection taskId={task.id} boardId={task.boardId} commentCount={task.commentCount} />
        </div>
        <div className="task-drawer-col-side">
          <section className="task-assigned-summary">
            <div className="task-assigned-summary-group">
              <h3 className="task-section-title">{tTasks('assignedDepartmentsLabel')}</h3>
              <TaskDepartmentChips departments={task.assignedDepartments} emptyLabel={tTasks('departmentsEmpty')} />
            </div>
            <div className="task-assigned-summary-group">
              <h3 className="task-section-title">{tTasks('assigneesLabel')}</h3>
              <TaskAssigneeChips assignees={task.assignees} />
            </div>
          </section>
          {can('task.assign') ? <TaskAssigneesSection task={task} onReload={onReload} /> : null}
          {canToggleHidden ? <TaskHiddenSection task={task} onReload={onReload} /> : null}
          {can('task.delete') ? <TaskDeleteSection task={task} onDeleted={onClose} /> : null}
        </div>
      </div>
    </div>
  );
}

function TaskDrawerErrorBody({
  error,
  onClose,
  onRetry,
}: {
  error: unknown;
  onClose: () => void;
  onRetry: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeTaskError(error);
  const isNotFound = err?.key === 'notFound';

  return (
    <div className="ui-drawer-body">
      <ErrorState
        variant={isNotFound ? '404' : '500'}
        code={isNotFound ? tErr('404.code') : undefined}
        title={isNotFound ? tErr('404.title') : tTasks('loadError')}
        description={isNotFound ? tErr('404.description') : tErr(err?.key ?? 'unknown')}
        requestId={err?.requestId}
        requestIdLabel={tErr('requestIdLabel')}
        actions={
          <button type="button" className="ui-btn primary" onClick={() => (isNotFound ? onClose() : onRetry())}>
            {isNotFound ? tCommon('close') : tCommon('retry')}
          </button>
        }
      />
    </div>
  );
}

export interface TaskDetailDrawerProps {
  taskId: string | null;
  onClose: () => void;
}

export function TaskDetailDrawer({ taskId, onClose }: TaskDetailDrawerProps) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(Boolean(taskId), onClose);

  const taskQuery = useTaskDetailQuery(taskId);
  if (!taskId) return null;
  const task = taskQuery.data?.task ?? null;

  return (
    <div className="ui-drawer-backdrop" role="presentation">
      <aside className="ui-drawer ui-drawer-task" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{tTasks('drawerTitle')}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        {taskQuery.isPending ? (
          <div className="ui-drawer-body"><p className="auth-loading" role="status">{tCommon('loading')}</p></div>
        ) : taskQuery.isError ? (
          <TaskDrawerErrorBody error={taskQuery.error} onClose={onClose} onRetry={() => taskQuery.refetch()} />
        ) : task ? (
          <TaskDrawerLoaded key={`${task.id}-v${task.version}`} task={task} onReload={() => taskQuery.refetch()} onClose={onClose} />
        ) : null}
      </aside>
    </div>
  );
}
