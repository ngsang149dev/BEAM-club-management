'use client';

import { useLocale, useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import {
  formatTaskEventSummary,
  type TaskHistoryLookup,
} from '../event-formatters';
import { formatTaskDateTime } from '../formatters';
import type { TaskEventDto } from '../hooks/useTaskEvents';
import { MemberInlineName } from './TaskPriorityBadge';

export interface TaskHistoryRowProps {
  readonly event: TaskEventDto;
  readonly lookup: TaskHistoryLookup;
  readonly canRevert: boolean;
  readonly isRevertingThis: boolean;
  readonly isBusy: boolean;
  readonly onRevert: (event: TaskEventDto) => void;
}

export function TaskHistoryRow({
  event,
  lookup,
  canRevert,
  isRevertingThis,
  isBusy,
  onRevert,
}: TaskHistoryRowProps) {
  const locale = useLocale();
  const tHistory = useTranslations('taskHistory');
  const tPrio = useTranslations('priority');
  const summary = formatTaskEventSummary({
    event,
    locale,
    lookup,
    tHistory,
    tPrio,
  });

  return (
    <li className="task-history-row">
      <MemberAvatar
        memberId={event.actor.id}
        fullName={event.actor.fullName}
        avatarUrl={event.actor.avatarUrl}
        isActive={event.actor.isActive}
        size="sm"
      />
      <div className="task-history-body">
        <p className="task-history-text">
          <strong><MemberInlineName member={event.actor} /></strong>{' '}
          <span>{summary}</span>
        </p>
        <div className="task-history-badges">
          <time className="mono task-history-time" dateTime={event.createdAt}>
            {formatTaskDateTime(event.createdAt, locale)}
          </time>
          {event.revertsEventId ? (
            <span className="ui-chip task-history-badge is-revert">{tHistory('revertedBadge')}</span>
          ) : null}
          {event.forced ? (
            <span className="ui-chip task-history-badge is-forced">{tHistory('forcedBadge')}</span>
          ) : null}
        </div>
      </div>
      {canRevert ? (
        <div className="task-history-actions">
          <button
            type="button"
            className="ui-btn ghost is-sm task-history-revert-btn"
            disabled={isBusy}
            onClick={() => onRevert(event)}
          >
            {isRevertingThis ? tHistory('restoringValue') : tHistory('restoreValueButton')}
          </button>
        </div>
      ) : null}
    </li>
  );
}
