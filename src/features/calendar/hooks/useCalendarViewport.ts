'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeDayWidth,
  zoomTierOf,
  type YearCalendarModel,
} from '../calendar-math';

const INITIAL_ZOOM = 50;
const ZOOM_ANIMATION_MS = 300;
const PAN_DRAG_THRESHOLD = 5;

function applyCanvasMetrics(params: {
  readonly canvas: HTMLDivElement | null;
  readonly scroller: HTMLDivElement | null;
  readonly zoomVal: number;
  readonly dayWidth: number;
  readonly focalDay: number | null;
}): void {
  const { canvas, scroller, zoomVal, dayWidth, focalDay } = params;
  if (!canvas || !scroller) return;
  canvas.style.setProperty('--day-w', `${dayWidth.toFixed(3)}px`);
  canvas.setAttribute('data-zoom-tier', zoomTierOf(zoomVal));
  if (focalDay !== null) {
    scroller.scrollLeft = Math.max(0, focalDay * dayWidth - scroller.clientWidth / 2);
  }
}

function resolveMonthIndex(
  scroller: HTMLDivElement,
  dayWidth: number,
  calendar: YearCalendarModel
): number {
  const centerDay = Math.max(
    0,
    Math.min(
      calendar.totalDays - 1,
      Math.floor((scroller.scrollLeft + scroller.clientWidth / 2) / dayWidth)
    )
  );
  return calendar.days[centerDay]?.monthIndex ?? 0;
}

function useHorizontalPan(scrollerRef: React.RefObject<HTMLDivElement | null>) {
  const panRef = useRef({ active: false, startX: 0, startScrollLeft: 0, justPanned: false });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button, a, input, select, label')) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    panRef.current = { active: true, startX: e.clientX, startScrollLeft: scroller.scrollLeft, justPanned: false };
    scroller.classList.add('is-panning');
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const scroller = scrollerRef.current;
    if (!pan.active || !scroller) return;
    const dx = e.clientX - pan.startX;
    if (Math.abs(dx) > PAN_DRAG_THRESHOLD) pan.justPanned = true;
    scroller.scrollLeft = pan.startScrollLeft - dx;
  };

  const onPointerUp = () => {
    if (!panRef.current.active) return;
    panRef.current.active = false;
    scrollerRef.current?.classList.remove('is-panning');
    if (panRef.current.justPanned) {
      setTimeout(() => { panRef.current.justPanned = false; }, 60);
    }
  };

  return {
    canSkipClick: () => panRef.current.justPanned,
    panHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

function scrollScrollerToDay(
  scroller: HTMLDivElement | null,
  dayWidth: number,
  dayCenter: number,
  smooth: boolean
): void {
  if (!scroller) return;
  const vw = scroller.clientWidth || 1200;
  const left = Math.max(0, dayCenter * dayWidth - vw / 2);
  if (typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    scroller.scrollLeft = left;
  }
}

function computeCenterDayAnchor(
  scroller: HTMLDivElement | null,
  dayWidth: number,
  calendar: YearCalendarModel,
  anchorDay?: number
): number {
  if (typeof anchorDay === 'number') return anchorDay;
  if (scroller) return (scroller.scrollLeft + scroller.clientWidth / 2) / dayWidth;
  return calendar.todayIndex >= 0 ? calendar.todayIndex + 0.5 : calendar.totalDays / 2;
}

function startEaseOutZoomAnimation(params: {
  readonly zoomRafRef: React.RefObject<number | null>;
  readonly from: number;
  readonly to: number;
  readonly anchor: number;
  readonly applyRangeZoom: (nextZoom: number, opts?: { preserveFocal?: boolean; anchorDay?: number }) => void;
}) {
  const { zoomRafRef, from, to, anchor, applyRangeZoom } = params;
  const startTs = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - startTs) / ZOOM_ANIMATION_MS);
    applyRangeZoom(from + (to - from) * (1 - Math.pow(1 - t, 3)), { preserveFocal: true, anchorDay: anchor });
    zoomRafRef.current = t < 1 ? requestAnimationFrame(step) : null;
  };
  zoomRafRef.current = requestAnimationFrame(step);
}

function useViewportZoom(
  calendar: YearCalendarModel,
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLDivElement | null>
) {
  const zoomRafRef = useRef<number | null>(null);
  const zoomRef = useRef<number>(INITIAL_ZOOM);
  const dayWidthRef = useRef<number>(computeDayWidth(INITIAL_ZOOM, 1200));
  const [zoomValue, setZoomValue] = useState(INITIAL_ZOOM);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(() =>
    calendar.todayIndex >= 0 ? (calendar.days[calendar.todayIndex]?.monthIndex ?? 0) : 0
  );

  const stopZoomAnim = useCallback(() => {
    if (zoomRafRef.current !== null) {
      cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = null;
    }
  }, []);

  const syncMonthFromScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !dayWidthRef.current) return;
    const mIdx = resolveMonthIndex(scroller, dayWidthRef.current, calendar);
    setSelectedMonthIndex((prev) => (prev === mIdx ? prev : mIdx));
  }, [calendar, scrollerRef]);

  const applyRangeZoom = useCallback(
    (nextZoom: number, options?: { preserveFocal?: boolean; anchorDay?: number }) => {
      const clamped = Math.max(0, Math.min(100, Math.round(nextZoom)));
      const scroller = scrollerRef.current;
      const vw = scroller?.clientWidth || 1200;
      const prevW = dayWidthRef.current || computeDayWidth(zoomRef.current, vw);
      const nextW = computeDayWidth(clamped, vw);
      const focalDay = options?.preserveFocal === false ? null : computeCenterDayAnchor(scroller, prevW, calendar, options?.anchorDay);
      zoomRef.current = clamped;
      dayWidthRef.current = nextW;
      setZoomValue(clamped);
      applyCanvasMetrics({ canvas: canvasRef.current, scroller, zoomVal: clamped, dayWidth: nextW, focalDay });
      syncMonthFromScroll();
    },
    [calendar, canvasRef, scrollerRef, syncMonthFromScroll]
  );

  const animateZoomTo = useCallback(
    (targetZoom: number, anchorDay?: number) => {
      stopZoomAnim();
      const from = zoomRef.current;
      const to = Math.max(0, Math.min(100, targetZoom));
      const anchor = computeCenterDayAnchor(scrollerRef.current, dayWidthRef.current, calendar, anchorDay);
      startEaseOutZoomAnimation({ zoomRafRef, from, to, anchor, applyRangeZoom });
    },
    [applyRangeZoom, calendar, scrollerRef, stopZoomAnim]
  );

  return {
    zoomRef, dayWidthRef, zoomValue, selectedMonthIndex, setSelectedMonthIndex,
    stopZoomAnim, syncMonthFromScroll, applyRangeZoom, animateZoomTo,
  };
}

function useViewportWheelAndResize(params: {
  readonly scrollerRef: React.RefObject<HTMLDivElement | null>;
  readonly zoomRef: React.RefObject<number>;
  readonly isReady: boolean;
  readonly applyRangeZoom: (nextZoom: number, opts?: { preserveFocal?: boolean; anchorDay?: number }) => void;
  readonly stopZoomAnim: () => void;
}) {
  const { scrollerRef, zoomRef, isReady, applyRangeZoom, stopZoomAnim } = params;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!isReady || !scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      stopZoomAnim();
      applyRangeZoom(zoomRef.current - e.deltaY * 0.25, { preserveFocal: true });
    };
    const onResize = () => applyRangeZoom(zoomRef.current, { preserveFocal: true });
    scroller.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      stopZoomAnim();
    };
  }, [applyRangeZoom, isReady, scrollerRef, stopZoomAnim, zoomRef]);
}

export function useCalendarViewport(calendar: YearCalendarModel, isReady = true) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const centeredYearRef = useRef<number | null>(null);
  const zoom = useViewportZoom(calendar, scrollerRef, canvasRef);
  const { zoomRef, dayWidthRef, setSelectedMonthIndex, applyRangeZoom, animateZoomTo, stopZoomAnim } = zoom;

  const scrollToCenterDay = useCallback(
    (centerDay: number, smooth: boolean) => {
      if (zoomRef.current < 32) { animateZoomTo(INITIAL_ZOOM, centerDay); return; }
      const w = computeDayWidth(zoomRef.current, scrollerRef.current?.clientWidth || 1200);
      dayWidthRef.current = w;
      scrollScrollerToDay(scrollerRef.current, w, centerDay, smooth);
    },
    [animateZoomTo, dayWidthRef, zoomRef]
  );

  const jumpToMonth = useCallback((monthIdx: number, smooth = true) => {
    const clamped = Math.max(0, Math.min(11, monthIdx));
    const mInfo = calendar.months[clamped];
    if (!mInfo) return;
    setSelectedMonthIndex(clamped);
    scrollToCenterDay(mInfo.startIndex + mInfo.dayCount / 2, smooth);
  }, [calendar.months, scrollToCenterDay, setSelectedMonthIndex]);

  const centerOnToday = useCallback((smooth = true) => {
    if (calendar.todayIndex < 0) return;
    setSelectedMonthIndex(calendar.days[calendar.todayIndex]?.monthIndex ?? 0);
    scrollToCenterDay(calendar.todayIndex + 0.5, smooth);
  }, [calendar.days, calendar.todayIndex, scrollToCenterDay, setSelectedMonthIndex]);

  useEffect(() => {
    if (!isReady || !scrollerRef.current) return;
    applyRangeZoom(zoomRef.current, { preserveFocal: false });
    if (centeredYearRef.current !== calendar.year) {
      centeredYearRef.current = calendar.year;
      if (calendar.todayIndex >= 0) centerOnToday(false);
      else jumpToMonth(0, false);
    }
  }, [applyRangeZoom, calendar.todayIndex, calendar.year, centerOnToday, isReady, jumpToMonth, zoomRef]);

  useViewportWheelAndResize({ scrollerRef, zoomRef, isReady, applyRangeZoom, stopZoomAnim });
  const pan = useHorizontalPan(scrollerRef);

  return {
    scrollerRef, canvasRef, zoomValue: zoom.zoomValue, zoomTier: zoomTierOf(zoom.zoomValue),
    selectedMonthIndex: zoom.selectedMonthIndex, canSkipClick: pan.canSkipClick,
    onSliderChange: (nextVal: number) => { stopZoomAnim(); applyRangeZoom(nextVal, { preserveFocal: true }); },
    animateZoomTo, jumpToMonth, centerOnToday, syncMonthFromScroll: zoom.syncMonthFromScroll, panHandlers: pan.panHandlers,
  };
}
