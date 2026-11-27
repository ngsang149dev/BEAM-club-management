'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TaskDeadlineBadge } from '@/features/tasks/components/TaskPriorityBadge';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import { getCalendarDeadlineTier } from '../calendar-math';

export function CalendarUnscheduledTray({
  tasks,
  todayIso,
  onOpenTask,
}: {
  readonly tasks: readonly TaskDto[];
  readonly todayIso: string;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const tCal = useTranslations('calendar');
  const tTasks = useTranslations('tasks');
  const [expanded, setExpanded] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <section className="hcal-unscheduled-tray">
      <button
        type="button"
        className="hcal-unscheduled-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span>{tCal('unscheduledTrayTitle', { count: tasks.length })}</span>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded ? (
        <div className="hcal-unscheduled-list">
          {tasks.map((task) => {
            const tier = getCalendarDeadlineTier(task, todayIso);
            return (
              <button
                key={task.id}
                type="button"
                className={`hcal-unscheduled-chip deadline-${tier}`}
                onClick={() => onOpenTask(task.id)}
              >
                <span className="hcal-unscheduled-title">{task.title}</span>
                {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
                <TaskDeadlineBadge dueAt={task.dueAt} isCompleted={task.isCompleted} todayIso={todayIso} />
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
