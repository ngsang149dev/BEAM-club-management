import { notFound } from '@/lib/errors';
import type { ListNotificationsQueryInput } from '@/lib/notifications';
import { assertActorActive } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import type { Mailer } from '@/server/shared/mailer';
import type { TransactionRunner } from '@/server/shared/transaction';
import { buildDepartmentAssignedEmail } from './email-template';
import {
  executeNotifyDeliverableSubmitted,
  executeNotifyTaskAccepted,
  extractSafeMailErrorMessage,
} from './lead-notifications';
import {
  type NotificationPageResponseDto,
  type NotificationReadAllResponseDto,
  type NotificationReadResponseDto,
  toNotificationPageResponseDto,
  toNotificationReadAllResponseDto,
  toNotificationReadResponseDto,
} from './mapper';
import {
  buildNotificationPayload,
  decodeNotificationCursor,
  dedupeDepartmentRecipients,
  type DeduplicatedDepartmentRecipient,
  encodeNotificationCursor,
} from './policy';
import type {
  CreateNotificationRowInput,
  DepartmentAssignmentContextRecord,
  NotificationsDispatcher,
  NotificationsRepository,
  NotifyDeliverableSubmittedInput,
  NotifyDepartmentAssignmentInput,
  NotifyTaskAcceptedInput,
} from './types';

export interface NotificationsServiceDeps {
  readonly notificationsRepo: NotificationsRepository;
  readonly transactionRunner: TransactionRunner;
  readonly mailer: Mailer;
  readonly clock: Clock;
  readonly config: Pick<Config, 'appUrl'>;
  readonly logger: Logger;
}

function buildDepartmentNotificationRows(params: {
  readonly context: DepartmentAssignmentContextRecord;
  readonly recipients: readonly DeduplicatedDepartmentRecipient[];
  readonly actorId: string;
  readonly isHiddenTask: boolean;
  readonly now: Date;
}): CreateNotificationRowInput[] {
  return params.recipients.map((recipient) => ({
    userId: recipient.userId,
    type: recipient.type,
    taskId: params.context.task.id,
    boardId: params.context.board.id,
    departmentId: recipient.representativeDepartmentId,
    actorId: params.actorId,
    isHiddenTask: params.isHiddenTask,
    payload: buildNotificationPayload({
      isHiddenTask: params.isHiddenTask,
      taskTitle: params.context.task.title,
      boardName: params.context.board.name,
      departmentName: recipient.departmentName,
    }),
    createdAt: params.now,
  }));
}

function renderAssignmentEmail(params: {
  readonly context: DepartmentAssignmentContextRecord;
  readonly recipient: DeduplicatedDepartmentRecipient;
  readonly isHiddenTask: boolean;
  readonly now: Date;
  readonly appUrl: string;
}) {
  const { context, recipient, isHiddenTask } = params;
  const { task } = context;
  return buildDepartmentAssignedEmail({
    locale: recipient.locale,
    recipientName: recipient.fullName,
    actorName: context.actor.fullName,
    boardName: context.board.name,
    departmentNames: recipient.departmentNames,
    taskTitle: isHiddenTask ? null : task.title,
    taskDescription: isHiddenTask ? null : (task.description ?? null),
    startAt: isHiddenTask ? null : (task.startAt ?? null),
    dueAt: isHiddenTask ? null : (task.dueAt ?? null),
    now: params.now,
    isHiddenTask,
    appUrl: params.appUrl,
    boardId: context.board.id,
    taskId: task.id,
  });
}

function resolveDispatchInput(input: NotifyDepartmentAssignmentInput) {
  const notifyInApp = input.notifyInApp ?? true;
  const notifyEmail = input.notifyEmail ?? true;
  const assigneeIds = input.assigneeIds ?? [];
  const shouldRun =
    (notifyInApp || notifyEmail) &&
    (input.departmentIds.length > 0 || assigneeIds.length > 0);
  return { notifyInApp, notifyEmail, assigneeIds, shouldRun };
}

export class NotificationsService implements NotificationsDispatcher {
  constructor(private readonly deps: NotificationsServiceDeps) {}

  async notifyDepartmentAssignment(input: NotifyDepartmentAssignmentInput): Promise<void> {
    const resolved = resolveDispatchInput(input);
    if (!resolved.shouldRun) return;
    const context = await this.deps.notificationsRepo.loadDepartmentAssignmentContext({
      taskId: input.taskId,
      boardId: input.boardId,
      actorId: input.actorId,
      departmentIds: input.departmentIds,
      assigneeIds: resolved.assigneeIds,
    });
    if (!context) return;
    const recipients = dedupeDepartmentRecipients({
      departments: context.departments,
      members: context.members,
      directAssignees: context.directAssignees,
      actorId: input.actorId,
    });
    if (recipients.length === 0) return;
    const isHiddenTask = context.task.isHidden || input.isHiddenTask;
    const idByUser = resolved.notifyInApp
      ? await this.persistNotificationRows({ context, recipients, actorId: input.actorId, isHiddenTask, now: input.now })
      : new Map<string, string>();
    if (resolved.notifyEmail) await this.deliverEmails({ context, recipients, isHiddenTask, idByUser, now: input.now });
    this.deps.logger.info('Department assignment notifications dispatched', {
      taskId: context.task.id,
      boardId: context.board.id,
      actorId: input.actorId,
      recipientCount: recipients.length,
      notifyInApp: resolved.notifyInApp,
      notifyEmail: resolved.notifyEmail,
      isHiddenTask,
    });
  }

  async notifyTaskAccepted(input: NotifyTaskAcceptedInput): Promise<void> {
    await executeNotifyTaskAccepted(this.deps, input);
  }

  async notifyDeliverableSubmitted(input: NotifyDeliverableSubmittedInput): Promise<void> {
    await executeNotifyDeliverableSubmitted(this.deps, input);
  }

  async listForUser(
    actor: AuthActor,
    query: ListNotificationsQueryInput,
  ): Promise<NotificationPageResponseDto> {
    assertActorActive(actor);
    const cursor = query.cursor
      ? decodeNotificationCursor(query.cursor)
      : undefined;
    const { rows, unreadCount, hasMore } =
      await this.deps.notificationsRepo.listVisibleForUser(actor, {
        unreadOnly: query.unreadOnly,
        cursor,
        limit: query.limit,
      });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeNotificationCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return toNotificationPageResponseDto({
      items: rows,
      unreadCount,
      nextCursor,
      limit: query.limit,
    });
  }

  async markRead(
    actor: AuthActor,
    notificationId: string,
  ): Promise<NotificationReadResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.deps.notificationsRepo.markReadForUser(
        actor,
        notificationId,
        now,
        tx,
      ),
    );
    if (!updated) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return toNotificationReadResponseDto(updated);
  }

  async markAllRead(actor: AuthActor): Promise<NotificationReadAllResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.deps.notificationsRepo.markAllReadForUser(actor, now, tx),
    );
    return toNotificationReadAllResponseDto(result);
  }

  private async persistNotificationRows(params: {
    readonly context: DepartmentAssignmentContextRecord;
    readonly recipients: readonly DeduplicatedDepartmentRecipient[];
    readonly actorId: string;
    readonly isHiddenTask: boolean;
    readonly now: Date;
  }): Promise<Map<string, string>> {
    const rows = buildDepartmentNotificationRows(params);
    const inserted = await this.deps.notificationsRepo.insertNotifications(rows);
    return new Map(inserted.map((row) => [row.userId, row.id]));
  }

  private async deliverEmails(params: {
    readonly context: DepartmentAssignmentContextRecord;
    readonly recipients: readonly DeduplicatedDepartmentRecipient[];
    readonly isHiddenTask: boolean;
    readonly idByUser: ReadonlyMap<string, string>;
    readonly now: Date;
  }): Promise<void> {
    for (const recipient of params.recipients) {
      const rendered = renderAssignmentEmail({
        context: params.context,
        recipient,
        isHiddenTask: params.isHiddenTask,
        now: params.now,
        appUrl: this.deps.config.appUrl,
      });
      try {
        await this.deps.mailer.send({
          to: recipient.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
      } catch (error) {
        this.deps.logger.error('Failed to send notification email', {
          notificationId: params.idByUser.get(recipient.userId) ?? null,
          userId: recipient.userId,
          taskId: params.context.task.id,
          errorMessage: extractSafeMailErrorMessage(error),
        });
      }
    }
  }
}
