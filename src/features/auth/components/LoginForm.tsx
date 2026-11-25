'use client';

import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { ClubLogo } from '@/components/ClubLogo';
import { ClubWordmark } from '@/components/ClubWordmark';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { PasswordInput } from '@/components/PasswordInput';
import { isApiClientError } from '@/features/shared/api/client';
import { loginFormSchema, type LoginFormInput } from '@/lib/auth';
import { useLoginMutation } from '../hooks/useAuth';
import { resolveExplicitReturnTo } from '../return-to';
import { LoginShowcase } from './LoginShowcase';

export interface LoginFormProps {
  expired?: boolean;
  returnTo?: string;
}

export { resolveExplicitReturnTo };

function formatWaitDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function resolveBannerConfig(
  error: unknown,
  hasValidationError: boolean,
  expired: boolean
): { kind: 'danger' | 'warn' | 'info'; type: 'rate' | 'network' | 'invalid' | 'expired'; wait?: string } | null {
  if (isApiClientError(error)) {
    if (error.status === 429 || error.code === 'TOO_MANY_REQUESTS') {
      const wait =
        typeof error.details.retryAfterSeconds === 'number'
          ? formatWaitDuration(error.details.retryAfterSeconds)
          : undefined;
      return { kind: 'warn', type: 'rate', wait };
    }
    if (error.status === 0 || error.code === 'NETWORK_ERROR') {
      return { kind: 'danger', type: 'network' };
    }
    return { kind: 'danger', type: 'invalid' };
  }
  if (error || hasValidationError) {
    return { kind: 'danger', type: 'invalid' };
  }
  return expired ? { kind: 'info', type: 'expired' } : null;
}

export function LoginStatusBanner({
  error,
  hasValidationError,
  expired,
}: {
  error: unknown;
  hasValidationError: boolean;
  expired: boolean;
}) {
  const tAuth = useTranslations('auth');
  const config = resolveBannerConfig(error, hasValidationError, expired);
  if (!config) {
    return null;
  }

  let title = tAuth('sessionExpiredTitle');
  let body = tAuth('sessionExpiredBody');
  if (config.type === 'rate') {
    title = tAuth('rateLimitedTitle');
    body = config.wait ? tAuth('rateLimitedWithWait', { wait: config.wait }) : tAuth('rateLimited');
  } else if (config.type === 'network') {
    title = tAuth('networkErrorTitle');
    body = tAuth('networkError');
  } else if (config.type === 'invalid') {
    title = tAuth('invalidCredentialsTitle');
    body = tAuth('invalidCredentials');
  }

  return (
    <div className={`ui-banner${config.kind === 'info' ? '' : ` is-${config.kind}`}`} role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-title">{title}</span>
        <span className="ui-banner-text">{body}</span>
      </div>
    </div>
  );
}

function LoginHeaderBar() {
  return (
    <header className="login-top">
      <div className="login-word login-mobile-brand">
        <ClubLogo alt="" />
        <ClubWordmark className="login-word-text" />
      </div>
      <LanguageSwitch />
    </header>
  );
}

function LoginCollabFooter() {
  const tAuth = useTranslations('auth');
  return (
    <div className="login-collab">
      <span className="login-collab-label">{tAuth('collabLabel')}</span>
      <span className="login-collab-pair">
        <a
          href="https://www.facebook.com/eiu.beam.club"
          target="_blank"
          rel="noopener noreferrer"
          className="login-collab-link"
        >
          BEAM CLUB
        </a>
        <span className="login-collab-x" aria-hidden="true">×</span>
        <a
          href="https://www.facebook.com/ng.sanggg149"
          target="_blank"
          rel="noopener noreferrer"
          className="login-collab-link"
        >
          Sang
        </a>
      </span>
    </div>
  );
}

interface LoginFormFieldsProps {
  studentIdInputId: string;
  passwordInputId: string;
  studentIdError: boolean;
  passwordError: boolean;
  isBusy: boolean;
  register: ReturnType<typeof useForm<LoginFormInput>>['register'];
  onClearApiError: () => void;
}

function LoginFormFields({
  studentIdInputId,
  passwordInputId,
  studentIdError,
  passwordError,
  isBusy,
  register,
  onClearApiError,
}: LoginFormFieldsProps) {
  const tAuth = useTranslations('auth');
  return (
    <>
      <div className="login-field">
        <label className="login-label" htmlFor={studentIdInputId}>{tAuth('studentIdLabel')}</label>
        <input
          id={studentIdInputId}
          type="text"
          autoComplete="username"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={tAuth('studentIdPlaceholder')}
          className={`login-input${studentIdError ? ' has-error' : ''}`}
          aria-invalid={studentIdError}
          disabled={isBusy}
          {...register('studentId', { onChange: onClearApiError })}
        />
      </div>
      <div className="login-field">
        <label className="login-label" htmlFor={passwordInputId}>{tAuth('passwordLabel')}</label>
        <PasswordInput
          id={passwordInputId}
          autoComplete="current-password"
          placeholder={tAuth('passwordPlaceholder')}
          className="login-input"
          hasError={passwordError}
          showLabel={tAuth('showPassword')}
          hideLabel={tAuth('hidePassword')}
          disabled={isBusy}
          {...register('password', { onChange: onClearApiError })}
        />
      </div>
      <label className="login-remember">
        <input type="checkbox" className="login-remember-checkbox" disabled={isBusy} {...register('remember')} />
        <span className="login-remember-text">
          <span className="login-remember-label">{tAuth('rememberLabel')}</span>
        </span>
      </label>
    </>
  );
}

export function LoginForm({ expired = false, returnTo }: LoginFormProps) {
  const studentIdInputId = useId();
  const passwordInputId = useId();
  const tAuth = useTranslations('auth');
  const loginMutation = useLoginMutation();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormInput>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { studentId: '', password: '', remember: false },
  });
  const isBusy = isSubmitting || loginMutation.isPending;

  function onSubmit(values: LoginFormInput): void {
    loginMutation.mutate({
      studentId: values.studentId,
      password: values.password,
      remember: values.remember,
      returnTo: resolveExplicitReturnTo(returnTo),
    });
  }

  return (
    <div className="login-shell">
      <LoginShowcase />
      <main className="login-right">
        <LoginHeaderBar />
        <div className="login-center">
          <form className="login-form" method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
            <LoginStatusBanner error={loginMutation.error} hasValidationError={Boolean(errors.studentId || errors.password)} expired={expired} />
            <h1 className="login-title">{tAuth('title')}</h1>
            <p className="login-lead">{tAuth('subtitle')}</p>
            <LoginFormFields
              studentIdInputId={studentIdInputId}
              passwordInputId={passwordInputId}
              studentIdError={Boolean(errors.studentId)}
              passwordError={Boolean(errors.password)}
              isBusy={isBusy}
              register={register}
              onClearApiError={() => { if (loginMutation.error) loginMutation.reset(); }}
            />
            <button type="submit" className={`login-submit${isBusy ? ' is-busy' : ''}`} disabled={isBusy}>
              {isBusy ? tAuth('signingIn') : tAuth('signInButton')}
            </button>
            <p className="login-help">{tAuth('helpNote')}</p>
            {process.env.NODE_ENV === 'development' ? <p className="login-dev-hint">{tAuth('devSeedHint')}</p> : null}
          </form>
        </div>
        <footer className="login-foot"><LoginCollabFooter /></footer>
      </main>
    </div>
  );
}
