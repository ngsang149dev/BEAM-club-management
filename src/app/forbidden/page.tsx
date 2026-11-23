import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ErrorState } from '@/components/ErrorState';

export default async function ForbiddenPage() {
  const [tErrors, tCommon, tApp] = await Promise.all([
    getTranslations('errors'),
    getTranslations('common'),
    getTranslations('app'),
  ]);

  return (
    <ErrorState
      fullPage
      variant="403"
      code={tErrors('403.code')}
      title={tErrors('403.title')}
      description={tErrors('403.description')}
      brandName={tApp('name')}
      footerText={tApp('footerNote')}
      actions={
        <>
          <Link href="/boards" className="ui-btn primary">
            {tCommon('backToBoards')}
          </Link>
          <Link href="/" className="ui-btn secondary">
            {tCommon('goHome')}
          </Link>
        </>
      }
    />
  );
}
