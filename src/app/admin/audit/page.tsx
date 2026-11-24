import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { AuditLogsView } from '@/features/audit/components/AuditLogsView';

export async function generateMetadata(): Promise<Metadata> {
  const tAudit = await getTranslations('auditLogs');
  const tApp = await getTranslations('app');
  return {
    title: `${tAudit('title')} · ${tApp('name')}`,
  };
}

export default async function AuditLogsPage() {
  const tAudit = await getTranslations('auditLogs');

  return (
    <AuthGuard
      activeNav="auditLog"
      breadcrumb={tAudit('kicker')}
      title={tAudit('title')}
    >
      <AuditLogsView />
    </AuthGuard>
  );
}
