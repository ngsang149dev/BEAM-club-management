'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AppShell, type AppNavKey, type AppShellUser } from '@/components/AppShell';
import { ErrorState } from '@/components/ErrorState';
import { isApiClientError } from '@/features/shared/api/client';
import { PermissionsProvider } from '@/features/shared/permissions/can';
import type { AppLocale } from '@/i18n/locale';
import {
  useLoggedOutState,
  useLogoutMutation,
  useMeQuery,
  useSessionQuery,
  useUpdateLocaleMutation,
} from '../hooks/useAuth';
import { sanitizeReturnTo } from '../return-to';

export interface AuthGuardProps {
  activeNav?: AppNavKey;
  title?: string;
  breadcrumb?: string;
  actions?: ReactNode;
  userSummary?: AppShellUser;
  children: ReactNode;
}

function buildLoginRedirectUrl(pathname: string): string {
  const raw =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : pathname;
  return `/login?expired=1&returnTo=${encodeURIComponent(sanitizeReturnTo(raw))}`;
}

function isAuthUnauthorized(params: {
  isLoggedOut: boolean;
  sessionError: unknown;
  meError: unknown;
  authenticated: boolean | undefined;
}): boolean {
  if (params.isLoggedOut) {
    return false;
  }
  if (isApiClientError(params.sessionError) && params.sessionError.status === 401) {
    return true;
  }
  if (isApiClientError(params.meError) && params.meError.status === 401) {
    return true;
  }
  return params.authenticated === false;
}

function AuthGuardErrorView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const key = isApiClientError(error) && error.status === 0 ? 'offline' : '500';
  return (
    <ErrorState
      variant={key}
      code={tErrors(`${key}.code`)}
      title={tErrors(`${key}.title`)}
      description={tErrors(`${key}.description`)}
      requestId={isApiClientError(error) ? error.requestId : undefined}
      requestIdLabel={tErrors('requestIdLabel')}
      actions={
        <button type="button" className="ui-btn primary" onClick={onRetry}>
          {tCommon('retry')}
        </button>
      }
    />
  );
}

function resolveShellUser(
  userSummary: AppShellUser | undefined,
  meData: ReturnType<typeof useMeQuery>['data'],
  isAdmin: boolean,
  roleLabels: { admin: string; member: string }
): AppShellUser | null {
  if (userSummary) {
    return userSummary;
  }
  if (!meData) {
    return null;
  }
  return {
    fullName: meData.profile.fullName,
    roleLabel: isAdmin ? roleLabels.admin : roleLabels.member,
    isActive: meData.profile.isActive,
  };
}

function shouldShowGuardLoading(params: {
  isLoggedOut: boolean;
  isPending: boolean;
  isUnauthorized: boolean;
}): boolean {
  return params.isLoggedOut || params.isPending || params.isUnauthorized;
}

function AuthGuardLocaleAlert() {
  const tProfile = useTranslations('profile');
  return (
    <div className="ui-banner is-danger auth-guard-banner" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{tProfile('languageSaveError')}</span>
      </div>
    </div>
  );
}

export function AuthGuard({ activeNav, title, breadcrumb, actions, userSummary, children }: AuthGuardProps) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const tCommon = useTranslations('common');
  const tProfile = useTranslations('profile');
  const isLoggedOut = useLoggedOutState();
  const sessionQuery = useSessionQuery();
  const meQuery = useMeQuery(Boolean(sessionQuery.data?.authenticated) && !userSummary);
  const logoutMutation = useLogoutMutation();
  const updateLocaleMutation = useUpdateLocaleMutation();
  const isUnauthorized = isAuthUnauthorized({
    isLoggedOut,
    sessionError: sessionQuery.error,
    meError: meQuery.error,
    authenticated: sessionQuery.data?.authenticated,
  });

  useEffect(() => {
    if (isUnauthorized) {
      router.replace(buildLoginRedirectUrl(pathname));
    }
  }, [isUnauthorized, pathname, router]);

  if (shouldShowGuardLoading({ isLoggedOut, isPending: sessionQuery.isPending, isUnauthorized })) {
    return (
      <AppShell activeNav={activeNav} title={title} breadcrumb={breadcrumb}>
        <p className="auth-loading" role="status">{tCommon('loading')}</p>
      </AppShell>
    );
  }
  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <AppShell activeNav={activeNav} title={title} breadcrumb={breadcrumb}>
        <AuthGuardErrorView error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />
      </AppShell>
    );
  }

  const session = sessionQuery.data;
  const resolvedUser = resolveShellUser(userSummary, meQuery.data, session.isAdmin, {
    admin: tProfile('roleAdmin'),
    member: tProfile('roleMember'),
  });

  return (
    <PermissionsProvider isAdmin={session.isAdmin} permissions={session.permissions}>
      <AppShell
        activeNav={activeNav}
        title={title}
        breadcrumb={breadcrumb}
        actions={actions}
        user={resolvedUser}
        onSignOut={() => logoutMutation.mutate()}
        onLocaleChange={(locale: AppLocale) => updateLocaleMutation.mutateAsync(locale)}
      >
        {updateLocaleMutation.isError ? <AuthGuardLocaleAlert /> : null}
        {children}
      </AppShell>
    </PermissionsProvider>
  );
}
