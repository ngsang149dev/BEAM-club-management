'use client';

import { createElement, useState } from 'react';
import { useOptionalClubLogoUrl } from '@/features/branding/hooks/useBranding';

export type ClubLogoSize = 'sm' | 'md' | 'lg';

export interface ClubLogoProps {
  logoUrl?: string | null;
  alt?: string;
  size?: ClubLogoSize;
  className?: string;
}

const LOGO_SIZE_CLASS: Record<ClubLogoSize, string> = {
  sm: 'is-sm',
  md: '',
  lg: 'is-lg',
};

function joinClasses(base: string, size: ClubLogoSize, extra?: string): string {
  return [base, LOGO_SIZE_CLASS[size], extra ?? ''].filter(Boolean).join(' ');
}

function DefaultClubLogo({ alt, className }: { alt: string; className: string }) {
  const hasAlt = alt.length > 0;
  return (
    <span
      className={className}
      role={hasAlt ? 'img' : undefined}
      aria-label={hasAlt ? alt : undefined}
      aria-hidden={hasAlt ? undefined : true}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function ClubLogo({
  logoUrl,
  alt = '',
  size = 'md',
  className,
}: ClubLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const subscribedLogoUrl = useOptionalClubLogoUrl(logoUrl === undefined);
  const resolvedUrl = logoUrl !== undefined ? logoUrl : subscribedLogoUrl;
  const showCustom = Boolean(resolvedUrl && failedUrl !== resolvedUrl);

  if (showCustom && resolvedUrl) {
    return (
      <span className={joinClasses('club-logo-box', size, className)}>
        {createElement('img', {
          src: resolvedUrl,
          alt,
          className: 'club-logo-img',
          onError: () => setFailedUrl(resolvedUrl),
        })}
      </span>
    );
  }

  return <DefaultClubLogo alt={alt} className={joinClasses('ui-logo', size, className)} />;
}
