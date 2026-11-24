import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { DepartmentsAdminView } from '@/features/departments/components/DepartmentsAdminView';

export async function generateMetadata(): Promise<Metadata> {
  const tDepartments = await getTranslations('departmentsAdmin');
  const tApp = await getTranslations('app');
  return {
    title: `${tDepartments('title')} · ${tApp('name')}`,
  };
}

export default async function DepartmentsAdminPage() {
  const tDepartments = await getTranslations('departmentsAdmin');

  return (
    <AuthGuard
      activeNav="departments"
      breadcrumb={tDepartments('kicker')}
      title={tDepartments('title')}
    >
      <DepartmentsAdminView />
    </AuthGuard>
  );
}
