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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tBoards = await getTranslations('boards');

  return (
    <AuthGuard
      activeNav="boards"
      breadcrumb={tBoards('kicker')}
      title={tBoards('title')}
    >
      <BoardDetailView boardId={id} />
    </AuthGuard>
  );
}
