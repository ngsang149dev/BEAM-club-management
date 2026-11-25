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
  readonly allColumns: readonly ColumnDto[];
  readonly tasks: readonly TaskDto[];
  readonly columnIndex: number;
  readonly columnCount: number;
  readonly isDoneColumn: boolean;
  readonly dndPaused: boolean;
  readonly isReordering: boolean;
  readonly isMovingTask: boolean;
  readonly canReorderColumns: boolean;
  readonly isDropTarget: boolean;
  readonly canDragTask: (task: TaskDto) => boolean;
  readonly onMoveLeft: () => void;
  readonly onMoveRight: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onAddTask: () => void;
  readonly onOpenTask: (taskId: string) => void;
  readonly onMoveTaskToColumn: (task: TaskDto, targetColumn: ColumnDto) => void;
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
  allColumns,
  tasks,
  isDoneColumn,
  dndPaused,
  isDropTarget,
  isMovingTask,
  canDragTask,
  onOpenTask,
  onMoveTaskToColumn,
}: {
  readonly columnId: string;
  readonly allColumns: readonly ColumnDto[];
  readonly tasks: readonly TaskDto[];
  readonly isDoneColumn: boolean;
  readonly dndPaused: boolean;
  readonly isDropTarget: boolean;
  readonly isMovingTask: boolean;
  readonly canDragTask: (task: TaskDto) => boolean;
  readonly onOpenTask: (taskId: string) => void;
  readonly onMoveTaskToColumn: (task: TaskDto, targetColumn: ColumnDto) => void;
}) {
  const t = useTranslations('boards');
  const { setNodeRef } = useDroppable({
    id: toLaneDropId(columnId),
    disabled: dndPaused,
    data: { kind: 'lane', columnId },
  });
  const taskDragIds = tasks.map((task) => toTaskDragId(task.id));

  return (
    <div ref={setNodeRef} className="kanban-col-body">
      <SortableContext items={taskDragIds} strategy={verticalListSortingStrategy}>
        {tasks.length === 0 ? (
          <p className="kanban-col-empty">{isDropTarget ? t('dropHereHint') : t('emptyColumn')}</p>
        ) : (
          tasks.map((task) => {
            const canMove = canDragTask(task);
            return (
              <SortableBoardTaskCard
                key={task.id}
                task={task}
                canDrag={canMove && !dndPaused}
                canMove={canMove}
                isDoneColumn={isDoneColumn}
                columns={allColumns}
                isMoving={isMovingTask}
                onOpenTask={onOpenTask}
                onMoveToColumn={onMoveTaskToColumn}
              />
            );
          })
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
  const allowColumnDrag = props.canReorderColumns && !props.dndPaused;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: toColumnDragId(column.id),
    disabled: !allowColumnDrag,
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
          canReorderColumns={allowColumnDrag}
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
        allColumns={props.allColumns}
        tasks={tasks}
        isDoneColumn={props.isDoneColumn}
        dndPaused={props.dndPaused}
        isDropTarget={props.isDropTarget}
        isMovingTask={props.isMovingTask}
        canDragTask={props.canDragTask}
        onOpenTask={props.onOpenTask}
        onMoveTaskToColumn={props.onMoveTaskToColumn}
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
