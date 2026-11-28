'use client';

import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import {
  getCalendarDeadlineInfo,
  type CalendarDeadlineTier,
} from '../formatters';
import type { DepartmentSummaryDto, MemberPublicSummary } from '../hooks/useTasks';

export function resolveDeadlineBadgeText(
  tier: CalendarDeadlineTier,
  daysDiff: number | null,
  tTasks: ReturnType<typeof useTranslations<'tasks'>>
): string {
  if (tier === 'done') return tTasks('deadlineBadgeDone');
  if (daysDiff === null) return tTasks('deadlineBadgeDone');
  if (tier === 'overdue') return tTasks('deadlineBadgeOverdue', { days: Math.abs(daysDiff) });
  if (daysDiff === 0) return tTasks('dueTodayBadge');
  return tTasks('deadlineBadgeDaysLeft', { days: daysDiff });
}

export function TaskDeadlineBadge({
  dueAt,
  isCompleted,
  todayIso,
}: {
  readonly dueAt: string | null;
  readonly isCompleted: boolean;
  readonly todayIso?: string;
}) {
  const tTasks = useTranslations('tasks');
  const { tier, daysDiff } = getCalendarDeadlineInfo({ dueAt, isCompleted }, todayIso);
  const text = resolveDeadlineBadgeText(tier, daysDiff, tTasks);
  return <span className={`task-deadline-badge is-${tier}`}>{text}</span>;
}

export function MemberInlineName({ member }: { member: MemberPublicSummary }) {
  const tBadge = useTranslations('member');
  return (
    <span className="task-member-inline">
      {member.fullName}
      {!member.isActive ? <span className="member-left-badge"> {tBadge('leftBadge')}</span> : null}
    </span>
  );
}

function DepartmentBadgeIcon() {
  return (
    <svg className="ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-3h4v3" />
    </svg>
  );
}

export function TaskDepartmentChips({
  departments,
  emptyLabel,
}: {
  departments: readonly DepartmentSummaryDto[];
  emptyLabel?: string;
}) {
  if (departments.length === 0) {
    return emptyLabel ? <span className="muted-dash">{emptyLabel}</span> : null;
  }

  return (
    <span className="task-dept-chips">
      {departments.map((dept) => (
        <span key={dept.id} className="ui-chip task-dept-chip">
          <DepartmentBadgeIcon />
          <span>{dept.name}</span>
        </span>
      ))}
    </span>
  );
}

export function TaskAssigneeChips({ assignees }: { assignees: readonly MemberPublicSummary[] }) {
  const tTasks = useTranslations('tasks');
  const tBadge = useTranslations('member');

  if (assignees.length === 0) {
    return <span className="muted-dash">{tTasks('assigneesEmpty')}</span>;
  }

  return (
    <div className="task-assignees-chips">
      {assignees.map((person) => (
        <span key={person.id} className="ui-chip">
          <MemberAvatar
            memberId={person.id}
            fullName={person.fullName}
            avatarUrl={person.avatarUrl}
            isActive={person.isActive}
            size="xs"
          />
          <span>
            {person.fullName}
            {!person.isActive ? ` ${tBadge('leftBadge')}` : ''}
          </span>
        </span>
      ))}
    </div>
  );
}
