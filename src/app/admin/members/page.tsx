import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { MemberAdminView } from '@/features/members/components/MemberAdminView';

export async function generateMetadata(): Promise<Metadata> {
  const tAdmin = await getTranslations('memberAdmin');
  const tApp = await getTranslations('app');
  return {
    title: `${tAdmin('title')} · ${tApp('name')}`,
  };
}

export default async function MemberAdminPage() {
  const tAdmin = await getTranslations('memberAdmin');

  return (
    <AuthGuard
      activeNav="memberAdmin"
      breadcrumb={tAdmin('kicker')}
      title={tAdmin('title')}
    >
      <MemberAdminView />
    </AuthGuard>
  );
}
