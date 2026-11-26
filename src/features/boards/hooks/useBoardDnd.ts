'use client';

import { useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { describeTaskError } from '@/features/tasks/error-mapping';
import {
  useUndoTaskActionToast,
  type TaskMutationResponse,
} from '@/features/tasks/hooks/useTaskEvents';
import type { TaskDto, useMoveTaskMutation } from '@/features/tasks/hooks/useTasks';
import {
  computeTaskMovePayload,
  findColumnIdForBoardTasks,
  parseDragId,
  reorderIdsWithArrayMove,
} from '../dnd-helpers';
import { describeBoardError } from '../error-mapping';
import type { BoardDetailDto, ColumnDto, useReorderColumnsMutation } from '../hooks/useBoards';

export type ActiveBoardDrag =
  | { readonly kind: 'column'; readonly id: string }
  | { readonly kind: 'task'; readonly id: string }
  | null;

const detectTaskCollisions: CollisionDetection = (args) => {
  const taskContainers = args.droppableContainers.filter((container) => {
    const kind = parseDragId(container.id)?.kind;
    return kind === 'task' || kind === 'lane';
  });
  const pointerCollisions = pointerWithin({ ...args, droppableContainers: taskContainers });
  const taskHit = pointerCollisions.filter((c) => parseDragId(c.id)?.kind === 'task');
  if (taskHit.length > 0) return taskHit;
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners({ ...args, droppableContainers: taskContainers });
};

const boardDndCollisionDetection: CollisionDetection = (args) => {
  const activeParsed = parseDragId(args.active.id);
  if (!activeParsed) return closestCenter(args);
  if (activeParsed.kind !== 'column') return detectTaskCollisions(args);

  const columnContainers = args.droppableContainers.filter(
    (container) => parseDragId(container.id)?.kind === 'column'
  );
  return closestCenter({ ...args, droppableContainers: columnContainers });
};

function resolveTaskDestination(
  board: BoardDetailDto,
  overId: UniqueIdentifier | undefined
): { readonly destinationColumnId: string; readonly overTaskId: string | null } | null {
  if (!overId) return null;
  const parsed = parseDragId(overId);
  if (!parsed) return null;
  if (parsed.kind === 'lane' || parsed.kind === 'column') {
    return { destinationColumnId: parsed.id, overTaskId: null };
  }
  const colId = findColumnIdForBoardTasks(board, parsed.id);
  return colId ? { destinationColumnId: colId, overTaskId: parsed.id } : null;
}

function submitColumnReorder({
  activeColumnId,
  overId,
  sortedColumns,
  reorderMutation,
  onSuccessMessage,
  onErrorToast,
}: {
  readonly activeColumnId: string;
  readonly overId: UniqueIdentifier;
  readonly sortedColumns: readonly ColumnDto[];
  readonly reorderMutation: ReturnType<typeof useReorderColumnsMutation>;
  readonly onSuccessMessage: string;
  readonly onErrorToast: (error: unknown) => void;
}) {
  const overCol = parseDragId(overId);
  if (!overCol || overCol.kind !== 'column') return;
  const columnIds = reorderIdsWithArrayMove(
    sortedColumns.map((col) => col.id),
    activeColumnId,
    overCol.id
  );
  if (!columnIds) return;
  reorderMutation.reset();
  reorderMutation.mutate(
    { columnIds },
    { onSuccess: () => toast.success(onSuccessMessage), onError: onErrorToast }
  );
}

function submitTaskMove({
  board,
  activeTaskId,
  overId,
  moveTaskMutation,
  onTaskMoved,
  onErrorToast,
}: {
  readonly board: BoardDetailDto;
  readonly activeTaskId: string;
  readonly overId: UniqueIdentifier;
  readonly moveTaskMutation: ReturnType<typeof useMoveTaskMutation>;
  readonly onTaskMoved: (data: TaskMutationResponse) => void;
  readonly onErrorToast: (error: unknown) => void;
}) {
  const dest = resolveTaskDestination(board, overId);
  if (!dest) return;
  const payload = computeTaskMovePayload({
    tasks: board.tasks,
    activeTaskId,
    destinationColumnId: dest.destinationColumnId,
    overTaskId: dest.overTaskId,
  });
  if (!payload) return;
  moveTaskMutation.reset();
  moveTaskMutation.mutate(
    { id: activeTaskId, payload },
    { onSuccess: onTaskMoved, onError: onErrorToast }
  );
}

interface BoardDragEndContext {
  readonly board: BoardDetailDto | undefined;
  readonly sortedColumns: readonly ColumnDto[];
  readonly reorderMutation: ReturnType<typeof useReorderColumnsMutation>;
  readonly moveTaskMutation: ReturnType<typeof useMoveTaskMutation>;
  readonly colMovedMsg: string;
  readonly onTaskMoved: (data: TaskMutationResponse) => void;
  readonly onBoardErr: (err: unknown) => void;
  readonly onTaskErr: (err: unknown) => void;
}

function handleBoardDragEnd(event: DragEndEvent, ctx: BoardDragEndContext): void {
  const overId = event.over?.id;
  if (!ctx.board || !overId) return;
  const activeParsed = parseDragId(event.active.id);
  if (!activeParsed) return;

  if (activeParsed.kind === 'column') {
    submitColumnReorder({
      activeColumnId: activeParsed.id,
      overId,
      sortedColumns: ctx.sortedColumns,
      reorderMutation: ctx.reorderMutation,
      onSuccessMessage: ctx.colMovedMsg,
      onErrorToast: ctx.onBoardErr,
    });
    return;
  }

  if (activeParsed.kind === 'task') {
    submitTaskMove({
      board: ctx.board,
      activeTaskId: activeParsed.id,
      overId,
      moveTaskMutation: ctx.moveTaskMutation,
      onTaskMoved: ctx.onTaskMoved,
      onErrorToast: ctx.onTaskErr,
    });
  }
}

function resolveActiveEntities(
  board: BoardDetailDto | undefined,
  sortedColumns: readonly ColumnDto[],
  activeDrag: ActiveBoardDrag
): { readonly activeTask: TaskDto | null; readonly activeColumn: ColumnDto | null } {
  const activeTask =
    activeDrag?.kind === 'task' && board ? board.tasks.find((t) => t.id === activeDrag.id) ?? null : null;
  const activeColumn =
    activeDrag?.kind === 'column' ? sortedColumns.find((c) => c.id === activeDrag.id) ?? null : null;
  return { activeTask, activeColumn };
}

export interface UseBoardDndParams {
  readonly board: BoardDetailDto | undefined;
  readonly sortedColumns: readonly ColumnDto[];
  readonly reorderMutation: ReturnType<typeof useReorderColumnsMutation>;
  readonly moveTaskMutation: ReturnType<typeof useMoveTaskMutation>;
}

export function useBoardDnd({ board, sortedColumns, reorderMutation, moveTaskMutation }: UseBoardDndParams) {
  const tBoards = useTranslations('boards');
  const tTasks = useTranslations('tasks');
  const tErr = useTranslations('errors');
  const showUndoToast = useUndoTaskActionToast();
  const [activeDrag, setActiveDrag] = useState<ActiveBoardDrag>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const clearDrag = () => {
    setActiveDrag(null);
    setOverColumnId(null);
  };

  const onDragStart = (event: DragStartEvent) => {
    const parsed = parseDragId(event.active.id);
    if (!parsed || parsed.kind === 'lane') return;
    setActiveDrag({ kind: parsed.kind, id: parsed.id });
    if (parsed.kind === 'task' && board) setOverColumnId(findColumnIdForBoardTasks(board, parsed.id));
  };

  const onDragOver = (event: DragOverEvent) => {
    if (!board || activeDrag?.kind !== 'task') return;
    setOverColumnId(resolveTaskDestination(board, event.over?.id)?.destinationColumnId ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    clearDrag();
    handleBoardDragEnd(event, {
      board,
      sortedColumns,
      reorderMutation,
      moveTaskMutation,
      colMovedMsg: tBoards('columnReorderedToast'),
      onTaskMoved: (data) =>
        showUndoToast({
          message: tTasks('movedToast'),
          taskId: data.task.id,
          boardId: data.task.boardId,
          eventId: data.eventId,
        }),
      onBoardErr: (err) => toast.error(tErr(describeBoardError(err)?.key ?? 'unknown')),
      onTaskErr: (err) => toast.error(tErr(describeTaskError(err)?.key ?? 'unknown')),
    });
  };

  const { activeTask, activeColumn } = resolveActiveEntities(board, sortedColumns, activeDrag);
  return {
    sensors,
    collisionDetection: boardDndCollisionDetection,
    activeDrag,
    activeTask,
    activeColumn,
    overColumnId,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel: clearDrag,
  };
}
