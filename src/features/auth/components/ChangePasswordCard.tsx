'use client';

import { useId, useState } from 'react';
import { useForm, type FieldErrors, type UseFormRegister, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/PasswordInput';
import { isApiClientError } from '@/features/shared/api/client';
import { changeMyPasswordFormSchema, type ChangeMyPasswordFormInput } from '@/lib/auth';
import { useChangeMyPasswordMutation } from '../hooks/useAuth';

export type ChangePasswordErrorKey =
  | 'invalidCurrentPassword'
  | 'network'
  | 'unauthorized'
  | 'validation'
  | 'unknown';

const CHANGE_PASSWORD_CODE_MAP: Record<string, ChangePasswordErrorKey> = {
  INVALID_CURRENT_PASSWORD: 'invalidCurrentPassword',
  NETWORK_ERROR: 'network',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  VALIDATION_ERROR: 'validation',
};

const CHANGE_PASSWORD_STATUS_MAP: Record<number, ChangePasswordErrorKey> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
};

export function resolveChangePasswordErrorKey(error: unknown): ChangePasswordErrorKey | null {
  if (!error) return null;
  if (!isApiClientError(error)) return 'unknown';
  if (error.messageKey === 'errors.invalidCurrentPassword') return 'invalidCurrentPassword';
  return CHANGE_PASSWORD_CODE_MAP[error.code] ?? CHANGE_PASSWORD_STATUS_MAP[error.status] ?? 'unknown';
}

function resolveConfirmErrorText(
  error: { message?: string } | undefined,
  tProfile: ReturnType<typeof useTranslations<'profile'>>
): string | null {
  if (!error) return null;
  return error.message === 'Passwords do not match'
    ? tProfile('validationConfirmMismatch')
    : tProfile('validationNewPassword');
}

function ChangePasswordStatusBanners({
  showForceAlert,
  serverErrorKey,
  showSuccess,
}: {
  showForceAlert: boolean;
  serverErrorKey: ChangePasswordErrorKey | null;
  showSuccess: boolean;
}) {
  const tProfile = useTranslations('profile');
  const tErrors = useTranslations('errors');

  return (
    <>
      {showForceAlert ? (
        <div className="ui-banner is-warn" role="alert">
          <div className="ui-banner-body">
            <span className="ui-banner-title">{tProfile('forceChangePasswordTitle')}</span>
            <span className="ui-banner-text">{tProfile('forceChangePasswordBody')}</span>
          </div>
        </div>
      ) : null}
      {serverErrorKey ? (
        <div className="ui-banner is-danger" role="alert">
          <div className="ui-banner-body">
            <span className="ui-banner-text">{tErrors(serverErrorKey)}</span>
          </div>
        </div>
      ) : null}
      {showSuccess ? (
        <div className="ui-banner is-success" role="status">
          <div className="ui-banner-body">
            <span className="ui-banner-text">{tProfile('passwordChangedBanner')}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface ChangePasswordFieldsProps {
  baseId: string;
  isBusy: boolean;
  hasInvalidCurrentError: boolean;
  errors: FieldErrors<ChangeMyPasswordFormInput>;
  register: UseFormRegister<ChangeMyPasswordFormInput>;
  onClearFeedback: () => void;
}

interface PasswordFieldRowProps {
  id: string;
  label: string;
  placeholder: string;
  autoComplete: string;
  hasError: boolean;
  errorText: string | null;
  disabled: boolean;
  showLabel: string;
  hideLabel: string;
  registration: UseFormRegisterReturn;
}

function PasswordFieldRow({
  id,
  label,
  placeholder,
  autoComplete,
  hasError,
  errorText,
  disabled,
  showLabel,
  hideLabel,
  registration,
}: PasswordFieldRowProps) {
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{label}</label>
      <PasswordInput
        id={id}
        className="ui-input"
        autoComplete={autoComplete}
        placeholder={placeholder}
        hasError={hasError}
        showLabel={showLabel}
        hideLabel={hideLabel}
        disabled={disabled}
        {...registration}
      />
      {errorText ? <p className="ui-field-error" role="alert">{errorText}</p> : null}
    </div>
  );
}

function ChangePasswordFields({
  baseId,
  isBusy,
  hasInvalidCurrentError,
  errors,
  register,
  onClearFeedback,
}: ChangePasswordFieldsProps) {
  const tProfile = useTranslations('profile');
  const tAuth = useTranslations('auth');
  const showLabel = tAuth('showPassword');
  const hideLabel = tAuth('hidePassword');
  const confirmErrorText = resolveConfirmErrorText(errors.confirmPassword, tProfile);

  return (
    <>
      <PasswordFieldRow
        id={`${baseId}-current`}
        label={tProfile('currentPasswordLabel')}
        placeholder={tProfile('currentPasswordPlaceholder')}
        autoComplete="current-password"
        hasError={Boolean(errors.currentPassword) || hasInvalidCurrentError}
        errorText={errors.currentPassword ? tProfile('validationCurrentPassword') : null}
        disabled={isBusy}
        showLabel={showLabel}
        hideLabel={hideLabel}
        registration={register('currentPassword', { onChange: onClearFeedback })}
      />
      <PasswordFieldRow
        id={`${baseId}-new`}
        label={tProfile('newPasswordLabel')}
        placeholder={tProfile('newPasswordPlaceholder')}
        autoComplete="new-password"
        hasError={Boolean(errors.newPassword)}
        errorText={errors.newPassword ? tProfile('validationNewPassword') : null}
        disabled={isBusy}
        showLabel={showLabel}
        hideLabel={hideLabel}
        registration={register('newPassword', { onChange: onClearFeedback })}
      />
      <PasswordFieldRow
        id={`${baseId}-confirm`}
        label={tProfile('confirmPasswordLabel')}
        placeholder={tProfile('confirmPasswordPlaceholder')}
        autoComplete="new-password"
        hasError={Boolean(errors.confirmPassword)}
        errorText={confirmErrorText}
        disabled={isBusy}
        showLabel={showLabel}
        hideLabel={hideLabel}
        registration={register('confirmPassword', { onChange: onClearFeedback })}
      />
    </>
  );
}

export interface ChangePasswordCardProps {
  mustChangePassword?: boolean;
  forcePrompt?: boolean;
  passwordChanged?: boolean;
  onPasswordChanged?: () => void;
  onClearPasswordChanged?: () => void;
}

function useChangePasswordFormState({
  passwordChanged,
  onPasswordChanged,
  onClearPasswordChanged,
}: Pick<
  ChangePasswordCardProps,
  'passwordChanged' | 'onPasswordChanged' | 'onClearPasswordChanged'
>) {
  const tProfile = useTranslations('profile');
  const [internalSuccess, setInternalSuccess] = useState(false);
  const mutation = useChangeMyPasswordMutation();
  const form = useForm<ChangeMyPasswordFormInput>({
    resolver: zodResolver(changeMyPasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const isSuccessControlled = passwordChanged !== undefined;
  const showSuccess = isSuccessControlled ? passwordChanged : internalSuccess;

  const clearFeedback = () => {
    if (mutation.error) mutation.reset();
    if (!isSuccessControlled && internalSuccess) setInternalSuccess(false);
    if (isSuccessControlled && passwordChanged) onClearPasswordChanged?.();
  };

  const handleValidSubmit = async (values: ChangeMyPasswordFormInput): Promise<void> => {
    if (!isSuccessControlled) setInternalSuccess(false);
    try {
      await mutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      if (!isSuccessControlled) setInternalSuccess(true);
      toast.success(tProfile('passwordChangedToast'));
      onPasswordChanged?.();
    } catch {
      // Error surfaced cleanly via mutation.error banner.
    }
  };

  return { form, mutation, showSuccess, clearFeedback, handleValidSubmit };
}

export function ChangePasswordCard({
  mustChangePassword = false,
  forcePrompt = false,
  passwordChanged,
  onPasswordChanged,
  onClearPasswordChanged,
}: ChangePasswordCardProps) {
  const baseId = useId();
  const tProfile = useTranslations('profile');
  const { form, mutation, showSuccess, clearFeedback, handleValidSubmit } =
    useChangePasswordFormState({ passwordChanged, onPasswordChanged, onClearPasswordChanged });

  const isBusy = form.formState.isSubmitting || mutation.isPending;
  const serverErrorKey = resolveChangePasswordErrorKey(mutation.error);
  const showForceAlert = mustChangePassword || forcePrompt;

  return (
    <section id="change-password" className={`profile-section${showForceAlert ? ' is-highlighted' : ''}`} aria-labelledby={`${baseId}-heading`}>
      <div className="profile-password-head">
        <h3 id={`${baseId}-heading`}>{tProfile('changePasswordTitle')}</h3>
        <p>{tProfile('changePasswordSubtitle')}</p>
      </div>
      <form className="profile-password-form" method="post" onSubmit={form.handleSubmit(handleValidSubmit)} noValidate>
        <ChangePasswordStatusBanners showForceAlert={showForceAlert} serverErrorKey={serverErrorKey} showSuccess={showSuccess} />
        <ChangePasswordFields
          baseId={baseId}
          isBusy={isBusy}
          hasInvalidCurrentError={serverErrorKey === 'invalidCurrentPassword'}
          errors={form.formState.errors}
          register={form.register}
          onClearFeedback={clearFeedback}
        />
        <div className="profile-password-actions">
          <button type="submit" className="ui-btn primary" disabled={isBusy}>
            {isBusy ? tProfile('changingPassword') : tProfile('changePasswordButton')}
          </button>
        </div>
      </form>
    </section>
  );
}
