'use client';

import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslations } from 'next-intl';
import {
  TaskAssigneeChips,
  TaskDepartmentChips,
  TaskDueBadge,
  TaskPriorityBadge,
} from '@/features/tasks/components/TaskPriorityBadge';
import { isTaskOverdue, normalizeTaskPriority } from '@/features/tasks/formatters';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import type { TaskPriority } from '@/lib/tasks';
import { toTaskDragId } from '../dnd-helpers';
import type { ColumnDto } from '../hooks/useBoards';
import { ActionMenu, ActionMenuItem } from './ActionMenu';

export interface BoardTaskCardViewProps {
  readonly task: TaskDto;
  readonly canDrag?: boolean;
  readonly canMove?: boolean;
  readonly isDoneColumn?: boolean;
  readonly columns?: readonly ColumnDto[];
  readonly isMoving?: boolean;
  readonly isDragging?: boolean;
  readonly isOverlay?: boolean;
  readonly onOpenTask?: (taskId: string) => void;
  readonly onMoveToColumn?: (task: TaskDto, targetColumn: ColumnDto) => void;
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

function TaskMoveColumnMenu({
  task,
  columns,
  isMoving,
  onMoveToColumn,
}: {
  readonly task: TaskDto;
  readonly columns: readonly ColumnDto[];
  readonly isMoving: boolean;
  readonly onMoveToColumn: (task: TaskDto, targetColumn: ColumnDto) => void;
}) {
  const tTasks = useTranslations('tasks');
  const otherColumns = columns.filter((col) => col.id !== task.columnId);
  if (otherColumns.length === 0) return null;

  return (
    <div
      className="task-card-menu"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ActionMenu label={tTasks('taskActionsMenu')}>
        <div className="task-card-menu-label">{tTasks('moveToColumnMenu')}</div>
        {otherColumns.map((col) => (
          <ActionMenuItem key={col.id} disabled={isMoving} onSelect={() => onMoveToColumn(task, col)}>
            {col.name}
          </ActionMenuItem>
        ))}
      </ActionMenu>
    </div>
  );
}

type BoardTaskCardTopProps = Pick<
  BoardTaskCardViewProps,
  | 'task'
  | 'canDrag'
  | 'canMove'
  | 'columns'
  | 'isMoving'
  | 'isOverlay'
  | 'onOpenTask'
  | 'onMoveToColumn'
  | 'dragHandleAttributes'
  | 'dragHandleKeyDown'
>;

function HiddenTaskEyeIcon() {
  return (
    <svg className="ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.3A9.8 9.8 0 0 1 12 5.2c5.7 0 9 6.8 9 6.8a17 17 0 0 1-2.4 3.4" />
      <path d="M6.2 6.9C3.8 8.7 3 12 3 12s3.3 6.8 9 6.8c1.2 0 2.3-.3 3.3-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function BoardTaskCardTop(props: BoardTaskCardTopProps) {
  const { task, canDrag, canMove, columns, isMoving, isOverlay, onOpenTask, onMoveToColumn } = props;
  const tTasks = useTranslations('tasks');

  return (
    <div className="kanban-card-top">
      <button
        type="button"
        className="kanban-card-open"
        onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
      >
        <span className="kanban-card-title">{task.title}</span>
      </button>
      <div className="kanban-card-top-right">
        {task.isHidden ? (
          <span className="ui-chip task-hidden-chip">
            <HiddenTaskEyeIcon />
            <span>{tTasks('hiddenBadge')}</span>
          </span>
        ) : null}
        {canDrag ? (
          <button
            type="button"
            className="kanban-drag-handle"
            aria-label={tTasks('dragTaskHint')}
            title={tTasks('dragTaskHint')}
            {...props.dragHandleAttributes}
            onKeyDown={props.dragHandleKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            ⋮⋮
          </button>
        ) : null}
        {!isOverlay && canMove && columns && onMoveToColumn ? (
          <TaskMoveColumnMenu
            task={task}
            columns={columns}
            isMoving={Boolean(isMoving)}
            onMoveToColumn={onMoveToColumn}
          />
        ) : null}
      </div>
    </div>
  );
}

export function BoardTaskCardView({
  task,
  canDrag = false,
  canMove = false,
  isDoneColumn = false,
  columns = [],
  isMoving = false,
  isDragging = false,
  isOverlay = false,
  onOpenTask,
  onMoveToColumn,
  cardPointerDown,
  dragHandleAttributes,
  dragHandleKeyDown,
}: BoardTaskCardViewProps) {
  const tTasks = useTranslations('tasks');
  const priorityLevel = normalizeTaskPriority(task.priority);
  const cardClass = buildTaskCardClass({
    priorityLevel,
    isOverdue: !isDoneColumn && isTaskOverdue(task.dueAt),
    isHidden: task.isHidden,
    canDrag,
    isDragging,
    isOverlay,
  });

  return (
    <article className={cardClass} onPointerDown={cardPointerDown}>
      <BoardTaskCardTop
        task={task}
        canDrag={canDrag}
        canMove={canMove}
        columns={columns}
        isMoving={isMoving}
        isOverlay={isOverlay}
        onOpenTask={onOpenTask}
        onMoveToColumn={onMoveToColumn}
        dragHandleAttributes={dragHandleAttributes}
        dragHandleKeyDown={dragHandleKeyDown}
      />
      <div className="kanban-card-signals">
        <TaskPriorityBadge priority={task.priority} />
        <TaskDueBadge dueAt={task.dueAt} suppressOverdue={isDoneColumn} />
      </div>
      <div className="kanban-card-meta">
        <span className="ui-chip">{tTasks('commentsCount', { count: task.commentCount })}</span>
      </div>
      <TaskDepartmentChips departments={task.assignedDepartments} />
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
  canMove,
  isDoneColumn,
  columns,
  isMoving,
  onOpenTask,
  onMoveToColumn,
}: {
  readonly task: TaskDto;
  readonly canDrag: boolean;
  readonly canMove: boolean;
  readonly isDoneColumn: boolean;
  readonly columns: readonly ColumnDto[];
  readonly isMoving: boolean;
  readonly onOpenTask: (taskId: string) => void;
  readonly onMoveToColumn: (task: TaskDto, targetColumn: ColumnDto) => void;
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
        canMove={canMove}
        isDoneColumn={isDoneColumn}
        columns={columns}
        isMoving={isMoving}
        isDragging={isDragging}
        onOpenTask={onOpenTask}
        onMoveToColumn={onMoveToColumn}
        cardPointerDown={getPointerDownHandler(canDrag, listeners)}
        dragHandleAttributes={canDrag ? attributes : undefined}
        dragHandleKeyDown={getKeyDownHandler(canDrag, listeners)}
      />
    </div>
  );
}
