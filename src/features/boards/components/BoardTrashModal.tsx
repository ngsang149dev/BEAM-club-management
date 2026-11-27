'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { ArchiveBoxIcon, RestoreArrowIcon, TrashBinIcon } from '@/components/TrashIcons';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { TaskEventErrorBanner } from '@/features/tasks/components/TaskRevertConflictModal';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import {
  resolveTaskEventErrorDescriptor,
  useBoardTrashInfiniteQuery,
  useRestoreBoardTaskMutation,
  useUndoTaskActionToast,
  useWorkspaceTrashInfiniteQuery,
  type TaskDto,
} from '@/features/tasks/hooks/useTaskEvents';
import type { ColumnDto } from '../hooks/useBoards';

interface TrashEntry {
  readonly task: TaskDto;
  readonly columnLabel: string;
}

interface TrashViewState {
  readonly entries: readonly TrashEntry[];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}

interface TrashSharedProps {
  readonly locale: string;
  readonly restoringTaskId: string | null;
  readonly isRestoring: boolean;
  readonly onRestore: (task: TaskDto) => void;
}

function resolveTrashColumnLabel(
  columnName: string | null | undefined,
  tBoards: ReturnType<typeof useTranslations<'boards'>>
): string {
  return columnName
    ? tBoards('trashOriginalColumn', { column: columnName })
    : tBoards('trashDeletedColumnFallback');
}

function TrashTaskRow({
  entry,
  shared,
}: {
  readonly entry: TrashEntry;
  readonly shared: TrashSharedProps;
}) {
  const { task, columnLabel } = entry;
  const tBoards = useTranslations('boards');
  const tTasks = useTranslations('tasks');
  const isRestoringThis = shared.isRestoring && shared.restoringTaskId === task.id;

  return (
    <li className="board-trash-item">
      <div className="board-trash-item-main">
        <div className="board-trash-item-title">
          <span className="board-trash-row-icon" aria-hidden="true"><TrashBinIcon size={14} /></span>
          <strong>{task.title}</strong>
          {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
        </div>
        <div className="board-trash-item-meta">
          <span>{columnLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="mono">{tBoards('trashDeletedAt', { time: formatTaskDateTime(task.deletedAt, shared.locale) })}</span>
        </div>
      </div>
      <div className="board-trash-item-actions">
        <button type="button" className="ui-btn primary is-sm board-trash-restore-btn" disabled={shared.isRestoring} onClick={() => shared.onRestore(task)}>
          <RestoreArrowIcon size={13} />
          <span>{isRestoringThis ? tBoards('trashRestoring') : tBoards('trashRestoreButton')}</span>
        </button>
      </div>
    </li>
  );
}

function BoardTrashErrorState({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const tBoards = useTranslations('boards');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = resolveTaskEventErrorDescriptor(error);
  const isForbidden = err?.key === 'forbidden';

  return (
    <ErrorState
      variant={isForbidden ? '403' : '500'}
      code={isForbidden ? tErr('403.code') : undefined}
      title={isForbidden ? tErr('403.title') : tBoards('trashLoadError')}
      description={isForbidden ? tErr('403.description') : tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function BoardTrashListView({ view, shared }: { readonly view: TrashViewState; readonly shared: TrashSharedProps }) {
  const tBoards = useTranslations('boards');
  if (view.isPending) return <p className="auth-loading" role="status">{tBoards('trashLoading')}</p>;
  if (view.isError) return <BoardTrashErrorState error={view.error} onRetry={view.onRetry} />;

  if (view.entries.length === 0) {
    return (
      <div className="board-trash-empty">
        <span className="board-trash-empty-icon" aria-hidden="true"><TrashBinIcon size={22} /></span>
        <strong>{tBoards('trashEmptyTitle')}</strong>
        <p className="ui-field-hint">{tBoards('trashEmptyDescription')}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="board-trash-list">
        {view.entries.map((entry) => (
          <TrashTaskRow key={entry.task.id} entry={entry} shared={shared} />
        ))}
      </ul>
      {view.hasNextPage ? (
        <div className="task-history-more">
          <button type="button" className="ui-btn ghost is-sm" onClick={view.onLoadMore} disabled={view.isFetchingNextPage}>
            {view.isFetchingNextPage ? tBoards('trashLoadingMore') : tBoards('trashLoadMore')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function BoardScopedTrashContent({
  boardId,
  columnsById,
  shared,
}: {
  readonly boardId: string;
  readonly columnsById: ReadonlyMap<string, string>;
  readonly shared: TrashSharedProps;
}) {
  const tBoards = useTranslations('boards');
  const query = useBoardTrashInfiniteQuery(boardId, true);
  const entries: TrashEntry[] = (query.data?.pages.flatMap((page) => page.items) ?? []).map((task) => ({
    task,
    columnLabel: resolveTrashColumnLabel(task.columnId ? columnsById.get(task.columnId) : null, tBoards),
  }));

  return (
    <BoardTrashListView
      view={{
        entries,
        isPending: query.isPending,
        isError: query.isError,
        error: query.error,
        hasNextPage: Boolean(query.hasNextPage),
        isFetchingNextPage: query.isFetchingNextPage,
        onRetry: () => void query.refetch(),
        onLoadMore: () => void query.fetchNextPage(),
      }}
      shared={shared}
    />
  );
}

function WorkspaceTrashContent({ shared }: { readonly shared: TrashSharedProps }) {
  const tBoards = useTranslations('boards');
  const query = useWorkspaceTrashInfiniteQuery(true);
  const entries: TrashEntry[] = (query.data?.pages.flatMap((page) => page.tasks) ?? []).map((item) => ({
    task: item.task,
    columnLabel: resolveTrashColumnLabel(item.columnName, tBoards),
  }));

  return (
    <BoardTrashListView
      view={{
        entries,
        isPending: query.isPending,
        isError: query.isError,
        error: query.error,
        hasNextPage: Boolean(query.hasNextPage),
        isFetchingNextPage: query.isFetchingNextPage,
        onRetry: () => void query.refetch(),
        onLoadMore: () => void query.fetchNextPage(),
      }}
      shared={shared}
    />
  );
}

function useTrashRestoreAction(boardId: string | null | undefined) {
  const tBoards = useTranslations('boards');
  const restoreMutation = useRestoreBoardTaskMutation(boardId ?? '');
  const showUndoToast = useUndoTaskActionToast();

  const handleRestore = (task: TaskDto) => {
    restoreMutation.reset();
    restoreMutation.mutate(task.id, {
      onSuccess: (data) =>
        showUndoToast({
          message: tBoards('trashRestoredToast', { title: data.task.title }),
          taskId: data.task.id,
          boardId: data.task.boardId,
          eventId: data.eventId,
        }),
    });
  };
  return { restoreMutation, handleRestore };
}

export interface BoardTrashModalProps {
  readonly boardId?: string | null;
  readonly boardName: string;
  readonly columns?: readonly ColumnDto[];
  readonly onClose: () => void;
}

export function BoardTrashModal({ boardId, boardName, columns = [], onClose }: BoardTrashModalProps) {
  const locale = useLocale();
  const tBoards = useTranslations('boards');
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(true, onClose);
  const { restoreMutation, handleRestore } = useTrashRestoreAction(boardId);
  const columnsById = new Map(columns.map((col) => [col.id, col.name]));
  const shared: TrashSharedProps = {
    locale,
    restoringTaskId: restoreMutation.variables ?? null,
    isRestoring: restoreMutation.isPending,
    onRestore: handleRestore,
  };

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal ui-modal-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <div className="board-trash-modal-heading">
            <span className="board-trash-modal-icon" aria-hidden="true"><TrashBinIcon size={17} /></span>
            <h2 id={titleId} className="ui-modal-title">{tBoards('trashModalTitle', { name: boardName })}</h2>
          </div>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        <div className="ui-modal-body">
          <p className="ui-field-hint board-trash-modal-note">{tBoards('trashSubtitle')}</p>
          <TaskEventErrorBanner error={restoreMutation.error} />
          {boardId ? (
            <BoardScopedTrashContent boardId={boardId} columnsById={columnsById} shared={shared} />
          ) : (
            <WorkspaceTrashContent shared={shared} />
          )}
          <div className="board-trash-modal-foot">
            <Link href="/archive" className="ui-btn secondary is-sm board-trash-archive-link" onClick={onClose}>
              <ArchiveBoxIcon size={14} />
              <span>{tBoards('trashOpenArchiveLink')}</span>
            </Link>
            <button type="button" className="ui-btn ghost is-sm" onClick={onClose}>{tCommon('close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
