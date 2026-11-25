'use client';

import { useLocale, useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import {
  PRIORITY_MESSAGE_KEY,
  formatTaskDueDate,
  getTaskDueUrgency,
  normalizeTaskPriority,
  type TaskDueUrgency,
} from '../formatters';
import type { DepartmentSummaryDto, MemberPublicSummary } from '../hooks/useTasks';

export function TaskPriorityBadge({ priority }: { priority: number }) {
  const tPrio = useTranslations('priority');
  const level = normalizeTaskPriority(priority);
  const label = tPrio(PRIORITY_MESSAGE_KEY[level]);

  return (
    <span className={`ui-prio p${level}`}>
      <span className="ui-prio-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= level ? 'on' : undefined} />
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function DueCalendarIcon() {
  return (
    <svg className="ic" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M5 1.8v2.4M11 1.8v2.4M2 6.5h12" />
    </svg>
  );
}

function resolveDueBadgeLabel(
  urgency: Exclude<TaskDueUrgency, 'none'>,
  dateText: string,
  tTasks: ReturnType<typeof useTranslations<'tasks'>>
): string {
  if (urgency === 'overdue') return `${tTasks('overdueBadge')} · ${dateText}`;
  if (urgency === 'today') return `${tTasks('dueTodayBadge')} · ${dateText}`;
  if (urgency === 'soon') return `${tTasks('dueSoonBadge')} · ${dateText}`;
  return dateText;
}

export function TaskDueBadge({
  dueAt,
  suppressOverdue = false,
}: {
  dueAt: string | null;
  suppressOverdue?: boolean;
}) {
  const locale = useLocale();
  const tTasks = useTranslations('tasks');
  const urgency = getTaskDueUrgency(dueAt);

  if (urgency === 'none' || !dueAt) {
    return <span className="ui-due is-empty">{tTasks('noDueDate')}</span>;
  }

  const dateText = formatTaskDueDate(dueAt, locale);
  if (suppressOverdue) {
    return (
      <span className="ui-due is-done">
        <DueCalendarIcon />
        <span>{dateText}</span>
      </span>
    );
  }

  const showDot = urgency === 'overdue' || urgency === 'today';

  return (
    <span className={`ui-due is-${urgency}`}>
      <DueCalendarIcon />
      {showDot ? <span className="ui-due-dot" aria-hidden="true" /> : null}
      <span>{resolveDueBadgeLabel(urgency, dateText, tTasks)}</span>
    </span>
  );
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
