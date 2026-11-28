'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { ArchiveBoxIcon, RestoreArrowIcon, TrashBinIcon } from '@/components/TrashIcons';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import { TaskEventErrorBanner } from '@/features/tasks/components/TaskRevertConflictModal';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import {
  resolveTaskEventErrorDescriptor,
  useRestoreTaskMutation,
  useUndoTaskActionToast,
  useWorkspaceTrashInfiniteQuery,
  type TaskDto,
} from '@/features/tasks/hooks/useTaskEvents';

function TrashTaskRow({
  task,
  locale,
  isRestoringThis,
  isRestoring,
  onRestore,
}: {
  readonly task: TaskDto;
  readonly locale: string;
  readonly isRestoringThis: boolean;
  readonly isRestoring: boolean;
  readonly onRestore: (task: TaskDto) => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <li className="board-trash-item">
      <div className="board-trash-item-main">
        <div className="board-trash-item-title">
          <span className="board-trash-row-icon" aria-hidden="true"><TrashBinIcon size={14} /></span>
          <strong>{task.title}</strong>
          {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
        </div>
        <div className="board-trash-item-meta">
          <span className="mono">{tTasks('trashDeletedAt', { time: formatTaskDateTime(task.deletedAt, locale) })}</span>
        </div>
      </div>
      <div className="board-trash-item-actions">
        <button type="button" className="ui-btn primary is-sm board-trash-restore-btn" disabled={isRestoring} onClick={() => onRestore(task)}>
          <RestoreArrowIcon size={13} />
          <span>{isRestoringThis ? tTasks('trashRestoring') : tTasks('trashRestoreButton')}</span>
        </button>
      </div>
    </li>
  );
}

function WorkspaceTrashErrorState({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = resolveTaskEventErrorDescriptor(error);
  const isForbidden = err?.key === 'forbidden';

  return (
    <ErrorState
      variant={isForbidden ? '403' : '500'}
      code={isForbidden ? tErr('403.code') : undefined}
      title={isForbidden ? tErr('403.title') : tTasks('trashLoadError')}
      description={isForbidden ? tErr('403.description') : tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function WorkspaceTrashBody({
  restoringTaskId,
  isRestoring,
  onRestore,
}: {
  readonly restoringTaskId: string | null;
  readonly isRestoring: boolean;
  readonly onRestore: (task: TaskDto) => void;
}) {
  const locale = useLocale();
  const tTasks = useTranslations('tasks');
  const query = useWorkspaceTrashInfiniteQuery(true);
  if (query.isPending) return <p className="auth-loading" role="status">{tTasks('trashLoading')}</p>;
  if (query.isError) return <WorkspaceTrashErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const items = query.data?.pages.flatMap((page) => page.tasks) ?? [];
  if (items.length === 0) {
    return (
      <div className="board-trash-empty">
        <span className="board-trash-empty-icon" aria-hidden="true"><TrashBinIcon size={22} /></span>
        <strong>{tTasks('trashEmptyTitle')}</strong>
        <p className="ui-field-hint">{tTasks('trashEmptyDescription')}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="board-trash-list">
        {items.map((item) => (
          <TrashTaskRow
            key={item.task.id}
            task={item.task}
            locale={locale}
            isRestoringThis={isRestoring && restoringTaskId === item.task.id}
            isRestoring={isRestoring}
            onRestore={onRestore}
          />
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="task-history-more">
          <button type="button" className="ui-btn ghost is-sm" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? tTasks('trashLoadingMore') : tTasks('trashLoadMore')}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function WorkspaceTrashModal({ onClose }: { readonly onClose: () => void }) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(true, onClose);
  const restoreMutation = useRestoreTaskMutation();
  const showUndoToast = useUndoTaskActionToast();

  const handleRestore = (task: TaskDto) => {
    restoreMutation.reset();
    restoreMutation.mutate(task.id, {
      onSuccess: (data) =>
        showUndoToast({
          message: tTasks('trashRestoredToast', { title: data.task.title }),
          taskId: data.task.id,
          eventId: data.eventId,
        }),
    });
  };

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal ui-modal-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <div className="board-trash-modal-heading">
            <span className="board-trash-modal-icon" aria-hidden="true"><TrashBinIcon size={17} /></span>
            <h2 id={titleId} className="ui-modal-title">{tTasks('trashModalTitle')}</h2>
          </div>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        <div className="ui-modal-body">
          <TaskEventErrorBanner error={restoreMutation.error} />
          <WorkspaceTrashBody
            restoringTaskId={restoreMutation.variables ?? null}
            isRestoring={restoreMutation.isPending}
            onRestore={handleRestore}
          />
          <div className="board-trash-modal-foot">
            <Link href="/archive" className="ui-btn secondary is-sm board-trash-archive-link" onClick={onClose}>
              <ArchiveBoxIcon size={14} />
              <span>{tTasks('trashOpenArchiveLink')}</span>
            </Link>
            <button type="button" className="ui-btn ghost is-sm" onClick={onClose}>{tCommon('close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
