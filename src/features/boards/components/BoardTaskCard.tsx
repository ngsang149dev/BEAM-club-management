'use client';

import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslations } from 'next-intl';
import {
  TaskAssigneeChips,
  TaskDueBadge,
  TaskPriorityBadge,
} from '@/features/tasks/components/TaskPriorityBadge';
import { isTaskOverdue, normalizeTaskPriority } from '@/features/tasks/formatters';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import type { TaskPriority } from '@/lib/tasks';
import { toTaskDragId } from '../dnd-helpers';

export interface BoardTaskCardViewProps {
  readonly task: TaskDto;
  readonly canDrag?: boolean;
  readonly isDragging?: boolean;
  readonly isOverlay?: boolean;
  readonly onOpenTask?: (taskId: string) => void;
  readonly cardPointerDown?: PointerEventHandler<HTMLElement>;
  readonly dragHandleAttributes?: DraggableAttributes;
  readonly dragHandleKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}

function buildTaskCardClass({
  priorityLevel,
  isOverdue,
  isHidden,
  canDrag,
  isDragging,
  isOverlay,
}: {
  readonly priorityLevel: TaskPriority;
  readonly isOverdue: boolean;
  readonly isHidden: boolean;
  readonly canDrag: boolean;
  readonly isDragging: boolean;
  readonly isOverlay: boolean;
}): string {
  const classes = ['kanban-card', `prio-p${priorityLevel}`];
  if (isOverdue) classes.push('is-overdue');
  if (isHidden) classes.push('is-hidden');
  if (canDrag) classes.push('is-draggable');
  if (isDragging) classes.push('is-dragging');
  if (isOverlay) classes.push('is-drag-overlay');
  return classes.join(' ');
}

export function BoardTaskCardView({
  task,
  canDrag = false,
  isDragging = false,
  isOverlay = false,
  onOpenTask,
  cardPointerDown,
  dragHandleAttributes,
  dragHandleKeyDown,
}: BoardTaskCardViewProps) {
  const tTasks = useTranslations('tasks');
  const priorityLevel = normalizeTaskPriority(task.priority);
  const cardClass = buildTaskCardClass({
    priorityLevel,
    isOverdue: isTaskOverdue(task.dueAt),
    isHidden: task.isHidden,
    canDrag,
    isDragging,
    isOverlay,
  });

  return (
    <article className={cardClass} onPointerDown={cardPointerDown}>
      <div className="kanban-card-top">
        <button
          type="button"
          className="kanban-card-open"
          onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
        >
          <span className="kanban-card-title">{task.title}</span>
        </button>
        <div className="kanban-card-top-right">
          {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
          {canDrag ? (
            <button
              type="button"
              className="kanban-drag-handle"
              aria-label={tTasks('dragTaskHint')}
              title={tTasks('dragTaskHint')}
              {...dragHandleAttributes}
              onKeyDown={dragHandleKeyDown}
              onClick={(event) => event.stopPropagation()}
            >
              ⋮⋮
            </button>
          ) : null}
        </div>
      </div>
      <div className="kanban-card-signals">
        <TaskPriorityBadge priority={task.priority} />
        <TaskDueBadge dueAt={task.dueAt} />
      </div>
      <div className="kanban-card-meta">
        <span className="ui-chip">{tTasks('commentsCount', { count: task.commentCount })}</span>
      </div>
      <TaskAssigneeChips assignees={task.assignees} />
    </article>
  );
}

function getPointerDownHandler(
  enabled: boolean,
  listeners: DraggableSyntheticListeners
): PointerEventHandler<HTMLElement> | undefined {
  if (!enabled || !listeners?.onPointerDown) return undefined;
  return listeners.onPointerDown as PointerEventHandler<HTMLElement>;
}

function getKeyDownHandler(
  enabled: boolean,
  listeners: DraggableSyntheticListeners
): KeyboardEventHandler<HTMLButtonElement> | undefined {
  if (!enabled || !listeners?.onKeyDown) return undefined;
  return listeners.onKeyDown as KeyboardEventHandler<HTMLButtonElement>;
}

export function SortableBoardTaskCard({
  task,
  canDrag,
  onOpenTask,
}: {
  readonly task: TaskDto;
  readonly canDrag: boolean;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: toTaskDragId(task.id),
    disabled: !canDrag,
    data: { kind: 'task', task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <BoardTaskCardView
        task={task}
        canDrag={canDrag}
        isDragging={isDragging}
        onOpenTask={onOpenTask}
        cardPointerDown={getPointerDownHandler(canDrag, listeners)}
        dragHandleAttributes={canDrag ? attributes : undefined}
        dragHandleKeyDown={getKeyDownHandler(canDrag, listeners)}
      />
    </div>
  );
}
