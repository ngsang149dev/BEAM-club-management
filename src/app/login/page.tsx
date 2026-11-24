import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { resolveExplicitReturnTo } from '@/features/auth/return-to';

export async function generateMetadata(): Promise<Metadata> {
  const tAuth = await getTranslations('auth');
  const tApp = await getTranslations('app');
  return {
    title: `${tAuth('title')} · ${tApp('name')}`,
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const expired = params.expired === '1';
  const returnTo = resolveExplicitReturnTo(params.returnTo) ?? undefined;

  return <LoginForm expired={expired} returnTo={returnTo} />;
}
