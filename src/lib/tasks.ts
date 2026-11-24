import { z } from 'zod';

export const TASK_PRIORITIES = [1, 2, 3, 4] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_DUE_STATUSES = ['overdue', 'upcoming', 'no_due'] as const;
export type TaskDueStatus = (typeof TASK_DUE_STATUSES)[number];

export const TASK_SORT_BY_VALUES = [
  'position',
  'priority',
  'dueAt',
  'createdAt',
] as const;
export type TaskSortBy = (typeof TASK_SORT_BY_VALUES)[number];

export const TASK_SORT_ORDER_VALUES = ['asc', 'desc'] as const;
export type TaskSortOrder = (typeof TASK_SORT_ORDER_VALUES)[number];

export const taskTitleSchema = z.string().trim().min(1).max(200);
export const taskDescriptionSchema = z.string().max(10000).nullable();
export const taskPrioritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export const nullableIsoDateSchema = z.iso
  .datetime({ offset: true })
  .transform((iso) => new Date(iso))
  .nullable();

export const createTaskRequestSchema = z
  .object({
    boardId: z.uuid(),
    columnId: z.uuid(),
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional(),
    dueAt: nullableIsoDateSchema.optional(),
    priority: taskPrioritySchema.default(2),
    assigneeIds: z.array(z.uuid()).default([]),
    isHidden: z.boolean().default(false),
  })
  .strict();

export type CreateTaskRequestInput = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    dueAt: nullableIsoDateSchema.optional(),
    priority: taskPrioritySchema.optional(),
    version: z.number().int().min(1),
  })
  .strict();

export type UpdateTaskRequestInput = z.infer<typeof updateTaskRequestSchema>;

export const moveTaskRequestSchema = z
  .object({
    columnId: z.uuid(),
    beforeId: z.uuid().nullable().optional(),
    afterId: z.uuid().nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict();

export type MoveTaskRequestInput = z.infer<typeof moveTaskRequestSchema>;

export const replaceTaskAssigneesRequestSchema = z
  .object({
    assigneeIds: z.array(z.uuid()),
    version: z.number().int().min(1).optional(),
  })
  .strict();

export type ReplaceTaskAssigneesRequestInput = z.infer<
  typeof replaceTaskAssigneesRequestSchema
>;

function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

function parseStrictBooleanInput(raw: unknown): unknown {
  const value = emptyToUndefined(raw);
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return raw;
}

function parseIntegerInput(raw: unknown): unknown {
  const value = emptyToUndefined(raw);
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value.trim());
  }
  return Number.NaN;
}

const optionalUuidQuerySchema = z.preprocess(
  emptyToUndefined,
  z.uuid().optional(),
);

const optionalPriorityQuerySchema = z.preprocess(
  parseIntegerInput,
  taskPrioritySchema.optional(),
);

const optionalCursorQuerySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(512).optional(),
);

const queryLimitSchema = z.preprocess(
  parseIntegerInput,
  z.number().int().min(1).max(100).default(20),
);

export const listTasksQuerySchema = z.object({
  boardId: optionalUuidQuerySchema,
  columnId: optionalUuidQuerySchema,
  assigneeId: optionalUuidQuerySchema,
  priority: optionalPriorityQuerySchema,
  dueStatus: z.preprocess(emptyToUndefined, z.enum(TASK_DUE_STATUSES).optional()),
  q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200).optional()),
  sortBy: z.preprocess(
    emptyToUndefined,
    z.enum(TASK_SORT_BY_VALUES).default('position'),
  ),
  sortOrder: z.preprocess(
    emptyToUndefined,
    z.enum(TASK_SORT_ORDER_VALUES).default('asc'),
  ),
  cursor: optionalCursorQuerySchema,
  limit: queryLimitSchema,
});

export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;

export const listMyTasksQuerySchema = z.object({
  boardId: optionalUuidQuerySchema,
  q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200).optional()),
  includeDone: z.preprocess(
    parseStrictBooleanInput,
    z.boolean().default(false),
  ),
  priority: optionalPriorityQuerySchema,
  cursor: optionalCursorQuerySchema,
  limit: queryLimitSchema,
});

export type ListMyTasksQueryInput = z.infer<typeof listMyTasksQuerySchema>;

export function dedupeSortedUuids(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).sort();
}
