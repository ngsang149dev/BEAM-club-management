import {
  DEFAULT_REMIND_OVERDUE,
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_SEND_HOUR_VN,
  normalizeDaysBefore,
  updateReminderSettingsSchema,
} from '@/lib/reminders';
import type { TaskPriority } from '@/lib/tasks';
import { canViewTask, type TaskVisibilitySubject } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type {
  ReminderCandidateTaskRecord,
  ReminderLocale,
  ReminderRecipientRecord,
  ReminderSentKeyRecord,
  ReminderSettingsValue,
} from './types';

const MS_PER_DAY = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

export interface VnDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly utcMidnightMs: number;
}

export interface MatchedTaskMilestone {
  readonly kind: string;
  readonly diffDays: number;
}

export interface ReminderDigestItem {
  readonly taskId: string;
  readonly kind: string;
  readonly boardName: string;
  readonly columnName: string | null;
  readonly title: string | null;
  readonly dueAt: Date;
  readonly diffDays: number;
  readonly priority: TaskPriority;
  readonly isHidden: boolean;
}

export interface ReminderDigestBuckets {
  readonly overdue: readonly ReminderDigestItem[];
  readonly dueToday: readonly ReminderDigestItem[];
  readonly comingUp: readonly ReminderDigestItem[];
}

export interface RecipientReminderDigest {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: ReminderLocale;
  readonly buckets: ReminderDigestBuckets;
  readonly itemsToRecord: ReadonlyArray<{ readonly taskId: string; readonly kind: string }>;
}

export interface ReminderDispatchPlan {
  readonly processedTasks: number;
  readonly skippedAlreadySent: number;
  readonly digests: readonly RecipientReminderDigest[];
}

export function createDefaultReminderSettings(): ReminderSettingsValue {
  return {
    daysBefore: [...DEFAULT_REMINDER_DAYS_BEFORE],
    remindOverdue: DEFAULT_REMIND_OVERDUE,
    sendHourVn: DEFAULT_SEND_HOUR_VN,
  };
}

function parseSendHourVn(rawHour: unknown): number {
  const valid =
    typeof rawHour === 'number' && Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23;
  return valid ? rawHour : DEFAULT_SEND_HOUR_VN;
}

export function parseStoredReminderSettings(raw: unknown): ReminderSettingsValue {
  if (typeof raw !== 'object' || raw === null) return createDefaultReminderSettings();
  const obj = raw as { daysBefore?: unknown; remindOverdue?: unknown; sendHourVn?: unknown };
  const parsed = updateReminderSettingsSchema.safeParse({
    daysBefore: obj.daysBefore,
    remindOverdue: obj.remindOverdue,
  });
  if (!parsed.success) return createDefaultReminderSettings();
  return {
    daysBefore: normalizeDaysBefore(parsed.data.daysBefore),
    remindOverdue: parsed.data.remindOverdue,
    sendHourVn: parseSendHourVn(obj.sendHourVn),
  };
}

export function toVnDateParts(date: Date): VnDateParts {
  // Asia/Ho_Chi_Minh is fixed UTC+7 without DST; shifting avoids host TZ drift.
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  const year = vn.getUTCFullYear();
  const month = vn.getUTCMonth() + 1;
  const day = vn.getUTCDate();
  return {
    year,
    month,
    day,
    hour: vn.getUTCHours(),
    minute: vn.getUTCMinutes(),
    utcMidnightMs: Date.UTC(year, month - 1, day),
  };
}

export function computeVnDiffDays(today: Date, dueAt: Date): number {
  const todayMidnight = toVnDateParts(today).utcMidnightMs;
  const dueMidnight = toVnDateParts(dueAt).utcMidnightMs;
  return Math.round((dueMidnight - todayMidnight) / MS_PER_DAY);
}

export function matchTaskReminderMilestone(
  dueAt: Date,
  settings: Pick<ReminderSettingsValue, 'daysBefore' | 'remindOverdue'>,
  now: Date,
): MatchedTaskMilestone | null {
  const diffDays = computeVnDiffDays(now, dueAt);
  if (diffDays >= 0 && settings.daysBefore.includes(diffDays)) {
    return { kind: `d${diffDays}`, diffDays };
  }
  if (diffDays < 0 && settings.remindOverdue) {
    return { kind: 'overdue', diffDays };
  }
  return null;
}

export function buildSentReminderKey(taskId: string, userId: string, kind: string): string {
  return `${taskId}:${userId}:${kind}`;
}

export function extractMatchedTaskIds(
  tasks: readonly ReminderCandidateTaskRecord[],
  settings: Pick<ReminderSettingsValue, 'daysBefore' | 'remindOverdue'>,
  now: Date,
): string[] {
  const ids: string[] = [];
  for (const task of tasks) {
    if (matchTaskReminderMilestone(task.dueAt, settings, now)) ids.push(task.id);
  }
  return ids;
}

function toTaskSubject(task: ReminderCandidateTaskRecord): TaskVisibilitySubject {
  return {
    isHidden: task.isHidden,
    createdBy: task.createdBy,
    assigneeIds: task.assigneeIds,
    assignedDepartmentIds: task.assignedDepartmentIds,
  };
}

function isEligibleRecipient(
  task: ReminderCandidateTaskRecord,
  subject: TaskVisibilitySubject,
  recipient: ReminderRecipientRecord,
): boolean {
  if (!recipient.isActive) return false;
  const isAssigned =
    task.assigneeIds.includes(recipient.userId) ||
    recipient.departmentIds.some((deptId) => task.assignedDepartmentIds.includes(deptId));
  if (!isAssigned) return false;
  const actor: AuthActor = {
    id: recipient.userId,
    isActive: recipient.isActive,
    isAdmin: recipient.isAdmin,
    permissions: [],
    departmentIds: recipient.departmentIds,
  };
  return canViewTask(actor, subject);
}

function dedupeRecipients(recipients: readonly ReminderRecipientRecord[]): ReminderRecipientRecord[] {
  const byId = new Map<string, ReminderRecipientRecord>();
  for (const recipient of recipients) {
    if (!byId.has(recipient.userId)) byId.set(recipient.userId, recipient);
  }
  return Array.from(byId.values());
}

function compareDigestItems(a: ReminderDigestItem, b: ReminderDigestItem): number {
  return (
    b.priority - a.priority ||
    a.dueAt.getTime() - b.dueAt.getTime() ||
    (a.title ?? '').localeCompare(b.title ?? '') ||
    a.taskId.localeCompare(b.taskId)
  );
}

interface RecipientAccumulator {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: ReminderLocale;
  readonly items: ReminderDigestItem[];
}

function addRecipientDigestItem(
  byUser: Map<string, RecipientAccumulator>,
  recipient: ReminderRecipientRecord,
  item: ReminderDigestItem,
): void {
  const existing = byUser.get(recipient.userId);
  if (existing) {
    existing.items.push(item);
    return;
  }
  byUser.set(recipient.userId, {
    userId: recipient.userId,
    email: recipient.email,
    fullName: recipient.fullName,
    locale: recipient.locale,
    items: [item],
  });
}

function toRecipientDigest(acc: RecipientAccumulator): RecipientReminderDigest {
  return {
    userId: acc.userId,
    email: acc.email,
    fullName: acc.fullName,
    locale: acc.locale,
    buckets: {
      overdue: acc.items.filter((item) => item.diffDays < 0).sort(compareDigestItems),
      dueToday: acc.items.filter((item) => item.diffDays === 0).sort(compareDigestItems),
      comingUp: acc.items.filter((item) => item.diffDays > 0).sort(compareDigestItems),
    },
    itemsToRecord: acc.items.map((item) => ({ taskId: item.taskId, kind: item.kind })),
  };
}

function collectTaskDigestItems(params: {
  readonly task: ReminderCandidateTaskRecord;
  readonly milestone: MatchedTaskMilestone;
  readonly sentSet: ReadonlySet<string>;
  readonly byUser: Map<string, RecipientAccumulator>;
}): number {
  const subject = toTaskSubject(params.task);
  let skippedCount = 0;
  for (const recipient of dedupeRecipients(params.task.recipients)) {
    if (!isEligibleRecipient(params.task, subject, recipient)) continue;
    const sentKey = buildSentReminderKey(params.task.id, recipient.userId, params.milestone.kind);
    if (params.sentSet.has(sentKey)) {
      skippedCount += 1;
      continue;
    }
    addRecipientDigestItem(params.byUser, recipient, {
      taskId: params.task.id,
      kind: params.milestone.kind,
      boardName: params.task.boardName,
      columnName: params.task.columnName,
      // WQ-27: Never pass hidden task titles into digest rendering.
      title: params.task.isHidden ? null : params.task.title,
      dueAt: params.task.dueAt,
      diffDays: params.milestone.diffDays,
      priority: params.task.priority,
      isHidden: params.task.isHidden,
    });
  }
  return skippedCount;
}

export function buildReminderDispatchPlan(params: {
  readonly tasks: readonly ReminderCandidateTaskRecord[];
  readonly settings: Pick<ReminderSettingsValue, 'daysBefore' | 'remindOverdue'>;
  readonly existingSentKeys: readonly ReminderSentKeyRecord[];
  readonly now: Date;
}): ReminderDispatchPlan {
  const sentSet = new Set(
    params.existingSentKeys.map((row) => buildSentReminderKey(row.taskId, row.userId, row.kind)),
  );
  const byUser = new Map<string, RecipientAccumulator>();
  let processedTasks = 0;
  let skippedAlreadySent = 0;

  for (const task of params.tasks) {
    const milestone = matchTaskReminderMilestone(task.dueAt, params.settings, params.now);
    if (!milestone) continue;
    processedTasks += 1;
    skippedAlreadySent += collectTaskDigestItems({ task, milestone, sentSet, byUser });
  }

  const digests = Array.from(byUser.values())
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map(toRecipientDigest);
  return { processedTasks, skippedAlreadySent, digests };
}
