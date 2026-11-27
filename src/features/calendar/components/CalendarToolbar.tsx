'use client';

import { useTranslations } from 'next-intl';
import { TrashBinIcon } from '@/components/TrashIcons';
import { Can } from '@/features/shared/permissions/can';
import type { DepartmentDto } from '@/features/tasks/hooks/useTasks';
import type {
  CalendarDeadlineFilter,
  CalendarMonthMeta,
  CalendarTierCounts,
  ZoomTier,
} from '../calendar-math';

export interface CalendarToolbarProps {
  readonly year: number;
  readonly selectedMonthIndex: number;
  readonly months: readonly CalendarMonthMeta[];
  readonly zoomValue: number;
  readonly zoomTier: ZoomTier;
  readonly counts: CalendarTierCounts;
  readonly deadlineFilter: CalendarDeadlineFilter;
  readonly departmentId: string;
  readonly q: string;
  readonly departments: readonly DepartmentDto[];
  readonly showTrashButton: boolean;
  readonly onYearChange: (year: number) => void;
  readonly onSelectMonth: (monthIndex: number) => void;
  readonly onCenterToday: () => void;
  readonly onZoomSliderChange: (value: number) => void;
  readonly onZoomPreset: (value: number) => void;
  readonly onDeadlineFilterChange: (filter: CalendarDeadlineFilter) => void;
  readonly onDepartmentChange: (departmentId: string) => void;
  readonly onSearchChange: (q: string) => void;
  readonly onOpenCreate: () => void;
  readonly onOpenTrash: () => void;
}

const DEADLINE_FILTERS: readonly { readonly id: CalendarDeadlineFilter; readonly key: string }[] = [
  { id: 'all', key: 'filterAll' },
  { id: 'overdue', key: 'filterOverdue' },
  { id: 'urgent', key: 'filterUrgent' },
  { id: 'soon', key: 'filterSoon' },
  { id: 'safe', key: 'filterSafe' },
  { id: 'done', key: 'filterDone' },
];

const ZOOM_PRESETS: readonly {
  readonly tier: ZoomTier;
  readonly value: number;
  readonly key: 'zoomYear' | 'zoomMonth' | 'zoomWeek';
}[] = [
  { tier: 'year', value: 0, key: 'zoomYear' },
  { tier: 'month', value: 50, key: 'zoomMonth' },
  { tier: 'week', value: 100, key: 'zoomWeek' },
];

function CalendarPeriodControls({
  year,
  selectedMonthIndex,
  months,
  onYearChange,
  onSelectMonth,
  onCenterToday,
}: Pick<
  CalendarToolbarProps,
  'year' | 'selectedMonthIndex' | 'months' | 'onYearChange' | 'onSelectMonth' | 'onCenterToday'
>) {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-period-group">
      <div className="hcal-stepper">
        <button type="button" className="hcal-nav-btn" aria-label={t('prevYear')} onClick={() => onYearChange(year - 1)}>◀</button>
        <span className="hcal-year-label mono">{year}</span>
        <button type="button" className="hcal-nav-btn" aria-label={t('nextYear')} onClick={() => onYearChange(year + 1)}>▶</button>
      </div>
      <div className="hcal-stepper">
        <button
          type="button"
          className="hcal-nav-btn"
          aria-label={t('prevMonth')}
          disabled={selectedMonthIndex <= 0}
          onClick={() => onSelectMonth(selectedMonthIndex - 1)}
        >
          ◀
        </button>
        <select
          className="ui-select hcal-month-select"
          value={String(selectedMonthIndex)}
          aria-label={t('selectMonth')}
          onChange={(e) => onSelectMonth(Number(e.target.value))}
        >
          {months.map((m) => (
            <option key={m.monthIndex} value={String(m.monthIndex)}>
              {t('monthOption', { month: m.monthNumber, year })}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="hcal-nav-btn"
          aria-label={t('nextMonth')}
          disabled={selectedMonthIndex >= 11}
          onClick={() => onSelectMonth(selectedMonthIndex + 1)}
        >
          ▶
        </button>
      </div>
      <button type="button" className="ui-btn secondary is-sm" onClick={onCenterToday}>
        {t('today')}
      </button>
    </div>
  );
}

function CalendarZoomControls({
  zoomValue,
  zoomTier,
  onZoomSliderChange,
  onZoomPreset,
}: Pick<CalendarToolbarProps, 'zoomValue' | 'zoomTier' | 'onZoomSliderChange' | 'onZoomPreset'>) {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-zoom-box">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={zoomValue}
        aria-label={t('zoomAriaLabel')}
        className="hcal-zoom-range"
        onChange={(e) => onZoomSliderChange(Number(e.target.value))}
      />
      <div className="hcal-zoom-ticks">
        {ZOOM_PRESETS.map((preset) => (
          <button
            key={preset.tier}
            type="button"
            className={`hcal-zoom-label${zoomTier === preset.tier ? ' is-active' : ''}`}
            onClick={() => onZoomPreset(preset.value)}
          >
            {t(preset.key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function CalendarDeadlinePills({
  counts,
  deadlineFilter,
  onDeadlineFilterChange,
}: Pick<CalendarToolbarProps, 'counts' | 'deadlineFilter' | 'onDeadlineFilterChange'>) {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-filter-pills" role="group" aria-label={t('deadlineFilterGroup')}>
      {DEADLINE_FILTERS.map((item) => {
        const active = deadlineFilter === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            className={`hcal-filter-pill${active ? ' is-active' : ''}`}
            onClick={() => onDeadlineFilterChange(item.id)}
          >
            {t(item.key, { count: counts[item.id] })}
          </button>
        );
      })}
    </div>
  );
}

function CalendarFilterRow({
  counts,
  deadlineFilter,
  departmentId,
  q,
  departments,
  onDeadlineFilterChange,
  onDepartmentChange,
  onSearchChange,
}: Pick<
  CalendarToolbarProps,
  | 'counts'
  | 'deadlineFilter'
  | 'departmentId'
  | 'q'
  | 'departments'
  | 'onDeadlineFilterChange'
  | 'onDepartmentChange'
  | 'onSearchChange'
>) {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-filter-row">
      <CalendarDeadlinePills
        counts={counts}
        deadlineFilter={deadlineFilter}
        onDeadlineFilterChange={onDeadlineFilterChange}
      />
      <div className="hcal-filter-inputs">
        <select
          className="ui-select hcal-dept-select"
          value={departmentId}
          aria-label={t('departmentFilterLabel')}
          onChange={(e) => onDepartmentChange(e.target.value)}
        >
          <option value="">{t('allDepartments')}</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
        </select>
        <input
          className="ui-input hcal-search-input"
          type="search"
          value={q}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export function CalendarToolbar(props: CalendarToolbarProps) {
  const t = useTranslations('calendar');

  return (
    <div className="hcal-toolbar">
      <div className="hcal-toolbar-top">
        <CalendarPeriodControls
          year={props.year}
          selectedMonthIndex={props.selectedMonthIndex}
          months={props.months}
          onYearChange={props.onYearChange}
          onSelectMonth={props.onSelectMonth}
          onCenterToday={props.onCenterToday}
        />
        <div className="hcal-toolbar-actions">
          <CalendarZoomControls
            zoomValue={props.zoomValue}
            zoomTier={props.zoomTier}
            onZoomSliderChange={props.onZoomSliderChange}
            onZoomPreset={props.onZoomPreset}
          />
          {props.showTrashButton ? (
            <Can permission="task.delete">
              <button
                type="button"
                className="ui-icon-btn hcal-trash-btn"
                aria-label={t('openTrash')}
                title={t('openTrash')}
                onClick={props.onOpenTrash}
              >
                <TrashBinIcon size={16} />
              </button>
            </Can>
          ) : null}
          <Can permission="task.create">
            <button type="button" className="ui-btn primary is-sm" onClick={props.onOpenCreate}>
              + {t('createTask')}
            </button>
          </Can>
        </div>
      </div>
      <CalendarFilterRow
        counts={props.counts}
        deadlineFilter={props.deadlineFilter}
        departmentId={props.departmentId}
        q={props.q}
        departments={props.departments}
        onDeadlineFilterChange={props.onDeadlineFilterChange}
        onDepartmentChange={props.onDepartmentChange}
        onSearchChange={props.onSearchChange}
      />
    </div>
  );
}
