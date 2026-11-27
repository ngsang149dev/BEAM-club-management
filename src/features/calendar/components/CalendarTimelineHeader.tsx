'use client';

import { useTranslations } from 'next-intl';
import type { YearCalendarModel } from '../calendar-math';

export function CalendarTimelineHeader({
  calendar,
  currentVnMonthIndex,
  isCurrentYear,
  onJumpToMonth,
}: {
  readonly calendar: YearCalendarModel;
  readonly currentVnMonthIndex: number;
  readonly isCurrentYear: boolean;
  readonly onJumpToMonth: (monthIndex: number) => void;
}) {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-sticky-head">
      <div className="hcal-month-row">
        {calendar.months.map((m) => {
          const highlight = isCurrentYear && m.monthIndex === currentVnMonthIndex;
          return (
            <button
              key={m.monthIndex}
              type="button"
              style={{
                width: `calc(${m.dayCount} * var(--day-w))`,
                flex: `0 0 calc(${m.dayCount} * var(--day-w))`,
              }}
              className={`hcal-month-cell${highlight ? ' is-current' : ''}`}
              onClick={() => onJumpToMonth(m.monthIndex)}
            >
              {t('monthLabel', { month: m.monthNumber })}
            </button>
          );
        })}
      </div>

      <div className="hcal-day-row">
        {calendar.days.map((d) => {
          const dayClasses = ['hcal-day-cell'];
          if (d.isToday) dayClasses.push('is-today');
          else if (d.isWeekend) dayClasses.push('is-weekend');
          return (
            <div key={d.iso} className={dayClasses.join(' ')}>
              <div className="hcal-day-wd">
                <span className="hcal-weekday-short">{t(`weekdaysShort.${d.dow}`)}</span>
                <span className="hcal-weekday-full">{t(`weekdaysFull.${d.dow}`)}</span>
              </div>
              <div className="hcal-day-num">{d.dayNum}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
