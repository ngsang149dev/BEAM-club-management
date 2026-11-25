'use client';

import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import { MemberInlineName } from '@/features/tasks/components/TaskPriorityBadge';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import type { CommentDto } from '../hooks/useComments';

function CommentDeleteControls({
  isConfirming,
  isDeleting,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  readonly isConfirming: boolean;
  readonly isDeleting: boolean;
  readonly onRequestDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}) {
  const tComments = useTranslations('comments');
  const tCommon = useTranslations('common');

  if (!isConfirming) {
    return (
      <div className="task-comment-actions">
        <button type="button" className="ui-btn ghost is-sm" onClick={onRequestDelete} disabled={isDeleting}>
          {tComments('deleteAction')}
        </button>
      </div>
    );
  }

  return (
    <div className="task-comment-actions">
      <span className="task-comment-confirm" role="group" aria-label={tComments('deleteConfirmPrompt')}>
        <button type="button" className="ui-btn ghost is-sm" onClick={onCancelDelete} disabled={isDeleting}>
          {tCommon('cancel')}
        </button>
        <button type="button" className="ui-btn danger is-sm" onClick={onConfirmDelete} disabled={isDeleting}>
          {isDeleting ? tComments('deleting') : tComments('deleteConfirm')}
        </button>
      </span>
    </div>
  );
}

export interface CommentItemRowProps {
  readonly comment: CommentDto;
  readonly locale: string;
  readonly canDelete: boolean;
  readonly isConfirming: boolean;
  readonly isDeleting: boolean;
  readonly onRequestDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function CommentItemRow({
  comment,
  locale,
  canDelete,
  isConfirming,
  isDeleting,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: CommentItemRowProps) {
  return (
    <li className="task-comment-item">
      <MemberAvatar
        memberId={comment.author.id}
        fullName={comment.author.fullName}
        avatarUrl={comment.author.avatarUrl}
        isActive={comment.author.isActive}
        size="sm"
      />
      <div className="task-comment-content">
        <div className="task-comment-head">
          <div className="task-comment-meta">
            <span className="task-comment-author">
              <MemberInlineName member={comment.author} />
            </span>
            <time className="task-comment-time mono" dateTime={comment.createdAt}>
              {formatTaskDateTime(comment.createdAt, locale)}
            </time>
          </div>
          {canDelete ? (
            <CommentDeleteControls
              isConfirming={isConfirming}
              isDeleting={isDeleting}
              onRequestDelete={onRequestDelete}
              onCancelDelete={onCancelDelete}
              onConfirmDelete={onConfirmDelete}
            />
          ) : null}
        </div>
        <p className="task-comment-body">{comment.body}</p>
      </div>
    </li>
  );
}
