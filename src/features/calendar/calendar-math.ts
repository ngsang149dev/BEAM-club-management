import {
  diffIsoDays,
  getCalendarDeadlineInfo,
  getCalendarDeadlineTier,
  getTodayVnIso,
  utcIsoToHoChiMinhInput,
  type CalendarDeadlineInfo,
  type CalendarDeadlineTier,
} from '@/features/tasks/formatters';

export {
  diffIsoDays,
  getCalendarDeadlineInfo,
  getCalendarDeadlineTier,
  getTodayVnIso,
  type CalendarDeadlineInfo,
  type CalendarDeadlineTier,
};

export type ZoomTier = 'year' | 'month' | 'week';
export type CalendarDeadlineFilter = 'all' | 'overdue' | 'urgent' | 'soon' | 'safe' | 'done';

export interface CalendarMonthMeta {
  readonly monthIndex: number;
  readonly monthNumber: number;
  readonly label: string;
  readonly shortLabel: string;
  readonly startIndex: number;
  readonly dayCount: number;
}

export interface CalendarDayMeta {
  readonly index: number;
  readonly iso: string;
  readonly dayNum: string;
  readonly monthIndex: number;
  readonly monthNum: string;
  readonly shortDate: string;
  readonly dow: number;
  readonly wdShort: string;
  readonly wdFull: string;
  readonly isWeekend: boolean;
  readonly isToday: boolean;
}

export interface YearCalendarModel {
  readonly year: number;
  readonly yearStartIso: string;
  readonly totalDays: number;
  readonly todayIndex: number;
  readonly months: readonly CalendarMonthMeta[];
  readonly days: readonly CalendarDayMeta[];
}

export interface CalendarDateTaskLike {
  readonly startAt: string | null;
  readonly dueAt: string | null;
}

export interface CalendarPackedTask<T extends CalendarDateTaskLike> {
  readonly task: T;
  readonly startIdx: number;
  readonly endIdx: number;
  readonly span: number;
}

export type CalendarTierCounts = Record<CalendarDeadlineFilter, number> & {
  readonly unscheduled: number;
};

const DAY_MS = 86_400_000;
const WD_SHORT_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;
const WD_FULL_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'] as const;
const WD_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WD_FULL_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function getYearIsoBounds(year: number): { readonly fromIso: string; readonly toIso: string } {
  return {
    fromIso: new Date(`${year}-01-01T00:00:00.000+07:00`).toISOString(),
    toIso: new Date(`${year}-12-31T23:59:59.999+07:00`).toISOString(),
  };
}

function formatMonthLabels(monthIndex: number, locale: 'vi' | 'en'): { label: string; shortLabel: string } {
  const num = monthIndex + 1;
  if (locale === 'en') {
    const shortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { label: shortNames[monthIndex] ?? `M${num}`, shortLabel: `M${num}` };
  }
  return { label: `Tháng ${num}`, shortLabel: `T${num}` };
}

export function buildYearCalendar(
  year: number,
  todayIso = getTodayVnIso(),
  locale: 'vi' | 'en' = 'vi'
): YearCalendarModel {
  const startMs = Date.UTC(year, 0, 1);
  const totalDays = Math.round((Date.UTC(year + 1, 0, 1) - startMs) / DAY_MS);
  const wdShortList = locale === 'en' ? WD_SHORT_EN : WD_SHORT_VI;
  const wdFullList = locale === 'en' ? WD_FULL_EN : WD_FULL_VI;
  const monthBuckets = Array.from({ length: 12 }, (_, m) => ({
    monthIndex: m,
    monthNumber: m + 1,
    ...formatMonthLabels(m, locale),
    startIndex: -1,
    dayCount: 0,
  }));

  const days: CalendarDayMeta[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(startMs + i * DAY_MS);
    const iso = d.toISOString().slice(0, 10);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mIdx = d.getUTCMonth();
    const mm = String(mIdx + 1).padStart(2, '0');
    const dow = d.getUTCDay();
    const bucket = monthBuckets[mIdx]!;
    if (bucket.startIndex === -1) bucket.startIndex = i;
    bucket.dayCount += 1;
    days.push({
      index: i,
      iso,
      dayNum: dd,
      monthIndex: mIdx,
      monthNum: mm,
      shortDate: `${dd}/${mm}`,
      dow,
      wdShort: wdShortList[dow] ?? '',
      wdFull: wdFullList[dow] ?? '',
      isWeekend: dow === 0 || dow === 6,
      isToday: iso === todayIso,
    });
  }

  return {
    year,
    yearStartIso: `${year}-01-01`,
    totalDays,
    todayIndex: days.findIndex((d) => d.isToday),
    months: monthBuckets,
    days,
  };
}

export function computeDayWidth(zoomVal: number, viewportWidth = 1200): number {
  const clamped = Math.max(0, Math.min(100, zoomVal));
  const vw = Math.max(viewportWidth || 1200, 320);
  const wYear = Math.max(5.5, vw / 220);
  const wMonth = Math.max(72, vw / 16);
  const wWeek = Math.max(195, vw / 5.5);
  if (clamped <= 50) {
    return wYear * Math.pow(wMonth / wYear, clamped / 50);
  }
  return wMonth * Math.pow(wWeek / wMonth, (clamped - 50) / 50);
}

export function zoomTierOf(zoomVal: number): ZoomTier {
  if (zoomVal < 22) return 'year';
  if (zoomVal < 72) return 'month';
  return 'week';
}

export function computeCalendarTierCounts<T extends { readonly isCompleted: boolean; readonly dueAt: string | null }>(
  tasks: readonly T[],
  todayIso = getTodayVnIso()
): CalendarTierCounts {
  const counts = { all: 0, overdue: 0, urgent: 0, soon: 0, safe: 0, done: 0, unscheduled: 0 };
  for (const task of tasks) {
    counts.all += 1;
    const tier = getCalendarDeadlineTier(task, todayIso);
    counts[tier] += 1;
  }
  return counts;
}

export function filterCalendarTasks<T extends { readonly isCompleted: boolean; readonly dueAt: string | null }>(
  tasks: readonly T[],
  filter: CalendarDeadlineFilter,
  todayIso = getTodayVnIso()
): T[] {
  if (filter === 'all') return [...tasks];
  return tasks.filter((task) => getCalendarDeadlineTier(task, todayIso) === filter);
}

function resolveTaskDaySpan<T extends CalendarDateTaskLike>(
  task: T,
  yearStartIso: string,
  totalDays: number
): CalendarPackedTask<T> | 'unscheduled' | null {
  const startIso = utcIsoToHoChiMinhInput(task.startAt);
  const dueIso = utcIsoToHoChiMinhInput(task.dueAt);
  if (!startIso && !dueIso) return 'unscheduled';
  const rawStart = diffIsoDays(yearStartIso, startIso || dueIso);
  const rawEnd = startIso && dueIso ? Math.max(rawStart, diffIsoDays(yearStartIso, dueIso)) : rawStart;
  if (rawEnd < 0 || rawStart >= totalDays) return null;
  const startIdx = Math.max(0, rawStart);
  const endIdx = Math.min(totalDays - 1, Math.max(startIdx, rawEnd));
  return { task, startIdx, endIdx, span: endIdx - startIdx + 1 };
}

export function packCalendarLanes<T extends CalendarDateTaskLike>(
  tasks: readonly T[],
  yearStartIso: string,
  totalDays: number
): { readonly lanes: CalendarPackedTask<T>[][]; readonly unscheduled: T[] } {
  const scheduled: CalendarPackedTask<T>[] = [];
  const unscheduled: T[] = [];

  for (const task of tasks) {
    const resolved = resolveTaskDaySpan(task, yearStartIso, totalDays);
    if (resolved === 'unscheduled') {
      unscheduled.push(task);
    } else if (resolved !== null) {
      scheduled.push(resolved);
    }
  }

  scheduled.sort((a, b) => a.startIdx - b.startIdx || b.span - a.span);
  const lanes: CalendarPackedTask<T>[][] = [];
  const laneEnds: number[] = [];

  for (const item of scheduled) {
    const laneIdx = laneEnds.findIndex((end) => end < item.startIdx);
    if (laneIdx === -1) {
      lanes.push([item]);
      laneEnds.push(item.endIdx);
    } else {
      lanes[laneIdx]!.push(item);
      laneEnds[laneIdx] = item.endIdx;
    }
  }

  return { lanes, unscheduled };
}
