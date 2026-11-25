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
  NotifyDepartmentAssignmentInput,
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
    type: 'task.department_assigned' as const,
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

export class NotificationsService implements NotificationsDispatcher {
  constructor(private readonly deps: NotificationsServiceDeps) {}

  async notifyDepartmentAssignment(
    input: NotifyDepartmentAssignmentInput,
  ): Promise<void> {
    if (input.departmentIds.length === 0) return;
    const context =
      await this.deps.notificationsRepo.loadDepartmentAssignmentContext({
        taskId: input.taskId,
        boardId: input.boardId,
        actorId: input.actorId,
        departmentIds: input.departmentIds,
      });
    if (!context) return;

    const recipients = dedupeDepartmentRecipients({
      departments: context.departments,
      members: context.members,
      actorId: input.actorId,
    });
    if (recipients.length === 0) return;

    const isHiddenTask = context.task.isHidden || input.isHiddenTask;
    const rows = buildDepartmentNotificationRows({
      context,
      recipients,
      actorId: input.actorId,
      isHiddenTask,
      now: input.now,
    });
    const inserted = await this.deps.notificationsRepo.insertNotifications(rows);
    const idByUser = new Map(inserted.map((row) => [row.userId, row.id]));
    await this.deliverEmails({ context, recipients, isHiddenTask, idByUser });
    this.deps.logger.info('Department assignment notifications dispatched', {
      taskId: context.task.id,
      boardId: context.board.id,
      actorId: input.actorId,
      recipientCount: recipients.length,
      isHiddenTask,
    });
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

  private async deliverEmails(params: {
    readonly context: DepartmentAssignmentContextRecord;
    readonly recipients: readonly DeduplicatedDepartmentRecipient[];
    readonly isHiddenTask: boolean;
    readonly idByUser: ReadonlyMap<string, string>;
  }): Promise<void> {
    for (const recipient of params.recipients) {
      const rendered = buildDepartmentAssignedEmail({
        locale: recipient.locale,
        recipientName: recipient.fullName,
        actorName: params.context.actor.fullName,
        boardName: params.context.board.name,
        departmentNames: recipient.departmentNames,
        taskTitle: params.isHiddenTask ? null : params.context.task.title,
        isHiddenTask: params.isHiddenTask,
        appUrl: this.deps.config.appUrl,
        boardId: params.context.board.id,
        taskId: params.context.task.id,
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
          error,
        });
      }
    }
  }
}
