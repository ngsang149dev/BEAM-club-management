import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { MemberProgressView } from '@/features/progress';

export async function generateMetadata(): Promise<Metadata> {
  const tProgress = await getTranslations('progress');
  const tApp = await getTranslations('app');
  return {
    title: `${tProgress('title')} · ${tApp('name')}`,
  };
}

export default async function ProgressPage() {
  const tProgress = await getTranslations('progress');

  return (
    <AuthGuard
      activeNav="progress"
      breadcrumb={tProgress('kicker')}
      title={tProgress('title')}
      fullHeight
    >
      <MemberProgressView />
    </AuthGuard>
  );
}
