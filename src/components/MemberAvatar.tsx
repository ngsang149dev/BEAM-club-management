'use client';

import { createElement, useState, type CSSProperties } from 'react';
import { getAvatarTone, getMemberInitials } from '@/lib/media';

export type MemberAvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface MemberAvatarProps {
  memberId?: string;
  fullName: string;
  avatarUrl?: string | null;
  isActive?: boolean;
  size?: MemberAvatarSize;
  className?: string;
}

const SIZE_CLASS: Record<MemberAvatarSize, string> = {
  xs: 'is-xs',
  sm: 'is-sm',
  md: '',
  lg: 'is-lg',
};

function buildAvatarClassName({
  size,
  showImage,
  isInactive,
  className,
}: {
  size: MemberAvatarSize;
  showImage: boolean;
  isInactive: boolean;
  className?: string;
}): string {
  return [
    'ui-avatar',
    SIZE_CLASS[size],
    showImage ? 'has-image' : '',
    isInactive ? 'is-out' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function MemberAvatar({
  memberId,
  fullName,
  avatarUrl,
  isActive = true,
  size = 'md',
  className,
}: MemberAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);
  const isInactive = isActive === false;
  const classes = buildAvatarClassName({ size, showImage, isInactive, className });

  if (showImage && avatarUrl) {
    return (
      <span className={classes} aria-hidden="true">
        {createElement('img', {
          src: avatarUrl,
          alt: '',
          className: 'ui-avatar-img',
          onError: () => setFailedUrl(avatarUrl),
        })}
      </span>
    );
  }

  const tone = getAvatarTone(memberId || fullName);
  const style: CSSProperties | undefined = isInactive
    ? undefined
    : { backgroundColor: tone.bg, color: tone.fg };

  return (
    <span className={classes} style={style} aria-hidden="true">
      {getMemberInitials(fullName)}
    </span>
  );
}
