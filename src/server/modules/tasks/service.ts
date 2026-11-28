import { badRequest, notFound } from '@/lib/errors';
import {
  type CreateTaskDeliverableRequestInput,
  type CreateTaskRequestInput,
  dedupeSortedUuids,
  type ListMyTasksQueryInput,
  type ListTasksQueryInput,
  type MoveTaskRequestInput,
  type ReplaceTaskAssigneesRequestInput,
  resolveTaskNotificationChannels,
  type TaskNotificationChannels,
  type UpdateTaskAcceptanceRequestInput,
  type UpdateTaskHiddenRequestInput,
  type UpdateTaskRequestInput,
} from '@/lib/tasks';
import type { AuditLogWriter } from '@/server/shared/audit-writer';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  executeAddDeliverable,
  executeRemoveDeliverable,
  executeSetTaskAcceptance,
} from './acceptance-service-helpers';
import {
  type DeleteTaskDeliverableResponseDto,
  type TaskDeliverableMutationResponseDto,
  type TaskDeliverablesResponseDto,
  type TaskMutationResponseDto,
  type TaskPageResponseDto,
  type TaskResponseDto,
  toTaskDeliverablesResponseDto,
  toTaskMutationResponseDto,
  toTaskPageResponseDto,
  toTaskResponseDto,
} from './mapper';
import {
  assertActorActive,
  assertCanViewTask,
  assertValidDateRange,
  decodeMyTasksCursor,
  decodeTaskCursor,
  encodeMyTasksCursor,
  encodeTaskCursor,
} from './policy';
import {
  extractTaskCursorValue,
  recordTaskLifecycleAudit,
  runTaskAssigneesInTx,
  runTaskHiddenInTx,
  runTaskMoveInTx,
  runTaskUpdateInTx,
  toTaskVisibilitySubject,
} from './service-helpers';
import type { TaskAssignmentNotifier, TasksRepository } from './types';

export interface TasksServiceDeps {
  readonly tasksRepo: TasksRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly notificationsDispatcher?: TaskAssignmentNotifier;
}

function shouldDispatchNotifications(
  channels: TaskNotificationChannels,
  departmentIds: readonly string[],
  assigneeIds: readonly string[],
): boolean {
  return (channels.notifyInApp || channels.notifyEmail) && (departmentIds.length > 0 || assigneeIds.length > 0);
}

export class TasksService {
  constructor(private readonly deps: TasksServiceDeps) {}

  async listTasks(actor: AuthActor, query: ListTasksQueryInput): Promise<TaskPageResponseDto> {
    assertActorActive(actor);
    const cursor = query.cursor ? decodeTaskCursor(query.cursor, query.sortBy, query.sortOrder) : undefined;
    const { rows, hasMore } = await this.deps.tasksRepo.listVisibleTasks(actor, {
      boardId: query.boardId, columnId: query.columnId, assigneeId: query.assigneeId,
      departmentId: query.departmentId, priority: query.priority, dueStatus: query.dueStatus,
      deadlineStatus: query.deadlineStatus, from: query.from, to: query.to, q: query.q,
      sortBy: query.sortBy, sortOrder: query.sortOrder, cursor, limit: query.limit,
      now: this.deps.clock.now(),
    });
    const last = rows.at(-1);
    const nextCursor = hasMore && last
      ? encodeTaskCursor({ sortBy: query.sortBy, sortOrder: query.sortOrder, value: extractTaskCursorValue(last, query.sortBy), id: last.id })
      : null;
    return toTaskPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  async listMyTasks(actor: AuthActor, query: ListMyTasksQueryInput): Promise<TaskPageResponseDto> {
    assertActorActive(actor);
    const cursor = query.cursor ? decodeMyTasksCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.tasksRepo.listMyTasks(actor, {
      boardId: query.boardId, departmentId: query.departmentId, q: query.q,
      includeDone: query.includeDone, priority: query.priority, cursor, limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor = hasMore && last ? encodeMyTasksCursor({ dueAt: last.dueAt, priority: last.priority, id: last.id }) : null;
    return toTaskPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  async getTask(actor: AuthActor, taskId: string): Promise<TaskResponseDto> {
    assertActorActive(actor);
    const task = await this.deps.tasksRepo.findActiveById(taskId);
    if (!task) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    assertCanViewTask(actor, toTaskVisibilitySubject(task));
    return toTaskResponseDto(task);
  }

  async createTask(actor: AuthActor, input: CreateTaskRequestInput): Promise<TaskMutationResponseDto> {
    authorize(actor, 'task.create');
    if ((input.boardId === undefined) !== (input.columnId === undefined)) {
      throw badRequest('errors.badRequest', {}, 'BAD_REQUEST');
    }
    assertValidDateRange(input.startAt, input.dueAt);
    const assigneeIds = dedupeSortedUuids(input.assigneeIds);
    const departmentIds = dedupeSortedUuids(input.departmentIds);
    if (assigneeIds.length > 0 || departmentIds.length > 0) authorize(actor, 'task.assign');
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const created = await this.deps.tasksRepo.createTaskWithEvent({
        boardId: input.boardId, columnId: input.columnId, title: input.title, description: input.description,
        startAt: input.startAt, dueAt: input.dueAt, priority: input.priority, assigneeIds, departmentIds,
        isHidden: input.isHidden, actorId: actor.id, now,
      }, tx);
      await recordTaskLifecycleAudit({
        auditWriter: this.deps.auditWriter, actorId: actor.id, action: 'task.created', task: created.task,
        extra: { assigneeCount: assigneeIds.length, departmentIds }, now, tx,
      });
      return created;
    });
    this.deps.logger.info('Task created', { actorId: actor.id, taskId: result.task.id, boardId: result.task.boardId, isHidden: result.task.isHidden });
    await this.maybeNotifyAssignment(input, { taskId: result.task.id, boardId: result.task.boardId, actorId: actor.id, departmentIds, assigneeIds, isHiddenTask: result.task.isHidden, now });
    return toTaskMutationResponseDto(result);
  }

  async updateTask(actor: AuthActor, taskId: string, input: UpdateTaskRequestInput): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskUpdateInTx({ tasksRepo: this.deps.tasksRepo, auditWriter: this.deps.auditWriter, actor, taskId, input, now, tx }),
    );
    if (result.eventId) this.deps.logger.info('Task updated', { actorId: actor.id, taskId, eventId: result.eventId });
    return toTaskMutationResponseDto(result);
  }

  async moveTask(actor: AuthActor, taskId: string, input: MoveTaskRequestInput): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskMoveInTx({ tasksRepo: this.deps.tasksRepo, actor, taskId, input, now, tx }),
    );
    if (result.eventId) {
      this.deps.logger.info('Task moved', { actorId: actor.id, taskId, boardId: result.task.boardId, eventId: result.eventId });
    }
    return toTaskMutationResponseDto(result);
  }

  async replaceAssignees(actor: AuthActor, taskId: string, input: ReplaceTaskAssigneesRequestInput): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskAssigneesInTx({ tasksRepo: this.deps.tasksRepo, auditWriter: this.deps.auditWriter, actor, taskId, input, now, tx }),
    );
    if (result.eventId) this.deps.logger.info('Task assignees replaced', { actorId: actor.id, taskId, eventId: result.eventId });
    await this.maybeNotifyAssignment(input, {
      taskId: result.task.id, boardId: result.task.boardId, actorId: actor.id,
      departmentIds: result.addedDepartmentIds, assigneeIds: result.addedAssigneeIds, isHiddenTask: result.task.isHidden, now,
    });
    return toTaskMutationResponseDto(result);
  }

  async deleteTask(actor: AuthActor, taskId: string): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const target = await this.deps.tasksRepo.findActiveById(taskId, tx);
      if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      assertCanViewTask(actor, toTaskVisibilitySubject(target));
      authorize(actor, 'task.delete');
      const deleted = await this.deps.tasksRepo.softDeleteTaskWithEvent({ id: taskId, boardId: target.boardId, actorId: actor.id, version: target.version, now }, tx);
      await recordTaskLifecycleAudit({ auditWriter: this.deps.auditWriter, actorId: actor.id, action: 'task.deleted', task: target, now, tx });
      return deleted;
    });
    this.deps.logger.info('Task soft-deleted', { actorId: actor.id, taskId, eventId: result.eventId });
    return toTaskMutationResponseDto(result);
  }

  async updateTaskHidden(actor: AuthActor, taskId: string, input: UpdateTaskHiddenRequestInput): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskHiddenInTx({ tasksRepo: this.deps.tasksRepo, auditWriter: this.deps.auditWriter, actor, taskId, input, now, tx }),
    );
    if (result.eventId) {
      this.deps.logger.info('Task hidden flag updated', { actorId: actor.id, taskId, isHidden: result.task.isHidden, eventId: result.eventId });
    }
    return toTaskMutationResponseDto(result);
  }

  setTaskAcceptance(actor: AuthActor, taskId: string, input: UpdateTaskAcceptanceRequestInput): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    return executeSetTaskAcceptance(this.deps, actor, taskId, input);
  }

  async listDeliverables(actor: AuthActor, taskId: string): Promise<TaskDeliverablesResponseDto> {
    assertActorActive(actor);
    const task = await this.deps.tasksRepo.findActiveById(taskId);
    if (!task) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    assertCanViewTask(actor, toTaskVisibilitySubject(task));
    return toTaskDeliverablesResponseDto(task.deliverables);
  }

  addDeliverable(actor: AuthActor, taskId: string, input: CreateTaskDeliverableRequestInput): Promise<TaskDeliverableMutationResponseDto> {
    assertActorActive(actor);
    return executeAddDeliverable(this.deps, actor, taskId, input);
  }

  removeDeliverable(actor: AuthActor, taskId: string, deliverableId: string): Promise<DeleteTaskDeliverableResponseDto> {
    assertActorActive(actor);
    return executeRemoveDeliverable(this.deps, actor, taskId, deliverableId);
  }

  private async maybeNotifyAssignment(
    channelsInput: { readonly notifyDepartmentMembers?: boolean; readonly notifyInApp?: boolean; readonly notifyEmail?: boolean },
    payload: { readonly taskId: string; readonly boardId: string; readonly actorId: string; readonly departmentIds: readonly string[]; readonly assigneeIds: readonly string[]; readonly isHiddenTask: boolean; readonly now: Date },
  ): Promise<void> {
    const channels = resolveTaskNotificationChannels(channelsInput);
    if (!this.deps.notificationsDispatcher || !shouldDispatchNotifications(channels, payload.departmentIds, payload.assigneeIds)) return;
    try {
      await this.deps.notificationsDispatcher.notifyDepartmentAssignment({ ...payload, notifyInApp: channels.notifyInApp, notifyEmail: channels.notifyEmail });
    } catch (error) {
      this.deps.logger.error('Failed to dispatch task department notifications', {
        taskId: payload.taskId, boardId: payload.boardId, actorId: payload.actorId,
        departmentCount: payload.departmentIds.length, assigneeCount: payload.assigneeIds.length, error,
      });
    }
  }
}
