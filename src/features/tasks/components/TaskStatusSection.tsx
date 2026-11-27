'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { hasTaskVersionChanged } from '../drawer-helpers';
import { useUndoTaskActionToast } from '../hooks/useTaskEvents';
import { useUpdateTaskMutation, type TaskDto } from '../hooks/useTasks';
import { TaskErrorBanner } from './TaskFormFields';

function useTaskStatusController(task: TaskDto) {
  const tTasks = useTranslations('tasks');
  const updateMutation = useUpdateTaskMutation();
  const showUndoToast = useUndoTaskActionToast();
  const { isError, reset } = updateMutation;
  const syncedRef = useRef({ id: task.id, version: task.version });

  useEffect(() => {
    if (!hasTaskVersionChanged(syncedRef.current, task.id, task.version)) return;
    syncedRef.current = { id: task.id, version: task.version };
    if (isError) reset();
  }, [task.id, task.version, isError, reset]);

  const handleStatusChange = (nextValue: string) => {
    const nextCompleted = nextValue === 'completed';
    if (nextCompleted === task.isCompleted) return;
    updateMutation.mutate(
      { id: task.id, payload: { isCompleted: nextCompleted, version: task.version } },
      {
        onSuccess: (data) =>
          showUndoToast({
            message: tTasks('updatedToast'),
            taskId: data.task.id,
            boardId: data.task.boardId,
            eventId: data.eventId,
          }),
      }
    );
  };

  return { updateMutation, handleStatusChange };
}

export function TaskStatusSection({
  task,
  canEdit,
  onReload,
}: {
  readonly task: TaskDto;
  readonly canEdit: boolean;
  readonly onReload: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const selectId = useId();
  const { updateMutation, handleStatusChange } = useTaskStatusController(task);

  return (
    <section className="task-side-card">
      <label className="task-section-title" htmlFor={canEdit ? selectId : undefined}>
        {tTasks('statusLabel')}
      </label>
      <TaskErrorBanner
        error={updateMutation.error}
        onReloadConflict={() => {
          updateMutation.reset();
          onReload();
        }}
      />
      {canEdit ? (
        <select
          id={selectId}
          className="ui-select"
          value={task.isCompleted ? 'completed' : 'active'}
          disabled={updateMutation.isPending}
          onChange={(e) => handleStatusChange(e.target.value)}
        >
          <option value="active">{tTasks('statusActive')}</option>
          <option value="completed">{tTasks('statusDone')}</option>
        </select>
      ) : (
        <span className={`task-status-pill${task.isCompleted ? ' is-done' : ''}`}>
          {task.isCompleted ? tTasks('statusDone') : tTasks('statusActive')}
        </span>
      )}
    </section>
  );
}
