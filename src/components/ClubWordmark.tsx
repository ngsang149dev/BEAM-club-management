'use client';

import { createElement, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalClubWordmarkUrl } from '@/features/branding/hooks/useBranding';

export interface ClubWordmarkProps {
  wordmarkUrl?: string | null;
  className?: string;
}

function joinWordmarkClasses(base: string, extra?: string): string {
  return [extra, base].filter(Boolean).join(' ');
}

export function ClubWordmark({ wordmarkUrl, className }: ClubWordmarkProps) {
  const tApp = useTranslations('app');
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const subscribedWordmarkUrl = useOptionalClubWordmarkUrl(wordmarkUrl === undefined);
  const resolvedUrl = wordmarkUrl !== undefined ? wordmarkUrl : subscribedWordmarkUrl;
  const showCustom = Boolean(resolvedUrl && failedUrl !== resolvedUrl);

  if (showCustom && resolvedUrl) {
    return (
      <span className={joinWordmarkClasses('club-wordmark', className)}>
        {createElement('img', {
          src: resolvedUrl,
          alt: tApp('name'),
          className: 'club-wordmark-img',
          onError: () => setFailedUrl(resolvedUrl),
        })}
      </span>
    );
  }

  return (
    <span className={className ?? 'app-brand-text'}>
      <b>{tApp('name')}</b>
      <span>{tApp('subtitle')}</span>
    </span>
  );
}
