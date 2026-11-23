import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { ProfileView } from '@/features/auth/components/ProfileView';

export async function generateMetadata(): Promise<Metadata> {
  const tProfile = await getTranslations('profile');
  const tApp = await getTranslations('app');
  return {
    title: `${tProfile('title')} · ${tApp('name')}`,
  };
}

export default async function ProfilePage() {
  const tProfile = await getTranslations('profile');

  return (
    <AuthGuard activeNav="profile" breadcrumb={tProfile('kicker')} title={tProfile('title')}>
      <ProfileView />
    </AuthGuard>
  );
}
