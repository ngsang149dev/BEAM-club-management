import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { BoardDetailView } from '@/features/boards/components/BoardDetailView';

export async function generateMetadata(): Promise<Metadata> {
  const tBoards = await getTranslations('boards');
  const tApp = await getTranslations('app');
  return {
    title: `${tBoards('title')} · ${tApp('name')}`,
  };
}

export default async function BoardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const tBoards = await getTranslations('boards');
  const initialTaskId =
    typeof resolvedSearch.task === 'string' && resolvedSearch.task.trim().length > 0
      ? resolvedSearch.task.trim()
      : null;

  return (
    <AuthGuard
      activeNav="boards"
      breadcrumb={tBoards('kicker')}
      title={tBoards('title')}
    >
      <BoardDetailView boardId={id} initialTaskId={initialTaskId} />
    </AuthGuard>
  );
}
