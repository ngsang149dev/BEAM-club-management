import { conflict, notFound } from '@/lib/errors';
import {
  dedupeSortedUuids,
  type MoveTaskRequestInput,
  type ReplaceTaskAssigneesRequestInput,
  type TaskSortBy,
  type UpdateTaskRequestInput,
} from '@/lib/tasks';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';
import {
  assertCanEditTask,
  assertCanViewTask,
  buildTaskUpdateChanges,
  hasTaskChanges,
  type TaskVisibilitySubject,
} from './policy';
import type {
  TaskOptionalEventMutationResult,
  TaskRecord,
  TasksRepository,
} from './types';

export function toTaskVisibilitySubject(task: TaskRecord): TaskVisibilitySubject {
  return {
    isHidden: task.isHidden,
    createdBy: task.createdBy,
    assigneeIds: task.assignees.map((assignee) => assignee.id),
    assignedDepartmentIds: task.assignedDepartments.map((dept) => dept.id),
  };
}

export function extractTaskCursorValue(
  task: TaskRecord,
  sortBy: TaskSortBy,
): string | number | null {
  if (sortBy === 'position') return task.position;
  if (sortBy === 'priority') return task.priority;
  if (sortBy === 'createdAt') return task.createdAt.toISOString();
  return task.dueAt ? task.dueAt.toISOString() : null;
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

export async function runTaskUpdateInTx(params: {
  readonly tasksRepo: TasksRepository;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly input: UpdateTaskRequestInput;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<TaskOptionalEventMutationResult> {
  const target = await params.tasksRepo.findActiveById(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  assertCanEditTask(params.actor, toTaskVisibilitySubject(target));
  if (target.version !== params.input.version) {
    throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
  }
  const changes = buildTaskUpdateChanges(target, params.input);
  if (!hasTaskChanges(changes)) {
    return { task: target, eventId: null };
  }
  return params.tasksRepo.updateTaskWithEvent(
    {
      id: params.taskId,
      boardId: target.boardId,
      actorId: params.actor.id,
      version: params.input.version,
      title: params.input.title,
      description: params.input.description,
      dueAt: params.input.dueAt,
      priority: params.input.priority,
      changes,
      now: params.now,
    },
    params.tx,
  );
}

export interface RunTaskAssigneesResult extends TaskOptionalEventMutationResult {
  readonly addedDepartmentIds: readonly string[];
  readonly addedAssigneeIds: readonly string[];
}

function computeNextAssignments(
  target: TaskRecord,
  input: ReplaceTaskAssigneesRequestInput,
) {
  const currentAssigneeIds = dedupeSortedUuids(target.assignees.map((a) => a.id));
  const currentDepartmentIds = dedupeSortedUuids(target.assignedDepartments.map((d) => d.id));
  const nextAssigneeIds =
    input.assigneeIds !== undefined ? dedupeSortedUuids(input.assigneeIds) : currentAssigneeIds;
  const nextDepartmentIds =
    input.departmentIds !== undefined ? dedupeSortedUuids(input.departmentIds) : currentDepartmentIds;
  const changed =
    !sameStringSet(currentAssigneeIds, nextAssigneeIds) ||
    !sameStringSet(currentDepartmentIds, nextDepartmentIds);
  const addedAssigneeIds = nextAssigneeIds.filter((id) => !currentAssigneeIds.includes(id));
  const addedDepartmentIds = nextDepartmentIds.filter((id) => !currentDepartmentIds.includes(id));
  return {
    currentAssigneeIds,
    currentDepartmentIds,
    nextAssigneeIds,
    nextDepartmentIds,
    changed,
    addedAssigneeIds,
    addedDepartmentIds,
  };
}

export async function runTaskAssigneesInTx(params: {
  readonly tasksRepo: TasksRepository;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly input: ReplaceTaskAssigneesRequestInput;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<RunTaskAssigneesResult> {
  const target = await params.tasksRepo.findActiveById(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  assertCanViewTask(params.actor, toTaskVisibilitySubject(target));
  authorize(params.actor, 'task.assign');
  if (params.input.version !== undefined && target.version !== params.input.version) {
    throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
  }
  const next = computeNextAssignments(target, params.input);
  if (!next.changed) {
    return { task: target, eventId: null, addedDepartmentIds: [], addedAssigneeIds: [] };
  }
  const mutated = await params.tasksRepo.replaceAssigneesWithEvent(
    {
      id: params.taskId,
      boardId: target.boardId,
      actorId: params.actor.id,
      currentAssigneeIds: next.currentAssigneeIds,
      nextAssigneeIds: next.nextAssigneeIds,
      currentDepartmentIds: next.currentDepartmentIds,
      nextDepartmentIds: next.nextDepartmentIds,
      expectedVersion: params.input.version,
      now: params.now,
    },
    params.tx,
  );
  return {
    ...mutated,
    addedDepartmentIds: next.addedDepartmentIds,
    addedAssigneeIds: next.addedAssigneeIds,
  };
}

export async function runTaskMoveInTx(params: {
  readonly tasksRepo: TasksRepository;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly input: MoveTaskRequestInput;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<TaskOptionalEventMutationResult> {
  const target = await params.tasksRepo.findActiveById(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  assertCanEditTask(params.actor, toTaskVisibilitySubject(target));
  if (target.version !== params.input.version) {
    throw conflict('errors.taskVersionConflict', {}, 'TASK_VERSION_CONFLICT');
  }
  return params.tasksRepo.moveTaskWithEvent(
    {
      id: params.taskId,
      boardId: target.boardId,
      actor: params.actor,
      currentTask: target,
      destinationColumnId: params.input.columnId,
      beforeId: params.input.beforeId,
      afterId: params.input.afterId,
      expectedVersion: params.input.version,
      now: params.now,
    },
    params.tx,
  );
}
