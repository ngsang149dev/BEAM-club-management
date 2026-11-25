'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import { MemberInlineName } from '@/features/tasks/components/TaskPriorityBadge';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import type { CommentDto } from '../hooks/useComments';

export const COMMENT_COLLAPSE_CHAR_THRESHOLD = 320;
export const COMMENT_COLLAPSE_LINE_THRESHOLD = 5;

export function isLongCommentBody(body: string): boolean {
  return (
    body.length > COMMENT_COLLAPSE_CHAR_THRESHOLD ||
    body.split('\n').length > COMMENT_COLLAPSE_LINE_THRESHOLD
  );
}

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
  const tComments = useTranslations('comments');
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = isLongCommentBody(comment.body);
  const bodyClassName = isLong && !isExpanded ? 'task-comment-body is-clamped' : 'task-comment-body';

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
        <p className={bodyClassName}>{comment.body}</p>
        {isLong ? (
          <div>
            <button
              type="button"
              className="task-comment-expand-btn"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((prev) => !prev)}
            >
              {isExpanded ? tComments('showLess') : tComments('showMore')}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
