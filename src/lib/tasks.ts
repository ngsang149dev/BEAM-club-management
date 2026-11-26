import { z } from 'zod';

export const TASK_PRIORITIES = [1, 2, 3, 4] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_DUE_STATUSES = ['overdue', 'upcoming', 'no_due'] as const;
export type TaskDueStatus = (typeof TASK_DUE_STATUSES)[number];

export const TASK_DEADLINE_STATUSES = [
  'overdue',
  'urgent',
  'soon',
  'safe',
  'done',
] as const;
export type TaskDeadlineStatus = (typeof TASK_DEADLINE_STATUSES)[number];

export const DELIVERABLE_TITLE_MAX = 160;
export const DELIVERABLE_URL_MIN = 8;
export const DELIVERABLE_URL_MAX = 2048;
export const MAX_DELIVERABLES_PER_TASK = 30;
const CONTROL_OR_WHITESPACE_RE = /[\u0000-\u0020\u007F]/;

function isValidHttpDeliverableUrl(value: string): boolean {
  if (CONTROL_OR_WHITESPACE_RE.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const deliverableUrlSchema = z
  .string()
  .trim()
  .min(DELIVERABLE_URL_MIN, 'errors.invalidDeliverableUrl')
  .max(DELIVERABLE_URL_MAX, 'errors.invalidDeliverableUrl')
  .refine(isValidHttpDeliverableUrl, {
    message: 'errors.invalidDeliverableUrl',
  });

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
    boardId: z.uuid().optional(),
    columnId: z.uuid().optional(),
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional(),
    startAt: nullableIsoDateSchema.optional(),
    dueAt: nullableIsoDateSchema.optional(),
    priority: taskPrioritySchema.default(2),
    assigneeIds: z.array(z.uuid()).default([]),
    departmentIds: z.array(z.uuid()).default([]),
    notifyDepartmentMembers: z.boolean().default(true),
    notifyInApp: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
    isHidden: z.boolean().default(false),
  })
  .strict()
  .refine(
    (d) =>
      (d.boardId === undefined && d.columnId === undefined) ||
      (d.boardId !== undefined && d.columnId !== undefined),
    {
      message: 'boardId and columnId must both be provided or both omitted',
      path: ['boardId'],
    },
  )
  .refine((d) => !(d.startAt && d.dueAt && d.startAt > d.dueAt), {
    message: 'errors.invalidDateRange',
    path: ['dueAt'],
  });

export type CreateTaskRequestInput = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    startAt: nullableIsoDateSchema.optional(),
    dueAt: nullableIsoDateSchema.optional(),
    isCompleted: z.boolean().optional(),
    priority: taskPrioritySchema.optional(),
    version: z.number().int().min(1),
  })
  .strict();

export type UpdateTaskRequestInput = z.infer<typeof updateTaskRequestSchema>;

export const updateTaskAcceptanceRequestSchema = z
  .object({
    accepted: z.boolean(),
  })
  .strict();

export type UpdateTaskAcceptanceRequestInput = z.infer<
  typeof updateTaskAcceptanceRequestSchema
>;

export const createTaskDeliverableRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(DELIVERABLE_TITLE_MAX),
    url: deliverableUrlSchema,
  })
  .strict();

export type CreateTaskDeliverableRequestInput = z.infer<
  typeof createTaskDeliverableRequestSchema
>;

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
    assigneeIds: z.array(z.uuid()).optional(),
    departmentIds: z.array(z.uuid()).optional(),
    notifyDepartmentMembers: z.boolean().default(true),
    notifyInApp: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (val) => val.assigneeIds !== undefined || val.departmentIds !== undefined,
    {
      message: 'At least one of assigneeIds or departmentIds is required',
      path: ['assigneeIds'],
    },
  );

export type ReplaceTaskAssigneesRequestInput = z.infer<
  typeof replaceTaskAssigneesRequestSchema
>;

export const updateTaskHiddenRequestSchema = z
  .object({
    isHidden: z.boolean(),
    version: z.number().int().min(1).optional(),
  })
  .strict();

export type UpdateTaskHiddenRequestInput = z.infer<
  typeof updateTaskHiddenRequestSchema
>;

export interface TaskNotificationChannels {
  readonly notifyInApp: boolean;
  readonly notifyEmail: boolean;
}

export function resolveTaskNotificationChannels(input: {
  readonly notifyDepartmentMembers?: boolean;
  readonly notifyInApp?: boolean;
  readonly notifyEmail?: boolean;
}): TaskNotificationChannels {
  const fallback = input.notifyDepartmentMembers ?? true;
  return {
    notifyInApp: input.notifyInApp ?? fallback,
    notifyEmail: input.notifyEmail ?? fallback,
  };
}

export function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

export function parseStrictBooleanInput(raw: unknown): unknown {
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

export function parseIntegerInput(raw: unknown): unknown {
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

export const optionalCursorQuerySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(512).optional(),
);

const optionalIsoDateQuerySchema = z.preprocess(
  emptyToUndefined,
  z.iso
    .datetime({ offset: true })
    .transform((iso) => new Date(iso))
    .optional(),
);

const queryLimitSchema = z.preprocess(
  parseIntegerInput,
  z.number().int().min(1).max(100).default(20),
);

const calendarTasksLimitSchema = z.preprocess(
  parseIntegerInput,
  z.number().int().min(1).max(200).default(20),
);

export const listTasksQuerySchema = z
  .object({
    boardId: optionalUuidQuerySchema,
    columnId: optionalUuidQuerySchema,
    assigneeId: optionalUuidQuerySchema,
    departmentId: optionalUuidQuerySchema,
    priority: optionalPriorityQuerySchema,
    dueStatus: z.preprocess(emptyToUndefined, z.enum(TASK_DUE_STATUSES).optional()),
    deadlineStatus: z.preprocess(
      emptyToUndefined,
      z.enum(TASK_DEADLINE_STATUSES).optional(),
    ),
    from: optionalIsoDateQuerySchema,
    to: optionalIsoDateQuerySchema,
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
    limit: calendarTasksLimitSchema,
  })
  .refine(
    (data) => !data.from || !data.to || data.from.getTime() <= data.to.getTime(),
    { message: 'errors.invalidDateRange', path: ['from'] },
  );

export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;

export const listMyTasksQuerySchema = z.object({
  boardId: optionalUuidQuerySchema,
  departmentId: optionalUuidQuerySchema,
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
