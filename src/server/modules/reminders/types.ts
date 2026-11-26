import type { TaskPriority } from '@/lib/tasks';
import type { TaskMemberSummaryRecord } from '@/server/modules/tasks';
import type { TransactionContext } from '@/server/shared/transaction';

export type ReminderLocale = 'vi' | 'en';
export type ReminderBucket = 'overdue' | 'dueToday' | 'comingUp';

export interface ReminderSettingsValue {
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
  readonly sendHourVn: number;
}

export interface ReminderSettingsRecord extends ReminderSettingsValue {
  readonly updatedAt: Date | null;
  readonly updatedBy: TaskMemberSummaryRecord | null;
}

export interface UpsertReminderSettingsParams {
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
  readonly sendHourVn: number;
  readonly actorId: string;
  readonly now: Date;
}

export interface UpsertReminderSettingsResult {
  readonly previousDaysBefore: readonly number[];
  readonly previousRemindOverdue: boolean;
  readonly current: ReminderSettingsRecord;
}

export interface ReminderRecipientRecord {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: ReminderLocale;
  readonly isActive: boolean;
  readonly isAdmin: boolean;
  readonly departmentIds: readonly string[];
}

export interface ReminderCandidateTaskRecord {
  readonly id: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly columnId: string | null;
  readonly columnName: string | null;
  readonly title: string;
  readonly dueAt: Date;
  readonly priority: TaskPriority;
  readonly isHidden: boolean;
  readonly createdBy: string;
  readonly assigneeIds: readonly string[];
  readonly assignedDepartmentIds: readonly string[];
  readonly recipients: readonly ReminderRecipientRecord[];
}

export interface ReminderSentKeyRecord {
  readonly taskId: string;
  readonly userId: string;
  readonly kind: string;
}

export interface RecordReminderSentInput {
  readonly taskId: string;
  readonly userId: string;
  readonly kind: string;
  readonly sentAt: Date;
}

export interface RemindersRepository {
  getSettings(tx?: TransactionContext): Promise<ReminderSettingsRecord>;
  upsertSettings(
    input: UpsertReminderSettingsParams,
    tx: TransactionContext,
  ): Promise<UpsertReminderSettingsResult>;
  findCandidateTasks(): Promise<ReminderCandidateTaskRecord[]>;
  findSentReminderKeys(taskIds: readonly string[]): Promise<ReminderSentKeyRecord[]>;
  insertSentReminders(rows: readonly RecordReminderSentInput[]): Promise<number>;
}
