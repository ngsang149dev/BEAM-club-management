'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { TaskCommentsSection } from '@/features/comments/components/TaskCommentsSection';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { usePermissions } from '@/features/shared/permissions/can';
import { formatTaskDateTime } from '../formatters';
import { useTaskDetailQuery, type TaskDto } from '../hooks/useTasks';
import {
  type DrawerTab,
  TaskDrawerErrorBody,
  TaskDrawerHiddenBanner,
  TaskDrawerReadOnlyBody,
  TaskDrawerTabBar,
} from './TaskDrawerChrome';
import {
  TaskAssigneesSection,
  TaskDeleteSection,
  TaskEditFormSection,
} from './TaskDrawerSections';
import { canToggleTaskHidden, TaskHiddenSection } from './TaskHiddenSection';
import { TaskHistorySection } from './TaskHistorySection';
import {
  MemberInlineName,
  TaskAssigneeChips,
  TaskDepartmentChips,
  TaskDueBadge,
  TaskPriorityBadge,
} from './TaskPriorityBadge';

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

function TaskDrawerSidebar({
  task,
  canAssign,
  canToggleHidden,
  canDelete,
  onReload,
  onClose,
}: {
  task: TaskDto;
  canAssign: boolean;
  canToggleHidden: boolean;
  canDelete: boolean;
  onReload: () => void;
  onClose: () => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
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
      {canAssign ? <TaskAssigneesSection task={task} onReload={onReload} /> : null}
      {canToggleHidden ? <TaskHiddenSection task={task} onReload={onReload} /> : null}
      {canDelete ? <TaskDeleteSection task={task} onDeleted={onClose} /> : null}
    </div>
  );
}

function TaskDrawerLoaded({
  task,
  onReload,
  onClose,
  onOpenComments,
}: {
  task: TaskDto;
  onReload: () => void;
  onClose: () => void;
  onOpenComments: () => void;
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
    <div className="task-drawer-grid">
      <div className="task-drawer-col-main">
        <TaskDrawerHiddenBanner isHidden={task.isHidden} />
        <div className="task-drawer-badges">
          <TaskPriorityBadge priority={task.priority} />
          <TaskDueBadge dueAt={task.dueAt} />
          <button
            type="button"
            className="ui-chip task-comments-jump-chip"
            onClick={onOpenComments}
          >
            {tTasks('commentsCount', { count: task.commentCount })}
          </button>
        </div>
        <div className="task-drawer-meta-grid">
          <div><span>{tTasks('creatorLabel')}</span><b><MemberInlineName member={task.creator} /></b></div>
          <div><span>{tTasks('createdAtLabel')}</span><b className="mono">{formatTaskDateTime(task.createdAt, locale)}</b></div>
        </div>
        {canEdit ? <TaskEditFormSection task={task} onReload={onReload} /> : <TaskDrawerReadOnlyBody task={task} />}
      </div>
      <TaskDrawerSidebar
        task={task}
        canAssign={can('task.assign')}
        canToggleHidden={canToggleHidden}
        canDelete={can('task.delete')}
        onReload={onReload}
        onClose={onClose}
      />
    </div>
  );
}

export function TaskDrawerActiveTabPanel({
  activeTab,
  task,
  tabIds,
  panelIds,
  onReload,
  onClose,
  onOpenComments,
}: {
  readonly activeTab: DrawerTab;
  readonly task: TaskDto;
  readonly tabIds: { details: string; comments: string; history: string };
  readonly panelIds: { details: string; comments: string; history: string };
  readonly onReload: () => void;
  readonly onClose: () => void;
  readonly onOpenComments: () => void;
}) {
  if (activeTab === 'details') {
    return (
      <div id={panelIds.details} role="tabpanel" aria-labelledby={tabIds.details} className="ui-drawer-body task-drawer-tabpanel">
        <TaskDrawerLoaded key={task.id} task={task} onReload={onReload} onClose={onClose} onOpenComments={onOpenComments} />
      </div>
    );
  }
  if (activeTab === 'comments') {
    return (
      <div id={panelIds.comments} role="tabpanel" aria-labelledby={tabIds.comments} className="task-drawer-comments-panel">
        <TaskCommentsSection taskId={task.id} boardId={task.boardId} commentCount={task.commentCount} />
      </div>
    );
  }
  return (
    <div id={panelIds.history} role="tabpanel" aria-labelledby={tabIds.history} className="task-drawer-history-panel">
      <TaskHistorySection task={task} onTaskDeleted={onClose} />
    </div>
  );
}

function TaskDrawerTabsShell({
  task,
  onReload,
  onClose,
}: {
  task: TaskDto;
  onReload: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('details');
  const tabIds = { details: useId(), comments: useId(), history: useId() };
  const panelIds = { details: useId(), comments: useId(), history: useId() };

  return (
    <>
      <TaskDrawerTabBar
        activeTab={activeTab}
        commentCount={task.commentCount}
        detailsTabId={tabIds.details}
        commentsTabId={tabIds.comments}
        historyTabId={tabIds.history}
        detailsPanelId={panelIds.details}
        commentsPanelId={panelIds.comments}
        historyPanelId={panelIds.history}
        onSelect={setActiveTab}
      />
      <TaskDrawerActiveTabPanel
        activeTab={activeTab}
        task={task}
        tabIds={tabIds}
        panelIds={panelIds}
        onReload={onReload}
        onClose={onClose}
        onOpenComments={() => setActiveTab('comments')}
      />
    </>
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
          <TaskDrawerTabsShell key={task.id} task={task} onReload={() => taskQuery.refetch()} onClose={onClose} />
        ) : null}
      </aside>
    </div>
  );
}
