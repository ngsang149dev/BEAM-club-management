import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ErrorState } from '@/components/ErrorState';

export default async function NotFoundPage() {
  const [tErrors, tCommon, tApp] = await Promise.all([
    getTranslations('errors'),
    getTranslations('common'),
    getTranslations('app'),
  ]);

  return (
    <ErrorState
      fullPage
      variant="404"
      code={tErrors('404.code')}
      title={tErrors('404.title')}
      description={tErrors('404.description')}
      brandName={tApp('name')}
      footerText={tApp('footerNote')}
      actions={
        <>
          <Link href="/tasks" className="ui-btn primary">
            {tCommon('backToTasks')}
          </Link>
          <Link href="/progress" className="ui-btn secondary">
            {tCommon('backToProgress')}
          </Link>
        </>
      }
    />
  );
}
