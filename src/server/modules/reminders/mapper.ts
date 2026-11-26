import {
  type TaskMemberPublicSummaryDto,
  toTaskMemberPublicSummaryDto,
} from '@/server/modules/tasks';
import type { ReminderSettingsRecord } from './types';

export interface ReminderSettingsDto {
  readonly daysBefore: number[];
  readonly remindOverdue: boolean;
  readonly sendHourVn: number;
  readonly updatedAt: string | null;
  readonly updatedBy: TaskMemberPublicSummaryDto | null;
}

export interface ReminderSettingsResponseDto {
  readonly settings: ReminderSettingsDto;
}

export interface CronRemindersResponseDto {
  readonly processedTasks: number;
  readonly emailsSent: number;
  readonly remindersRecorded: number;
  readonly skippedAlreadySent: number;
}

export function toReminderSettingsResponseDto(
  record: ReminderSettingsRecord,
): ReminderSettingsResponseDto {
  return {
    settings: {
      daysBefore: [...record.daysBefore],
      remindOverdue: record.remindOverdue,
      sendHourVn: record.sendHourVn,
      updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
      updatedBy: record.updatedBy
        ? toTaskMemberPublicSummaryDto(record.updatedBy)
        : null,
    },
  };
}

export function toCronRemindersResponseDto(
  result: CronRemindersResponseDto,
): CronRemindersResponseDto {
  return {
    processedTasks: result.processedTasks,
    emailsSent: result.emailsSent,
    remindersRecorded: result.remindersRecorded,
    skippedAlreadySent: result.skippedAlreadySent,
  };
}
