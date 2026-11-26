import type { Config } from '@/server/shared/config';
import { type Logger, scrubPiiText } from '@/server/shared/logger';
import type { Mailer } from '@/server/shared/mailer';
import { buildLeadActivityEmail } from './lead-email-template';
import {
  buildNotificationPayload,
  type DeduplicatedLeadRecipient,
  selectLeadAndCreatorRecipients,
} from './policy';
import type {
  NotificationsRepository,
  NotifyDeliverableSubmittedInput,
  NotifyTaskAcceptedInput,
  TaskActivityNotificationContextRecord,
} from './types';

function formatSubError(item: unknown): string {
  return item instanceof Error ? item.message : String(item);
}

function extractAggregateMessages(error: Error): string {
  if (!('errors' in error) || !Array.isArray(error.errors)) return '';
  return error.errors
    .map(formatSubError)
    .filter((msg) => msg.trim().length > 0)
    .join('; ');
}

export function extractSafeMailErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Mail delivery error';
  if (error.message.trim().length > 0) return scrubPiiText(error.message);
  const aggregateMessage = extractAggregateMessages(error);
  if (aggregateMessage.length > 0) return scrubPiiText(aggregateMessage);
  return scrubPiiText(error.name || 'Mail delivery error');
}

export interface LeadNotificationsDeps {
  readonly notificationsRepo: NotificationsRepository;
  readonly mailer: Mailer;
  readonly config: Pick<Config, 'appUrl'>;
  readonly logger: Logger;
}

async function sendSingleLeadEmail(params: {
  readonly deps: LeadNotificationsDeps;
  readonly kind: 'task.accepted' | 'task.deliverable_submitted';
  readonly context: TaskActivityNotificationContextRecord;
  readonly recipient: DeduplicatedLeadRecipient;
  readonly isHiddenTask: boolean;
  readonly notificationId: string | null;
}): Promise<void> {
  const { context, recipient, isHiddenTask } = params;
  const rendered = buildLeadActivityEmail({
    kind: params.kind,
    locale: recipient.locale,
    recipientName: recipient.fullName,
    actorName: context.actor.fullName,
    boardName: context.board.name,
    departmentNames: recipient.departmentNames,
    taskTitle: isHiddenTask ? null : context.task.title,
    deliverableTitle: isHiddenTask ? null : (context.deliverable?.title ?? null),
    deliverableUrl: isHiddenTask ? null : (context.deliverable?.url ?? null),
    isHiddenTask,
    appUrl: params.deps.config.appUrl,
    boardId: context.board.id,
    taskId: context.task.id,
  });
  try {
    await params.deps.mailer.send({ to: recipient.email, subject: rendered.subject, text: rendered.text, html: rendered.html });
  } catch (error) {
    params.deps.logger.error('Failed to send lead notification email', {
      notificationId: params.notificationId,
      userId: recipient.userId,
      taskId: context.task.id,
      kind: params.kind,
      errorMessage: extractSafeMailErrorMessage(error),
    });
  }
}

async function deliverLeadEmails(params: {
  readonly deps: LeadNotificationsDeps;
  readonly kind: 'task.accepted' | 'task.deliverable_submitted';
  readonly context: TaskActivityNotificationContextRecord;
  readonly recipients: readonly DeduplicatedLeadRecipient[];
  readonly isHiddenTask: boolean;
  readonly idByUser: ReadonlyMap<string, string>;
}): Promise<void> {
  for (const recipient of params.recipients) {
    await sendSingleLeadEmail({
      deps: params.deps,
      kind: params.kind,
      context: params.context,
      recipient,
      isHiddenTask: params.isHiddenTask,
      notificationId: params.idByUser.get(recipient.userId) ?? null,
    });
  }
}

function buildLeadNotificationRows(params: {
  readonly kind: 'task.accepted' | 'task.deliverable_submitted';
  readonly context: TaskActivityNotificationContextRecord;
  readonly recipients: readonly DeduplicatedLeadRecipient[];
  readonly actorId: string;
  readonly isHiddenTask: boolean;
  readonly now: Date;
}) {
  return params.recipients.map((recipient) => ({
    userId: recipient.userId,
    type: params.kind,
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

async function dispatchLeadActivityNotification(params: {
  readonly deps: LeadNotificationsDeps;
  readonly kind: 'task.accepted' | 'task.deliverable_submitted';
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly deliverableId?: string;
  readonly isHiddenTask: boolean;
  readonly now: Date;
}): Promise<void> {
  const context = await params.deps.notificationsRepo.loadTaskActivityContext({
    taskId: params.taskId, boardId: params.boardId, actorId: params.actorId, deliverableId: params.deliverableId,
  });
  if (!context) return;
  const recipients = selectLeadAndCreatorRecipients({ context, actorId: params.actorId });
  if (recipients.length === 0) return;

  const isHiddenTask = context.task.isHidden || params.isHiddenTask;
  const inserted = await params.deps.notificationsRepo.insertNotifications(
    buildLeadNotificationRows({ kind: params.kind, context, recipients, actorId: params.actorId, isHiddenTask, now: params.now }),
  );
  const idByUser = new Map(inserted.map((r) => [r.userId, r.id]));
  await deliverLeadEmails({ deps: params.deps, kind: params.kind, context, recipients, isHiddenTask, idByUser });
  params.deps.logger.info('Lead activity notifications dispatched', {
    taskId: context.task.id, boardId: context.board.id, actorId: params.actorId, kind: params.kind, recipientCount: recipients.length, isHiddenTask,
  });
}

export async function executeNotifyTaskAccepted(
  deps: LeadNotificationsDeps,
  input: NotifyTaskAcceptedInput,
): Promise<void> {
  await dispatchLeadActivityNotification({
    deps,
    kind: 'task.accepted',
    ...input,
  });
}

export async function executeNotifyDeliverableSubmitted(
  deps: LeadNotificationsDeps,
  input: NotifyDeliverableSubmittedInput,
): Promise<void> {
  await dispatchLeadActivityNotification({
    deps,
    kind: 'task.deliverable_submitted',
    ...input,
  });
}
