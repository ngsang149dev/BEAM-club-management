import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { PermissionsAdminView } from '@/features/permissions/components/PermissionsAdminView';

export async function generateMetadata(): Promise<Metadata> {
  const tPermissions = await getTranslations('permissionsAdmin');
  const tApp = await getTranslations('app');
  return {
    title: `${tPermissions('title')} · ${tApp('name')}`,
  };
}

export default async function PermissionsAdminPage() {
  const tPermissions = await getTranslations('permissionsAdmin');

  return (
    <AuthGuard
      activeNav="permissions"
      breadcrumb={tPermissions('kicker')}
      title={tPermissions('title')}
    >
      <PermissionsAdminView />
    </AuthGuard>
  );
}
