'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useSessionQuery } from '@/features/auth/hooks/useAuth';
import { usePermissions } from '@/features/shared/permissions/can';
import { TaskErrorBanner } from '@/features/tasks/components/TaskFormFields';
import {
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useTaskCommentsInfiniteQuery,
} from '../hooks/useComments';
import { CommentComposerForm } from './CommentComposerForm';
import { CommentItemRow } from './CommentItemRow';

export function canDeleteComment({
  isAdmin,
  canDeleteAny,
  authorId,
  currentUserId,
}: {
  readonly isAdmin: boolean;
  readonly canDeleteAny: boolean;
  readonly authorId: string;
  readonly currentUserId: string | null | undefined;
}): boolean {
  if (isAdmin || canDeleteAny) return true;
  return Boolean(currentUserId && authorId === currentUserId);
}

interface CommentsListBodyProps {
  readonly commentsQuery: ReturnType<typeof useTaskCommentsInfiniteQuery>;
  readonly locale: string;
  readonly isAdmin: boolean;
  readonly canDeleteAny: boolean;
  readonly currentUserId: string | null | undefined;
  readonly confirmingId: string | null;
  readonly isDeleting: boolean;
  readonly onRequestDelete: (id: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (id: string) => void;
}

function CommentsListBody(props: CommentsListBodyProps) {
  const { commentsQuery } = props;
  const tComments = useTranslations('comments');
  const tCommon = useTranslations('common');

  if (commentsQuery.isPending) {
    return <p className="ui-field-hint" role="status">{tComments('loading')}</p>;
  }
  if (commentsQuery.isError) {
    return (
      <div className="task-comment-load-error">
        <TaskErrorBanner error={commentsQuery.error} />
        <button type="button" className="ui-btn ghost is-sm" onClick={() => commentsQuery.refetch()}>
          {tCommon('retry')}
        </button>
      </div>
    );
  }

  const items = commentsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (items.length === 0) {
    return <p className="ui-field-hint task-comments-empty">{tComments('empty')}</p>;
  }

  return (
    <>
      <ul className="task-comment-list">
        {items.map((comment) => (
          <CommentItemRow
            key={comment.id}
            comment={comment}
            locale={props.locale}
            canDelete={canDeleteComment({
              isAdmin: props.isAdmin,
              canDeleteAny: props.canDeleteAny,
              authorId: comment.author.id,
              currentUserId: props.currentUserId,
            })}
            isConfirming={props.confirmingId === comment.id}
            isDeleting={props.isDeleting}
            onRequestDelete={() => props.onRequestDelete(comment.id)}
            onCancelDelete={props.onCancelDelete}
            onConfirmDelete={() => props.onConfirmDelete(comment.id)}
          />
        ))}
      </ul>
      {commentsQuery.hasNextPage ? (
        <div className="task-comments-more">
          <button
            type="button"
            className="ui-btn ghost is-sm"
            onClick={() => commentsQuery.fetchNextPage()}
            disabled={commentsQuery.isFetchingNextPage}
          >
            {commentsQuery.isFetchingNextPage ? tComments('loadingMore') : tComments('loadOlder')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function CommentsPanelHeader({
  commentCount,
  loadedCount,
  showPartialCount,
}: {
  readonly commentCount: number;
  readonly loadedCount: number;
  readonly showPartialCount: boolean;
}) {
  const tComments = useTranslations('comments');

  return (
    <div className="task-comments-header">
      <div className="task-comments-title-group">
        <span className="ui-chip">{commentCount}</span>
      </div>
      <div className="task-comments-meta">
        <span>{tComments('sortNewestFirst')}</span>
        {showPartialCount ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {tComments('showingCount', {
                shown: loadedCount,
                total: Math.max(commentCount, loadedCount),
              })}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function useCommentsController(
  taskId: string,
  onCreated?: () => void,
) {
  const tComments = useTranslations('comments');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const commentsQuery = useTaskCommentsInfiniteQuery(taskId, true);
  const createMutation = useCreateCommentMutation(taskId);
  const deleteMutation = useDeleteCommentMutation(taskId);

  const submitBody = (body: string, resetForm: () => void) => {
    createMutation.mutate(
      { body: body.trim() },
      {
        onSuccess: () => {
          resetForm();
          onCreated?.();
          toast.success(tComments('createdToast'));
        },
      },
    );
  };

  const confirmDelete = (commentId: string) => {
    deleteMutation.mutate(commentId, {
      onSuccess: () => { setConfirmingId(null); toast.success(tComments('deletedToast')); },
    });
  };

  return { confirmingId, setConfirmingId, commentsQuery, createMutation, deleteMutation, submitBody, confirmDelete };
}

export function TaskCommentsSection({
  taskId,
  commentCount,
}: {
  readonly taskId: string;
  readonly commentCount: number;
}) {
  const locale = useLocale();
  const { isAdmin, can } = usePermissions();
  const sessionQuery = useSessionQuery(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ctrl = useCommentsController(taskId, () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  });
  const canCreate = isAdmin || can('comment.create');
  const loadedCount =
    ctrl.commentsQuery.data?.pages.reduce((sum, page) => sum + page.items.length, 0) ?? 0;
  const showPartialCount =
    loadedCount > 0 && (ctrl.commentsQuery.hasNextPage || loadedCount < commentCount);

  return (
    <section className="task-comments-panel task-comments-section">
      <CommentsPanelHeader
        commentCount={commentCount}
        loadedCount={loadedCount}
        showPartialCount={showPartialCount}
      />
      {ctrl.deleteMutation.error ? <TaskErrorBanner error={ctrl.deleteMutation.error} /> : null}
      {canCreate ? (
        <div className="task-comments-composer-pin">
          <CommentComposerForm
            isPending={ctrl.createMutation.isPending}
            apiError={ctrl.createMutation.error}
            onSubmitBody={ctrl.submitBody}
          />
        </div>
      ) : null}
      <div className="task-comments-scroll" ref={scrollRef}>
        <CommentsListBody
          commentsQuery={ctrl.commentsQuery}
          locale={locale}
          isAdmin={isAdmin}
          canDeleteAny={can('comment.delete_any')}
          currentUserId={sessionQuery.data?.userId}
          confirmingId={ctrl.confirmingId}
          isDeleting={ctrl.deleteMutation.isPending}
          onRequestDelete={ctrl.setConfirmingId}
          onCancelDelete={() => ctrl.setConfirmingId(null)}
          onConfirmDelete={ctrl.confirmDelete}
        />
      </div>
    </section>
  );
}
