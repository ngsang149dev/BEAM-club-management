'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import { ARCHIVE_RETENTION_DAYS, type ArchiveRetentionDays } from '@/lib/archive';
import { resolveArchiveErrorMessage } from '../error-mapping';
import type { ArchiveRetentionSettingsDto } from '../hooks/useArchive';

export interface ArchiveRetentionBarProps {
  readonly settings: ArchiveRetentionSettingsDto | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isAdmin: boolean;
  readonly isSaving: boolean;
  readonly saveError: unknown;
  readonly onSave: (retentionDays: ArchiveRetentionDays) => void;
}

const RETENTION_KEY_BY_VALUE: Record<string, 'never' | 'days7' | 'days30' | 'days90'> = {
  never: 'never',
  '7': 'days7',
  '30': 'days30',
  '90': 'days90',
};

function toOptionValue(days: ArchiveRetentionDays): string {
  return days === null ? 'never' : String(days);
}

function fromOptionValue(raw: string): ArchiveRetentionDays {
  if (raw === '7') return 7;
  if (raw === '30') return 30;
  if (raw === '90') return 90;
  return null;
}

export function formatRetentionLabel(
  days: ArchiveRetentionDays,
  t: ReturnType<typeof useTranslations<'archive'>>
): string {
  const key = RETENTION_KEY_BY_VALUE[toOptionValue(days)] ?? 'never';
  return t(`retentionOptions.${key}`);
}

function RetentionAdminForm({
  initialDays,
  isLoading,
  isSaving,
  onSave,
}: {
  readonly initialDays: ArchiveRetentionDays;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly onSave: (retentionDays: ArchiveRetentionDays) => void;
}) {
  const t = useTranslations('archive');
  const selectId = useId();
  const [selectedOption, setSelectedOption] = useState<string>(() => toOptionValue(initialDays));

  return (
    <form
      className="archive-retention-controls"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(fromOptionValue(selectedOption));
      }}
    >
      <label className="sr-only" htmlFor={selectId}>
        {t('retentionLabel')}
      </label>
      <select
        id={selectId}
        className="ui-select archive-retention-select"
        aria-label={t('retentionLabel')}
        value={selectedOption}
        disabled={isLoading || isSaving}
        onChange={(event) => setSelectedOption(event.target.value)}
      >
        <option value="never">{t('retentionOptions.never')}</option>
        {ARCHIVE_RETENTION_DAYS.map((days) => (
          <option key={days} value={String(days)}>
            {formatRetentionLabel(days, t)}
          </option>
        ))}
      </select>
      <button type="submit" className="ui-btn primary is-sm" disabled={isLoading || isSaving}>
        {isSaving ? t('retentionSaving') : t('retentionSave')}
      </button>
    </form>
  );
}

function RetentionUpdatedNote({
  settings,
}: {
  readonly settings: ArchiveRetentionSettingsDto | undefined;
}) {
  const locale = useLocale();
  const t = useTranslations('archive');
  if (!settings?.updatedAt) return null;
  const formattedTime = formatTaskDateTime(settings.updatedAt, locale);
  const text = settings.updatedBy
    ? t('retentionUpdatedByNote', { time: formattedTime, name: settings.updatedBy.fullName })
    : t('retentionUpdatedNote', { time: formattedTime });
  return <p className="archive-retention-note">{text}</p>;
}

export function ArchiveRetentionBar({
  settings,
  isLoading,
  isError,
  isAdmin,
  isSaving,
  saveError,
  onSave,
}: ArchiveRetentionBarProps) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');

  const currentDays: ArchiveRetentionDays = settings?.retentionDays ?? null;
  const saveErrorMessage = resolveArchiveErrorMessage(saveError, tErr);

  return (
    <section className="admin-card archive-retention-bar" aria-label={t('retentionTitle')}>
      <div className="archive-retention-head">
        <div className="archive-retention-copy">
          <h2 className="admin-card-title">{t('retentionTitle')}</h2>
          {isLoading && !settings ? (
            <p className="archive-retention-note">{tCommon('loading')}</p>
          ) : (
            <p className="archive-retention-note">
              {t('retentionLabel')}: <strong>{formatRetentionLabel(currentDays, t)}</strong>
            </p>
          )}
          <RetentionUpdatedNote settings={settings} />
          {!isAdmin ? (
            <p className="archive-retention-note">{t('retentionAdminOnlyNote')}</p>
          ) : null}
        </div>
        {isAdmin ? (
          <RetentionAdminForm
            key={toOptionValue(currentDays)}
            initialDays={currentDays}
            isLoading={isLoading}
            isSaving={isSaving}
            onSave={onSave}
          />
        ) : null}
      </div>
      {isError ? (
        <p className="ui-field-error" role="alert">
          {t('retentionLoadError')}
        </p>
      ) : null}
      {saveErrorMessage ? (
        <div className="ui-banner is-danger" role="alert">
          <div className="ui-banner-body">
            <span className="ui-banner-text">{saveErrorMessage}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
