'use client';

import Link from 'next/link';
import { DragOverlay } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { TrashBinIcon } from '@/components/TrashIcons';
import { Can } from '@/features/shared/permissions/can';
import { CreateTaskModal } from '@/features/tasks/components/CreateTaskModal';
import { isDoneColumn } from '../filters';
import { describeBoardError } from '../error-mapping';
import type { useBoardDnd } from '../hooks/useBoardDnd';
import type { BoardDetailDto, ColumnDto } from '../hooks/useBoards';
import { BoardColumnOverlayPreview } from './BoardColumnLane';
import { BoardTaskCardView } from './BoardTaskCard';
import { BoardTrashModal } from './BoardTrashModal';
import { ColumnDeleteModal, ColumnUpsertModal } from './ColumnModals';

export type BoardDetailModalState =
  | { kind: 'closed' }
  | { kind: 'createColumn' }
  | { kind: 'renameColumn'; column: ColumnDto }
  | { kind: 'deleteColumn'; column: ColumnDto; visibleTaskCount: number }
  | { kind: 'createTask'; column: ColumnDto }
  | { kind: 'boardTrash' };

export interface BoardDetailModalsProps {
  readonly boardId: string;
  readonly boardName?: string;
  readonly columns?: readonly ColumnDto[];
  readonly modal: BoardDetailModalState;
  readonly isUpserting: boolean;
  readonly upsertError: unknown;
  readonly isDeleting: boolean;
  readonly deleteError: unknown;
  readonly onClose: () => void;
  readonly onUpsert: (values: { name: string }) => void;
  readonly onDelete: () => void;
}

export function BoardDetailModals(props: BoardDetailModalsProps) {
  const { modal } = props;
  if (modal.kind === 'createColumn' || modal.kind === 'renameColumn') {
    return (
      <ColumnUpsertModal
        key={modal.kind === 'renameColumn' ? modal.column.id : 'create-col'}
        mode={modal.kind === 'createColumn' ? 'create' : 'rename'}
        column={modal.kind === 'renameColumn' ? modal.column : undefined}
        isSubmitting={props.isUpserting}
        error={props.upsertError}
        onClose={props.onClose}
        onSubmit={props.onUpsert}
      />
    );
  }
  if (modal.kind === 'deleteColumn') {
    return (
      <ColumnDeleteModal
        column={modal.column}
        visibleTaskCount={modal.visibleTaskCount}
        isDeleting={props.isDeleting}
        error={props.deleteError}
        onClose={props.onClose}
        onConfirm={props.onDelete}
      />
    );
  }
  if (modal.kind === 'createTask') {
    return (
      <CreateTaskModal
        boardId={props.boardId}
        columnId={modal.column.id}
        columnName={modal.column.name}
        onClose={props.onClose}
      />
    );
  }
  if (modal.kind === 'boardTrash') {
    return (
      <BoardTrashModal
        boardId={props.boardId}
        boardName={props.boardName ?? ''}
        columns={props.columns}
        onClose={props.onClose}
      />
    );
  }
  return null;
}

export function BoardDetailErrorState({ error }: { readonly error: unknown }) {
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

export function BoardDetailHeader({
  name,
  departmentName,
  archived,
  visibleTaskCount,
  overdueTaskCount,
  onAddColumn,
  onOpenTrash,
}: {
  readonly name: string;
  readonly departmentName: string | null;
  readonly archived: boolean;
  readonly visibleTaskCount: number;
  readonly overdueTaskCount: number;
  readonly onAddColumn: () => void;
  readonly onOpenTrash: () => void;
}) {
  const t = useTranslations('boards');

  return (
    <div className="board-detail-header">
      <div className="board-detail-title-group">
        <Link href="/boards" className="ui-btn ghost is-sm">← {t('backToBoards')}</Link>
        <h1 className="board-detail-heading">{name}</h1>
        <span className="ui-chip">{departmentName ?? t('clubWideLabel')}</span>
        <span className="ui-chip">{t('visibleTaskCount', { count: visibleTaskCount })}</span>
        {overdueTaskCount > 0 ? (
          <span className="board-tile-overdue-pill">{t('overdueTaskCount', { count: overdueTaskCount })}</span>
        ) : null}
        {archived ? <span className="status-pill is-inactive">{t('archivedBadge')}</span> : null}
      </div>
      <div className="board-detail-header-actions">
        <Can permission="task.delete">
          <button type="button" className="ui-btn secondary board-trash-trigger" onClick={onOpenTrash}>
            <span className="board-trash-trigger-icon" aria-hidden="true">
              <TrashBinIcon size={15} />
            </span>
            <span>{t('openTrash')}</span>
          </button>
        </Can>
        <Can permission="board.update">
          <button type="button" className="ui-btn primary" onClick={onAddColumn}>
            + {t('addColumn')}
          </button>
        </Can>
      </div>
    </div>
  );
}

export function BoardDndOverlay({
  board,
  dnd,
}: {
  readonly board: BoardDetailDto;
  readonly dnd: ReturnType<typeof useBoardDnd>;
}) {
  const activeColTaskCount = dnd.activeColumn
    ? board.tasks.filter((task) => task.columnId === dnd.activeColumn?.id).length
    : 0;
  const activeTaskColumn = dnd.activeTask
    ? board.columns.find((col) => col.id === dnd.activeTask?.columnId)
    : undefined;
  const activeTaskInDone = activeTaskColumn ? isDoneColumn(activeTaskColumn, board.columns) : false;

  return (
    <DragOverlay>
      {dnd.activeTask ? <BoardTaskCardView task={dnd.activeTask} isDoneColumn={activeTaskInDone} isOverlay /> : null}
      {dnd.activeColumn ? (
        <BoardColumnOverlayPreview column={dnd.activeColumn} taskCount={activeColTaskCount} />
      ) : null}
    </DragOverlay>
  );
}
