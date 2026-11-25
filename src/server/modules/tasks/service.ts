import { notFound } from '@/lib/errors';
import {
  type CreateTaskRequestInput,
  dedupeSortedUuids,
  type ListMyTasksQueryInput,
  type ListTasksQueryInput,
  type MoveTaskRequestInput,
  type ReplaceTaskAssigneesRequestInput,
  type UpdateTaskRequestInput,
} from '@/lib/tasks';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  type TaskMutationResponseDto,
  type TaskPageResponseDto,
  type TaskResponseDto,
  toTaskMutationResponseDto,
  toTaskPageResponseDto,
  toTaskResponseDto,
} from './mapper';
import {
  assertActorActive,
  assertCanViewTask,
  decodeMyTasksCursor,
  decodeTaskCursor,
  encodeMyTasksCursor,
  encodeTaskCursor,
} from './policy';
import {
  extractTaskCursorValue,
  runTaskAssigneesInTx,
  runTaskMoveInTx,
  runTaskUpdateInTx,
  toTaskVisibilitySubject,
} from './service-helpers';
import type { TaskAssignmentNotifier, TasksRepository } from './types';

export interface TasksServiceDeps {
  readonly tasksRepo: TasksRepository;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly notificationsDispatcher?: TaskAssignmentNotifier;
}

export class TasksService {
  constructor(private readonly deps: TasksServiceDeps) {}

  async listTasks(actor: AuthActor, query: ListTasksQueryInput): Promise<TaskPageResponseDto> {
    assertActorActive(actor);
    const cursor = query.cursor
      ? decodeTaskCursor(query.cursor, query.sortBy, query.sortOrder)
      : undefined;
    const { rows, hasMore } = await this.deps.tasksRepo.listVisibleTasks(actor, {
      boardId: query.boardId,
      columnId: query.columnId,
      assigneeId: query.assigneeId,
      departmentId: query.departmentId,
      priority: query.priority,
      dueStatus: query.dueStatus,
      q: query.q,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      cursor,
      limit: query.limit,
      now: this.deps.clock.now(),
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeTaskCursor({
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
            value: extractTaskCursorValue(last, query.sortBy),
            id: last.id,
          })
        : null;
    return toTaskPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  async listMyTasks(
    actor: AuthActor,
    query: ListMyTasksQueryInput,
  ): Promise<TaskPageResponseDto> {
    assertActorActive(actor);
    const cursor = query.cursor ? decodeMyTasksCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.tasksRepo.listMyTasks(actor, {
      boardId: query.boardId,
      departmentId: query.departmentId,
      q: query.q,
      includeDone: query.includeDone,
      priority: query.priority,
      cursor,
      limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeMyTasksCursor({ dueAt: last.dueAt, priority: last.priority, id: last.id })
        : null;
    return toTaskPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  async getTask(actor: AuthActor, taskId: string): Promise<TaskResponseDto> {
    assertActorActive(actor);
    const task = await this.deps.tasksRepo.findActiveById(taskId);
    if (!task) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    assertCanViewTask(actor, toTaskVisibilitySubject(task));
    return toTaskResponseDto(task);
  }

  async createTask(
    actor: AuthActor,
    input: CreateTaskRequestInput,
  ): Promise<TaskMutationResponseDto> {
    authorize(actor, 'task.create');
    const assigneeIds = dedupeSortedUuids(input.assigneeIds);
    const departmentIds = dedupeSortedUuids(input.departmentIds);
    if (assigneeIds.length > 0 || departmentIds.length > 0) authorize(actor, 'task.assign');
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.deps.tasksRepo.createTaskWithEvent(
        {
          boardId: input.boardId, columnId: input.columnId, title: input.title,
          description: input.description, dueAt: input.dueAt, priority: input.priority,
          assigneeIds, departmentIds, isHidden: input.isHidden, actorId: actor.id, now,
        },
        tx,
      ),
    );
    this.deps.logger.info('Task created', { actorId: actor.id, taskId: result.task.id, boardId: result.task.boardId, isHidden: result.task.isHidden });
    if (input.notifyDepartmentMembers && departmentIds.length > 0) {
      await this.dispatchDepartmentNotifications({ taskId: result.task.id, boardId: result.task.boardId, actorId: actor.id, departmentIds, isHiddenTask: result.task.isHidden, now });
    }
    return toTaskMutationResponseDto(result);
  }

  async updateTask(
    actor: AuthActor,
    taskId: string,
    input: UpdateTaskRequestInput,
  ): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskUpdateInTx({ tasksRepo: this.deps.tasksRepo, actor, taskId, input, now, tx }),
    );
    if (result.eventId) {
      this.deps.logger.info('Task updated', { actorId: actor.id, taskId, eventId: result.eventId });
    }
    return toTaskMutationResponseDto(result);
  }

  async moveTask(
    actor: AuthActor,
    taskId: string,
    input: MoveTaskRequestInput,
  ): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskMoveInTx({ tasksRepo: this.deps.tasksRepo, actor, taskId, input, now, tx }),
    );
    if (result.eventId) {
      this.deps.logger.info('Task moved', {
        actorId: actor.id,
        taskId,
        boardId: result.task.boardId,
        eventId: result.eventId,
      });
    }
    return toTaskMutationResponseDto(result);
  }

  async replaceAssignees(
    actor: AuthActor,
    taskId: string,
    input: ReplaceTaskAssigneesRequestInput,
  ): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      runTaskAssigneesInTx({
        tasksRepo: this.deps.tasksRepo,
        actor,
        taskId,
        input,
        now,
        tx,
      }),
    );
    if (result.eventId) {
      this.deps.logger.info('Task assignees replaced', {
        actorId: actor.id,
        taskId,
        eventId: result.eventId,
      });
    }
    if (input.notifyDepartmentMembers && result.addedDepartmentIds.length > 0) {
      await this.dispatchDepartmentNotifications({
        taskId: result.task.id,
        boardId: result.task.boardId,
        actorId: actor.id,
        departmentIds: result.addedDepartmentIds,
        isHiddenTask: result.task.isHidden,
        now,
      });
    }
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
      return this.deps.tasksRepo.softDeleteTaskWithEvent(
        { id: taskId, boardId: target.boardId, actorId: actor.id, version: target.version, now },
        tx,
      );
    });
    this.deps.logger.info('Task soft-deleted', {
      actorId: actor.id,
      taskId,
      eventId: result.eventId,
    });
    return toTaskMutationResponseDto(result);
  }

  private async dispatchDepartmentNotifications(input: {
    readonly taskId: string;
    readonly boardId: string;
    readonly actorId: string;
    readonly departmentIds: readonly string[];
    readonly isHiddenTask: boolean;
    readonly now: Date;
  }): Promise<void> {
    if (!this.deps.notificationsDispatcher) return;
    try {
      await this.deps.notificationsDispatcher.notifyDepartmentAssignment(input);
    } catch (error) {
      this.deps.logger.error('Failed to dispatch task department notifications', {
        taskId: input.taskId,
        boardId: input.boardId,
        actorId: input.actorId,
        departmentCount: input.departmentIds.length,
        error,
      });
    }
  }
}
