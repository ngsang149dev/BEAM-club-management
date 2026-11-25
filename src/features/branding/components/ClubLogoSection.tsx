'use client';

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
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

export function useClubLogoActions(enabled = true) {
  const t = useTranslations('branding');
  const [clientError, setClientError] = useState<unknown>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const brandingQuery = useBrandingQuery(enabled);
  const updateMutation = useUpdateClubLogoMutation();
  const removeMutation = useRemoveClubLogoMutation();

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

export function ClubLogoPreviewCard({ logoUrl }: { logoUrl: string | null }) {
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

function ClubLogoActionRow({
  hasCustomLogo,
  uploadLabel,
  isRemoving,
  isBusy,
  onPickFile,
  onRestoreDefault,
}: {
  hasCustomLogo: boolean;
  uploadLabel: string;
  isRemoving: boolean;
  isBusy: boolean;
  onPickFile: () => void;
  onRestoreDefault: () => void;
}) {
  const t = useTranslations('branding');
  return (
    <div className="club-logo-modal-actions">
      <button type="button" className="ui-btn primary" disabled={isBusy} onClick={onPickFile}>
        {uploadLabel}
      </button>
      <button type="button" className="ui-btn ghost" disabled={!hasCustomLogo || isBusy} onClick={onRestoreDefault}>
        {isRemoving ? t('restoring') : t('restoreDefaultButton')}
      </button>
    </div>
  );
}

export function ClubLogoEditor({
  logoUrl,
  isUploading,
  isRemoving,
  isBusy,
  errorKey,
  onFileChange,
  onRestoreDefault,
  footerSlot,
}: {
  logoUrl: string | null;
  isUploading: boolean;
  isRemoving: boolean;
  isBusy: boolean;
  errorKey: BrandingErrorKey | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRestoreDefault: () => void;
  footerSlot?: ReactNode;
}) {
  const t = useTranslations('branding');
  const tErr = useTranslations('errors');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasCustomLogo = Boolean(logoUrl);
  const uploadLabel = isUploading ? t('uploading') : hasCustomLogo ? t('replaceButton') : t('uploadButton');

  return (
    <div className="club-logo-editor-stack">
      {errorKey ? (
        <div className="ui-banner is-danger" role="alert">
          <div className="ui-banner-body"><span className="ui-banner-text">{tErr(errorKey)}</span></div>
        </div>
      ) : null}
      <ClubLogoPreviewCard logoUrl={logoUrl} />
      <input ref={inputRef} type="file" accept={IMAGE_FILE_ACCEPT} className="avatar-file-input" aria-label={uploadLabel} tabIndex={-1} disabled={isBusy} onChange={onFileChange} />
      <ClubLogoActionRow
        hasCustomLogo={hasCustomLogo}
        uploadLabel={uploadLabel}
        isRemoving={isRemoving}
        isBusy={isBusy}
        onPickFile={() => inputRef.current?.click()}
        onRestoreDefault={onRestoreDefault}
      />
      {footerSlot}
    </div>
  );
}

export function ClubLogoSection() {
  const t = useTranslations('branding');
  const state = useClubLogoActions(true);

  return (
    <section className="admin-card" aria-labelledby="club-logo-section-title">
      <div className="admin-card-header">
        <div>
          <h2 id="club-logo-section-title" className="admin-card-title">
            {t('modalTitle')}
          </h2>
          <p className="admin-card-hint">{t('modalSubtitle')}</p>
        </div>
      </div>
      <ClubLogoEditor
        logoUrl={state.logoUrl}
        isUploading={state.isUploading}
        isRemoving={state.isRemoving}
        isBusy={state.isBusy}
        errorKey={state.errorKey}
        onFileChange={(event) => void state.handleFileChange(event)}
        onRestoreDefault={() => void state.handleRestoreDefault()}
      />
    </section>
  );
}
