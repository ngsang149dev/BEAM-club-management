import { z } from 'zod';
import {
  defaultQueryLimitSchema,
  optionalCursorQuerySchema,
} from './query-params';

export const REVERTABLE_TASK_EVENT_TYPES = [
  'task.updated',
  'task.moved',
  'task.assignees_changed',
  'task.hidden_changed',
  'task.deleted',
  'task.restored',
] as const;

export type RevertableTaskEventType = (typeof REVERTABLE_TASK_EVENT_TYPES)[number];

export const NON_REVERTABLE_TASK_EVENT_TYPES = [
  'task.created',
  'task.accepted',
  'task.deliverable_added',
  'task.deliverable_removed',
  'comment.added',
  'comment.deleted',
] as const;

export type NonRevertableTaskEventType = (typeof NON_REVERTABLE_TASK_EVENT_TYPES)[number];

export type TaskEventType = RevertableTaskEventType | NonRevertableTaskEventType;

const REVERTABLE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(REVERTABLE_TASK_EVENT_TYPES);

export function isRevertableTaskEventType(type: string): type is RevertableTaskEventType {
  return REVERTABLE_EVENT_TYPE_SET.has(type);
}

export const listTaskEventsQuerySchema = z.object({
  cursor: optionalCursorQuerySchema,
  limit: defaultQueryLimitSchema,
});

export type ListTaskEventsQueryInput = z.infer<typeof listTaskEventsQuerySchema>;

export const listBoardTrashQuerySchema = z.object({
  cursor: optionalCursorQuerySchema,
  limit: defaultQueryLimitSchema,
});

export type ListBoardTrashQueryInput = z.infer<typeof listBoardTrashQuerySchema>;

export const revertTaskEventRequestSchema = z
  .object({
    force: z.boolean().default(false),
  })
  .strict();

export type RevertTaskEventRequestInput = z.infer<typeof revertTaskEventRequestSchema>;
