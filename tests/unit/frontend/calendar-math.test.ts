import { describe, expect, it } from 'vitest';
import {
  buildYearCalendar,
  computeCalendarTierCounts,
  computeDayWidth,
  filterCalendarTasks,
  getCalendarDeadlineInfo,
  getCalendarDeadlineTier,
  getTodayVnIso,
  getYearIsoBounds,
  packCalendarLanes,
  zoomTierOf,
} from '@/features/calendar/calendar-math';

describe('calendar-math pure helpers', () => {
  it('computes VN today ISO across UTC+7 midnight boundaries and year ISO bounds', () => {
    expect(getTodayVnIso(Date.parse('2026-03-01T16:59:59.000Z'))).toBe('2026-03-01');
    expect(getTodayVnIso(Date.parse('2026-03-01T17:00:00.000Z'))).toBe('2026-03-02');
    expect(getYearIsoBounds(2026)).toEqual({
      fromIso: '2025-12-31T17:00:00.000Z',
      toIso: '2026-12-31T16:59:59.999Z',
    });
  });

  it('builds 365-day normal years and 366-day leap years with month bounds and todayIndex', () => {
    const leap = buildYearCalendar(2024, '2024-02-29', 'vi');
    expect(leap.totalDays).toBe(366);
    expect(leap.months).toHaveLength(12);
    expect(leap.months[1]).toMatchObject({ monthIndex: 1, label: 'Tháng 2', shortLabel: 'T2', startIndex: 31, dayCount: 29 });
    expect(leap.todayIndex).toBe(59);
    expect(leap.days[59]).toMatchObject({ iso: '2024-02-29', shortDate: '29/02', isToday: true });

    const normal = buildYearCalendar(2026, '2025-12-31', 'en');
    expect(normal.totalDays).toBe(365);
    expect(normal.todayIndex).toBe(-1);
    expect(normal.months[1]).toMatchObject({ monthIndex: 1, label: 'Feb', shortLabel: 'M2', startIndex: 31, dayCount: 28 });
    expect(normal.days[0]?.wdShort).toBe('Thu');
  });

  it('evaluates the 2-segment exponential zoom curve and zoom tiers accurately', () => {
    expect(computeDayWidth(-10, 1200)).toBeCloseTo(computeDayWidth(0, 1200), 5);
    expect(computeDayWidth(0, 1320)).toBeCloseTo(6, 5);
    expect(computeDayWidth(50, 1280)).toBeCloseTo(80, 5);
    expect(computeDayWidth(100, 1200)).toBeCloseTo(1200 / 5.5, 5);
    expect(computeDayWidth(0, 320)).toBeCloseTo(5.5, 5);
    expect(computeDayWidth(50, 320)).toBeCloseTo(72, 5);
    expect(computeDayWidth(100, 320)).toBeCloseTo(195, 5);

    expect(zoomTierOf(0)).toBe('year');
    expect(zoomTierOf(21)).toBe('year');
    expect(zoomTierOf(22)).toBe('month');
    expect(zoomTierOf(50)).toBe('month');
    expect(zoomTierOf(71)).toBe('month');
    expect(zoomTierOf(72)).toBe('week');
    expect(zoomTierOf(100)).toBe('week');
  });

  it('classifies deadline tiers, counts, and filters deterministically in Asia/Ho_Chi_Minh', () => {
    const todayIso = '2026-11-20';
    const tasks = [
      { id: 'done', isCompleted: true, dueAt: '2026-11-10T10:00:00Z' },
      { id: 'none', isCompleted: false, dueAt: null },
      { id: 'over', isCompleted: false, dueAt: '2026-11-18T10:00:00Z' },
      { id: 'd0', isCompleted: false, dueAt: '2026-11-20T12:00:00Z' },
      { id: 'd1', isCompleted: false, dueAt: '2026-11-21T10:00:00Z' },
      { id: 'd2', isCompleted: false, dueAt: '2026-11-22T10:00:00Z' },
      { id: 'd5', isCompleted: false, dueAt: '2026-11-25T10:00:00Z' },
    ];

    expect(tasks.map((t) => getCalendarDeadlineTier(t, todayIso))).toEqual([
      'done',
      'unscheduled',
      'overdue',
      'urgent',
      'urgent',
      'soon',
      'safe',
    ]);
    expect(getCalendarDeadlineInfo(tasks[2]!, todayIso)).toEqual({ tier: 'overdue', daysDiff: -2 });
    expect(getCalendarDeadlineInfo(tasks[3]!, todayIso)).toEqual({ tier: 'urgent', daysDiff: 0 });
    expect(getCalendarDeadlineInfo(tasks[0]!, todayIso)).toEqual({ tier: 'done', daysDiff: null });

    expect(computeCalendarTierCounts(tasks, todayIso)).toEqual({
      all: 7,
      overdue: 1,
      urgent: 2,
      soon: 1,
      safe: 1,
      done: 1,
      unscheduled: 1,
    });
    expect(filterCalendarTasks(tasks, 'all', todayIso)).toHaveLength(7);
    expect(filterCalendarTasks(tasks, 'urgent', todayIso).map((t) => t.id)).toEqual(['d0', 'd1']);
    expect(filterCalendarTasks(tasks, 'done', todayIso).map((t) => t.id)).toEqual(['done']);
  });

  it('packs spanning, single-date, cross-year clamped, out-of-year, and unscheduled tasks into greedy swimlanes', () => {
    const tasks = [
      { id: 'unsched', startAt: null, dueAt: null },
      { id: 'past-year', startAt: '2025-01-01T10:00:00Z', dueAt: '2025-12-30T10:00:00Z' },
      { id: 'cross-start', startAt: '2025-12-28T10:00:00Z', dueAt: '2026-01-03T10:00:00Z' },
      { id: 'overlap', startAt: '2026-01-02T10:00:00Z', dueAt: '2026-01-05T10:00:00Z' },
      { id: 'after', startAt: '2026-01-04T10:00:00Z', dueAt: '2026-01-06T10:00:00Z' },
      { id: 'due-only', startAt: null, dueAt: '2026-01-10T10:00:00Z' },
      { id: 'start-only', startAt: '2026-01-12T10:00:00Z', dueAt: null },
    ];

    const packed = packCalendarLanes(tasks, '2026-01-01', 365);
    expect(packed.unscheduled.map((t) => t.id)).toEqual(['unsched']);
    expect(packed.lanes).toHaveLength(2);
    expect(packed.lanes[0]!.map((item) => [item.task.id, item.startIdx, item.endIdx, item.span])).toEqual([
      ['cross-start', 0, 2, 3],
      ['after', 3, 5, 3],
      ['due-only', 9, 9, 1],
      ['start-only', 11, 11, 1],
    ]);
    expect(packed.lanes[1]!.map((item) => [item.task.id, item.startIdx, item.endIdx, item.span])).toEqual([
      ['overlap', 1, 4, 4],
    ]);
  });
});
