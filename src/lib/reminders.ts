import { z } from 'zod';

export const MIN_MILESTONE_DAY = 0;
export const MAX_MILESTONE_DAY = 365;
export const MAX_MILESTONE_COUNT = 30;
export const DEFAULT_REMINDER_DAYS_BEFORE = [2, 1] as const;
export const DEFAULT_REMIND_OVERDUE = true;
export const DEFAULT_SEND_HOUR_VN = 7;
export const REMINDERS_APP_SETTING_KEY = 'reminders';

export const milestoneDaySchema = z
  .number()
  .int()
  .min(MIN_MILESTONE_DAY)
  .max(MAX_MILESTONE_DAY);

export const updateReminderSettingsSchema = z
  .object({
    daysBefore: z.array(milestoneDaySchema).max(MAX_MILESTONE_COUNT),
    remindOverdue: z.boolean(),
  })
  .strict();

export type UpdateReminderSettingsInput = z.infer<
  typeof updateReminderSettingsSchema
>;

function isValidMilestoneDay(day: number): boolean {
  return (
    Number.isInteger(day) &&
    day >= MIN_MILESTONE_DAY &&
    day <= MAX_MILESTONE_DAY
  );
}

export function normalizeDaysBefore(days: readonly number[]): number[] {
  return Array.from(new Set(days.filter(isValidMilestoneDay))).sort(
    (a, b) => b - a,
  );
}
