import { badRequest, conflict, notFound } from '@/lib/errors';
import type {
  ListBoardTrashQueryInput,
  ListTaskEventsQueryInput,
  RevertTaskEventRequestInput,
} from '@/lib/task-events';
import {
  assertActorActive,
  assertCanViewTask,
  type TaskPageResponseDto,
  type TaskRecord,
  toTaskPageResponseDto,
  toTaskVisibilitySubject,
} from '@/server/modules/tasks';
import type { AuditLogWriter } from '@/server/shared/audit-writer';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import { getRevertCommand, type TaskEventCommand } from './commands';
import {
  type RevertTaskEventResponseDto,
  type TaskEventPageResponseDto,
  toRevertTaskEventResponseDto,
  toTaskEventPageResponseDto,
} from './mapper';
import {
  assertCanAccessSoftDeletedEvent,
  assertCanViewTaskEvents,
  decodeBoardTrashCursor,
  decodeTaskEventCursor,
  encodeBoardTrashCursor,
  encodeTaskEventCursor,
} from './policy';
import type { RevertTaskEventMutationResult, TaskEventsRepository } from './types';

export interface TaskEventsServiceDeps {
  readonly taskEventsRepo: TaskEventsRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

function resolveCommandOrThrow(eventType: string): TaskEventCommand {
  const command = getRevertCommand(eventType);
  if (!command) {
    throw badRequest(
      'errors.eventNotRevertable',
      { type: eventType },
      'EVENT_NOT_REVERTABLE',
    );
  }
  return command;
}

function assertNoConflicts(params: {
  readonly command: TaskEventCommand;
  readonly task: TaskRecord;
  readonly changes: Record<string, unknown>;
  readonly force: boolean;
}): void {
  const conflictingFields = params.command.detectConflicts(params.task, params.changes);
  if (conflictingFields.length > 0 && !params.force) {
    throw conflict(
      'errors.revertConflict',
      { conflictingFields },
      'REVERT_CONFLICT',
    );
  }
}

export class TaskEventsService {
  constructor(private readonly deps: TaskEventsServiceDeps) {}

  async listTaskEvents(
    actor: AuthActor,
    taskId: string,
    query: ListTaskEventsQueryInput,
  ): Promise<TaskEventPageResponseDto> {
    assertActorActive(actor);
    const context = await this.deps.taskEventsRepo.findTaskContext(taskId);
    if (!context) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    assertCanViewTaskEvents(actor, context.task);

    const cursor = query.cursor ? decodeTaskEventCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.taskEventsRepo.listByTaskId({
      taskId,
      cursor,
      limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeTaskEventCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return toTaskEventPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  async revertTaskEvent(
    actor: AuthActor,
    taskId: string,
    eventId: string,
    input: RevertTaskEventRequestInput,
  ): Promise<RevertTaskEventResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.executeRevertTx({ actor, taskId, eventId, input, now, tx }),
    );
    this.deps.logger.info('Task event reverted', {
      actorId: actor.id,
      taskId,
      boardId: result.task.boardId,
      eventId: result.eventId,
      revertedEventId: result.revertedEventId,
      forced: input.force,
    });
    return toRevertTaskEventResponseDto(result);
  }

  async listBoardTrash(
    actor: AuthActor,
    boardId: string,
    query: ListBoardTrashQueryInput,
  ): Promise<TaskPageResponseDto> {
    authorize(actor, 'task.delete');
    const exists = await this.deps.taskEventsRepo.boardExists(boardId);
    if (!exists) throw notFound('errors.notFound', {}, 'NOT_FOUND');

    const cursor = query.cursor ? decodeBoardTrashCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.taskEventsRepo.listBoardTrash({
      boardId,
      actor,
      cursor,
      limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last?.deletedAt
        ? encodeBoardTrashCursor({ deletedAt: last.deletedAt, id: last.id })
        : null;
    return toTaskPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  private async executeRevertTx(params: {
    readonly actor: AuthActor;
    readonly taskId: string;
    readonly eventId: string;
    readonly input: RevertTaskEventRequestInput;
    readonly now: Date;
    readonly tx: TransactionContext;
  }): Promise<RevertTaskEventMutationResult> {
    const context = await this.deps.taskEventsRepo.findTaskContext(params.taskId, params.tx);
    if (!context) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    // Enforce task visibility BEFORE event lookup, 403, or 400 so hidden tasks always yield 404.
    assertCanViewTask(params.actor, toTaskVisibilitySubject(context.task));

    const event = await this.deps.taskEventsRepo.findEventByIdForTask(
      { taskId: params.taskId, eventId: params.eventId },
      params.tx,
    );
    if (!event) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    assertCanAccessSoftDeletedEvent(params.actor, context.task, event.type);

    const command = resolveCommandOrThrow(event.type);
    command.authorize(params.actor, context.task);
    command.checkState(context);
    assertNoConflicts({
      command,
      task: context.task,
      changes: event.changes,
      force: params.input.force,
    });

    return this.commitRevertCommand({
      ...params,
      task: context.task,
      eventId: event.id,
      eventType: event.type,
      changes: event.changes,
      command,
    });
  }

  private async commitRevertCommand(params: {
    readonly actor: AuthActor;
    readonly taskId: string;
    readonly task: TaskRecord;
    readonly eventId: string;
    readonly eventType: string;
    readonly changes: Record<string, unknown>;
    readonly input: RevertTaskEventRequestInput;
    readonly command: TaskEventCommand;
    readonly now: Date;
    readonly tx: TransactionContext;
  }): Promise<RevertTaskEventMutationResult> {
    const intent = params.command.invert(params.task, params.changes);
    const resolved = await this.deps.taskEventsRepo.resolveRevertTargets(
      { boardId: params.task.boardId, taskId: params.taskId, intent },
      params.tx,
    );
    const plan = params.command.apply({ task: params.task, intent, resolved, now: params.now });
    const mutated = await this.deps.taskEventsRepo.applyRevertAndInsertEvent(
      {
        taskId: params.taskId, boardId: params.task.boardId, actorId: params.actor.id,
        expectedVersion: params.task.version, revertsEventId: params.eventId,
        forced: params.input.force, plan, now: params.now,
      },
      params.tx,
    );
    await this.recordRevertAudit({
      actorId: params.actor.id, revertedEventId: params.eventId,
      revertedType: params.eventType, forced: params.input.force,
      task: mutated.task, now: params.now, tx: params.tx,
    });
    return { ...mutated, revertedEventId: params.eventId };
  }

  private async recordRevertAudit(params: {
    readonly actorId: string;
    readonly revertedEventId: string;
    readonly revertedType: string;
    readonly forced: boolean;
    readonly task: TaskRecord;
    readonly now: Date;
    readonly tx: TransactionContext;
  }): Promise<void> {
    await this.deps.auditWriter?.record(
      {
        actorId: params.actorId, action: 'task.reverted',
        detail: {
          taskId: params.task.id, boardId: params.task.boardId,
          revertedEventId: params.revertedEventId, revertedType: params.revertedType,
          forced: params.forced, isHidden: params.task.isHidden,
          taskTitle: params.task.isHidden ? null : params.task.title,
        },
        createdAt: params.now,
      },
      params.tx,
    );
  }
}
