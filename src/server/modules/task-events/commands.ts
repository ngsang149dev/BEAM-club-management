import { z } from 'zod';
import { badRequest, conflict, forbidden } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import { isRevertableTaskEventType, type RevertableTaskEventType } from '@/lib/task-events';
import { dedupeSortedUuids } from '@/lib/tasks';
import {
  assertCanEditTask,
  canToggleTaskHidden,
  type TaskRecord,
  toTaskVisibilitySubject,
} from '@/server/modules/tasks';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import { sameSortedStringSets } from './policy';
import type {
  RevertPersistencePlan,
  RevertResolvedTargets,
  RevertTargetIntent,
  TaskEventContext,
} from './types';
import {
  buildUpdatedPlan,
  detectUpdatedConflicts,
  updatedEventChangesSchema,
} from './updated-command';

const isoSchema = z.iso.datetime({ offset: true });
const numSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number),
]);
const uuidListDiff = z.object({ from: z.array(uuidSchema), to: z.array(uuidSchema) });
const movedSchema = z.object({
  column_id: z.object({ from: uuidSchema.nullable(), to: uuidSchema }),
  position: z.object({ from: numSchema, to: numSchema }),
});
const assigneesSchema = z.object({
  assignee_ids: uuidListDiff.optional(),
  department_ids: uuidListDiff.optional(),
});
const hiddenSchema = z.object({ is_hidden: z.object({ from: z.boolean(), to: z.boolean() }) });
const deletedSchema = z.object({
  deleted_at: z.object({ from: isoSchema.nullable(), to: isoSchema }),
});
const restoredSchema = z.object({
  deleted_at: z.object({ from: isoSchema.nullable(), to: z.null() }),
  column_id: z.object({ from: uuidSchema.nullable(), to: uuidSchema }).optional(),
});

export interface TaskEventCommand {
  readonly type: RevertableTaskEventType;
  authorize(actor: AuthActor, task: TaskRecord): void;
  checkState(context: TaskEventContext): void;
  detectConflicts(task: TaskRecord, changes: Record<string, unknown>): string[];
  invert(task: TaskRecord, changes: Record<string, unknown>): RevertTargetIntent;
  apply(params: {
    readonly task: TaskRecord;
    readonly intent: RevertTargetIntent;
    readonly resolved: RevertResolvedTargets;
    readonly now: Date;
  }): RevertPersistencePlan;
}

function parseChanges<T>(schema: z.ZodType<T>, changes: Record<string, unknown>): T {
  const parsed = schema.safeParse(changes);
  if (!parsed.success) throw badRequest('errors.badRequest', {}, 'INVALID_EVENT_CHANGES');
  return parsed.data;
}

function sameTimestampMs(actual: Date, expectedIso: string): boolean {
  // Allow 1ms tolerance for Postgres timestamptz microsecond/JS millisecond round-trips.
  return Math.abs(actual.getTime() - new Date(expectedIso).getTime()) <= 1;
}

function assertNotSoftDeleted(context: TaskEventContext): void {
  if (context.task.deletedAt !== null) {
    throw conflict('errors.taskDeletedConflict', {}, 'TASK_DELETED');
  }
}

function detectAssigneesConflicts(task: TaskRecord, parsed: z.infer<typeof assigneesSchema>): string[] {
  const conflicts: string[] = [];
  if (parsed.assignee_ids && !sameSortedStringSets(dedupeSortedUuids(task.assignees.map((a) => a.id)), dedupeSortedUuids(parsed.assignee_ids.to))) {
    conflicts.push('assignee_ids');
  }
  if (parsed.department_ids && !sameSortedStringSets(dedupeSortedUuids(task.assignedDepartments.map((d) => d.id)), dedupeSortedUuids(parsed.department_ids.to))) {
    conflicts.push('department_ids');
  }
  return conflicts;
}

function buildAssigneesPlan(
  task: TaskRecord,
  intent: RevertTargetIntent,
  resolved: RevertResolvedTargets,
): RevertPersistencePlan {
  const changes: Record<string, unknown> = {};
  const replaceAssigneeIds = intent.desiredAssigneeIds !== undefined ? (resolved.validAssigneeIds ?? []) : undefined;
  const replaceDepartmentIds = intent.desiredDepartmentIds !== undefined ? (resolved.validDepartmentIds ?? []) : undefined;
  if (replaceAssigneeIds !== undefined) {
    changes.assignee_ids = { from: dedupeSortedUuids(task.assignees.map((a) => a.id)), to: replaceAssigneeIds };
  }
  if (replaceDepartmentIds !== undefined) {
    changes.department_ids = { from: dedupeSortedUuids(task.assignedDepartments.map((d) => d.id)), to: replaceDepartmentIds };
  }
  return {
    taskPatch: {},
    replaceAssigneeIds,
    replaceDepartmentIds,
    compensatingType: 'task.assignees_changed',
    compensatingChanges: changes,
  };
}

const taskUpdatedCommand: TaskEventCommand = {
  type: 'task.updated',
  authorize: (actor, task) => assertCanEditTask(actor, toTaskVisibilitySubject(task)),
  checkState: assertNotSoftDeleted,
  detectConflicts: (task, changes) =>
    detectUpdatedConflicts(task, parseChanges(updatedEventChangesSchema, changes)),
  invert: (_task, changes) => ({ updatedChanges: parseChanges(updatedEventChangesSchema, changes) }),
  apply: ({ task, intent, now }) => buildUpdatedPlan(task, intent.updatedChanges ?? {}, now),
};

const taskMovedCommand: TaskEventCommand = {
  type: 'task.moved',
  authorize: (actor, task) => assertCanEditTask(actor, toTaskVisibilitySubject(task)),
  checkState: assertNotSoftDeleted,
  detectConflicts: (task, changes) => {
    const parsed = parseChanges(movedSchema, changes);
    const conflicts: string[] = [];
    if (task.columnId !== parsed.column_id.to) conflicts.push('column_id');
    if (Number(task.position) !== Number(parsed.position.to)) conflicts.push('position');
    return conflicts;
  },
  invert: (_task, changes) => {
    const parsed = parseChanges(movedSchema, changes);
    return { columnLookup: { desiredColumnId: parsed.column_id.from, desiredPosition: parsed.position.from } };
  },
  apply: ({ task, resolved }) => ({
    taskPatch: { columnId: resolved.column!.columnId, position: String(resolved.column!.position) },
    compensatingType: 'task.moved',
    compensatingChanges: {
      column_id: { from: task.columnId, to: resolved.column!.columnId },
      position: { from: Number(task.position), to: resolved.column!.position },
    },
  }),
};

const taskAssigneesChangedCommand: TaskEventCommand = {
  type: 'task.assignees_changed',
  authorize: (actor) => authorize(actor, 'task.assign'),
  checkState: assertNotSoftDeleted,
  detectConflicts: (task, changes) => detectAssigneesConflicts(task, parseChanges(assigneesSchema, changes)),
  invert: (_task, changes) => {
    const parsed = parseChanges(assigneesSchema, changes);
    return {
      desiredAssigneeIds: parsed.assignee_ids ? dedupeSortedUuids(parsed.assignee_ids.from) : undefined,
      desiredDepartmentIds: parsed.department_ids ? dedupeSortedUuids(parsed.department_ids.from) : undefined,
    };
  },
  apply: ({ task, intent, resolved }) => buildAssigneesPlan(task, intent, resolved),
};

const taskHiddenChangedCommand: TaskEventCommand = {
  type: 'task.hidden_changed',
  authorize: (actor, task) => {
    if (!canToggleTaskHidden(actor, task)) {
      throw forbidden('errors.forbidden', { requiredRole: 'creator_or_admin' });
    }
  },
  checkState: assertNotSoftDeleted,
  detectConflicts: (task, changes) =>
    task.isHidden !== parseChanges(hiddenSchema, changes).is_hidden.to ? ['is_hidden'] : [],
  invert: (_task, changes) => ({ nextIsHidden: parseChanges(hiddenSchema, changes).is_hidden.from }),
  apply: ({ task, intent }) => ({
    taskPatch: { isHidden: intent.nextIsHidden },
    compensatingType: 'task.hidden_changed',
    compensatingChanges: { is_hidden: { from: task.isHidden, to: intent.nextIsHidden } },
  }),
};

const taskDeletedCommand: TaskEventCommand = {
  type: 'task.deleted',
  authorize: (actor) => authorize(actor, 'task.delete'),
  checkState: (context) => {
    if (context.boardArchivedAt !== null) throw conflict('errors.boardArchived', {}, 'BOARD_ARCHIVED');
  },
  detectConflicts: (task, changes) => {
    const parsed = parseChanges(deletedSchema, changes);
    return task.deletedAt === null || !sameTimestampMs(task.deletedAt, parsed.deleted_at.to) ? ['deleted_at'] : [];
  },
  invert: (task) => ({ columnLookup: { desiredColumnId: task.columnId, desiredPosition: Number(task.position) } }),
  apply: ({ task, resolved }) => ({
    taskPatch: { deletedAt: null, columnId: resolved.column!.columnId, position: String(resolved.column!.position) },
    compensatingType: 'task.restored',
    compensatingChanges: {
      deleted_at: { from: task.deletedAt ? task.deletedAt.toISOString() : null, to: null },
      column_id: { from: task.columnId, to: resolved.column!.columnId },
    },
  }),
};

const taskRestoredCommand: TaskEventCommand = {
  type: 'task.restored',
  authorize: (actor) => authorize(actor, 'task.delete'),
  checkState: assertNotSoftDeleted,
  detectConflicts: (task, changes) => {
    const parsed = parseChanges(restoredSchema, changes);
    const conflicts: string[] = [];
    if (task.deletedAt !== null) conflicts.push('deleted_at');
    if (parsed.column_id && task.columnId !== parsed.column_id.to) conflicts.push('column_id');
    return conflicts;
  },
  invert: () => ({}),
  apply: ({ now }) => ({
    taskPatch: { deletedAt: now },
    compensatingType: 'task.deleted',
    compensatingChanges: { deleted_at: { from: null, to: now.toISOString() } },
  }),
};

export const TASK_EVENT_COMMAND_REGISTRY: Readonly<Record<RevertableTaskEventType, TaskEventCommand>> = {
  'task.updated': taskUpdatedCommand,
  'task.moved': taskMovedCommand,
  'task.assignees_changed': taskAssigneesChangedCommand,
  'task.hidden_changed': taskHiddenChangedCommand,
  'task.deleted': taskDeletedCommand,
  'task.restored': taskRestoredCommand,
};

export function getRevertCommand(type: string): TaskEventCommand | null {
  return isRevertableTaskEventType(type) ? TASK_EVENT_COMMAND_REGISTRY[type] : null;
}
