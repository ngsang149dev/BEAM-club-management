import {
  DEFAULT_SEND_HOUR_VN,
  normalizeDaysBefore,
  type UpdateReminderSettingsInput,
} from '@/lib/reminders';
import { assertValidCronAuthorization } from '@/server/modules/archive';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import { extractSafeMailErrorMessage, type Mailer } from '@/server/shared/mailer';
import type { TransactionRunner } from '@/server/shared/transaction';
import { buildReminderDigestEmail } from './email-template';
import {
  type CronRemindersResponseDto,
  type ReminderSettingsResponseDto,
  toCronRemindersResponseDto,
  toReminderSettingsResponseDto,
} from './mapper';
import {
  buildReminderDispatchPlan,
  extractMatchedTaskIds,
  type RecipientReminderDigest,
} from './policy';
import type { RemindersRepository } from './types';

export interface RemindersServiceDeps {
  readonly remindersRepo: RemindersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly mailer: Mailer;
  readonly clock: Clock;
  readonly config: Pick<Config, 'cronSecret' | 'appUrl'>;
  readonly logger: Logger;
}

export class RemindersService {
  constructor(private readonly deps: RemindersServiceDeps) {}

  async getSettings(actor: AuthActor): Promise<ReminderSettingsResponseDto> {
    authorize(actor, 'reminder.configure');
    const settings = await this.deps.remindersRepo.getSettings();
    return toReminderSettingsResponseDto(settings);
  }

  async updateSettings(
    actor: AuthActor,
    input: UpdateReminderSettingsInput,
  ): Promise<ReminderSettingsResponseDto> {
    authorize(actor, 'reminder.configure');
    const daysBefore = normalizeDaysBefore(input.daysBefore);
    const now = this.deps.clock.now();
    const current = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistSettingsUpdate({
        actorId: actor.id,
        daysBefore,
        remindOverdue: input.remindOverdue,
        now,
        tx,
      }),
    );
    this.deps.logger.info('Reminder settings updated', {
      actorId: actor.id,
      daysBefore,
      remindOverdue: input.remindOverdue,
    });
    return toReminderSettingsResponseDto(current);
  }

  private async persistSettingsUpdate(params: {
    readonly actorId: string;
    readonly daysBefore: readonly number[];
    readonly remindOverdue: boolean;
    readonly now: Date;
    readonly tx: Parameters<TransactionRunner['runInTransaction']>[0] extends (
      tx: infer T,
    ) => Promise<unknown>
      ? T
      : never;
  }) {
    const updated = await this.deps.remindersRepo.upsertSettings(
      {
        daysBefore: params.daysBefore,
        remindOverdue: params.remindOverdue,
        sendHourVn: DEFAULT_SEND_HOUR_VN,
        actorId: params.actorId,
        now: params.now,
      },
      params.tx,
    );
    await this.deps.auditWriter.record(
      {
        actorId: params.actorId,
        action: 'settings.reminders_updated',
        detail: {
          previousDaysBefore: [...updated.previousDaysBefore],
          previousRemindOverdue: updated.previousRemindOverdue,
          daysBefore: [...params.daysBefore],
          remindOverdue: params.remindOverdue,
        },
        createdAt: params.now,
      },
      params.tx,
    );
    return updated.current;
  }

  async runRemindersCron(
    authHeader: string | null | undefined,
  ): Promise<CronRemindersResponseDto> {
    assertValidCronAuthorization(authHeader, this.deps.config.cronSecret);
    const settings = await this.deps.remindersRepo.getSettings();
    if (settings.daysBefore.length === 0 && !settings.remindOverdue) {
      return this.finishEmptyCron('Deadline reminders cron skipped (disabled)');
    }
    const now = this.deps.clock.now();
    const candidateTasks = await this.deps.remindersRepo.findCandidateTasks();
    const matchedTaskIds = extractMatchedTaskIds(candidateTasks, settings, now);
    if (matchedTaskIds.length === 0) {
      return this.finishEmptyCron('Deadline reminders cron completed');
    }
    const existingSentKeys =
      await this.deps.remindersRepo.findSentReminderKeys(matchedTaskIds);
    const plan = buildReminderDispatchPlan({
      tasks: candidateTasks,
      settings,
      existingSentKeys,
      now,
    });
    const delivery = await this.deliverDigests(plan.digests, now);
    const summary = toCronRemindersResponseDto({
      processedTasks: plan.processedTasks,
      emailsSent: delivery.emailsSent,
      remindersRecorded: delivery.remindersRecorded,
      skippedAlreadySent: plan.skippedAlreadySent,
    });
    this.deps.logger.info('Deadline reminders cron completed', { ...summary });
    return summary;
  }

  private finishEmptyCron(message: string): CronRemindersResponseDto {
    const empty = toCronRemindersResponseDto({
      processedTasks: 0,
      emailsSent: 0,
      remindersRecorded: 0,
      skippedAlreadySent: 0,
    });
    this.deps.logger.info(message, { ...empty });
    return empty;
  }

  private async deliverDigests(
    digests: readonly RecipientReminderDigest[],
    now: Date,
  ): Promise<{ readonly emailsSent: number; readonly remindersRecorded: number }> {
    let emailsSent = 0;
    let remindersRecorded = 0;

    for (const digest of digests) {
      const sent = await this.deliverSingleDigest(digest, now);
      if (!sent.ok) continue;
      emailsSent += 1;
      remindersRecorded += sent.insertedCount;
    }

    return { emailsSent, remindersRecorded };
  }

  private async deliverSingleDigest(
    digest: RecipientReminderDigest,
    now: Date,
  ): Promise<{ readonly ok: boolean; readonly insertedCount: number }> {
    const rendered = buildReminderDigestEmail({
      locale: digest.locale,
      recipientName: digest.fullName,
      sentAt: now,
      appUrl: this.deps.config.appUrl,
      buckets: digest.buckets,
    });
    try {
      await this.deps.mailer.send({
        to: digest.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    } catch (error) {
      this.deps.logger.error('Failed to send deadline reminder email', {
        userId: digest.userId,
        taskIds: digest.itemsToRecord.map((item) => item.taskId),
        errorMessage: extractSafeMailErrorMessage(error),
      });
      return { ok: false, insertedCount: 0 };
    }
    // Persist reminder markers ONLY after mailer.send resolves so failed sends retry.
    const insertedCount = await this.deps.remindersRepo.insertSentReminders(
      digest.itemsToRecord.map((item) => ({
        taskId: item.taskId,
        userId: digest.userId,
        kind: item.kind,
        sentAt: now,
      })),
    );
    return { ok: true, insertedCount };
  }
}
