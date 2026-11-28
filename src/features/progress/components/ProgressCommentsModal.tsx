'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { TaskCommentsSection } from '@/features/comments/components/TaskCommentsSection';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';

function CommentsModalHeader({
  titleId,
  taskTitle,
  onClose,
}: {
  readonly titleId: string;
  readonly taskTitle: string;
  readonly onClose: () => void;
}) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');

  return (
    <div className="prog-modal-head">
      <div className="prog-modal-title-wrap">
        <h2 id={titleId} className="prog-modal-title">{t('commentsModalTitle')}</h2>
        <p className="prog-modal-subtitle">{taskTitle}</p>
      </div>
      <button type="button" className="prog-modal-close" aria-label={tCommon('close')} onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

export function ProgressCommentsModal({
  task,
  onClose,
}: {
  readonly task: TaskDto | null;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  useEscapeClose(Boolean(task), onClose);

  if (!task) return null;

  return (
    <div
      className="prog-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="prog-card prog-modal-shell" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <CommentsModalHeader titleId={titleId} taskTitle={task.title} onClose={onClose} />
        <div className="prog-modal-body">
          <TaskCommentsSection taskId={task.id} commentCount={task.commentCount} />
        </div>
      </div>
    </div>
  );
}
