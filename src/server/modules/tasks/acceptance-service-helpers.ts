import { badRequest, forbidden, notFound } from '@/lib/errors';
import {
  type CreateTaskDeliverableRequestInput,
  deliverableUrlSchema,
  type UpdateTaskAcceptanceRequestInput,
} from '@/lib/tasks';
import type { AuditLogWriter } from '@/server/shared/audit-writer';
import { type AuthActor } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  type DeleteTaskDeliverableResponseDto,
  type TaskDeliverableMutationResponseDto,
  type TaskMutationResponseDto,
  toDeleteTaskDeliverableResponseDto,
  toTaskDeliverableMutationResponseDto,
  toTaskMutationResponseDto,
} from './mapper';
import {
  assertCanViewTask,
  canRemoveTaskDeliverable,
  canSubmitTaskDeliverable,
  isActorAssignedToTask,
} from './policy';
import {
  recordTaskLifecycleAudit,
  toTaskVisibilitySubject,
} from './service-helpers';
import type {
  AddTaskDeliverableResult,
  RemoveTaskDeliverableResult,
  TaskAssignmentNotifier,
  TaskOptionalEventMutationResult,
  TasksRepository,
} from './types';

export interface RunTaskAcceptanceResult extends TaskOptionalEventMutationResult {
  readonly becameAccepted: boolean;
}

export async function runTaskAcceptanceInTx(params: {
  readonly tasksRepo: TasksRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly input: UpdateTaskAcceptanceRequestInput;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<RunTaskAcceptanceResult> {
  const target = await params.tasksRepo.findActiveById(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  const subject = toTaskVisibilitySubject(target);
  assertCanViewTask(params.actor, subject);
  if (!isActorAssignedToTask(params.actor, subject)) {
    throw forbidden('errors.forbidden', { requiredRole: 'task_assignee' });
  }
  const existingRow = target.assignees.find((a) => a.id === params.actor.id);
  const currentAccepted = Boolean(existingRow?.acceptedAt);
  if (currentAccepted === params.input.accepted) {
    return { task: target, eventId: null, becameAccepted: false };
  }
  const mutated = await params.tasksRepo.setAcceptanceWithEvent(
    { id: params.taskId, boardId: target.boardId, actorId: params.actor.id, currentAccepted, nextAccepted: params.input.accepted, now: params.now },
    params.tx,
  );
  await recordTaskLifecycleAudit({
    auditWriter: params.auditWriter, actorId: params.actor.id, action: 'task.accepted',
    task: mutated.task, extra: { accepted: params.input.accepted }, now: params.now, tx: params.tx,
  });
  return { ...mutated, becameAccepted: !currentAccepted && params.input.accepted };
}

export async function runAddDeliverableInTx(params: {
  readonly tasksRepo: TasksRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly input: CreateTaskDeliverableRequestInput;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<AddTaskDeliverableResult> {
  const parsedUrl = deliverableUrlSchema.safeParse(params.input.url);
  if (!parsedUrl.success) {
    throw badRequest('errors.invalidDeliverableUrl', {}, 'INVALID_DELIVERABLE_URL');
  }
  const target = await params.tasksRepo.findActiveById(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  const subject = toTaskVisibilitySubject(target);
  assertCanViewTask(params.actor, subject);
  if (!canSubmitTaskDeliverable(params.actor, subject)) {
    throw forbidden('errors.forbidden', { requiredRole: 'task_assignee_or_editor' });
  }
  const added = await params.tasksRepo.addDeliverableWithEvent(
    { taskId: params.taskId, boardId: target.boardId, actorId: params.actor.id, title: params.input.title.trim(), url: parsedUrl.data, now: params.now },
    params.tx,
  );
  await recordTaskLifecycleAudit({
    auditWriter: params.auditWriter, actorId: params.actor.id, action: 'task.deliverable_added',
    task: added.task,
    extra: { deliverableId: added.deliverable.id, deliverableTitle: added.task.isHidden ? null : added.deliverable.title },
    now: params.now, tx: params.tx,
  });
  return added;
}

export async function runRemoveDeliverableInTx(params: {
  readonly tasksRepo: TasksRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly deliverableId: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<RemoveTaskDeliverableResult> {
  const target = await params.tasksRepo.findActiveById(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  assertCanViewTask(params.actor, toTaskVisibilitySubject(target));
  const deliverable = target.deliverables.find((d) => d.id === params.deliverableId);
  if (!deliverable) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (!canRemoveTaskDeliverable(params.actor, deliverable.submittedBy.id)) {
    throw forbidden('errors.forbidden', { requiredRole: 'deliverable_submitter_or_admin' });
  }
  const removed = await params.tasksRepo.removeDeliverableWithEvent(
    { taskId: params.taskId, boardId: target.boardId, actorId: params.actor.id, deliverableId: params.deliverableId, now: params.now },
    params.tx,
  );
  await recordTaskLifecycleAudit({
    auditWriter: params.auditWriter, actorId: params.actor.id, action: 'task.deliverable_removed',
    task: removed.task, extra: { deliverableId: params.deliverableId }, now: params.now, tx: params.tx,
  });
  return removed;
}

export async function dispatchLeadNotificationSafe(
  dispatcher: TaskAssignmentNotifier | undefined,
  logger: Logger,
  action: () => Promise<void>,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!dispatcher) return;
  try {
    await action();
  } catch (error) {
    logger.error('Failed to dispatch task lead notifications', { ...meta, error });
  }
}

export interface AcceptanceServiceContext {
  readonly tasksRepo: TasksRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly notificationsDispatcher?: TaskAssignmentNotifier;
}

export async function executeSetTaskAcceptance(
  deps: AcceptanceServiceContext,
  actor: AuthActor,
  taskId: string,
  input: UpdateTaskAcceptanceRequestInput,
): Promise<TaskMutationResponseDto> {
  const now = deps.clock.now();
  const result = await deps.transactionRunner.runInTransaction((tx) =>
    runTaskAcceptanceInTx({ tasksRepo: deps.tasksRepo, auditWriter: deps.auditWriter, actor, taskId, input, now, tx }),
  );
  if (result.eventId) {
    deps.logger.info('Task acceptance updated', {
      actorId: actor.id, taskId, accepted: input.accepted, eventId: result.eventId,
    });
  }
  if (result.becameAccepted) {
    await dispatchLeadNotificationSafe(
      deps.notificationsDispatcher,
      deps.logger,
      () =>
        deps.notificationsDispatcher!.notifyTaskAccepted({
          taskId: result.task.id,
          boardId: result.task.boardId,
          actorId: actor.id,
          isHiddenTask: result.task.isHidden,
          now,
        }),
      { taskId: result.task.id, actorId: actor.id, eventType: 'task.accepted' },
    );
  }
  return toTaskMutationResponseDto(result);
}

export async function executeAddDeliverable(
  deps: AcceptanceServiceContext,
  actor: AuthActor,
  taskId: string,
  input: CreateTaskDeliverableRequestInput,
): Promise<TaskDeliverableMutationResponseDto> {
  const now = deps.clock.now();
  const result = await deps.transactionRunner.runInTransaction((tx) =>
    runAddDeliverableInTx({ tasksRepo: deps.tasksRepo, auditWriter: deps.auditWriter, actor, taskId, input, now, tx }),
  );
  deps.logger.info('Task deliverable added', {
    actorId: actor.id, taskId, deliverableId: result.deliverable.id, eventId: result.eventId,
  });
  await dispatchLeadNotificationSafe(
    deps.notificationsDispatcher,
    deps.logger,
    () =>
      deps.notificationsDispatcher!.notifyDeliverableSubmitted({
        taskId: result.task.id,
        boardId: result.task.boardId,
        actorId: actor.id,
        deliverableId: result.deliverable.id,
        isHiddenTask: result.task.isHidden,
        now,
      }),
    { taskId: result.task.id, actorId: actor.id, deliverableId: result.deliverable.id, eventType: 'task.deliverable_submitted' },
  );
  return toTaskDeliverableMutationResponseDto(result);
}

export async function executeRemoveDeliverable(
  deps: AcceptanceServiceContext,
  actor: AuthActor,
  taskId: string,
  deliverableId: string,
): Promise<DeleteTaskDeliverableResponseDto> {
  const now = deps.clock.now();
  const result = await deps.transactionRunner.runInTransaction((tx) =>
    runRemoveDeliverableInTx({ tasksRepo: deps.tasksRepo, auditWriter: deps.auditWriter, actor, taskId, deliverableId, now, tx }),
  );
  deps.logger.info('Task deliverable removed', {
    actorId: actor.id, taskId, deliverableId, eventId: result.eventId,
  });
  return toDeleteTaskDeliverableResponseDto(result);
}
