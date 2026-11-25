'use client';

import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import type { LoginGalleryItemDto } from '@/features/branding/hooks/useBranding';

type SampleSceneId = 'kickoff' | 'workshop' | 'hackathon' | 'community';

interface PolaroidFrameData {
  readonly id: string;
  readonly title: string;
  readonly caption: string | null;
  readonly imageUrl?: string;
  readonly sampleScene?: SampleSceneId;
}

const SAMPLE_SCENES: readonly SampleSceneId[] = ['kickoff', 'workshop', 'hackathon', 'community'];
const AUTO_DRIFT_PX_PER_SEC = 24;
const ARROW_SCROLL_STEP = 280;

const SAMPLE_ARTWORK_ELEMENTS: Record<SampleSceneId, ReactNode> = {
  kickoff: (
    <>
      <rect width="240" height="165" fill="#fff0f6" />
      <circle cx="192" cy="36" r="24" fill="#fbcfe8" />
      <rect x="24" y="28" width="98" height="64" rx="8" fill="#ffffff" stroke="#111827" strokeWidth="2.5" />
      <path d="M38 48h52M38 62h68M38 76h38" stroke="#ec4899" strokeWidth="4" strokeLinecap="round" />
      <circle cx="66" cy="126" r="16" fill="#ec4899" stroke="#111827" strokeWidth="2.5" />
      <circle cx="114" cy="120" r="18" fill="#111827" />
      <circle cx="164" cy="126" r="16" fill="#ffffff" stroke="#111827" strokeWidth="2.5" />
      <path d="M44 158c4-14 40-14 44 0M90 158c5-16 43-16 48 0M142 158c4-14 40-14 44 0" fill="#fbcfe8" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  workshop: (
    <>
      <rect width="240" height="165" fill="#ffe4f0" />
      <rect x="26" y="22" width="188" height="114" rx="10" fill="#ffffff" stroke="#111827" strokeWidth="2.5" />
      <rect x="42" y="38" width="76" height="58" rx="6" fill="#fdf2f8" stroke="#111827" strokeWidth="2" />
      <circle cx="80" cy="67" r="16" fill="#ec4899" stroke="#111827" strokeWidth="2" />
      <path d="M134 44h62M134 60h48M134 76h56" stroke="#111827" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="42" y="108" width="54" height="14" rx="7" fill="#111827" />
      <rect x="104" y="108" width="44" height="14" rx="7" fill="#ec4899" />
      <path d="M188 112l16-16 10 10-16 16z" fill="#fbcfe8" stroke="#111827" strokeWidth="2" />
    </>
  ),
  hackathon: (
    <>
      <rect width="240" height="165" fill="#111827" />
      <rect x="22" y="22" width="196" height="118" rx="10" fill="#1f2937" stroke="#ec4899" strokeWidth="2.5" />
      <circle cx="40" cy="38" r="4" fill="#ec4899" />
      <circle cx="54" cy="38" r="4" fill="#fbcfe8" />
      <circle cx="68" cy="38" r="4" fill="#ffffff" />
      <path d="M40 64l18 14-18 14M70 92h28" stroke="#ec4899" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M40 112h82M136 64h62M136 82h46M136 100h54" stroke="#f9a8d4" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="156" y="114" width="44" height="12" rx="6" fill="#ec4899" />
    </>
  ),
  community: (
    <>
      <rect width="240" height="165" fill="#fff5f9" />
      <path d="M22 36l28-14 28 14v30c0 22-28 36-28 36S22 88 22 66z" fill="#ec4899" stroke="#111827" strokeWidth="2.5" />
      <circle cx="50" cy="54" r="9" fill="#ffffff" />
      <rect x="96" y="28" width="122" height="106" rx="12" fill="#ffffff" stroke="#111827" strokeWidth="2.5" />
      <circle cx="132" cy="68" r="14" fill="#fbcfe8" stroke="#111827" strokeWidth="2" />
      <circle cx="178" cy="68" r="14" fill="#ec4899" stroke="#111827" strokeWidth="2" />
      <path d="M114 114c4-14 32-14 36 0M160 114c4-14 32-14 36 0" fill="#111827" />
      <path d="M36 130h44" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
};

function SampleArtwork({ scene }: { scene: SampleSceneId }) {
  return (
    <svg viewBox="0 0 240 165" className="login-polaroid-svg" aria-hidden="true">
      {SAMPLE_ARTWORK_ELEMENTS[scene]}
    </svg>
  );
}

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
}

function usePhotoWallAutoDrift(
  trackRef: RefObject<HTMLDivElement | null>,
  paused: boolean,
  itemCount: number,
) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (paused || reducedMotion || itemCount <= 1) return;
    const track = trackRef.current;
    if (!track || typeof window === 'undefined') return;

    let rafId = 0;
    let lastTimestamp = 0;
    let carry = 0;

    const step = (timestamp: number) => {
      if (lastTimestamp === 0) lastTimestamp = timestamp;
      const deltaSeconds = Math.min(0.1, (timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;
      const maxScrollLeft = track.scrollWidth - track.clientWidth;
      if (maxScrollLeft > 4) {
        carry += deltaSeconds * AUTO_DRIFT_PX_PER_SEC;
        const wholePx = Math.floor(carry);
        if (wholePx >= 1) {
          carry -= wholePx;
          track.scrollLeft = track.scrollLeft + wholePx >= maxScrollLeft - 1 ? 0 : track.scrollLeft + wholePx;
        }
      }
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [trackRef, paused, reducedMotion, itemCount]);
}

function usePhotoWallDrag(trackRef: RefObject<HTMLDivElement | null>) {
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !trackRef.current) return;
    dragOriginRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: trackRef.current.scrollLeft,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    const track = trackRef.current;
    if (!origin || !track || origin.pointerId !== event.pointerId) return;
    track.scrollLeft = origin.startScrollLeft - (event.clientX - origin.startX);
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current) return;
    if (event.currentTarget.hasPointerCapture?.(dragOriginRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragOriginRef.current.pointerId);
    }
    dragOriginRef.current = null;
    setIsDragging(false);
  };

  return { isDragging, onPointerDown, onPointerMove, stopDragging };
}

function PolaroidCard({ frame, index }: { frame: PolaroidFrameData; index: number }) {
  const tiltIndex = index % 4;

  return (
    <figure className={`login-polaroid-card login-polaroid-tilt-${tiltIndex}`}>
      <span className="login-polaroid-pin" aria-hidden="true" />
      <div className="login-polaroid-media">
        {frame.imageUrl ? (
          createElement('img', {
            src: frame.imageUrl,
            alt: frame.title,
            className: 'login-polaroid-img',
            draggable: false,
          })
        ) : (
          <SampleArtwork scene={frame.sampleScene ?? 'kickoff'} />
        )}
      </div>
      <figcaption className="login-polaroid-caption">
        <span className="login-polaroid-title">{frame.title}</span>
        {frame.caption ? <span className="login-polaroid-sub">{frame.caption}</span> : null}
      </figcaption>
    </figure>
  );
}

function PhotoWallControlsBar({
  frameCount,
  onPrev,
  onNext,
}: {
  frameCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const tAuth = useTranslations('auth.showcase');

  return (
    <div className="login-photo-wall-bar">
      <span className="login-photo-wall-count">{tAuth('frameCount', { count: frameCount })}</span>
      <div className="login-photo-wall-controls">
        <button type="button" className="login-photo-wall-arrow" aria-label={tAuth('prevPhoto')} onClick={onPrev}>
          ‹
        </button>
        <button type="button" className="login-photo-wall-arrow" aria-label={tAuth('nextPhoto')} onClick={onNext}>
          ›
        </button>
      </div>
    </div>
  );
}

export function LoginPhotoWall({ items }: { items: readonly LoginGalleryItemDto[] }) {
  const tAuth = useTranslations('auth.showcase');
  const trackRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const drag = usePhotoWallDrag(trackRef);

  const sortedRealItems = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
  const frames: PolaroidFrameData[] =
    sortedRealItems.length === 0
      ? SAMPLE_SCENES.map((scene) => ({
          id: `sample-${scene}`,
          title: tAuth(`samples.${scene}.title`),
          caption: tAuth(`samples.${scene}.caption`),
          sampleScene: scene,
        }))
      : sortedRealItems.map((item) => ({
          id: item.id,
          title: item.title,
          caption: item.caption,
          imageUrl: item.imageUrl,
        }));

  usePhotoWallAutoDrift(trackRef, isHovered || isFocused || drag.isDragging, frames.length);
  const scrollByStep = (direction: -1 | 1) => {
    trackRef.current?.scrollBy({ left: direction * ARROW_SCROLL_STEP, behavior: 'smooth' });
  };

  return (
    <div
      className="login-photo-wall"
      role="region"
      aria-label={tAuth('galleryLabel')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={() => setIsFocused(false)}
    >
      <PhotoWallControlsBar frameCount={frames.length} onPrev={() => scrollByStep(-1)} onNext={() => scrollByStep(1)} />
      <div className="login-photo-wall-rail" aria-hidden="true" />
      <div
        ref={trackRef}
        className={`login-photo-wall-track${drag.isDragging ? ' is-dragging' : ''}`}
        tabIndex={0}
        aria-label={tAuth('galleryTrackLabel')}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.stopDragging}
        onPointerCancel={drag.stopDragging}
      >
        {frames.map((frame, index) => (
          <PolaroidCard key={frame.id} frame={frame} index={index} />
        ))}
      </div>
    </div>
  );
}
