'use client';

import { useTranslations } from 'next-intl';
import { resolveDeadlineBadgeText } from '@/features/tasks/components/TaskPriorityBadge';
import { formatShortVnDate } from '@/features/tasks/formatters';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import { getCalendarDeadlineInfo, type CalendarPackedTask } from '../calendar-math';

function HiddenBarLockIcon() {
  return (
    <svg className="ic hcal-task-lock" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function formatTaskTitleTooltip(task: TaskDto): string {
  const start = formatShortVnDate(task.startAt);
  const due = formatShortVnDate(task.dueAt);
  if (start && due) return `${task.title} (${start} → ${due})`;
  if (start || due) return `${task.title} (${start || due})`;
  return task.title;
}

export function CalendarTaskBar({
  item,
  todayIso,
  onOpenTask,
}: {
  readonly item: CalendarPackedTask<TaskDto>;
  readonly todayIso: string;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const tCal = useTranslations('calendar');
  const tTasks = useTranslations('tasks');
  const { task, startIdx, span } = item;
  const { tier, daysDiff } = getCalendarDeadlineInfo(task, todayIso);
  const badgeText = resolveDeadlineBadgeText(tier, daysDiff, tTasks);
  const accepted = task.assignees.filter((a) => Boolean(a.acceptedAt)).length;
  const deptLabel = task.assignedDepartments.map((d) => d.name).join(', ') || tCal('clubWideDept');

  return (
    <button
      type="button"
      data-task-id={task.id}
      style={{
        left: `calc(${startIdx} * var(--day-w) + 2px)`,
        width: `calc(${span} * var(--day-w) - 4px)`,
      }}
      className={`hcal-task-bar deadline-${tier}`}
      title={formatTaskTitleTooltip(task)}
      onClick={() => onOpenTask(task.id)}
    >
      <div className="hcal-task-top">
        <span className="hcal-task-title">
          {task.isHidden ? <HiddenBarLockIcon /> : null}
          <span className="hcal-task-title-text">{task.title}</span>
        </span>
        <span className={`hcal-task-badge is-${tier}`}>{badgeText}</span>
      </div>
      <div className="hcal-task-meta">
        <span>{deptLabel}</span>
        <span aria-hidden="true">·</span>
        <span>{tCal('acceptedRatio', { accepted, total: task.assignees.length })}</span>
        <span aria-hidden="true">·</span>
        <span>{tCal('deliverableShortCount', { count: task.deliverableCount })}</span>
      </div>
    </button>
  );
}
