'use client';

import { useTranslations } from 'next-intl';
import { ClubLogo } from '@/components/ClubLogo';
import { useOptionalBranding } from '@/features/branding/hooks/useBranding';
import { LoginPhotoWall } from './LoginPhotoWall';

export function LoginShowcase() {
  const tApp = useTranslations('app');
  const tAuth = useTranslations('auth.showcase');
  const branding = useOptionalBranding();

  return (
    <section className="login-left" aria-label={tAuth('showcaseLabel')}>
      <div className="login-brand-row">
        <div className="login-word">
          <ClubLogo logoUrl={branding?.logoUrl} alt="" />
          <span className="login-word-text">
            <b>{tApp('name')}</b>
            <span>{tApp('subtitle')}</span>
          </span>
        </div>
        <span className="login-left-tag">{tAuth('tag')}</span>
      </div>
      <div className="login-copy">
        <span className="login-copy-kicker">{tAuth('kicker')}</span>
        <h2>{tAuth('headline')}</h2>
      </div>
      <LoginPhotoWall items={branding?.galleryItems ?? []} />
    </section>
  );
}
