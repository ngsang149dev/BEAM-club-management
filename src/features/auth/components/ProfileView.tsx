'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { isApiClientError, type components } from '@/features/shared/api/client';
import type { PermissionCode } from '@/features/shared/permissions/can';
import type { AppLocale } from '@/i18n/locale';
import {
  useLogoutMutation,
  useMeQuery,
  useRemoveMyAvatarMutation,
  useSessionQuery,
  useUpdateLocaleMutation,
  useUpdateMyAvatarMutation,
  type SessionInfoResponse,
} from '../hooks/useAuth';
import { ChangePasswordCard } from './ChangePasswordCard';
import {
  ProfileContactAndDepartments,
  ProfileHeroSection,
  ProfilePermissionsCard,
  ProfileSessionCard,
} from './ProfileSideCards';

type MemberDetail = components['schemas']['MemberDetail'];

export interface ProfileContentProps {
  profile: MemberDetail;
  permissions: readonly PermissionCode[];
  session?: Pick<SessionInfoResponse, 'rememberMe' | 'expiresAt'> | null;
  isSigningOut?: boolean;
  localeError?: boolean;
  forceChangePasswordPrompt?: boolean;
  passwordChanged?: boolean;
  avatarBusy?: boolean;
  avatarError?: unknown;
  onUploadAvatar?: (dataUrl: string) => Promise<unknown> | void;
  onRemoveAvatar?: () => Promise<unknown> | void;
  onClearAvatarError?: () => void;
  onPasswordChanged?: () => void;
  onClearPasswordChanged?: () => void;
  onSignOut: () => void;
  onLocaleChange: (locale: AppLocale) => unknown | Promise<unknown>;
}

function ProfileMainColumn({
  profile,
  forceChangePasswordPrompt = false,
  passwordChanged,
  avatarBusy,
  avatarError,
  onUploadAvatar,
  onRemoveAvatar,
  onClearAvatarError,
  onPasswordChanged,
  onClearPasswordChanged,
}: {
  profile: MemberDetail;
  forceChangePasswordPrompt?: boolean;
  passwordChanged?: boolean;
  avatarBusy?: boolean;
  avatarError?: unknown;
  onUploadAvatar?: (dataUrl: string) => Promise<unknown> | void;
  onRemoveAvatar?: () => Promise<unknown> | void;
  onClearAvatarError?: () => void;
  onPasswordChanged?: () => void;
  onClearPasswordChanged?: () => void;
}) {
  const isPasswordPriority =
    profile.mustChangePassword || forceChangePasswordPrompt || Boolean(passwordChanged);

  return (
    <section className={`profile-main${isPasswordPriority ? ' is-password-priority' : ''}`}>
      <ProfileHeroSection
        profile={profile}
        avatarBusy={avatarBusy}
        avatarError={avatarError}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
        onClearAvatarError={onClearAvatarError}
      />
      <ProfileContactAndDepartments profile={profile} />
      <ChangePasswordCard
        mustChangePassword={profile.mustChangePassword}
        forcePrompt={forceChangePasswordPrompt}
        passwordChanged={passwordChanged}
        onPasswordChanged={onPasswordChanged}
        onClearPasswordChanged={onClearPasswordChanged}
      />
    </section>
  );
}

export function ProfileContent({
  profile,
  permissions,
  session,
  isSigningOut = false,
  localeError = false,
  forceChangePasswordPrompt = false,
  passwordChanged,
  avatarBusy,
  avatarError,
  onUploadAvatar,
  onRemoveAvatar,
  onClearAvatarError,
  onPasswordChanged,
  onClearPasswordChanged,
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
        <ProfileMainColumn
          profile={profile}
          forceChangePasswordPrompt={forceChangePasswordPrompt}
          passwordChanged={passwordChanged}
          avatarBusy={avatarBusy}
          avatarError={avatarError}
          onUploadAvatar={onUploadAvatar}
          onRemoveAvatar={onRemoveAvatar}
          onClearAvatarError={onClearAvatarError}
          onPasswordChanged={onPasswordChanged}
          onClearPasswordChanged={onClearPasswordChanged}
        />
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

function ProfileContentWithSearchParams(props: ProfileContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasChangePasswordQuery = searchParams?.get('changePassword') === '1';

  const handlePasswordChanged = () => {
    props.onPasswordChanged?.();
    if (!hasChangePasswordQuery || !searchParams) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('changePassword');
    const query = nextParams.toString();
    router.replace(query ? `/profile?${query}` : '/profile');
  };

  return (
    <ProfileContent
      {...props}
      forceChangePasswordPrompt={hasChangePasswordQuery}
      onPasswordChanged={handlePasswordChanged}
    />
  );
}

export function ProfileView() {
  const tCommon = useTranslations('common');
  const tProfile = useTranslations('profile');
  const [passwordChanged, setPasswordChanged] = useState(false);
  const meQuery = useMeQuery();
  const sessionQuery = useSessionQuery();
  const logoutMutation = useLogoutMutation();
  const updateLocaleMutation = useUpdateLocaleMutation();
  const updateAvatarMutation = useUpdateMyAvatarMutation();
  const removeAvatarMutation = useRemoveMyAvatarMutation();

  const isMeUnauthorized = isApiClientError(meQuery.error) && meQuery.error.status === 401;
  if (meQuery.isPending || isMeUnauthorized) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }

  if (meQuery.isError || !meQuery.data) {
    return <ProfileLoadError error={meQuery.error} onRetry={() => void meQuery.refetch()} />;
  }

  const contentProps: ProfileContentProps = {
    profile: meQuery.data.profile,
    permissions: meQuery.data.permissions,
    session: sessionQuery.data ?? null,
    isSigningOut: logoutMutation.isPending,
    localeError: updateLocaleMutation.isError,
    passwordChanged,
    avatarBusy: updateAvatarMutation.isPending || removeAvatarMutation.isPending,
    avatarError: updateAvatarMutation.error ?? removeAvatarMutation.error,
    onUploadAvatar: async (dataUrl) => {
      await updateAvatarMutation.mutateAsync({ dataUrl });
      toast.success(tProfile('avatarUpdatedToast'));
    },
    onRemoveAvatar: async () => {
      await removeAvatarMutation.mutateAsync();
      toast.success(tProfile('avatarRemovedToast'));
    },
    onClearAvatarError: () => {
      updateAvatarMutation.reset();
      removeAvatarMutation.reset();
    },
    onPasswordChanged: () => setPasswordChanged(true),
    onClearPasswordChanged: () => setPasswordChanged(false),
    onSignOut: () => logoutMutation.mutate(),
    onLocaleChange: (locale) => updateLocaleMutation.mutateAsync(locale),
  };

  return (
    <Suspense fallback={<ProfileContent {...contentProps} />}>
      <ProfileContentWithSearchParams {...contentProps} />
    </Suspense>
  );
}
