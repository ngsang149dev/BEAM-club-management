import type { components } from '@/features/shared/api/client';
import {
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_REMIND_OVERDUE,
  DEFAULT_SEND_HOUR_VN,
  MAX_MILESTONE_COUNT,
  MAX_MILESTONE_DAY,
  MIN_MILESTONE_DAY,
  milestoneDaySchema,
  normalizeDaysBefore,
  updateReminderSettingsSchema,
} from '@/lib/reminders';

export {
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_REMIND_OVERDUE,
  DEFAULT_SEND_HOUR_VN,
  MAX_MILESTONE_COUNT,
  MAX_MILESTONE_DAY,
  MIN_MILESTONE_DAY,
  milestoneDaySchema,
  normalizeDaysBefore,
  updateReminderSettingsSchema,
};

type TaskDto = components['schemas']['TaskDto'];
type UpdateReminderSettingsRequest = components['schemas']['UpdateReminderSettingsRequest'];

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export type ReminderPreviewGroupKey = 'overdue' | 'today' | 'upcoming';

export interface ReminderPreviewTaskItem {
  readonly id: string;
  readonly isHidden: boolean;
  /** Strictly null when `isHidden === true` to prevent WQ-27 title leakage. */
  readonly title: string | null;
  readonly dueAt: string;
  readonly dayDiff: number;
  /** Redacted to `[]` when `isHidden === true`. */
  readonly departmentNames: readonly string[];
}

export interface ReminderPreviewGroup {
  readonly key: ReminderPreviewGroupKey;
  readonly items: readonly ReminderPreviewTaskItem[];
}

export interface ReminderEmailPreviewResult {
  readonly groups: readonly ReminderPreviewGroup[];
  readonly totalCount: number;
}

export interface ReminderPreviewInput {
  readonly tasks: readonly TaskDto[];
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
  readonly nowMs?: number;
}

export function parseCustomMilestoneDay(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  const check = milestoneDaySchema.safeParse(parsed);
  return check.success ? check.data : null;
}

export function toggleMilestoneDay(daysBefore: readonly number[], day: number): number[] {
  const normalized = normalizeDaysBefore(daysBefore);
  if (normalized.includes(day)) {
    return normalizeDaysBefore(normalized.filter((item) => item !== day));
  }
  if (normalized.length >= MAX_MILESTONE_COUNT) return normalized;
  return normalizeDaysBefore([...normalized, day]);
}

export function addMilestoneDay(daysBefore: readonly number[], day: number): number[] {
  const normalized = normalizeDaysBefore(daysBefore);
  if (!milestoneDaySchema.safeParse(day).success) return normalized;
  if (!normalized.includes(day) && normalized.length >= MAX_MILESTONE_COUNT) return normalized;
  return normalizeDaysBefore([...normalized, day]);
}

export function removeMilestoneDay(daysBefore: readonly number[], day: number): number[] {
  return normalizeDaysBefore(daysBefore.filter((item) => item !== day));
}

export function isAllMilestonesOff(draft: {
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
}): boolean {
  return draft.daysBefore.length === 0 && !draft.remindOverdue;
}

export function restoreDefaultMilestones(): UpdateReminderSettingsRequest {
  return {
    daysBefore: [...DEFAULT_REMINDER_DAYS_BEFORE],
    remindOverdue: DEFAULT_REMIND_OVERDUE,
  };
}

export function areReminderDraftsEqual(
  a: UpdateReminderSettingsRequest,
  b: UpdateReminderSettingsRequest
): boolean {
  if (a.remindOverdue !== b.remindOverdue) return false;
  const normA = normalizeDaysBefore(a.daysBefore);
  const normB = normalizeDaysBefore(b.daysBefore);
  if (normA.length !== normB.length) return false;
  return normA.every((value, idx) => value === normB[idx]);
}

export function toVnDayNumber(timestampMs: number): number {
  return Math.floor((timestampMs + VN_OFFSET_MS) / DAY_MS);
}

export function formatVnSendHour(sendHourVn: number): string {
  const safeHour =
    Number.isInteger(sendHourVn) && sendHourVn >= 0 && sendHourVn <= 23 ? sendHourVn : 7;
  return `${String(safeHour).padStart(2, '0')}:00`;
}

export function formatPreviewDate(timestampMs: number, previewLocale: 'vi' | 'en'): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(previewLocale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatPreviewShortDate(iso: string, previewLocale: 'vi' | 'en'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(previewLocale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function resolveGroupForDayDiff(
  dayDiff: number,
  daysSet: ReadonlySet<number>,
  remindOverdue: boolean
): ReminderPreviewGroupKey | null {
  if (dayDiff < 0) return remindOverdue ? 'overdue' : null;
  if (dayDiff === 0) return daysSet.has(0) ? 'today' : null;
  return daysSet.has(dayDiff) ? 'upcoming' : null;
}

function toPreviewTaskItem(task: TaskDto, dayDiff: number): ReminderPreviewTaskItem {
  return {
    id: task.id,
    isHidden: task.isHidden,
    title: task.isHidden ? null : task.title,
    dueAt: task.dueAt ?? '',
    dayDiff,
    departmentNames: task.isHidden ? [] : task.assignedDepartments.map((dept) => dept.name),
  };
}

function comparePreviewItems(a: ReminderPreviewTaskItem, b: ReminderPreviewTaskItem): number {
  const dueDiff = Date.parse(a.dueAt) - Date.parse(b.dueAt);
  if (Number.isFinite(dueDiff) && dueDiff !== 0) return dueDiff;
  return (a.title ?? '').localeCompare(b.title ?? '');
}

const GROUP_ORDER: readonly ReminderPreviewGroupKey[] = ['overdue', 'today', 'upcoming'];

export const REMINDER_GROUP_MSG_KEYS: Record<
  ReminderPreviewGroupKey,
  'groupOverdue' | 'groupToday' | 'groupUpcoming'
> = {
  overdue: 'groupOverdue',
  today: 'groupToday',
  upcoming: 'groupUpcoming',
};

export interface SampleReminderLabels {
  readonly overdueTitle: string;
  readonly overdueDept: string;
  readonly todayTitle: string;
  readonly todayDept: string;
  readonly soonTitle: string;
  readonly soonDept: string;
  readonly laterTitle: string;
  readonly laterDept: string;
}

function buildSampleTaskDto(spec: {
  readonly id: string;
  readonly title: string;
  readonly deptName: string;
  readonly dueAt: string;
}): TaskDto {
  return {
    id: spec.id,
    boardId: 'sample-board',
    columnId: 'sample-col',
    title: spec.title,
    description: null,
    startAt: spec.dueAt,
    dueAt: spec.dueAt,
    isCompleted: false,
    completedAt: null,
    priority: 2,
    position: 1,
    isHidden: false,
    version: 1,
    deletedAt: null,
    assignees: [],
    assignedDepartments: [{ id: `dept-${spec.id}`, name: spec.deptName }],
    deliverables: [],
    deliverableCount: 0,
    creator: {
      id: 'sample-creator',
      fullName: 'BEAM',
      isActive: true,
      leftAt: null,
      departments: [],
    },
    commentCount: 0,
    createdAt: spec.dueAt,
    updatedAt: spec.dueAt,
  };
}

function buildVnDayNoonIso(nowMs: number, dayOffset: number): string {
  const vnNoonMs = (toVnDayNumber(nowMs) + dayOffset) * DAY_MS + 12 * 3_600_000 - VN_OFFSET_MS;
  return new Date(vnNoonMs).toISOString();
}

export function buildSampleReminderTasks(labels: SampleReminderLabels, daysBefore: readonly number[], nowMs: number): TaskDto[] {
  const tasks: TaskDto[] = [buildSampleTaskDto({ id: 'sample-overdue-1', title: labels.overdueTitle, deptName: labels.overdueDept, dueAt: buildVnDayNoonIso(nowMs, -1) })];
  for (const day of normalizeDaysBefore(daysBefore)) {
    const spec =
      day === 0
        ? { title: labels.todayTitle, deptName: labels.todayDept }
        : day === 1
          ? { title: labels.soonTitle, deptName: labels.soonDept }
          : { title: labels.laterTitle, deptName: labels.laterDept };
    tasks.push(
      buildSampleTaskDto({
        id: `sample-day-${day}`,
        title: spec.title,
        deptName: spec.deptName,
        dueAt: buildVnDayNoonIso(nowMs, day),
      })
    );
  }
  return tasks;
}

export function buildReminderEmailPreviewData(
  input: ReminderPreviewInput
): ReminderEmailPreviewResult {
  const daysSet = new Set(normalizeDaysBefore(input.daysBefore));
  const nowVnDay = toVnDayNumber(input.nowMs ?? Date.now());
  const buckets: Record<ReminderPreviewGroupKey, ReminderPreviewTaskItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
  };

  for (const task of input.tasks) {
    if (task.deletedAt !== null || !task.dueAt) continue;
    const dueMs = Date.parse(task.dueAt);
    if (!Number.isFinite(dueMs)) continue;
    const dayDiff = toVnDayNumber(dueMs) - nowVnDay;
    const groupKey = resolveGroupForDayDiff(dayDiff, daysSet, input.remindOverdue);
    if (!groupKey) continue;
    buckets[groupKey].push(toPreviewTaskItem(task, dayDiff));
  }

  const groups: ReminderPreviewGroup[] = [];
  let totalCount = 0;
  for (const key of GROUP_ORDER) {
    const items = buckets[key].sort(comparePreviewItems);
    if (items.length > 0) {
      groups.push({ key, items });
      totalCount += items.length;
    }
  }
  return { groups, totalCount };
}
