'use client';

import { useTranslations } from 'next-intl';

const LEGEND_ITEMS = [
  { key: 'legendSafe', dotClass: 'is-safe' },
  { key: 'legendSoon', dotClass: 'is-soon' },
  { key: 'legendUrgent', dotClass: 'is-urgent' },
  { key: 'legendOverdue', dotClass: 'is-overdue' },
  { key: 'legendDone', dotClass: 'is-done' },
] as const;

export function CalendarLegend() {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-legend" aria-label={t('legendAriaLabel')}>
      {LEGEND_ITEMS.map((item) => (
        <span key={item.key} className="hcal-legend-item">
          <span className={`hcal-legend-dot ${item.dotClass}`} aria-hidden="true" />
          <span>{t(item.key)}</span>
        </span>
      ))}
    </div>
  );
}
