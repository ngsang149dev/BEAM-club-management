'use client';

import { useEffect, useId } from 'react';
import { useTranslations } from 'next-intl';
import { ClubLogoEditor, useClubLogoActions } from './ClubLogoSection';

export interface ClubLogoModalProps {
  onClose: () => void;
}

function useEscapeDismiss(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
}

export function ClubLogoModal({ onClose }: ClubLogoModalProps) {
  const t = useTranslations('branding');
  const tCommon = useTranslations('common');
  const titleId = useId();
  const state = useClubLogoActions(true);
  useEscapeDismiss(onClose);

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{t('modalTitle')}</h2>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={tCommon('close')}
            onClick={onClose}
            disabled={state.isBusy}
          >
            ✕
          </button>
        </div>
        <div className="ui-modal-body">
          <p className="ui-modal-copy">{t('modalSubtitle')}</p>
          <ClubLogoEditor
            logoUrl={state.logoUrl}
            isUploading={state.isUploading}
            isRemoving={state.isRemoving}
            isBusy={state.isBusy}
            errorKey={state.errorKey}
            onFileChange={(event) => void state.handleFileChange(event)}
            onRestoreDefault={() => void state.handleRestoreDefault()}
            footerSlot={
              <div className="ui-modal-actions">
                <button type="button" className="ui-btn ghost" onClick={onClose} disabled={state.isBusy}>
                  {tCommon('close')}
                </button>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
