'use client';

import { useTranslations } from 'next-intl';
import { describePermissionsError, type PermissionsErrorDescriptor } from '../error-mapping';

export interface AdminFlagPanelProps {
  memberName: string;
  isAdmin: boolean;
  isSelf?: boolean;
  isUpdating: boolean;
  error: unknown;
  onToggleAdmin: (nextIsAdmin: boolean) => void;
}

function AdminFlagErrorBanner({ descriptor }: { descriptor: PermissionsErrorDescriptor | null }) {
  const t = useTranslations('permissionsAdmin');
  const tErr = useTranslations('errors');
  if (!descriptor) return null;
  const isLastAdminError = descriptor.key === 'lastActiveAdmin';

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        {isLastAdminError ? (
          <strong className="ui-banner-title">{t('lastAdminBannerTitle')}</strong>
        ) : null}
        <span className="ui-banner-text">{tErr(descriptor.key)}</span>
        {descriptor.requestId ? (
          <span className="ui-banner-meta">
            {tErr('requestIdLabel')}: {descriptor.requestId}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function resolveAdminButtonLabel(
  t: ReturnType<typeof useTranslations<'permissionsAdmin'>>,
  isUpdating: boolean,
  isAdmin: boolean
): string {
  if (isUpdating) return t('updatingAdmin');
  return isAdmin ? t('removeAdminButton') : t('grantAdminButton');
}

export function AdminFlagPanel({
  memberName,
  isAdmin,
  isSelf = false,
  isUpdating,
  error,
  onToggleAdmin,
}: AdminFlagPanelProps) {
  const t = useTranslations('permissionsAdmin');
  const descriptor = describePermissionsError(error);
  const isSelfDemoteBlocked = isSelf && isAdmin;

  return (
    <section className="admin-card perm-admin-panel">
      <AdminFlagErrorBanner descriptor={descriptor} />
      <div className="perm-admin-row">
        <div>
          <h3 className="admin-card-title">{t('adminSectionTitle')}</h3>
          <p className="admin-card-hint">
            {memberName} · {isAdmin ? t('adminSectionOnDesc') : t('adminSectionOffDesc')}
          </p>
          {isSelfDemoteBlocked ? (
            <p className="admin-card-hint perm-self-guard-hint" role="note">
              {t('cannotRevokeSelfHint')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={isAdmin ? 'ui-btn danger is-sm' : 'ui-btn ghost is-sm'}
          disabled={isUpdating || isSelfDemoteBlocked}
          onClick={() => onToggleAdmin(!isAdmin)}
        >
          {resolveAdminButtonLabel(t, isUpdating, isAdmin)}
        </button>
      </div>
    </section>
  );
}
