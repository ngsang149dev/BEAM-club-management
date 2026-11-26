import { z } from 'zod';
import { taskPrioritySchema } from '@/lib/tasks';
import { assertValidDateRange, type TaskRecord } from '@/server/modules/tasks';
import type {
  RevertPersistencePlan,
  RevertTaskPatch,
  TaskUpdatedChangesPayload,
} from './types';

const isoSchema = z.iso.datetime({ offset: true });

export const updatedEventChangesSchema = z.object({
  title: z.object({ from: z.string(), to: z.string() }).optional(),
  description: z.object({ from: z.string().nullable(), to: z.string().nullable() }).optional(),
  start_at: z.object({ from: isoSchema.nullable(), to: isoSchema.nullable() }).optional(),
  due_at: z.object({ from: isoSchema.nullable(), to: isoSchema.nullable() }).optional(),
  is_completed: z.object({ from: z.boolean(), to: z.boolean() }).optional(),
  priority: z.object({ from: taskPrioritySchema, to: taskPrioritySchema }).optional(),
});

function sameTimestampMs(actual: Date, expectedIso: string): boolean {
  // Allow 1ms tolerance for Postgres timestamptz microsecond/JS millisecond round-trips.
  return Math.abs(actual.getTime() - new Date(expectedIso).getTime()) <= 1;
}

function sameNullableTimestamp(actual: Date | null, expectedIso: string | null): boolean {
  if (actual === null && expectedIso === null) return true;
  if (actual === null || expectedIso === null) return false;
  return sameTimestampMs(actual, expectedIso);
}

export function detectUpdatedConflicts(
  task: TaskRecord,
  parsed: TaskUpdatedChangesPayload,
): string[] {
  const checks: ReadonlyArray<readonly [string, boolean]> = [
    ['title', Boolean(parsed.title && task.title !== parsed.title.to)],
    ['description', Boolean(parsed.description && task.description !== parsed.description.to)],
    ['start_at', Boolean(parsed.start_at && !sameNullableTimestamp(task.startAt, parsed.start_at.to))],
    ['due_at', Boolean(parsed.due_at && !sameNullableTimestamp(task.dueAt, parsed.due_at.to))],
    ['is_completed', Boolean(parsed.is_completed && task.isCompleted !== parsed.is_completed.to)],
    ['priority', Boolean(parsed.priority && task.priority !== parsed.priority.to)],
  ];
  return checks.filter(([, hit]) => hit).map(([field]) => field);
}

function applyDateDiff(
  current: Date | null,
  diff: { readonly from: string | null; readonly to: string | null },
) {
  const nextDate = diff.from === null ? null : new Date(diff.from);
  return {
    nextDate,
    change: { from: current ? current.toISOString() : null, to: nextDate ? nextDate.toISOString() : null },
  };
}

function applyScalarUpdatedDiffs(params: {
  readonly task: TaskRecord;
  readonly parsed: TaskUpdatedChangesPayload;
  readonly now: Date;
  readonly patch: Record<string, unknown>;
  readonly changes: Record<string, unknown>;
}): void {
  const { task, parsed, now, patch, changes } = params;
  if (parsed.title) {
    patch.title = parsed.title.from;
    changes.title = { from: task.title, to: parsed.title.from };
  }
  if (parsed.description) {
    patch.description = parsed.description.from;
    changes.description = { from: task.description, to: parsed.description.from };
  }
  if (parsed.is_completed) {
    patch.isCompleted = parsed.is_completed.from;
    patch.completedAt = parsed.is_completed.from ? now : null;
    changes.is_completed = { from: task.isCompleted, to: parsed.is_completed.from };
  }
  if (parsed.priority) {
    patch.priority = parsed.priority.from;
    changes.priority = { from: task.priority, to: parsed.priority.from };
  }
}

export function buildUpdatedPlan(
  task: TaskRecord,
  parsed: TaskUpdatedChangesPayload,
  now: Date,
): RevertPersistencePlan {
  const patch: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};
  applyScalarUpdatedDiffs({ task, parsed, now, patch, changes });
  if (parsed.start_at) {
    const startDiff = applyDateDiff(task.startAt, parsed.start_at);
    patch.startAt = startDiff.nextDate;
    changes.start_at = startDiff.change;
  }
  if (parsed.due_at) {
    const dueDiff = applyDateDiff(task.dueAt, parsed.due_at);
    patch.dueAt = dueDiff.nextDate;
    changes.due_at = dueDiff.change;
  }
  const nextStart = patch.startAt !== undefined ? (patch.startAt as Date | null) : task.startAt;
  const nextDue = patch.dueAt !== undefined ? (patch.dueAt as Date | null) : task.dueAt;
  assertValidDateRange(nextStart, nextDue);
  return { taskPatch: patch as RevertTaskPatch, compensatingType: 'task.updated', compensatingChanges: changes };
}
