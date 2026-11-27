'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { usePermissions } from '@/features/shared/permissions/can';
import { hasTaskVersionChanged } from '../drawer-helpers';
import { useUndoTaskActionToast } from '../hooks/useTaskEvents';
import { useUpdateTaskHiddenMutation, type TaskDto } from '../hooks/useTasks';
import { TaskErrorBanner } from './TaskFormFields';
import { TaskToggleCard } from './TaskToggleCard';

export function canToggleTaskHidden({
  isAdmin,
  creatorId,
  currentUserId,
}: {
  readonly isAdmin: boolean;
  readonly creatorId: string;
  readonly currentUserId: string | null | undefined;
}): boolean {
  if (isAdmin) return true;
  return Boolean(currentUserId && creatorId === currentUserId);
}

export function HiddenLockIcon() {
  return (
    <svg className="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnassignedHiddenWarning() {
  const tTasks = useTranslations('tasks');
  return (
    <div className="ui-banner is-warn" role="status">
      <div className="ui-banner-body">
        <span className="ui-banner-title">{tTasks('hiddenUnassignedWarnTitle')}</span>
        <span className="ui-banner-text">{tTasks('hiddenUnassignedWarnBody')}</span>
      </div>
    </div>
  );
}

function useTaskHiddenToggleController(task: TaskDto) {
  const tTasks = useTranslations('tasks');
  const { isAdmin } = usePermissions();
  const meQuery = useMeQuery(true);
  const hiddenMutation = useUpdateTaskHiddenMutation(task.boardId);
  const { isError: isHiddenError, reset: resetHiddenMutation } = hiddenMutation;
  const syncedRef = useRef({ id: task.id, version: task.version });
  const showUndoToast = useUndoTaskActionToast();

  useEffect(() => {
    if (!hasTaskVersionChanged(syncedRef.current, task.id, task.version)) return;
    syncedRef.current = { id: task.id, version: task.version };
    if (isHiddenError) resetHiddenMutation();
  }, [task.id, task.version, isHiddenError, resetHiddenMutation]);

  const canToggle = canToggleTaskHidden({
    isAdmin,
    creatorId: task.creator.id,
    currentUserId: meQuery.data?.profile.id,
  });

  const handleToggle = () => {
    const nextHidden = !task.isHidden;
    hiddenMutation.mutate(
      { id: task.id, payload: { isHidden: nextHidden, version: task.version } },
      {
        onSuccess: (data) =>
          showUndoToast({
            message: nextHidden ? tTasks('hiddenEnabledToast') : tTasks('hiddenDisabledToast'),
            taskId: data.task.id,
            boardId: data.task.boardId,
            eventId: data.eventId,
          }),
      }
    );
  };

  return { canToggle, hiddenMutation, handleToggle };
}

export function TaskHiddenSection({
  task,
  onReload,
}: {
  readonly task: TaskDto;
  readonly onReload: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const { canToggle, hiddenMutation, handleToggle } = useTaskHiddenToggleController(task);
  if (!canToggle) return null;

  const isUnassigned = task.assignees.length === 0 && task.assignedDepartments.length === 0;
  const toggleLabel = hiddenMutation.isPending
    ? tTasks('hiddenTogglePending')
    : task.isHidden
      ? tTasks('hiddenToggleShow')
      : tTasks('hiddenToggleHide');

  return (
    <section className="task-side-card task-hidden-section">
      <div className="task-hidden-head">
        <h3 className="task-section-title">{tTasks('hiddenSectionTitle')}</h3>
        <span className={task.isHidden ? 'ui-chip task-hidden-chip' : 'ui-chip'}>
          {task.isHidden ? tTasks('hiddenStatusHidden') : tTasks('hiddenStatusPublic')}
        </span>
      </div>
      <TaskErrorBanner
        error={hiddenMutation.error}
        onReloadConflict={() => {
          hiddenMutation.reset();
          onReload();
        }}
      />
      <p className="ui-field-hint">
        {task.isHidden ? tTasks('hiddenStatusHiddenDesc') : tTasks('hiddenStatusPublicDesc')}
      </p>
      {isUnassigned ? <UnassignedHiddenWarning /> : null}
      <TaskToggleCard
        checked={task.isHidden}
        disabled={hiddenMutation.isPending}
        label={toggleLabel}
        icon={<HiddenLockIcon />}
        onToggle={handleToggle}
      />
    </section>
  );
}
