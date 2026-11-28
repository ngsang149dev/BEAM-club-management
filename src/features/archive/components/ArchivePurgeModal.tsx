'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import { describeArchiveError, resolveArchiveErrorMessage } from '../error-mapping';
import type { ArchiveTab } from '../hooks/useArchive';

export interface ArchivePurgeTarget {
  readonly entityType: ArchiveTab;
  readonly id: string;
  readonly label: string;
}

export interface ArchivePurgeModalProps {
  readonly target: ArchivePurgeTarget;
  readonly isPurging: boolean;
  readonly error: unknown;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

function PurgeErrorBanner({ error }: { readonly error: unknown }) {
  const tErr = useTranslations('errors');
  const descriptor = describeArchiveError(error);
  const errorMessage = resolveArchiveErrorMessage(error, tErr);
  if (!errorMessage) return null;

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{errorMessage}</span>
        {descriptor?.requestId ? (
          <span className="ui-banner-meta">
            {tErr('requestIdLabel')}: {descriptor.requestId}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PurgeModalActions({
  isPurging,
  onClose,
  onConfirm,
}: {
  readonly isPurging: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');

  return (
    <div className="ui-modal-actions">
      <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isPurging}>
        {tCommon('cancel')}
      </button>
      <button type="button" className="ui-btn danger" onClick={onConfirm} disabled={isPurging}>
        {isPurging ? t('purging') : t('purgeModalConfirm')}
      </button>
    </div>
  );
}

export function ArchivePurgeModal({
  target,
  isPurging,
  error,
  onClose,
  onConfirm,
}: ArchivePurgeModalProps) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(true, onClose);

  const entityLabel = t(`entityTypes.${target.entityType}`);

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{t('purgeModalTitle')}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose} disabled={isPurging}>
            ✕
          </button>
        </div>
        <div className="ui-modal-body">
          <p className="ui-modal-copy">
            {t('purgeModalBody', { entityType: entityLabel, name: target.label })}
          </p>
          <div className="ui-banner is-warn" role="status">
            <div className="ui-banner-body">
              <span className="ui-banner-text">{t('purgeModalHistoryNote')}</span>
            </div>
          </div>
          <PurgeErrorBanner error={error} />
          <PurgeModalActions isPurging={isPurging} onClose={onClose} onConfirm={onConfirm} />
        </div>
      </div>
    </div>
  );
}
