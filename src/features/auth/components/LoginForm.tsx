'use client';

import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { isApiClientError } from '@/features/shared/api/client';
import { loginFormSchema, type LoginFormInput } from '@/lib/auth';
import { useLoginMutation } from '../hooks/useAuth';
import { sanitizeReturnTo } from '../return-to';

export interface LoginFormProps {
  expired?: boolean;
  returnTo?: string;
}

function formatWaitDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function PriorityBars({ level, label }: { level: 1 | 2 | 3 | 4; label: string }) {
  return (
    <span className={`ui-prio p${level}`}>
      <span className="ui-prio-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= level ? 'on' : undefined} />
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function ShowcaseColumn({
  title,
  cards,
}: {
  title: string;
  cards: readonly { title: string; level: 1 | 2 | 3 | 4; levelLabel: string; hidden?: boolean }[];
}) {
  return (
    <div className="login-mini-col">
      <div className="login-mini-head">
        <span>{title}</span>
        <b>{cards.length}</b>
      </div>
      {cards.map((card) => (
        <div key={card.title} className={`login-mini-card${card.hidden ? ' is-hidden' : ''}`}>
          <span className="login-mini-title">{card.title}</span>
          <span className="login-mini-meta">
            <PriorityBars level={card.level} label={card.levelLabel} />
          </span>
        </div>
      ))}
    </div>
  );
}

function LoginShowcase() {
  const tApp = useTranslations('app');
  const tAuth = useTranslations('auth.showcase');
  const tPrio = useTranslations('priority');
  return (
    <section className="login-left" aria-hidden="true">
      <div className="login-brand-row">
        <div className="login-word">
          <span className="ui-logo"><i /><i /><i /><i /></span>
          <span className="login-word-text"><b>{tApp('name')}</b><span>{tApp('subtitle')}</span></span>
        </div>
        <span className="login-left-tag">{tAuth('tag')}</span>
      </div>
      <div className="login-copy">
        <span className="login-copy-kicker">{tAuth('kicker')}</span>
        <h2>{tAuth('headline')}</h2>
      </div>
      <div className="login-board-wrap">
        <div className="login-mini">
          <ShowcaseColumn
            title={tAuth('columns.todo')}
            cards={[
              { title: tAuth('sampleTasks.t1'), level: 3, levelLabel: tPrio('high') },
              { title: tAuth('sampleTasks.t2'), level: 1, levelLabel: tPrio('low') },
            ]}
          />
          <ShowcaseColumn
            title={tAuth('columns.doing')}
            cards={[
              { title: tAuth('sampleTasks.t3'), level: 4, levelLabel: tPrio('urgent') },
              { title: tAuth('sampleTasks.t4'), level: 4, levelLabel: tPrio('urgent'), hidden: true },
            ]}
          />
          <ShowcaseColumn
            title={tAuth('columns.done')}
            cards={[
              { title: tAuth('sampleTasks.t5'), level: 3, levelLabel: tPrio('high') },
              { title: tAuth('sampleTasks.t6'), level: 2, levelLabel: tPrio('medium') },
            ]}
          />
        </div>
      </div>
      <p className="login-caption">{tAuth('caption')}</p>
    </section>
  );
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
  const tApp = useTranslations('app');
  return (
    <header className="login-top">
      <div className="login-word login-mobile-brand">
        <span className="ui-logo" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="login-word-text"><b>{tApp('name')}</b><span>{tApp('subtitle')}</span></span>
      </div>
      <LanguageSwitch />
    </header>
  );
}

function LoginFormFields({
  inputId,
  hasError,
  isBusy,
  register,
  onClearApiError,
}: {
  inputId: string;
  hasError: boolean;
  isBusy: boolean;
  register: ReturnType<typeof useForm<LoginFormInput>>['register'];
  onClearApiError: () => void;
}) {
  const tAuth = useTranslations('auth');
  return (
    <>
      <div className="login-field">
        <label className="login-label" htmlFor={inputId}>{tAuth('studentIdLabel')}</label>
        <input
          id={inputId}
          type="text"
          autoComplete="username"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={tAuth('studentIdPlaceholder')}
          className={`login-input${hasError ? ' has-error' : ''}`}
          aria-invalid={hasError}
          disabled={isBusy}
          {...register('studentId', { onChange: onClearApiError })}
        />
      </div>
      <label className="login-remember">
        <input type="checkbox" className="login-remember-checkbox" disabled={isBusy} {...register('remember')} />
        <span className="login-remember-text">
          <span className="login-remember-label">{tAuth('rememberLabel')}</span>
          <span className="login-remember-hint">{tAuth('rememberHint')}</span>
        </span>
      </label>
    </>
  );
}

export function LoginForm({ expired = false, returnTo }: LoginFormProps) {
  const studentIdInputId = useId();
  const tApp = useTranslations('app');
  const tAuth = useTranslations('auth');
  const loginMutation = useLoginMutation();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormInput>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { studentId: '', remember: false },
  });
  const isBusy = isSubmitting || loginMutation.isPending;

  function onSubmit(values: LoginFormInput): void {
    loginMutation.mutate({ studentId: values.studentId, remember: values.remember, returnTo: sanitizeReturnTo(returnTo) });
  }

  return (
    <div className="login-shell">
      <LoginShowcase />
      <main className="login-right">
        <LoginHeaderBar />
        <div className="login-center">
          <form className="login-form" method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
            <LoginStatusBanner error={loginMutation.error} hasValidationError={Boolean(errors.studentId)} expired={expired} />
            <h1 className="login-title">{tAuth('title')}</h1>
            <p className="login-lead">{tAuth('subtitle')}</p>
            <LoginFormFields
              inputId={studentIdInputId}
              hasError={Boolean(errors.studentId)}
              isBusy={isBusy}
              register={register}
              onClearApiError={() => { if (loginMutation.error) loginMutation.reset(); }}
            />
            <button type="submit" className={`login-submit${isBusy ? ' is-busy' : ''}`} disabled={isBusy}>
              {isBusy ? tAuth('signingIn') : tAuth('signInButton')}
            </button>
            <p className="login-help">{tAuth('helpNote')}</p>
          </form>
        </div>
        <footer className="login-foot"><span>{tApp('footerNote')}</span></footer>
      </main>
    </div>
  );
}
