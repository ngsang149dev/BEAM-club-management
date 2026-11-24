'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { PasswordInput } from '@/components/PasswordInput';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import type { MemberListItem } from '../hooks/useMembers';
import {
  generateCompliantPassword,
  resetMemberPasswordFormSchema,
  type ResetMemberPasswordFormInput,
} from '../schemas';
import { formatMemberServerError } from './MemberFormFields';

export interface ResetPasswordModalProps {
  member: MemberListItem;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (newPassword: string) => void;
}

function resolveConfirmError(
  error: { message?: string } | undefined,
  t: ReturnType<typeof useTranslations<'memberAdmin'>>
): string | null {
  if (!error) return null;
  return error.message === 'Passwords do not match'
    ? t('validationPasswordMismatch')
    : t('validationNewPassword');
}

interface ResetPasswordFieldsProps {
  baseId: string;
  isPending: boolean;
  showPasswords: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onGenerate: () => void;
  newPasswordProps: InputHTMLAttributes<HTMLInputElement>;
  confirmPasswordProps: InputHTMLAttributes<HTMLInputElement>;
  newPasswordError: boolean;
  confirmErrorText: string | null;
}

function ResetPasswordFields({
  baseId,
  isPending,
  showPasswords,
  onVisibilityChange,
  onGenerate,
  newPasswordProps,
  confirmPasswordProps,
  newPasswordError,
  confirmErrorText,
}: ResetPasswordFieldsProps) {
  const t = useTranslations('memberAdmin');
  const tAuth = useTranslations('auth');

  return (
    <>
      <div className="ui-field">
        <div className="ui-field-label-row">
          <label className="ui-label" htmlFor={`${baseId}-new`}>{t('newPasswordLabel')}</label>
          <button type="button" className="ui-btn ghost is-sm" disabled={isPending} onClick={onGenerate}>
            {t('generatePasswordButton')}
          </button>
        </div>
        <PasswordInput
          id={`${baseId}-new`}
          className="ui-input"
          autoComplete="new-password"
          placeholder={t('newPasswordPlaceholder')}
          hasError={newPasswordError}
          showLabel={tAuth('showPassword')}
          hideLabel={tAuth('hidePassword')}
          visible={showPasswords}
          onVisibilityChange={onVisibilityChange}
          disabled={isPending}
          {...newPasswordProps}
        />
        {newPasswordError ? <p className="ui-field-error" role="alert">{t('validationNewPassword')}</p> : null}
      </div>
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-confirm`}>{t('confirmNewPasswordLabel')}</label>
        <PasswordInput
          id={`${baseId}-confirm`}
          className="ui-input"
          autoComplete="new-password"
          placeholder={t('confirmNewPasswordPlaceholder')}
          hasError={Boolean(confirmErrorText)}
          showLabel={tAuth('showPassword')}
          hideLabel={tAuth('hidePassword')}
          visible={showPasswords}
          onVisibilityChange={onVisibilityChange}
          disabled={isPending}
          {...confirmPasswordProps}
        />
        {confirmErrorText ? <p className="ui-field-error" role="alert">{confirmErrorText}</p> : null}
      </div>
    </>
  );
}

function ResetPasswordServerError({ error }: { error: unknown }) {
  const tErr = useTranslations('errors');
  const message = formatMemberServerError(error, tErr);
  if (!message) return null;
  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body"><span className="ui-banner-text">{message}</span></div>
    </div>
  );
}

export function ResetPasswordModal({ member, isPending, error, onClose, onSubmit }: ResetPasswordModalProps) {
  const t = useTranslations('memberAdmin');
  const tCommon = useTranslations('common');
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const [showPasswords, setShowPasswords] = useState(false);
  useEscapeClose(true, onClose);

  const { register, setValue, handleSubmit, formState: { errors } } =
    useForm<ResetMemberPasswordFormInput>({
      resolver: zodResolver(resetMemberPasswordFormSchema),
      defaultValues: { newPassword: '', confirmPassword: '' },
    });

  const handleGenerate = () => {
    const generated = generateCompliantPassword();
    setValue('newPassword', generated, { shouldDirty: true, shouldValidate: true });
    setValue('confirmPassword', generated, { shouldDirty: true, shouldValidate: true });
    setShowPasswords(true);
  };

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{t('resetPasswordModalTitle')}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        <form className="ui-modal-body" method="post" onSubmit={handleSubmit((v) => onSubmit(v.newPassword))} noValidate>
          <p className="ui-modal-copy">{t('resetPasswordModalBody', { name: member.fullName })}</p>
          <ResetPasswordServerError error={error} />
          <ResetPasswordFields
            baseId={baseId}
            isPending={isPending}
            showPasswords={showPasswords}
            onVisibilityChange={setShowPasswords}
            onGenerate={handleGenerate}
            newPasswordProps={register('newPassword')}
            confirmPasswordProps={register('confirmPassword')}
            newPasswordError={Boolean(errors.newPassword)}
            confirmErrorText={resolveConfirmError(errors.confirmPassword, t)}
          />
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isPending}>{tCommon('cancel')}</button>
            <button type="submit" className="ui-btn primary" disabled={isPending}>
              {isPending ? t('resettingPassword') : t('resetPasswordSubmit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
