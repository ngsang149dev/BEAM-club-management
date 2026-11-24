import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { MembersDirectoryView } from '@/features/members/components/MembersDirectoryView';

export async function generateMetadata(): Promise<Metadata> {
  const tMembers = await getTranslations('members');
  const tApp = await getTranslations('app');
  return {
    title: `${tMembers('title')} · ${tApp('name')}`,
  };
}

export default async function MembersPage() {
  const tMembers = await getTranslations('members');

  return (
    <AuthGuard
      activeNav="members"
      breadcrumb={tMembers('kicker')}
      title={tMembers('title')}
    >
      <MembersDirectoryView />
    </AuthGuard>
  );
}
