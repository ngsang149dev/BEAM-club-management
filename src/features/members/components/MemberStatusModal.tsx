'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import type { MemberListItem } from '../hooks/useMembers';
import { formatMemberServerError } from './MemberFormFields';

export interface MemberStatusModalProps {
  member: MemberListItem;
  action: 'deactivate' | 'activate';
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}

export function MemberStatusModal({
  member,
  action,
  isPending,
  error,
  onClose,
  onConfirm,
}: MemberStatusModalProps) {
  const t = useTranslations('memberAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const titleId = useId();
  useEscapeClose(true, onClose);

  const serverError = formatMemberServerError(error, tErr);
  const isDeactivate = action === 'deactivate';
  const titleText = isDeactivate ? t('deactivateModalTitle') : t('activateModalTitle');
  const bodyText = isDeactivate
    ? t('deactivateModalBody', { name: member.fullName })
    : t('activateModalBody', { name: member.fullName });
  const confirmText = isDeactivate ? t('deactivateConfirm') : t('activateConfirm');

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{titleText}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="ui-modal-body">
          <p className="ui-modal-copy">{bodyText}</p>
          {serverError ? (
            <div className="ui-banner is-danger" role="alert">
              <div className="ui-banner-body">
                <span className="ui-banner-text">{serverError}</span>
              </div>
            </div>
          ) : null}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isPending}>
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              className={isDeactivate ? 'ui-btn danger' : 'ui-btn primary'}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? t('processingStatus') : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
