'use client';

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  isImageCompressError,
  prepareImageUpload,
  type ImageCompressionOptions,
} from '@/features/shared/image-compress';
import { describeBrandingError, type BrandingErrorKey } from '../error-mapping';

export interface BrandAssetActionsConfig {
  readonly compressionOptions: ImageCompressionOptions;
  readonly onUpload: (payload: { dataUrl: string }) => Promise<unknown>;
  readonly onRemove: () => Promise<unknown>;
  readonly resetMutations: () => void;
  readonly updatedToast: string;
  readonly removedToast: string;
  readonly mutationError: unknown;
  readonly isMutating: boolean;
  readonly isRemoving: boolean;
}

export function useBrandAssetActions(config: BrandAssetActionsConfig) {
  const [clientError, setClientError] = useState<unknown>(null);
  const [isCompressing, setIsCompressing] = useState(false);

  const clearErrors = () => {
    setClientError(null);
    config.resetMutations();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearErrors();
    setIsCompressing(true);
    try {
      const { dataUrl } = await prepareImageUpload(file, config.compressionOptions);
      await config.onUpload({ dataUrl });
      toast.success(config.updatedToast);
    } catch (err) {
      if (isImageCompressError(err)) setClientError(err);
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRestoreDefault = async () => {
    clearErrors();
    try {
      await config.onRemove();
      toast.success(config.removedToast);
    } catch {
      // Server error rendered inline via mutation.error.
    }
  };

  return {
    isUploading: isCompressing || config.isMutating,
    isRemoving: config.isRemoving,
    isBusy: isCompressing || config.isMutating || config.isRemoving,
    errorKey: describeBrandingError(clientError ?? config.mutationError),
    handleFileChange,
    handleRestoreDefault,
  };
}

export interface BrandAssetSectionProps {
  readonly sectionId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly hasCustomAsset: boolean;
  readonly activeStatusLabel: string;
  readonly defaultStatusLabel: string;
  readonly uploadHint: string;
  readonly uploadLabel: string;
  readonly accept: string;
  readonly isRemoving: boolean;
  readonly isBusy: boolean;
  readonly errorKey: BrandingErrorKey | null;
  readonly preview: ReactNode;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRestoreDefault: () => void;
}

function BrandAssetErrorBanner({ errorKey }: { errorKey: BrandingErrorKey | null }) {
  const tErr = useTranslations('errors');
  if (!errorKey) return null;
  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{tErr(errorKey)}</span>
      </div>
    </div>
  );
}

export function BrandAssetSection(props: BrandAssetSectionProps) {
  const t = useTranslations('branding');
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="admin-card" aria-labelledby={props.sectionId}>
      <div className="admin-card-header">
        <div>
          <h2 id={props.sectionId} className="admin-card-title">{props.title}</h2>
          <p className="admin-card-hint">{props.subtitle}</p>
        </div>
      </div>
      <div className="club-logo-editor-stack">
        <BrandAssetErrorBanner errorKey={props.errorKey} />
        <div className="club-logo-preview-card">
          {props.preview}
          <div className="club-logo-preview-meta">
            <span className={props.hasCustomAsset ? 'status-pill is-active' : 'ui-chip'}>
              {props.hasCustomAsset ? props.activeStatusLabel : props.defaultStatusLabel}
            </span>
            <p className="ui-field-hint">{props.uploadHint}</p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={props.accept}
          className="avatar-file-input"
          aria-label={props.uploadLabel}
          tabIndex={-1}
          disabled={props.isBusy}
          onChange={props.onFileChange}
        />
        <div className="club-logo-modal-actions">
          <button
            type="button"
            className="ui-btn primary"
            disabled={props.isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {props.uploadLabel}
          </button>
          <button
            type="button"
            className="ui-btn ghost"
            disabled={!props.hasCustomAsset || props.isBusy}
            onClick={props.onRestoreDefault}
          >
            {props.isRemoving ? t('restoring') : t('restoreDefaultButton')}
          </button>
        </div>
      </div>
    </section>
  );
}
