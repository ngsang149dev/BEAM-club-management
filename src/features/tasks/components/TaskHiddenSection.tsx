'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { usePermissions } from '@/features/shared/permissions/can';
import { useUpdateTaskHiddenMutation, type TaskDto } from '../hooks/useTasks';
import { TaskErrorBanner } from './TaskFormFields';

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

function HiddenToggleButton({
  isHidden,
  isPending,
  onToggle,
}: {
  readonly isHidden: boolean;
  readonly isPending: boolean;
  readonly onToggle: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const label = isPending
    ? tTasks('hiddenTogglePending')
    : isHidden
      ? tTasks('hiddenToggleShow')
      : tTasks('hiddenToggleHide');

  return (
    <div className="task-section-actions">
      <button
        type="button"
        role="switch"
        aria-checked={isHidden}
        className={isHidden ? 'ui-btn secondary is-sm' : 'ui-btn ghost is-sm'}
        disabled={isPending}
        onClick={onToggle}
      >
        {label}
      </button>
    </div>
  );
}

export function TaskHiddenSection({
  task,
  onReload,
}: {
  readonly task: TaskDto;
  readonly onReload: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const { isAdmin } = usePermissions();
  const meQuery = useMeQuery(true);
  const hiddenMutation = useUpdateTaskHiddenMutation(task.boardId);

  if (!canToggleTaskHidden({ isAdmin, creatorId: task.creator.id, currentUserId: meQuery.data?.profile.id })) {
    return null;
  }

  const isUnassigned = task.assignees.length === 0 && task.assignedDepartments.length === 0;
  const handleToggle = () => {
    const nextHidden = !task.isHidden;
    hiddenMutation.mutate(
      { id: task.id, payload: { isHidden: nextHidden, version: task.version } },
      { onSuccess: () => toast.success(nextHidden ? tTasks('hiddenEnabledToast') : tTasks('hiddenDisabledToast')) },
    );
  };

  return (
    <section className="task-drawer-section task-hidden-section">
      <div className="task-hidden-head">
        <h3 className="task-section-title">{tTasks('hiddenSectionTitle')}</h3>
        <span className={task.isHidden ? 'ui-chip task-hidden-chip' : 'ui-chip'}>
          {task.isHidden ? tTasks('hiddenStatusHidden') : tTasks('hiddenStatusPublic')}
        </span>
      </div>
      <TaskErrorBanner error={hiddenMutation.error} onReloadConflict={onReload} />
      <p className="ui-field-hint">
        {task.isHidden ? tTasks('hiddenStatusHiddenDesc') : tTasks('hiddenStatusPublicDesc')}
      </p>
      {isUnassigned ? <UnassignedHiddenWarning /> : null}
      <HiddenToggleButton
        isHidden={task.isHidden}
        isPending={hiddenMutation.isPending}
        onToggle={handleToggle}
      />
    </section>
  );
}
