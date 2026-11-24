'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ClubLogo } from '@/components/ClubLogo';
import {
  IMAGE_FILE_ACCEPT,
  isImageCompressError,
  prepareImageUpload,
} from '@/features/shared/image-compress';
import { describeBrandingError, type BrandingErrorKey } from '../error-mapping';
import {
  useBrandingQuery,
  useRemoveClubLogoMutation,
  useUpdateClubLogoMutation,
} from '../hooks/useBranding';

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

function useClubLogoModalActions(onClose: () => void) {
  const t = useTranslations('branding');
  const [clientError, setClientError] = useState<unknown>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const brandingQuery = useBrandingQuery(true);
  const updateMutation = useUpdateClubLogoMutation();
  const removeMutation = useRemoveClubLogoMutation();
  useEscapeDismiss(onClose);

  const clearErrors = () => {
    setClientError(null);
    updateMutation.reset();
    removeMutation.reset();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearErrors();
    setIsCompressing(true);
    try {
      const { dataUrl } = await prepareImageUpload(file);
      await updateMutation.mutateAsync({ dataUrl });
      toast.success(t('updatedToast'));
    } catch (err) {
      if (isImageCompressError(err)) setClientError(err);
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRestoreDefault = async () => {
    clearErrors();
    try {
      await removeMutation.mutateAsync();
      toast.success(t('removedToast'));
    } catch {
      // Server error rendered inline via mutation.error.
    }
  };

  return {
    logoUrl: brandingQuery.data?.logoUrl ?? null,
    isUploading: isCompressing || updateMutation.isPending,
    isRemoving: removeMutation.isPending,
    isBusy: isCompressing || updateMutation.isPending || removeMutation.isPending,
    errorKey: describeBrandingError(clientError ?? updateMutation.error ?? removeMutation.error),
    handleFileChange,
    handleRestoreDefault,
  };
}

function ClubLogoPreviewCard({ logoUrl }: { logoUrl: string | null }) {
  const t = useTranslations('branding');
  const hasCustomLogo = Boolean(logoUrl);

  return (
    <div className="club-logo-preview-card">
      <ClubLogo logoUrl={logoUrl} alt={t('logoAlt')} size="lg" />
      <div className="club-logo-preview-meta">
        <span className={hasCustomLogo ? 'status-pill is-active' : 'ui-chip'}>
          {hasCustomLogo ? t('customLogoActive') : t('defaultBadgeActive')}
        </span>
        <p className="ui-field-hint">{t('uploadHint')}</p>
      </div>
    </div>
  );
}

function ClubLogoModalActions({
  hasCustomLogo,
  isUploading,
  isRemoving,
  isBusy,
  onFileChange,
  onRestoreDefault,
  onClose,
}: {
  hasCustomLogo: boolean;
  isUploading: boolean;
  isRemoving: boolean;
  isBusy: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRestoreDefault: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('branding');
  const tCommon = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadLabel = isUploading
    ? t('uploading')
    : hasCustomLogo
      ? t('replaceButton')
      : t('uploadButton');

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        className="avatar-file-input"
        aria-label={uploadLabel}
        tabIndex={-1}
        disabled={isBusy}
        onChange={onFileChange}
      />
      <div className="club-logo-modal-actions">
        <button type="button" className="ui-btn primary" disabled={isBusy} onClick={() => inputRef.current?.click()}>
          {uploadLabel}
        </button>
        <button type="button" className="ui-btn ghost" disabled={!hasCustomLogo || isBusy} onClick={onRestoreDefault}>
          {isRemoving ? t('restoring') : t('restoreDefaultButton')}
        </button>
      </div>
      <div className="ui-modal-actions">
        <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isBusy}>
          {tCommon('close')}
        </button>
      </div>
    </>
  );
}

function ClubLogoModalContent({
  logoUrl,
  isUploading,
  isRemoving,
  isBusy,
  errorKey,
  onFileChange,
  onRestoreDefault,
  onClose,
}: {
  logoUrl: string | null;
  isUploading: boolean;
  isRemoving: boolean;
  isBusy: boolean;
  errorKey: BrandingErrorKey | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRestoreDefault: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('branding');
  const tErr = useTranslations('errors');

  return (
    <div className="ui-modal-body">
      <p className="ui-modal-copy">{t('modalSubtitle')}</p>
      {errorKey ? (
        <div className="ui-banner is-danger" role="alert">
          <div className="ui-banner-body"><span className="ui-banner-text">{tErr(errorKey)}</span></div>
        </div>
      ) : null}
      <ClubLogoPreviewCard logoUrl={logoUrl} />
      <ClubLogoModalActions
        hasCustomLogo={Boolean(logoUrl)}
        isUploading={isUploading}
        isRemoving={isRemoving}
        isBusy={isBusy}
        onFileChange={onFileChange}
        onRestoreDefault={onRestoreDefault}
        onClose={onClose}
      />
    </div>
  );
}

export function ClubLogoModal({ onClose }: ClubLogoModalProps) {
  const t = useTranslations('branding');
  const tCommon = useTranslations('common');
  const titleId = useId();
  const state = useClubLogoModalActions(onClose);

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
        <ClubLogoModalContent
          logoUrl={state.logoUrl}
          isUploading={state.isUploading}
          isRemoving={state.isRemoving}
          isBusy={state.isBusy}
          errorKey={state.errorKey}
          onFileChange={(event) => void state.handleFileChange(event)}
          onRestoreDefault={() => void state.handleRestoreDefault()}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
