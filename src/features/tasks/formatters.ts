import type { TaskPriority } from '@/lib/tasks';

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export type TaskDueUrgency = 'none' | 'overdue' | 'today' | 'soon' | 'upcoming';

export type CalendarDeadlineTier =
  | 'overdue'
  | 'urgent'
  | 'soon'
  | 'safe'
  | 'done'
  | 'unscheduled';

export interface CalendarDeadlineInfo {
  readonly tier: CalendarDeadlineTier;
  readonly daysDiff: number | null;
}

export const PRIORITY_MESSAGE_KEY: Record<TaskPriority, 'low' | 'medium' | 'high' | 'urgent'> = {
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'urgent',
};

export function normalizeTaskPriority(value: number): TaskPriority {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  return 2;
}

export function getTodayVnIso(nowMs = Date.now()): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function diffIsoDays(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(`${fromIso}T00:00:00Z`);
  const toMs = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((toMs - fromMs) / DAY_MS);
}

export function formatTaskDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatVnMonthDayTime(iso: string | null, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatTaskDueDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatShortVnDate(isoOrDate: string | null): string {
  if (!isoOrDate) return '';
  const dateStr = isoOrDate.length === 10 ? isoOrDate : utcIsoToHoChiMinhInput(isoOrDate);
  if (!dateStr || dateStr.length < 10) return '';
  return `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

export function isTaskOverdue(dueAt: string | null, nowMs = Date.now()): boolean {
  if (!dueAt) return false;
  const dueMs = Date.parse(dueAt);
  return Number.isFinite(dueMs) && dueMs < nowMs;
}

export function getTaskDueUrgency(dueAt: string | null, nowMs = Date.now()): TaskDueUrgency {
  if (!dueAt) return 'none';
  const dueMs = Date.parse(dueAt);
  if (!Number.isFinite(dueMs)) return 'none';
  if (dueMs < nowMs) return 'overdue';
  const dueVnDay = Math.floor((dueMs + VN_OFFSET_MS) / DAY_MS);
  const nowVnDay = Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS);
  if (dueVnDay === nowVnDay || dueMs - nowMs <= DAY_MS) return 'today';
  if (dueMs - nowMs <= 2 * DAY_MS) return 'soon';
  return 'upcoming';
}

export function getCalendarDeadlineInfo(
  task: { readonly isCompleted: boolean; readonly dueAt: string | null },
  todayIso = getTodayVnIso()
): CalendarDeadlineInfo {
  if (task.isCompleted) return { tier: 'done', daysDiff: null };
  const dueVnIso = utcIsoToHoChiMinhInput(task.dueAt);
  if (!dueVnIso) return { tier: 'unscheduled', daysDiff: null };
  const diff = diffIsoDays(todayIso, dueVnIso);
  if (diff < 0) return { tier: 'overdue', daysDiff: diff };
  if (diff <= 1) return { tier: 'urgent', daysDiff: diff };
  if (diff <= 3) return { tier: 'soon', daysDiff: diff };
  return { tier: 'safe', daysDiff: diff };
}

export function getCalendarDeadlineTier(
  task: { readonly isCompleted: boolean; readonly dueAt: string | null },
  todayIso = getTodayVnIso()
): CalendarDeadlineTier {
  return getCalendarDeadlineInfo(task, todayIso).tier;
}

export function utcIsoToHoChiMinhInput(iso: string | null): string {
  if (!iso) return '';
  const utcMs = Date.parse(iso);
  if (!Number.isFinite(utcMs)) return '';
  const vnDate = new Date(utcMs + VN_OFFSET_MS);
  return vnDate.toISOString().slice(0, 10);
}

export function hoChiMinhInputToUtcIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let normalized = `${trimmed}+07:00`;
  if (trimmed.length === 10) {
    normalized = `${trimmed}T00:00:00+07:00`;
  } else if (trimmed.length === 16) {
    normalized = `${trimmed}:00+07:00`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
