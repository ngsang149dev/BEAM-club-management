'use client';

import type { HTMLAttributes, RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import type { CalendarPackedTask, YearCalendarModel, ZoomTier } from '../calendar-math';
import { CalendarTaskBar } from './CalendarTaskBar';
import { CalendarTimelineHeader } from './CalendarTimelineHeader';

export interface CalendarTimelineProps {
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  readonly canvasRef: RefObject<HTMLDivElement | null>;
  readonly calendar: YearCalendarModel;
  readonly zoomTier: ZoomTier;
  readonly todayIso: string;
  readonly currentVnMonthIndex: number;
  readonly isCurrentYear: boolean;
  readonly lanes: readonly (readonly CalendarPackedTask<TaskDto>[])[];
  readonly hasActiveFilters: boolean;
  readonly onScroll: () => void;
  readonly panHandlers: HTMLAttributes<HTMLDivElement>;
  readonly onJumpToMonth: (monthIndex: number) => void;
  readonly onOpenTask: (taskId: string) => void;
  readonly onResetFilters: () => void;
}

function CalendarTimelineGrid({
  lanes,
  todayIso,
  hasActiveFilters,
  onOpenTask,
  onResetFilters,
}: {
  readonly lanes: readonly (readonly CalendarPackedTask<TaskDto>[])[];
  readonly todayIso: string;
  readonly hasActiveFilters: boolean;
  readonly onOpenTask: (taskId: string) => void;
  readonly onResetFilters: () => void;
}) {
  const t = useTranslations('calendar');
  if (lanes.length === 0) {
    return (
      <div className="hcal-grid-bg">
        <div className="hcal-empty-state">
          <p>{t('emptyTimeline')}</p>
          {hasActiveFilters ? (
            <button type="button" className="ui-btn ghost is-sm" onClick={onResetFilters}>
              {t('resetFilters')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="hcal-grid-bg">
      {lanes.map((lane, laneIdx) => (
        <div key={lane[0]?.task.id ?? laneIdx} className="hcal-lane">
          {lane.map((item) => (
            <CalendarTaskBar key={item.task.id} item={item} todayIso={todayIso} onOpenTask={onOpenTask} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarTimelineMarkers({ calendar }: { readonly calendar: YearCalendarModel }) {
  return (
    <>
      {calendar.months.slice(1).map((m) => (
        <div
          key={m.monthIndex}
          className="hcal-month-divider"
          style={{ left: `calc(${m.startIndex} * var(--day-w))` }}
          aria-hidden="true"
        />
      ))}
      {calendar.todayIndex >= 0 ? (
        <div
          className="hcal-today-line"
          style={{ left: `calc(${calendar.todayIndex} * var(--day-w) + var(--day-w) / 2)` }}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

export function CalendarTimeline({
  scrollerRef,
  canvasRef,
  calendar,
  zoomTier,
  todayIso,
  currentVnMonthIndex,
  isCurrentYear,
  lanes,
  hasActiveFilters,
  onScroll,
  panHandlers,
  onJumpToMonth,
  onOpenTask,
  onResetFilters,
}: CalendarTimelineProps) {
  return (
    <div id="hcal-scroller" ref={scrollerRef} className="hcal-scroller" onScroll={onScroll} {...panHandlers}>
      <div
        id="hcal-canvas"
        ref={canvasRef}
        className="hcal-canvas"
        data-zoom-tier={zoomTier}
        style={{ '--days': calendar.totalDays } as React.CSSProperties}
      >
        <CalendarTimelineMarkers calendar={calendar} />
        <CalendarTimelineHeader
          calendar={calendar}
          currentVnMonthIndex={currentVnMonthIndex}
          isCurrentYear={isCurrentYear}
          onJumpToMonth={onJumpToMonth}
        />
        <CalendarTimelineGrid
          lanes={lanes}
          todayIso={todayIso}
          hasActiveFilters={hasActiveFilters}
          onOpenTask={onOpenTask}
          onResetFilters={onResetFilters}
        />
      </div>
    </div>
  );
}
