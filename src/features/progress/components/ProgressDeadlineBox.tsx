'use client';

import { useTranslations } from 'next-intl';
import { formatVnMonthDayTime } from '@/features/tasks/formatters';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import {
  computeDeadlineBarMetrics,
  type DeadlineBarMetrics,
} from '../progress-helpers';

type ProgressTranslator = ReturnType<typeof useTranslations<'progress'>>;

function resolveUrgentTierLabel(daysDiff: number | null, t: ProgressTranslator): string {
  const days = daysDiff ?? 0;
  return days <= 0 ? t('tierUrgentToday') : t('tierUrgentDays', { days });
}

function resolveTierLabel(metrics: DeadlineBarMetrics, t: ProgressTranslator): string {
  switch (metrics.tier) {
    case 'done':
      return t('tierDone');
    case 'unscheduled':
      return t('tierUnscheduled');
    case 'overdue':
      return t('tierOverdue', { days: Math.max(1, Math.abs(metrics.daysDiff ?? 1)) });
    case 'urgent':
      return resolveUrgentTierLabel(metrics.daysDiff, t);
    case 'soon':
      return t('tierSoonDays', { days: metrics.daysDiff ?? 2 });
    case 'safe':
      return t('tierSafeDays', { days: Math.max(4, metrics.daysDiff ?? 4) });
  }
}

function resolveRangeText(
  startAt: string | null,
  dueAt: string | null,
  locale: string,
  t: ProgressTranslator
): string {
  const start = startAt ? formatVnMonthDayTime(startAt, locale) : '';
  const due = dueAt ? formatVnMonthDayTime(dueAt, locale) : '';
  if (start && due) return t('rangeStartDue', { start, due });
  if (due) return t('rangeDueOnly', { due });
  if (start) return t('rangeStartOnly', { start });
  return '—';
}

export function InspectorDeadlineBox({
  task,
  locale,
}: {
  readonly task: TaskDto;
  readonly locale: string;
}) {
  const t = useTranslations('progress');
  const metrics = computeDeadlineBarMetrics(task);
  const tierLabel = resolveTierLabel(metrics, t);
  const rangeText = resolveRangeText(task.startAt, task.dueAt, locale, t);

  return (
    <div className={`prog-deadline-box is-${metrics.tier}`}>
      <div className="prog-deadline-top">
        <span className={`prog-deadline-label is-${metrics.tier}`}>{tierLabel}</span>
        <span className="prog-deadline-range mono">{rangeText}</span>
      </div>
      <div className="prog-deadline-track" aria-hidden="true">
        <div
          className="prog-deadline-fill"
          style={{ width: `${metrics.barPct}%`, backgroundColor: metrics.fillHex }}
        />
      </div>
    </div>
  );
}
