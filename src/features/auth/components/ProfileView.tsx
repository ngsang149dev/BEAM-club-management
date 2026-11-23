'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { isApiClientError, type components } from '@/features/shared/api/client';
import type { PermissionCode } from '@/features/shared/permissions/can';
import type { AppLocale } from '@/i18n/locale';
import { PERMISSIONS } from '@/lib/permissions';
import {
  useLogoutMutation,
  useMeQuery,
  useSessionQuery,
  useUpdateLocaleMutation,
  type SessionInfoResponse,
} from '../hooks/useAuth';

type MemberDetail = components['schemas']['MemberDetail'];

const PERMISSION_CATALOG_SUBKEY = new Map<string, string>(
  PERMISSIONS.map((perm) => [perm.code, perm.descriptionKey.replace(/^permissions\.catalog\./, '')])
);

export interface ProfileContentProps {
  profile: MemberDetail;
  permissions: readonly PermissionCode[];
  session?: Pick<SessionInfoResponse, 'rememberMe' | 'expiresAt'> | null;
  isSigningOut?: boolean;
  localeError?: boolean;
  onSignOut: () => void;
  onLocaleChange: (locale: AppLocale) => unknown | Promise<unknown>;
}

function getInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? '?').slice(0, 1).toUpperCase();
}

function ProfilePermissionsCard({
  isAdmin,
  permissions,
}: {
  isAdmin: boolean;
  permissions: readonly PermissionCode[];
}) {
  const tProfile = useTranslations('profile');
  const tCatalog = useTranslations('permissions.catalog');
  return (
    <section className="profile-card">
      <h3>{tProfile('permissionsTitle')}</h3>
      {isAdmin ? (
        <div className="profile-admin-note">
          <span className="role-badge is-admin">{tProfile('roleAdmin')}</span>
          <p>{tProfile('adminAllPermissions')}</p>
        </div>
      ) : permissions.length === 0 ? (
        <p className="profile-note">{tProfile('permissionsEmpty')}</p>
      ) : (
        <div className="profile-perms">
          {permissions.map((code) => {
            const subKey = PERMISSION_CATALOG_SUBKEY.get(code);
            return (
              <div key={code} className="profile-perm">
                <svg className="ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12l5 5L20 6" />
                </svg>
                <div>
                  <b>{code}</b>
                  <span>{subKey ? tCatalog(subKey) : code}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="profile-note">{tProfile('permissionsManagedByAdmin')}</p>
    </section>
  );
}

function ProfileSessionCard({
  session,
  isSigningOut,
  onSignOut,
}: {
  session?: Pick<SessionInfoResponse, 'rememberMe' | 'expiresAt'> | null;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  const tProfile = useTranslations('profile');
  const formatter = useFormatter();
  const formattedExpiry = session
    ? formatter.dateTime(new Date(session.expiresAt), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      })
    : null;

  return (
    <section className="profile-card">
      <h3>{tProfile('sessionTitle')}</h3>
      {session ? (
        <>
          <div className="profile-kv">
            <span>{tProfile('rememberLabel')}</span>
            <b>{session.rememberMe ? tProfile('rememberOn') : tProfile('rememberOff')}</b>
          </div>
          <div className="profile-kv">
            <span>{tProfile('expiresAtLabel')}</span>
            <b>{formattedExpiry}</b>
          </div>
        </>
      ) : null}
      <button type="button" className="ui-btn danger is-sm profile-signout" disabled={isSigningOut} onClick={onSignOut}>
        {isSigningOut ? tProfile('signingOut') : tProfile('signOutButton')}
      </button>
    </section>
  );
}

function ProfileMainColumn({ profile }: { profile: MemberDetail }) {
  const tProfile = useTranslations('profile');
  const tMember = useTranslations('member');
  return (
    <section className="profile-main">
      <div className="profile-hero">
        <span className={`ui-avatar profile-avatar${profile.isActive ? '' : ' is-out'}`} aria-hidden="true">
          {getInitial(profile.fullName)}
        </span>
        <div>
          <h2>
            {profile.fullName}
            {profile.isActive ? null : <span className="app-user-left"> {tMember('leftBadge')}</span>}
          </h2>
          <div className="profile-hero-meta">
            <span className={`role-badge${profile.isAdmin ? ' is-admin' : ''}`}>
              {profile.isAdmin ? tProfile('roleAdmin') : tProfile('roleMember')}
            </span>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h3>{tProfile('contactTitle')}</h3>
        <div className="profile-fields">
          <div className="profile-field">
            <span>{tProfile('studentIdLabel')}</span>
            <b className="profile-mono">{profile.studentId}</b>
            <span className="profile-lock">{tProfile('onlyYouAndAdmins')}</span>
          </div>
          <div className="profile-field">
            <span>{tProfile('emailLabel')}</span>
            <b>{profile.email}</b>
            <span className="profile-lock">{tProfile('onlyYouAndAdmins')}</span>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h3>{tProfile('departmentsTitle')}</h3>
        {profile.departments.length > 0 ? (
          <div className="profile-depts">
            {profile.departments.map((dept) => (
              <span key={dept.id} className="ui-chip">{dept.name}</span>
            ))}
          </div>
        ) : (
          <p className="profile-note">{tProfile('departmentsEmpty')}</p>
        )}
        <p className="profile-note">{tProfile('departmentsManagedByAdmin')}</p>
      </div>
    </section>
  );
}

export function ProfileContent({
  profile,
  permissions,
  session,
  isSigningOut = false,
  localeError = false,
  onSignOut,
  onLocaleChange,
}: ProfileContentProps) {
  const tProfile = useTranslations('profile');
  return (
    <div className="profile-page">
      <header className="profile-pagehead">
        <h1>{tProfile('title')}</h1>
        <p>{tProfile('subtitle')}</p>
      </header>
      <div className="profile-grid">
        <ProfileMainColumn profile={profile} />
        <aside className="profile-side">
          <ProfilePermissionsCard isAdmin={profile.isAdmin} permissions={permissions} />
          <section className="profile-card">
            <h3>{tProfile('languageTitle')}</h3>
            <LanguageSwitch onLocaleChange={onLocaleChange} />
            <p className="profile-note">{tProfile('languageSyncedNote')}</p>
            {localeError ? <p className="profile-error" role="alert">{tProfile('languageSaveError')}</p> : null}
          </section>
          <ProfileSessionCard session={session} isSigningOut={isSigningOut} onSignOut={onSignOut} />
        </aside>
      </div>
    </div>
  );
}

function ProfileLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const tProfile = useTranslations('profile');
  const isOffline = isApiClientError(error) && error.status === 0;
  return (
    <ErrorState
      variant={isOffline ? 'offline' : '500'}
      code={isOffline ? tErrors('offline.code') : tErrors('500.code')}
      title={tProfile('loadErrorTitle')}
      description={tProfile('loadErrorBody')}
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

export function ProfileView() {
  const tCommon = useTranslations('common');
  const meQuery = useMeQuery();
  const sessionQuery = useSessionQuery();
  const logoutMutation = useLogoutMutation();
  const updateLocaleMutation = useUpdateLocaleMutation();

  const isMeUnauthorized = isApiClientError(meQuery.error) && meQuery.error.status === 401;
  if (meQuery.isPending || isMeUnauthorized) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }

  if (meQuery.isError || !meQuery.data) {
    return <ProfileLoadError error={meQuery.error} onRetry={() => void meQuery.refetch()} />;
  }

  return (
    <ProfileContent
      profile={meQuery.data.profile}
      permissions={meQuery.data.permissions}
      session={sessionQuery.data ?? null}
      isSigningOut={logoutMutation.isPending}
      localeError={updateLocaleMutation.isError}
      onSignOut={() => logoutMutation.mutate()}
      onLocaleChange={(locale) => updateLocaleMutation.mutateAsync(locale)}
    />
  );
}
