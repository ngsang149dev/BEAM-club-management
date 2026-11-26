import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { RemindersAdminView } from '@/features/reminders/components/RemindersAdminView';

export async function generateMetadata(): Promise<Metadata> {
  const tRem = await getTranslations('reminders');
  const tApp = await getTranslations('app');
  return {
    title: `${tRem('title')} · ${tApp('name')}`,
  };
}

export default async function RemindersAdminPage() {
  const tRem = await getTranslations('reminders');

  return (
    <AuthGuard
      activeNav="reminders"
      breadcrumb={tRem('kicker')}
      title={tRem('title')}
    >
      <RemindersAdminView />
    </AuthGuard>
  );
}
