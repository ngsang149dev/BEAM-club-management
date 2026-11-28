'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { TaskCommentsSection } from '@/features/comments/components/TaskCommentsSection';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import { usePermissions } from '@/features/shared/permissions/can';
import {
  useTaskDepartmentsQuery,
  useTaskDetailQuery,
  type DepartmentDto,
  type TaskDto,
} from '../hooks/useTasks';
import { TaskAcceptanceSection } from './TaskAcceptanceSection';
import { TaskDeliverablesSection } from './TaskDeliverablesSection';
import {
  type ModalSubTab,
  TaskDrawerErrorBody,
  TaskDrawerHiddenBanner,
  TaskDrawerReadOnlyBody,
  TaskModalHeader,
  TaskModalSubTabs,
} from './TaskDrawerChrome';
import {
  TaskAssigneesSection,
  TaskDeleteSection,
  TaskEditFormSection,
} from './TaskDrawerSections';
import { canToggleTaskHidden, TaskHiddenSection } from './TaskHiddenSection';
import { TaskHistorySection } from './TaskHistorySection';
import { TaskStatusSection } from './TaskStatusSection';

function isActorAssigned(
  currentUserId: string | null | undefined,
  currentDepartmentIds: readonly string[],
  assignees: TaskDto['assignees'],
  assignedDepartments: TaskDto['assignedDepartments']
): boolean {
  if (!currentUserId) return false;
  return (
    assignees.some((assignee) => assignee.id === currentUserId) ||
    assignedDepartments.some((dept) => currentDepartmentIds.includes(dept.id))
  );
}

function resolveCanEditTask({
  isAdmin,
  can,
  isAssigned,
}: {
  isAdmin: boolean;
  can: ReturnType<typeof usePermissions>['can'];
  isAssigned: boolean;
}): boolean {
  if (isAdmin || can('task.update_any')) return true;
  return can('task.update_assigned') && isAssigned;
}

function TaskModalLeftColumn({
  task,
  canEdit,
  isAssigned,
  currentUserId,
  isAdmin,
  canUpdateAny,
  departments,
  onReload,
  onClose,
}: {
  readonly task: TaskDto;
  readonly canEdit: boolean;
  readonly isAssigned: boolean;
  readonly currentUserId: string | null | undefined;
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
  readonly departments: readonly DepartmentDto[];
  readonly onReload: () => void;
  readonly onClose: () => void;
}) {
  const [subTab, setSubTab] = useState<ModalSubTab>('comments');

  return (
    <div className="task-modal-col-main">
      <TaskDrawerHiddenBanner isHidden={task.isHidden} />
      <div className="task-modal-details-card">
        {canEdit ? <TaskEditFormSection task={task} onReload={onReload} /> : <TaskDrawerReadOnlyBody task={task} />}
      </div>
      <TaskDeliverablesSection
        task={task}
        canSubmit={canEdit || isAssigned}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        canUpdateAny={canUpdateAny}
        departments={departments}
      />
      <div className="task-modal-activity-card">
        <TaskModalSubTabs subTab={subTab} commentCount={task.commentCount} onSelect={setSubTab} />
        {subTab === 'comments' ? (
          <TaskCommentsSection taskId={task.id} commentCount={task.commentCount} />
        ) : (
          <TaskHistorySection task={task} onTaskDeleted={onClose} />
        )}
      </div>
    </div>
  );
}

function TaskModalRightColumn({
  task,
  canEdit,
  isAssigned,
  currentUserId,
  departments,
  canAssign,
  canToggleHidden,
  canDelete,
  onReload,
  onClose,
}: {
  readonly task: TaskDto;
  readonly canEdit: boolean;
  readonly isAssigned: boolean;
  readonly currentUserId: string | null | undefined;
  readonly departments: readonly DepartmentDto[];
  readonly canAssign: boolean;
  readonly canToggleHidden: boolean;
  readonly canDelete: boolean;
  readonly onReload: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="task-modal-col-side">
      <TaskStatusSection task={task} canEdit={canEdit} onReload={onReload} />
      <TaskAcceptanceSection
        task={task}
        isAssigned={isAssigned}
        currentUserId={currentUserId}
        departments={departments}
      />
      {canAssign ? <TaskAssigneesSection task={task} onReload={onReload} /> : null}
      {canToggleHidden ? (
        <TaskHiddenSection task={task} currentUserId={currentUserId} onReload={onReload} />
      ) : null}
      {canDelete ? <TaskDeleteSection task={task} onDeleted={onClose} /> : null}
    </div>
  );
}

export function TaskDrawerLoaded({
  task,
  onReload,
  onClose,
}: {
  task: TaskDto;
  onReload: () => void;
  onClose: () => void;
}) {
  const { isAdmin, can } = usePermissions();
  const meQuery = useMeQuery(true);
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const currentUserId = meQuery.data?.profile.id;
  const currentDepartmentIds = meQuery.data?.profile.departments?.map((dept) => dept.id) ?? [];
  const isAssigned = isActorAssigned(currentUserId, currentDepartmentIds, task.assignees, task.assignedDepartments);
  const canEdit = resolveCanEditTask({ isAdmin, can, isAssigned });
  const canToggleHidden = canToggleTaskHidden({ isAdmin, creatorId: task.creator.id, currentUserId });
  const departments = departmentsQuery.data?.items ?? [];

  return (
    <div className="task-modal-grid">
      <TaskModalLeftColumn
        task={task}
        canEdit={canEdit}
        isAssigned={isAssigned}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        canUpdateAny={can('task.update_any')}
        departments={departments}
        onReload={onReload}
        onClose={onClose}
      />
      <TaskModalRightColumn
        task={task}
        canEdit={canEdit}
        isAssigned={isAssigned}
        currentUserId={currentUserId}
        departments={departments}
        canAssign={can('task.assign')}
        canToggleHidden={canToggleHidden}
        canDelete={can('task.delete')}
        onReload={onReload}
        onClose={onClose}
      />
    </div>
  );
}

export interface TaskDetailDrawerProps {
  taskId: string | null;
  onClose: () => void;
}

export function TaskDetailDrawer({ taskId, onClose }: TaskDetailDrawerProps) {
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(Boolean(taskId), onClose);

  const taskQuery = useTaskDetailQuery(taskId);
  if (!taskId) return null;
  const task = taskQuery.data?.task ?? null;

  return (
    <div
      className="task-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="task-modal-shell" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <TaskModalHeader titleId={titleId} task={task} onClose={onClose} />
        {taskQuery.isPending ? (
          <div className="task-modal-body"><p className="auth-loading" role="status">{tCommon('loading')}</p></div>
        ) : taskQuery.isError ? (
          <TaskDrawerErrorBody error={taskQuery.error} onClose={onClose} onRetry={() => taskQuery.refetch()} />
        ) : task ? (
          <div className="task-modal-body">
            <TaskDrawerLoaded key={task.id} task={task} onReload={() => taskQuery.refetch()} onClose={onClose} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
