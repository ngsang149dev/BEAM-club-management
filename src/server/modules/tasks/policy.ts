import { z } from 'zod';
import { badRequest, forbidden, notFound, unauthorized } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import {
  TASK_SORT_BY_VALUES,
  TASK_SORT_ORDER_VALUES,
  type TaskPriority,
  type TaskSortBy,
  type TaskSortOrder,
  type UpdateTaskRequestInput,
} from '@/lib/tasks';
import { type AuthActor, hasPermission } from '@/server/shared/authorize';

export interface TaskVisibilitySubject {
  readonly isHidden: boolean;
  readonly createdBy: string;
  readonly assigneeIds: readonly string[];
  readonly assignedDepartmentIds?: readonly string[];
}

export interface TaskListCursor {
  readonly sortBy: TaskSortBy;
  readonly sortOrder: TaskSortOrder;
  readonly value: string | number | null;
  readonly id: string;
}

export interface MyTasksCursor {
  readonly dueAt: Date | null;
  readonly priority: TaskPriority;
  readonly id: string;
}

export interface TaskFieldDiff<T> {
  readonly from: T;
  readonly to: T;
}

export interface TaskUpdateChanges {
  readonly title?: TaskFieldDiff<string>;
  readonly description?: TaskFieldDiff<string | null>;
  readonly due_at?: TaskFieldDiff<string | null>;
  readonly priority?: TaskFieldDiff<TaskPriority>;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });
const sortBySchema = z.enum(TASK_SORT_BY_VALUES);
const sortOrderSchema = z.enum(TASK_SORT_ORDER_VALUES);
const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/);

export function assertActorActive(actor: AuthActor): void {
  if (!actor.isActive) {
    throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
  }
}

export function isActorAssignedToTask(
  actor: AuthActor,
  task: TaskVisibilitySubject,
): boolean {
  if (task.assigneeIds.includes(actor.id)) return true;
  const actorDepts = actor.departmentIds ?? [];
  const taskDepts = task.assignedDepartmentIds ?? [];
  if (actorDepts.length === 0 || taskDepts.length === 0) return false;
  return taskDepts.some((deptId) => actorDepts.includes(deptId));
}

export function canViewTask(actor: AuthActor, task: TaskVisibilitySubject): boolean {
  if (!actor.isActive) return false;
  if (actor.isAdmin || !task.isHidden) return true;
  return task.createdBy === actor.id || isActorAssignedToTask(actor, task);
}

export function assertCanViewTask(actor: AuthActor, task: TaskVisibilitySubject): void {
  assertActorActive(actor);
  if (!canViewTask(actor, task)) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
}

export function canEditTask(actor: AuthActor, task: TaskVisibilitySubject): boolean {
  if (!canViewTask(actor, task)) return false;
  if (hasPermission(actor, 'task.update_any')) return true;
  return hasPermission(actor, 'task.update_assigned') && isActorAssignedToTask(actor, task);
}

export function assertCanEditTask(actor: AuthActor, task: TaskVisibilitySubject): void {
  assertCanViewTask(actor, task);
  if (!canEditTask(actor, task)) {
    throw forbidden('errors.forbidden', { requiredPermission: 'task.update_any' });
  }
}

export function canToggleTaskHidden(
  actor: AuthActor,
  task: { readonly createdBy: string },
): boolean {
  return actor.isActive && (actor.isAdmin || task.createdBy === actor.id);
}

export function encodeTaskCursor(cursor: TaskListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function validatePositionValue(value: unknown): string {
  const parsed = decimalStringSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error('Invalid position cursor');
}

function validatePriorityValue(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4) {
    return value;
  }
  throw new Error('Invalid priority cursor');
}

function validateTaskCursorValue(sortBy: TaskSortBy, value: unknown): string | number | null {
  if (sortBy === 'position') return validatePositionValue(value);
  if (sortBy === 'priority') return validatePriorityValue(value);
  if (sortBy === 'dueAt' && value === null) return null;
  const iso = isoTimestampSchema.safeParse(value);
  if (!iso.success) throw new Error('Invalid date cursor');
  return iso.data;
}

export function decodeTaskCursor(
  raw: string,
  expectedSortBy: TaskSortBy,
  expectedSortOrder: TaskSortOrder,
): TaskListCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
      throw new Error('Non-canonical base64url cursor');
    }
    const parsed = JSON.parse(decoded) as {
      sortBy?: unknown;
      sortOrder?: unknown;
      value?: unknown;
      id?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor object');
    const sortBy = sortBySchema.parse(parsed.sortBy);
    const sortOrder = sortOrderSchema.parse(parsed.sortOrder);
    if (sortBy !== expectedSortBy || sortOrder !== expectedSortOrder) {
      throw new Error('Cursor sort mismatch');
    }
    const id = uuidSchema.parse(parsed.id);
    const value = validateTaskCursorValue(sortBy, parsed.value);
    return { sortBy, sortOrder, value, id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function encodeMyTasksCursor(cursor: MyTasksCursor): string {
  return Buffer.from(
    JSON.stringify({
      dueAt: cursor.dueAt ? cursor.dueAt.toISOString() : null,
      priority: cursor.priority,
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeMyTasksCursor(raw: string): MyTasksCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
      throw new Error('Non-canonical base64url cursor');
    }
    const parsed = JSON.parse(decoded) as {
      dueAt?: unknown;
      priority?: unknown;
      id?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor object');
    const dueAt =
      parsed.dueAt === null ? null : new Date(isoTimestampSchema.parse(parsed.dueAt));
    if (
      typeof parsed.priority !== 'number' ||
      !Number.isInteger(parsed.priority) ||
      parsed.priority < 1 ||
      parsed.priority > 4
    ) {
      throw new Error('Invalid priority');
    }
    const id = uuidSchema.parse(parsed.id);
    return { dueAt, priority: parsed.priority as TaskPriority, id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

function computeDueAtDiff(
  currentDueAt: Date | null,
  nextDueAt: Date | null,
): TaskFieldDiff<string | null> | undefined {
  const currentIso = currentDueAt ? currentDueAt.toISOString() : null;
  const nextIso = nextDueAt ? nextDueAt.toISOString() : null;
  return nextIso !== currentIso ? { from: currentIso, to: nextIso } : undefined;
}

export function buildTaskUpdateChanges(
  current: {
    readonly title: string;
    readonly description: string | null;
    readonly dueAt: Date | null;
    readonly priority: TaskPriority;
  },
  input: UpdateTaskRequestInput,
): TaskUpdateChanges {
  const changes: {
    title?: TaskFieldDiff<string>;
    description?: TaskFieldDiff<string | null>;
    due_at?: TaskFieldDiff<string | null>;
    priority?: TaskFieldDiff<TaskPriority>;
  } = {};

  if (input.title !== undefined && input.title !== current.title) {
    changes.title = { from: current.title, to: input.title };
  }
  if (input.description !== undefined && input.description !== current.description) {
    changes.description = { from: current.description, to: input.description };
  }
  if (input.dueAt !== undefined) {
    const dueDiff = computeDueAtDiff(current.dueAt, input.dueAt);
    if (dueDiff) changes.due_at = dueDiff;
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    changes.priority = { from: current.priority, to: input.priority };
  }
  return changes;
}

export function hasTaskChanges(changes: TaskUpdateChanges): boolean {
  return Object.keys(changes).length > 0;
}

export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
