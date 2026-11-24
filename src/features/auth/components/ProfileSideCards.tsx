'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { PermissionCode } from '@/features/shared/permissions/can';
import { PERMISSIONS } from '@/lib/permissions';
import type { SessionInfoResponse } from '../hooks/useAuth';

const PERMISSION_CATALOG_SUBKEY = new Map<string, string>(
  PERMISSIONS.map((perm) => [perm.code, perm.descriptionKey.replace(/^permissions\.catalog\./, '')])
);

export function ProfilePermissionsCard({
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

export function ProfileSessionCard({
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
