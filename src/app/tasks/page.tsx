import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { CalendarWorkspaceView } from '@/features/calendar';

export async function generateMetadata(): Promise<Metadata> {
  const tCalendar = await getTranslations('calendar');
  const tApp = await getTranslations('app');
  return {
    title: `${tCalendar('title')} · ${tApp('name')}`,
  };
}

export default async function TasksCalendarPage() {
  const tCalendar = await getTranslations('calendar');

  return (
    <AuthGuard
      activeNav="tasks"
      breadcrumb={tCalendar('kicker')}
      title={tCalendar('title')}
      fullHeight
    >
      <Suspense fallback={null}>
        <CalendarWorkspaceView />
      </Suspense>
    </AuthGuard>
  );
}
