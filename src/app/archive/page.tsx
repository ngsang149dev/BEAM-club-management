import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { ArchiveView } from '@/features/archive';

export async function generateMetadata(): Promise<Metadata> {
  const tArchive = await getTranslations('archive');
  const tApp = await getTranslations('app');
  return {
    title: `${tArchive('title')} · ${tApp('name')}`,
  };
}

export default async function ArchivePage() {
  const tArchive = await getTranslations('archive');

  return (
    <AuthGuard
      activeNav="archive"
      breadcrumb={tArchive('kicker')}
      title={tArchive('title')}
    >
      <ArchiveView />
    </AuthGuard>
  );
}
