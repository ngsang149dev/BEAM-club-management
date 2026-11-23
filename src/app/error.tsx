'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';

export interface RootErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: RootErrorProps) {
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');
  const tApp = useTranslations('app');

  return (
    <ErrorState
      fullPage
      variant="500"
      code={tErrors('500.code')}
      title={tErrors('500.title')}
      description={tErrors('500.description')}
      requestId={error.digest}
      requestIdLabel={tErrors('requestIdLabel')}
      brandName={tApp('name')}
      footerText={tApp('footerNote')}
      actions={
        <>
          <button type="button" className="ui-btn primary" onClick={reset}>
            {tCommon('retry')}
          </button>
          <Link href="/" className="ui-btn secondary">
            {tCommon('goHome')}
          </Link>
        </>
      }
    />
  );
}
