'use client';

import { useTranslations } from 'next-intl';
import { describePermissionsError } from '../error-mapping';

export interface AdminFlagPanelProps {
  memberName: string;
  isAdmin: boolean;
  isUpdating: boolean;
  error: unknown;
  onToggleAdmin: (nextIsAdmin: boolean) => void;
}

export function AdminFlagPanel({
  memberName,
  isAdmin,
  isUpdating,
  error,
  onToggleAdmin,
}: AdminFlagPanelProps) {
  const t = useTranslations('permissionsAdmin');
  const tErr = useTranslations('errors');
  const descriptor = describePermissionsError(error);
  const isLastAdminError = descriptor?.key === 'lastActiveAdmin';

  return (
    <section className="admin-card perm-admin-panel">
      {descriptor ? (
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
      ) : null}
      <div className="perm-admin-row">
        <div>
          <h3 className="admin-card-title">{t('adminSectionTitle')}</h3>
          <p className="admin-card-hint">
            {memberName} · {isAdmin ? t('adminSectionOnDesc') : t('adminSectionOffDesc')}
          </p>
        </div>
        <button
          type="button"
          className={isAdmin ? 'ui-btn danger is-sm' : 'ui-btn ghost is-sm'}
          disabled={isUpdating}
          onClick={() => onToggleAdmin(!isAdmin)}
        >
          {isUpdating
            ? t('updatingAdmin')
            : isAdmin
              ? t('removeAdminButton')
              : t('grantAdminButton')}
        </button>
      </div>
    </section>
  );
}
