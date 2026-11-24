'use client';

import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslations } from 'next-intl';
import { Can } from '@/features/shared/permissions/can';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import { toColumnDragId, toLaneDropId, toTaskDragId } from '../dnd-helpers';
import type { ColumnDto } from '../hooks/useBoards';
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from './ActionMenu';
import { SortableBoardTaskCard } from './BoardTaskCard';

function BoardColumnActionMenu({
  columnIndex,
  columnCount,
  isReordering,
  onMoveLeft,
  onMoveRight,
  onRename,
  onDelete,
}: {
  readonly columnIndex: number;
  readonly columnCount: number;
  readonly isReordering: boolean;
  readonly onMoveLeft: () => void;
  readonly onMoveRight: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const t = useTranslations('boards');

  return (
    <Can permission="board.update">
      <ActionMenu label={t('columnActionsMenu')}>
        <ActionMenuItem onSelect={onRename}>{t('renameColumn')}</ActionMenuItem>
        <ActionMenuItem disabled={columnIndex === 0 || isReordering} onSelect={onMoveLeft}>
          ← {t('moveColumnLeft')}
        </ActionMenuItem>
        <ActionMenuItem disabled={columnIndex === columnCount - 1 || isReordering} onSelect={onMoveRight}>
          → {t('moveColumnRight')}
        </ActionMenuItem>
        <ActionMenuSeparator />
        <ActionMenuItem variant="danger" onSelect={onDelete}>
          {t('deleteColumn')}
        </ActionMenuItem>
      </ActionMenu>
    </Can>
  );
}

export function BoardColumnOverlayPreview({
  column,
  taskCount,
}: {
  readonly column: ColumnDto;
  readonly taskCount: number;
}) {
  const t = useTranslations('boards');

  return (
    <div className="kanban-col is-drag-overlay">
      <div className="kanban-col-head">
        <div className="kanban-col-title-wrap">
          <span className="kanban-drag-handle" aria-hidden="true">⋮⋮</span>
          <h2 className="kanban-col-name">{column.name}</h2>
          <span className="ui-chip">{t('columnTaskCount', { count: taskCount })}</span>
        </div>
      </div>
    </div>
  );
}

export interface BoardColumnLaneProps {
  readonly column: ColumnDto;
  readonly tasks: readonly TaskDto[];
  readonly columnIndex: number;
  readonly columnCount: number;
  readonly isReordering: boolean;
  readonly canReorderColumns: boolean;
  readonly isDropTarget: boolean;
  readonly canDragTask: (task: TaskDto) => boolean;
  readonly onMoveLeft: () => void;
  readonly onMoveRight: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onAddTask: () => void;
  readonly onOpenTask: (taskId: string) => void;
}

function BoardColumnTitleBar({
  name,
  taskCount,
  canReorderColumns,
  attributes,
  listeners,
  menu,
}: {
  readonly name: string;
  readonly taskCount: number;
  readonly canReorderColumns: boolean;
  readonly attributes: ReturnType<typeof useSortable>['attributes'];
  readonly listeners: ReturnType<typeof useSortable>['listeners'];
  readonly menu: ReactNode;
}) {
  const t = useTranslations('boards');

  return (
    <div className="kanban-col-title-wrap">
      {canReorderColumns ? (
        <button
          type="button"
          className="kanban-drag-handle"
          aria-label={t('dragColumnHandle')}
          title={t('dragColumnHandle')}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
      ) : null}
      <h2 className="kanban-col-name">{name}</h2>
      <span className="ui-chip">{t('columnTaskCount', { count: taskCount })}</span>
      {menu}
    </div>
  );
}

function BoardColumnLaneBody({
  columnId,
  tasks,
  isDropTarget,
  canDragTask,
  onOpenTask,
}: {
  readonly columnId: string;
  readonly tasks: readonly TaskDto[];
  readonly isDropTarget: boolean;
  readonly canDragTask: (task: TaskDto) => boolean;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const t = useTranslations('boards');
  const { setNodeRef } = useDroppable({
    id: toLaneDropId(columnId),
    data: { kind: 'lane', columnId },
  });
  const taskDragIds = tasks.map((task) => toTaskDragId(task.id));

  return (
    <div ref={setNodeRef} className="kanban-col-body">
      <SortableContext items={taskDragIds} strategy={verticalListSortingStrategy}>
        {tasks.length === 0 ? (
          <p className="kanban-col-empty">{isDropTarget ? t('dropHereHint') : t('emptyColumn')}</p>
        ) : (
          tasks.map((task) => (
            <SortableBoardTaskCard
              key={task.id}
              task={task}
              canDrag={canDragTask(task)}
              onOpenTask={onOpenTask}
            />
          ))
        )}
      </SortableContext>
    </div>
  );
}

function getColumnLaneClass(isDropTarget: boolean, isDragging: boolean): string {
  const classes = ['kanban-col'];
  if (isDropTarget) classes.push('is-drop-target');
  if (isDragging) classes.push('is-dragging');
  return classes.join(' ');
}

export function BoardColumnLane(props: BoardColumnLaneProps) {
  const { column, tasks } = props;
  const t = useTranslations('boards');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: toColumnDragId(column.id),
    disabled: !props.canReorderColumns,
    data: { kind: 'column', column },
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={getColumnLaneClass(props.isDropTarget, isDragging)}
      aria-label={column.name}
    >
      <header className="kanban-col-head">
        <BoardColumnTitleBar
          name={column.name}
          taskCount={tasks.length}
          canReorderColumns={props.canReorderColumns}
          attributes={attributes}
          listeners={listeners}
          menu={
            <BoardColumnActionMenu
              columnIndex={props.columnIndex}
              columnCount={props.columnCount}
              isReordering={props.isReordering}
              onMoveLeft={props.onMoveLeft}
              onMoveRight={props.onMoveRight}
              onRename={props.onRename}
              onDelete={props.onDelete}
            />
          }
        />
      </header>
      <BoardColumnLaneBody
        columnId={column.id}
        tasks={tasks}
        isDropTarget={props.isDropTarget}
        canDragTask={props.canDragTask}
        onOpenTask={props.onOpenTask}
      />
      <Can permission="task.create">
        <div className="kanban-col-foot">
          <button type="button" className="ui-btn ghost is-sm kanban-add-task-btn" onClick={props.onAddTask}>
            + {t('addTaskInColumn')}
          </button>
        </div>
      </Can>
    </section>
  );
}
