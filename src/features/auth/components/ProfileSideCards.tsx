'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { AvatarUploadControl } from '@/features/members/components/AvatarUploadControl';
import type { components } from '@/features/shared/api/client';
import type { PermissionCode } from '@/features/shared/permissions/can';
import { PERMISSIONS } from '@/lib/permissions';
import type { SessionInfoResponse } from '../hooks/useAuth';

type MemberDetail = components['schemas']['MemberDetail'];

const NOOP_AVATAR = () => undefined;

export function ProfileHeroSection({
  profile,
  avatarBusy,
  avatarError,
  onUploadAvatar,
  onRemoveAvatar,
  onClearAvatarError,
}: {
  profile: MemberDetail;
  avatarBusy?: boolean;
  avatarError?: unknown;
  onUploadAvatar?: (dataUrl: string) => Promise<unknown> | void;
  onRemoveAvatar?: () => Promise<unknown> | void;
  onClearAvatarError?: () => void;
}) {
  const tProfile = useTranslations('profile');
  const tMember = useTranslations('member');
  return (
    <div className="profile-hero">
      <AvatarUploadControl
        memberId={profile.id}
        fullName={profile.fullName}
        avatarUrl={profile.avatarUrl}
        isActive={profile.isActive}
        isBusy={avatarBusy}
        serverError={avatarError}
        onUpload={onUploadAvatar ?? NOOP_AVATAR}
        onRemove={onRemoveAvatar ?? NOOP_AVATAR}
        onClearError={onClearAvatarError}
        details={
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
        }
      />
    </div>
  );
}

export function ProfileContactAndDepartments({ profile }: { profile: MemberDetail }) {
  const tProfile = useTranslations('profile');
  return (
    <>
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
    </>
  );
}

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
