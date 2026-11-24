'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { Can, usePermissions } from '@/features/shared/permissions/can';
import { CreateTaskModal } from '@/features/tasks/components/CreateTaskModal';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { useMoveTaskMutation } from '@/features/tasks/hooks/useTasks';
import type { UpdateColumnRequestInput } from '@/lib/boards';
import { canDragTask, compareTasksByPosition, toColumnDragId } from '../dnd-helpers';
import { describeBoardError } from '../error-mapping';
import { useBoardDnd } from '../hooks/useBoardDnd';
import {
  useBoardDetailQuery,
  useCreateColumnMutation,
  useDeleteColumnMutation,
  useRenameColumnMutation,
  useReorderColumnsMutation,
  type BoardDetailDto,
  type ColumnDto,
} from '../hooks/useBoards';
import { BoardColumnLane, BoardColumnOverlayPreview } from './BoardColumnLane';
import { BoardErrorBanner } from './BoardModals';
import { BoardTaskCardView } from './BoardTaskCard';
import { ColumnDeleteModal, ColumnUpsertModal } from './ColumnModals';

type BoardDetailModal =
  | { kind: 'closed' }
  | { kind: 'createColumn' }
  | { kind: 'renameColumn'; column: ColumnDto }
  | { kind: 'deleteColumn'; column: ColumnDto; visibleTaskCount: number }
  | { kind: 'createTask'; column: ColumnDto };

function swapColumnOrder(columns: readonly ColumnDto[], fromIndex: number, toIndex: number): string[] {
  const next = [...columns];
  const current = next[fromIndex];
  const target = next[toIndex];
  if (!current || !target) return next.map((c) => c.id);
  next[fromIndex] = target;
  next[toIndex] = current;
  return next.map((c) => c.id);
}

function useBoardDetailController(boardId: string) {
  const t = useTranslations('boards');
  const [modal, setModal] = useState<BoardDetailModal>({ kind: 'closed' });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const boardQuery = useBoardDetailQuery(boardId);
  const createColMutation = useCreateColumnMutation(boardId);
  const renameColMutation = useRenameColumnMutation(boardId);
  const deleteColMutation = useDeleteColumnMutation(boardId);
  const reorderMutation = useReorderColumnsMutation(boardId);
  const moveTaskMutation = useMoveTaskMutation(boardId);

  const closeModal = () => {
    createColMutation.reset();
    renameColMutation.reset();
    deleteColMutation.reset();
    setModal({ kind: 'closed' });
  };

  return {
    modal,
    setModal,
    selectedTaskId,
    setSelectedTaskId,
    boardQuery,
    createColMutation,
    renameColMutation,
    deleteColMutation,
    reorderMutation,
    moveTaskMutation,
    closeModal,
    handleColumnUpsert: (values: UpdateColumnRequestInput) => {
      if (modal.kind === 'createColumn') {
        createColMutation.mutate(values, {
          onSuccess: (res) => { toast.success(t('columnCreatedToast', { name: res.column.name })); closeModal(); },
        });
        return;
      }
      if (modal.kind === 'renameColumn') {
        renameColMutation.mutate({ columnId: modal.column.id, payload: values }, {
          onSuccess: (res) => { toast.success(t('columnRenamedToast', { name: res.column.name })); closeModal(); },
        });
      }
    },
    handleColumnDelete: () => {
      if (modal.kind !== 'deleteColumn') return;
      deleteColMutation.mutate(modal.column.id, {
        onSuccess: () => { toast.success(t('columnDeletedToast')); closeModal(); },
      });
    },
    handleMoveColumn: (columns: readonly ColumnDto[], fromIdx: number, toIdx: number) => {
      reorderMutation.reset();
      reorderMutation.mutate(
        { columnIds: swapColumnOrder(columns, fromIdx, toIdx) },
        { onSuccess: () => toast.success(t('columnReorderedToast')) }
      );
    },
  };
}

function BoardDetailModals({
  boardId,
  ctrl,
}: {
  readonly boardId: string;
  readonly ctrl: ReturnType<typeof useBoardDetailController>;
}) {
  const { modal } = ctrl;
  if (modal.kind === 'createColumn' || modal.kind === 'renameColumn') {
    return (
      <ColumnUpsertModal
        key={modal.kind === 'renameColumn' ? modal.column.id : 'create-col'}
        mode={modal.kind === 'createColumn' ? 'create' : 'rename'}
        column={modal.kind === 'renameColumn' ? modal.column : undefined}
        isSubmitting={ctrl.createColMutation.isPending || ctrl.renameColMutation.isPending}
        error={modal.kind === 'createColumn' ? ctrl.createColMutation.error : ctrl.renameColMutation.error}
        onClose={ctrl.closeModal}
        onSubmit={ctrl.handleColumnUpsert}
      />
    );
  }
  if (modal.kind === 'deleteColumn') {
    return (
      <ColumnDeleteModal
        column={modal.column}
        visibleTaskCount={modal.visibleTaskCount}
        isDeleting={ctrl.deleteColMutation.isPending}
        error={ctrl.deleteColMutation.error}
        onClose={ctrl.closeModal}
        onConfirm={ctrl.handleColumnDelete}
      />
    );
  }
  if (modal.kind === 'createTask') {
    return <CreateTaskModal boardId={boardId} columnId={modal.column.id} columnName={modal.column.name} onClose={ctrl.closeModal} />;
  }
  return null;
}

function BoardDetailErrorState({ error }: { readonly error: unknown }) {
  const t = useTranslations('boards');
  const tErr = useTranslations('errors');
  const err = describeBoardError(error);
  const isNotFound = err?.key === 'notFound';

  return (
    <ErrorState
      variant={isNotFound ? '404' : '500'}
      code={isNotFound ? tErr('404.code') : undefined}
      title={isNotFound ? tErr('404.title') : t('detailLoadError')}
      description={isNotFound ? tErr('404.description') : tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<Link href="/boards" className="ui-btn primary">{t('backToBoards')}</Link>}
    />
  );
}

function BoardDetailHeader({
  name,
  departmentName,
  archived,
  onAddColumn,
}: {
  readonly name: string;
  readonly departmentName: string | null;
  readonly archived: boolean;
  readonly onAddColumn: () => void;
}) {
  const t = useTranslations('boards');

  return (
    <div className="board-detail-header">
      <div className="board-detail-title-group">
        <Link href="/boards" className="ui-btn ghost is-sm">← {t('backToBoards')}</Link>
        <h1 className="board-detail-heading">{name}</h1>
        <span className="ui-chip">{departmentName ?? t('clubWideLabel')}</span>
        {archived ? <span className="status-pill is-inactive">{t('archivedBadge')}</span> : null}
      </div>
      <Can permission="board.update">
        <button type="button" className="ui-btn primary is-sm" onClick={onAddColumn}>
          + {t('addColumn')}
        </button>
      </Can>
    </div>
  );
}

function BoardDndOverlay({
  board,
  dnd,
}: {
  readonly board: BoardDetailDto;
  readonly dnd: ReturnType<typeof useBoardDnd>;
}) {
  const activeColTaskCount = dnd.activeColumn
    ? board.tasks.filter((task) => task.columnId === dnd.activeColumn?.id).length
    : 0;

  return (
    <DragOverlay>
      {dnd.activeTask ? <BoardTaskCardView task={dnd.activeTask} isOverlay /> : null}
      {dnd.activeColumn ? (
        <BoardColumnOverlayPreview column={dnd.activeColumn} taskCount={activeColTaskCount} />
      ) : null}
    </DragOverlay>
  );
}

function BoardKanbanWorkspace({
  board,
  ctrl,
}: {
  readonly board: BoardDetailDto;
  readonly ctrl: ReturnType<typeof useBoardDetailController>;
}) {
  const { isAdmin, can } = usePermissions();
  const meQuery = useMeQuery(true);
  const currentUserId = meQuery.data?.profile.id;
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
      <SortableContext items={sortedColumns.map((c) => toColumnDragId(c.id))} strategy={horizontalListSortingStrategy}>
        <div className="kanban-cols">
          {sortedColumns.map((column, index) => {
            const colTasks = board.tasks.filter((t) => t.columnId === column.id).sort(compareTasksByPosition);
            return (
              <BoardColumnLane
                key={column.id}
                column={column}
                tasks={colTasks}
                columnIndex={index}
                columnCount={sortedColumns.length}
                isReordering={ctrl.reorderMutation.isPending}
                canReorderColumns={can('board.update')}
                isDropTarget={dnd.activeDrag?.kind === 'task' && dnd.overColumnId === column.id}
                canDragTask={(task) => canDragTask({ task, isAdmin, can, currentUserId })}
                onMoveLeft={() => ctrl.handleMoveColumn(sortedColumns, index, index - 1)}
                onMoveRight={() => ctrl.handleMoveColumn(sortedColumns, index, index + 1)}
                onRename={() => { ctrl.renameColMutation.reset(); ctrl.setModal({ kind: 'renameColumn', column }); }}
                onDelete={() => { ctrl.deleteColMutation.reset(); ctrl.setModal({ kind: 'deleteColumn', column, visibleTaskCount: colTasks.length }); }}
                onAddTask={() => ctrl.setModal({ kind: 'createTask', column })}
                onOpenTask={ctrl.setSelectedTaskId}
              />
            );
          })}
        </div>
      </SortableContext>
      <BoardDndOverlay board={board} dnd={dnd} />
    </DndContext>
  );
}

export function BoardDetailView({ boardId }: { readonly boardId: string }) {
  const tCommon = useTranslations('common');
  const ctrl = useBoardDetailController(boardId);

  if (ctrl.boardQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (ctrl.boardQuery.isError || !ctrl.boardQuery.data) {
    return <BoardDetailErrorState error={ctrl.boardQuery.error} />;
  }

  const { board } = ctrl.boardQuery.data;

  return (
    <div className="board-detail-stack">
      <BoardDetailHeader
        name={board.name}
        departmentName={board.department?.name ?? null}
        archived={Boolean(board.archivedAt)}
        onAddColumn={() => { ctrl.createColMutation.reset(); ctrl.setModal({ kind: 'createColumn' }); }}
      />
      <BoardErrorBanner error={ctrl.reorderMutation.error ?? ctrl.moveTaskMutation.error} />
      <BoardKanbanWorkspace board={board} ctrl={ctrl} />
      <BoardDetailModals boardId={boardId} ctrl={ctrl} />
      <TaskDetailDrawer taskId={ctrl.selectedTaskId} onClose={() => ctrl.setSelectedTaskId(null)} />
    </div>
  );
}
