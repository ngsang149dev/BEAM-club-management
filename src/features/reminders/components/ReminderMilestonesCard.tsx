'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MAX_MILESTONE_COUNT,
  MAX_MILESTONE_DAY,
  MIN_MILESTONE_DAY,
  isAllMilestonesOff,
  normalizeDaysBefore,
  parseCustomMilestoneDay,
} from '../preview-helpers';

export interface ReminderMilestonesCardProps {
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
  readonly disabled: boolean;
  readonly onToggleDay: (day: number) => void;
  readonly onAddDay: (day: number) => void;
  readonly onRemoveDay: (day: number) => void;
  readonly onToggleOverdue: (next: boolean) => void;
  readonly onRestoreDefaults: () => void;
}

function MilestoneToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className={checked ? 'rem-option is-on' : 'rem-option'}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="rem-option-text">
        <b>{title}</b>
        <span>{description}</span>
      </span>
    </label>
  );
}

function formatDayBadgeLabel(
  day: number,
  t: ReturnType<typeof useTranslations<'reminders'>>
): string {
  return day === 0 ? t('dayChipToday') : t('dayChipLabel', { days: day });
}

function CustomMilestoneChips({
  daysBefore,
  disabled,
  onRemoveDay,
}: {
  readonly daysBefore: readonly number[];
  readonly disabled: boolean;
  readonly onRemoveDay: (day: number) => void;
}) {
  const t = useTranslations('reminders');
  const sortedDays = normalizeDaysBefore(daysBefore);

  if (sortedDays.length === 0) {
    return <p className="admin-empty-inline">{t('noDaysBeforeHint')}</p>;
  }

  return (
    <div className="rem-chip-list" role="list" aria-label={t('daysBeforeSectionTitle')}>
      {sortedDays.map((day) => {
        const label = formatDayBadgeLabel(day, t);
        return (
          <span key={day} className="ui-chip rem-day-chip" role="listitem">
            <span className="mono">{label}</span>
            <button
              type="button"
              className="rem-day-remove"
              aria-label={t('removeDayAria', { label })}
              disabled={disabled}
              onClick={() => onRemoveDay(day)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

type CustomMilestoneErrorKind = 'invalid' | 'max' | null;

function resolveCustomMilestoneError(
  errorKind: CustomMilestoneErrorKind,
  t: ReturnType<typeof useTranslations<'reminders'>>
): string | null {
  if (errorKind === 'max') return t('maxMilestonesError', { max: MAX_MILESTONE_COUNT });
  if (errorKind === 'invalid') return t('customDayValidation');
  return null;
}

function CustomMilestoneInputRow({
  disabled,
  existingDays,
  isAtMax,
  onAddDay,
}: {
  readonly disabled: boolean;
  readonly existingDays: readonly number[];
  readonly isAtMax: boolean;
  readonly onAddDay: (day: number) => void;
}) {
  const t = useTranslations('reminders');
  const inputId = useId();
  const [rawValue, setRawValue] = useState('');
  const [errorKind, setErrorKind] = useState<CustomMilestoneErrorKind>(null);

  const handleAdd = () => {
    const parsed = parseCustomMilestoneDay(rawValue);
    if (parsed === null) { setErrorKind('invalid'); return; }
    if (!existingDays.includes(parsed) && isAtMax) { setErrorKind('max'); return; }
    setErrorKind(null);
    setRawValue('');
    onAddDay(parsed);
  };

  const errorMessage = resolveCustomMilestoneError(errorKind, t);

  return (
    <div className="rem-custom-add-wrap">
      <label className="ui-label" htmlFor={inputId}>{t('customDayLabel')}</label>
      <div className="rem-custom-add">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_MILESTONE_DAY}
          max={MAX_MILESTONE_DAY}
          step={1}
          value={rawValue}
          disabled={disabled}
          placeholder={t('customDayPlaceholder')}
          aria-invalid={errorKind ? 'true' : undefined}
          className={`ui-input mono rem-day-input${errorKind ? ' has-error' : ''}`}
          onChange={(event) => { setRawValue(event.target.value); if (errorKind) setErrorKind(null); }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAdd(); } }}
        />
        <button type="button" className="ui-btn secondary is-sm" disabled={disabled} onClick={handleAdd}>
          {t('customDayAdd')}
        </button>
      </div>
      {errorMessage ? <p className="ui-field-error" role="alert">{errorMessage}</p> : null}
    </div>
  );
}

function AllMilestonesOffBanner({
  disabled,
  onRestoreDefaults,
}: {
  readonly disabled: boolean;
  readonly onRestoreDefaults: () => void;
}) {
  const t = useTranslations('reminders');

  return (
    <div className="ui-banner is-warn rem-all-off-banner" role="status">
      <svg
        className="ic"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 9v5M12 17.2v.2" />
      </svg>
      <div className="ui-banner-body rem-all-off-body">
        <span className="ui-banner-title">{t('allOffTitle')}</span>
        <span className="ui-banner-text">{t('allOffBody')}</span>
        <div className="rem-all-off-actions">
          <button
            type="button"
            className="ui-btn is-sm"
            disabled={disabled}
            onClick={onRestoreDefaults}
          >
            {t('restoreDefaults')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReminderMilestonesCard({
  daysBefore,
  remindOverdue,
  disabled,
  onToggleDay,
  onAddDay,
  onRemoveDay,
  onToggleOverdue,
  onRestoreDefaults,
}: ReminderMilestonesCardProps) {
  const t = useTranslations('reminders');
  const normalizedDays = normalizeDaysBefore(daysBefore);
  const isAtMax = normalizedDays.length >= MAX_MILESTONE_COUNT;
  const allOff = isAllMilestonesOff({ daysBefore: normalizedDays, remindOverdue });

  return (
    <section className="admin-card rem-card" aria-label={t('milestonesCardTitle')}>
      <div className="rem-card-head">
        <h2>{t('milestonesCardTitle')}</h2>
        <span className="rem-card-hint">{t('milestonesCardHint')}</span>
      </div>
      <div className="rem-options">
        <MilestoneToggleRow
          title={t('milestone2Days')}
          description={t('milestone2DaysDesc')}
          checked={normalizedDays.includes(2)}
          disabled={disabled || (!normalizedDays.includes(2) && isAtMax)}
          onChange={() => onToggleDay(2)}
        />
        <MilestoneToggleRow
          title={t('milestone1Day')}
          description={t('milestone1DayDesc')}
          checked={normalizedDays.includes(1)}
          disabled={disabled || (!normalizedDays.includes(1) && isAtMax)}
          onChange={() => onToggleDay(1)}
        />
        <MilestoneToggleRow
          title={t('milestoneOverdue')}
          description={t('milestoneOverdueDesc')}
          checked={remindOverdue}
          disabled={disabled}
          onChange={onToggleOverdue}
        />
      </div>
      <div className="rem-custom">
        <div className="rem-custom-head">
          <h3>{t('daysBeforeSectionTitle')}</h3>
          <span>{t('daysBeforeHint')}</span>
        </div>
        <CustomMilestoneChips daysBefore={normalizedDays} disabled={disabled} onRemoveDay={onRemoveDay} />
        <CustomMilestoneInputRow disabled={disabled} existingDays={normalizedDays} isAtMax={isAtMax} onAddDay={onAddDay} />
      </div>
      {allOff ? <AllMilestonesOffBanner disabled={disabled} onRestoreDefaults={onRestoreDefaults} /> : null}
    </section>
  );
}
