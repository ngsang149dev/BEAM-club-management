import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { MyTasksView } from '@/features/tasks/components/MyTasksView';

export async function generateMetadata(): Promise<Metadata> {
  const tMyTasks = await getTranslations('myTasks');
  const tApp = await getTranslations('app');
  return {
    title: `${tMyTasks('title')} · ${tApp('name')}`,
  };
}

export default async function MyTasksPage() {
  const tMyTasks = await getTranslations('myTasks');

  return (
    <AuthGuard
      activeNav="myTasks"
      breadcrumb={tMyTasks('kicker')}
      title={tMyTasks('title')}
    >
      <MyTasksView />
    </AuthGuard>
  );
}
