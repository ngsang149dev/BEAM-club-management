'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { isApiClientError } from '@/features/shared/api/client';
import { usePermissions } from '@/features/shared/permissions/can';
import { describeBrandingError } from '../error-mapping';
import { useBrandingQuery } from '../hooks/useBranding';
import { ClubLogoSection } from './ClubLogoSection';
import { ClubWordmarkSection } from './ClubWordmarkSection';
import { LoginGalleryAdminSection } from './LoginGalleryAdminSection';

export function BrandingAdminView() {
  const { isAdmin } = usePermissions();
  const t = useTranslations('branding');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const brandingQuery = useBrandingQuery(isAdmin);

  if (!isAdmin) {
    return (
      <ErrorState
        variant="403"
        code={tErr('403.code')}
        title={tErr('403.title')}
        description={tErr('403.description')}
        actions={<Link href="/" className="ui-btn primary">{tCommon('goHome')}</Link>}
      />
    );
  }

  if (brandingQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }

  if (brandingQuery.isError) {
    const queryError = brandingQuery.error;
    const errorKey = describeBrandingError(queryError);
    return (
      <ErrorState
        variant="500"
        title={t('loadErrorTitle')}
        description={tErr(errorKey ?? 'unknown')}
        requestId={isApiClientError(queryError) ? queryError.requestId : undefined}
        requestIdLabel={tErr('requestIdLabel')}
        actions={
          <button type="button" className="ui-btn primary" onClick={() => void brandingQuery.refetch()}>
            {tCommon('retry')}
          </button>
        }
      />
    );
  }

  const galleryItems = brandingQuery.data?.galleryItems ?? [];

  return (
    <div className="admin-page-stack">
      <div className="admin-sections-stack">
        <div className="branding-identity-grid">
          <ClubLogoSection />
          <ClubWordmarkSection />
        </div>
        <LoginGalleryAdminSection items={galleryItems} />
      </div>
    </div>
  );
}
