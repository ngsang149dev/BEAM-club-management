'use client';

import { DndContext } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { usePermissions } from '@/features/shared/permissions/can';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { canDragTask, compareTasksByPosition, toColumnDragId } from '../dnd-helpers';
import { isDoneColumn } from '../filters';
import { useBoardDetailController } from '../hooks/useBoardDetailController';
import { useBoardDnd } from '../hooks/useBoardDnd';
import type { BoardDetailDto } from '../hooks/useBoards';
import { BoardColumnLane } from './BoardColumnLane';
import {
  BoardDetailErrorState,
  BoardDetailHeader,
  BoardDetailModals,
  BoardDndOverlay,
} from './BoardDetailParts';
import { BoardFilterBar } from './BoardFilterBar';
import { BoardErrorBanner } from './BoardModals';

function BoardColumnsTrack({
  board,
  ctrl,
  dnd,
}: {
  readonly board: BoardDetailDto;
  readonly ctrl: ReturnType<typeof useBoardDetailController>;
  readonly dnd: ReturnType<typeof useBoardDnd>;
}) {
  const { isAdmin, can } = usePermissions();
  const meQuery = useMeQuery(true);
  const currentUserId = meQuery.data?.profile.id;
  const currentDepartmentIds = meQuery.data?.profile.departments?.map((dept) => dept.id) ?? [];

  const sortedColumns = [...board.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  const selectedColumnId = ctrl.filterState.filters.columnId;
  const visibleColumns = selectedColumnId
    ? sortedColumns.filter((c) => c.id === selectedColumnId)
    : sortedColumns;
  const useFilteredSource = ctrl.filterState.queryDndPaused;
  const displayedTasks = useFilteredSource
    ? (ctrl.filteredTasksQuery.data?.items ?? [])
    : board.tasks;

  return (
    <SortableContext items={visibleColumns.map((c) => toColumnDragId(c.id))} strategy={horizontalListSortingStrategy}>
      <div className="kanban-cols">
        {visibleColumns.map((column) => {
          const colIdx = sortedColumns.findIndex((c) => c.id === column.id);
          const rawTasks = displayedTasks.filter((t) => t.columnId === column.id);
          const colTasks = useFilteredSource ? rawTasks : [...rawTasks].sort(compareTasksByPosition);
          const totalInColumn = board.tasks.filter((t) => t.columnId === column.id).length;

          return (
            <BoardColumnLane
              key={column.id}
              column={column}
              allColumns={sortedColumns}
              tasks={colTasks}
              columnIndex={colIdx}
              columnCount={sortedColumns.length}
              isDoneColumn={isDoneColumn(column, sortedColumns)}
              dndPaused={ctrl.filterState.dndPaused}
              isReordering={ctrl.reorderMutation.isPending}
              isMovingTask={ctrl.moveTaskMutation.isPending}
              canReorderColumns={can('board.update')}
              isDropTarget={!ctrl.filterState.dndPaused && dnd.activeDrag?.kind === 'task' && dnd.overColumnId === column.id}
              canDragTask={(task) => canDragTask({ task, isAdmin, can, currentUserId, currentDepartmentIds })}
              onMoveLeft={() => ctrl.handleMoveColumn(sortedColumns, colIdx, colIdx - 1)}
              onMoveRight={() => ctrl.handleMoveColumn(sortedColumns, colIdx, colIdx + 1)}
              onRename={() => { ctrl.renameColMutation.reset(); ctrl.setModal({ kind: 'renameColumn', column }); }}
              onDelete={() => { ctrl.deleteColMutation.reset(); ctrl.setModal({ kind: 'deleteColumn', column, visibleTaskCount: totalInColumn }); }}
              onAddTask={() => ctrl.setModal({ kind: 'createTask', column })}
              onOpenTask={ctrl.setSelectedTaskId}
              onMoveTaskToColumn={ctrl.handleMoveTaskToColumn}
            />
          );
        })}
      </div>
    </SortableContext>
  );
}

function BoardKanbanWorkspace({
  board,
  ctrl,
}: {
  readonly board: BoardDetailDto;
  readonly ctrl: ReturnType<typeof useBoardDetailController>;
}) {
  const sortedColumns = [...board.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  const dnd = useBoardDnd({
    board,
    sortedColumns,
    reorderMutation: ctrl.reorderMutation,
    moveTaskMutation: ctrl.moveTaskMutation,
  });

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <BoardColumnsTrack board={board} ctrl={ctrl} dnd={dnd} />
      <BoardDndOverlay board={board} dnd={dnd} />
    </DndContext>
  );
}

function resolveDetailDisplayState(
  board: BoardDetailDto,
  ctrl: ReturnType<typeof useBoardDetailController>
) {
  const sortedColumns = [...board.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  const departments = ctrl.departmentsQuery.data?.items ?? [];
  const members = ctrl.membersQuery.data?.items ?? [];
  const bannerError =
    ctrl.reorderMutation.error ?? ctrl.moveTaskMutation.error ?? ctrl.filteredTasksQuery.error;
  const upsertError =
    ctrl.modal.kind === 'createColumn' ? ctrl.createColMutation.error : ctrl.renameColMutation.error;
  const isUpserting = ctrl.createColMutation.isPending || ctrl.renameColMutation.isPending;
  const isFiltering = ctrl.filterState.queryDndPaused && ctrl.filteredTasksQuery.isFetching;

  return {
    sortedColumns,
    departments,
    members,
    bannerError,
    upsertError,
    isUpserting,
    isFiltering,
  };
}

function BoardDetailContent({
  board,
  ctrl,
}: {
  readonly board: BoardDetailDto;
  readonly ctrl: ReturnType<typeof useBoardDetailController>;
}) {
  const view = resolveDetailDisplayState(board, ctrl);

  return (
    <div className="board-detail-stack">
      <BoardDetailHeader
        name={board.name}
        departmentName={board.department?.name ?? null}
        archived={Boolean(board.archivedAt)}
        visibleTaskCount={board.visibleTaskCount}
        overdueTaskCount={board.overdueTaskCount}
        onAddColumn={() => { ctrl.createColMutation.reset(); ctrl.setModal({ kind: 'createColumn' }); }}
        onOpenTrash={() => ctrl.setModal({ kind: 'boardTrash' })}
      />
      <BoardFilterBar
        filters={ctrl.filterState.filters}
        columns={view.sortedColumns}
        departments={view.departments}
        members={view.members}
        canViewMembers={ctrl.canViewMembers}
        dndPaused={ctrl.filterState.dndPaused}
        isFiltering={view.isFiltering}
        onUpdateFilters={ctrl.filterState.updateFilters}
        onResetFilters={ctrl.filterState.resetFilters}
      />
      <BoardErrorBanner error={view.bannerError} />
      <BoardKanbanWorkspace board={board} ctrl={ctrl} />
      <BoardDetailModals
        boardId={board.id}
        boardName={board.name}
        columns={view.sortedColumns}
        modal={ctrl.modal}
        isUpserting={view.isUpserting}
        upsertError={view.upsertError}
        isDeleting={ctrl.deleteColMutation.isPending}
        deleteError={ctrl.deleteColMutation.error}
        onClose={ctrl.closeModal}
        onUpsert={ctrl.handleColumnUpsert}
        onDelete={ctrl.handleColumnDelete}
      />
      <TaskDetailDrawer taskId={ctrl.selectedTaskId} onClose={ctrl.closeTaskDrawer} />
    </div>
  );
}

export function BoardDetailView({
  boardId,
  initialTaskId = null,
}: {
  readonly boardId: string;
  readonly initialTaskId?: string | null;
}) {
  const tCommon = useTranslations('common');
  const ctrl = useBoardDetailController(boardId, initialTaskId);

  if (ctrl.boardQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (ctrl.boardQuery.isError || !ctrl.boardQuery.data) {
    return <BoardDetailErrorState error={ctrl.boardQuery.error} />;
  }

  return <BoardDetailContent board={ctrl.boardQuery.data.board} ctrl={ctrl} />;
}
