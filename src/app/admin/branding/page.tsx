import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { BrandingAdminView } from '@/features/branding/components/BrandingAdminView';

export async function generateMetadata(): Promise<Metadata> {
  const tBranding = await getTranslations('branding');
  const tApp = await getTranslations('app');
  return {
    title: `${tBranding('pageTitle')} · ${tApp('name')}`,
  };
}

export default async function BrandingAdminPage() {
  const tBranding = await getTranslations('branding');

  return (
    <AuthGuard
      activeNav="branding"
      breadcrumb={tBranding('kicker')}
      title={tBranding('pageTitle')}
    >
      <BrandingAdminView />
    </AuthGuard>
  );
}
