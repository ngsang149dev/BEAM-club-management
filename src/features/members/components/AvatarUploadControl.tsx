'use client';

import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import {
  IMAGE_FILE_ACCEPT,
  isImageCompressError,
  prepareImageUpload,
  resolveImageUploadErrorKey,
} from '@/features/shared/image-compress';

export interface AvatarUploadControlProps {
  memberId?: string;
  fullName: string;
  avatarUrl?: string | null;
  isActive?: boolean;
  isBusy?: boolean;
  serverError?: unknown;
  disabled?: boolean;
  label?: string;
  details?: ReactNode;
  onUpload: (dataUrl: string) => Promise<unknown> | void;
  onRemove: () => Promise<unknown> | void;
  onClearError?: () => void;
}

function useAvatarUploadHandlers({
  onUpload,
  onRemove,
  onClearError,
}: Pick<AvatarUploadControlProps, 'onUpload' | 'onRemove' | 'onClearError'>) {
  const [clientError, setClientError] = useState<unknown>(null);
  const [isCompressing, setIsCompressing] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClientError(null);
    onClearError?.();
    setIsCompressing(true);
    try {
      const { dataUrl } = await prepareImageUpload(file);
      await onUpload(dataUrl);
    } catch (error) {
      if (isImageCompressError(error)) setClientError(error);
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRemove = async () => {
    setClientError(null);
    onClearError?.();
    try {
      await onRemove();
    } catch {
      // Server errors surface via serverError prop from the mutation.
    }
  };

  return { clientError, isCompressing, handleFileChange, handleRemove };
}

function AvatarUploadActions({
  inputId,
  hasAvatar,
  isWorking,
  isDisabled,
  onFileChange,
  onRemove,
}: {
  inputId: string;
  hasAvatar: boolean;
  isWorking: boolean;
  isDisabled: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const tMedia = useTranslations('media');
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadLabel = isWorking
    ? tMedia('uploadingPhoto')
    : hasAvatar
      ? tMedia('changePhoto')
      : tMedia('uploadPhoto');

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        className="avatar-file-input"
        aria-label={uploadLabel}
        tabIndex={-1}
        disabled={isDisabled}
        onChange={onFileChange}
      />
      <div className="avatar-upload-actions">
        <button type="button" className="ui-btn ghost is-sm" disabled={isDisabled} onClick={() => inputRef.current?.click()}>
          {uploadLabel}
        </button>
        {hasAvatar ? (
          <button type="button" className="ui-btn danger is-sm" disabled={isDisabled} onClick={onRemove}>
            {tMedia('removePhoto')}
          </button>
        ) : null}
      </div>
      <p className="ui-field-hint">{tMedia('avatarHint')}</p>
    </>
  );
}

export function AvatarUploadControl({
  memberId,
  fullName,
  avatarUrl,
  isActive = true,
  isBusy = false,
  serverError,
  disabled = false,
  label,
  details,
  onUpload,
  onRemove,
  onClearError,
}: AvatarUploadControlProps) {
  const tErr = useTranslations('errors');
  const inputId = useId();
  const { clientError, isCompressing, handleFileChange, handleRemove } =
    useAvatarUploadHandlers({ onUpload, onRemove, onClearError });
  const isWorking = isBusy || isCompressing;
  const errorKey = resolveImageUploadErrorKey(clientError ?? serverError);

  return (
    <div className="avatar-upload-box">
      {label ? <span className="ui-label">{label}</span> : null}
      <div className="avatar-upload-row">
        <MemberAvatar
          memberId={memberId}
          fullName={fullName}
          avatarUrl={avatarUrl}
          isActive={isActive}
          size="lg"
          className={details ? 'profile-avatar' : undefined}
        />
        <div className="avatar-upload-meta">
          {details}
          <AvatarUploadActions
            inputId={inputId}
            hasAvatar={Boolean(avatarUrl)}
            isWorking={isWorking}
            isDisabled={disabled || isWorking}
            onFileChange={(event) => void handleFileChange(event)}
            onRemove={() => void handleRemove()}
          />
        </div>
      </div>
      {errorKey ? (
        <div className="ui-banner is-danger" role="alert">
          <div className="ui-banner-body"><span className="ui-banner-text">{tErr(errorKey)}</span></div>
        </div>
      ) : null}
    </div>
  );
}
