'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { TaskPriorityBadge } from '@/features/tasks/components/TaskPriorityBadge';
import { TaskEventErrorBanner } from '@/features/tasks/components/TaskRevertConflictModal';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import {
  resolveTaskEventErrorDescriptor,
  useBoardTrashInfiniteQuery,
  useRestoreBoardTaskMutation,
  useUndoTaskActionToast,
  type TaskDto,
} from '@/features/tasks/hooks/useTaskEvents';
import type { ColumnDto } from '../hooks/useBoards';

function resolveColumnLabel(
  columnId: string | null,
  columnsById: ReadonlyMap<string, string>,
  tBoards: ReturnType<typeof useTranslations<'boards'>>
): string {
  const name = columnId ? columnsById.get(columnId) : undefined;
  return name ? tBoards('trashOriginalColumn', { column: name }) : tBoards('trashDeletedColumnFallback');
}

function TrashTaskRow({
  task,
  columnsById,
  locale,
  isRestoringThis,
  isBusy,
  onRestore,
}: {
  readonly task: TaskDto;
  readonly columnsById: ReadonlyMap<string, string>;
  readonly locale: string;
  readonly isRestoringThis: boolean;
  readonly isBusy: boolean;
  readonly onRestore: (task: TaskDto) => void;
}) {
  const tBoards = useTranslations('boards');
  const tTasks = useTranslations('tasks');

  return (
    <li className="board-trash-item">
      <div className="board-trash-item-main">
        <div className="board-trash-item-title">
          <strong>{task.title}</strong>
          {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
        </div>
        <div className="board-trash-item-meta">
          <TaskPriorityBadge priority={task.priority} />
          <span>{resolveColumnLabel(task.columnId, columnsById, tBoards)}</span>
          <span aria-hidden="true">·</span>
          <span className="mono">{tBoards('trashDeletedAt', { time: formatTaskDateTime(task.deletedAt, locale) })}</span>
        </div>
      </div>
      <div className="board-trash-item-actions">
        <button type="button" className="ui-btn secondary is-sm" disabled={isBusy} onClick={() => onRestore(task)}>
          {isRestoringThis ? tBoards('trashRestoring') : tBoards('trashRestoreButton')}
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

function BoardTrashItemsList({
  tasks,
  columnsById,
  locale,
  restoringTaskId,
  isRestoring,
  hasNextPage,
  isFetchingNextPage,
  onRestore,
  onLoadMore,
}: {
  readonly tasks: readonly TaskDto[];
  readonly columnsById: ReadonlyMap<string, string>;
  readonly locale: string;
  readonly restoringTaskId: string | null;
  readonly isRestoring: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onRestore: (task: TaskDto) => void;
  readonly onLoadMore: () => void;
}) {
  const tBoards = useTranslations('boards');
  return (
    <>
      <ul className="board-trash-list">
        {tasks.map((task) => (
          <TrashTaskRow
            key={task.id}
            task={task}
            columnsById={columnsById}
            locale={locale}
            isRestoringThis={isRestoring && restoringTaskId === task.id}
            isBusy={isRestoring}
            onRestore={onRestore}
          />
        ))}
      </ul>
      {hasNextPage ? (
        <div className="task-history-more">
          <button type="button" className="ui-btn ghost is-sm" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? tBoards('trashLoadingMore') : tBoards('trashLoadMore')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function BoardTrashBody({
  trashQuery,
  columnsById,
  locale,
  restoringTaskId,
  isRestoring,
  onRestore,
}: {
  readonly trashQuery: ReturnType<typeof useBoardTrashInfiniteQuery>;
  readonly columnsById: ReadonlyMap<string, string>;
  readonly locale: string;
  readonly restoringTaskId: string | null;
  readonly isRestoring: boolean;
  readonly onRestore: (task: TaskDto) => void;
}) {
  const tBoards = useTranslations('boards');
  if (trashQuery.isPending) return <p className="auth-loading" role="status">{tBoards('trashLoading')}</p>;
  if (trashQuery.isError) return <BoardTrashErrorState error={trashQuery.error} onRetry={() => trashQuery.refetch()} />;

  const tasks = trashQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (tasks.length === 0) {
    return (
      <div className="board-trash-empty">
        <strong>{tBoards('trashEmptyTitle')}</strong>
        <p className="ui-field-hint">{tBoards('trashEmptyDescription')}</p>
      </div>
    );
  }
  return (
    <BoardTrashItemsList
      tasks={tasks}
      columnsById={columnsById}
      locale={locale}
      restoringTaskId={restoringTaskId}
      isRestoring={isRestoring}
      hasNextPage={Boolean(trashQuery.hasNextPage)}
      isFetchingNextPage={trashQuery.isFetchingNextPage}
      onRestore={onRestore}
      onLoadMore={() => trashQuery.fetchNextPage()}
    />
  );
}

function useBoardTrashController(boardId: string) {
  const tBoards = useTranslations('boards');
  const trashQuery = useBoardTrashInfiniteQuery(boardId, true);
  const restoreMutation = useRestoreBoardTaskMutation(boardId);
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
  return { trashQuery, restoreMutation, handleRestore };
}

export interface BoardTrashModalProps {
  readonly boardId: string;
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
  const ctrl = useBoardTrashController(boardId);
  const columnsById = new Map(columns.map((col) => [col.id, col.name]));

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal ui-modal-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{tBoards('trashModalTitle', { name: boardName })}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        <div className="ui-modal-body">
          <p className="ui-field-hint board-trash-modal-note">{tBoards('trashSubtitle')}</p>
          <TaskEventErrorBanner error={ctrl.restoreMutation.error} />
          <BoardTrashBody
            trashQuery={ctrl.trashQuery}
            columnsById={columnsById}
            locale={locale}
            restoringTaskId={ctrl.restoreMutation.variables ?? null}
            isRestoring={ctrl.restoreMutation.isPending}
            onRestore={ctrl.handleRestore}
          />
          <div className="board-trash-modal-foot">
            <Link href="/archive" className="ui-btn ghost is-sm" onClick={onClose}>{tBoards('trashOpenArchiveLink')}</Link>
            <button type="button" className="ui-btn ghost is-sm" onClick={onClose}>{tCommon('close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
