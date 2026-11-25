import { z } from 'zod';

export const DEFAULT_BOARD_COLUMN_NAMES = [
  'Todo',
  'Doing',
  'Review',
  'Done',
] as const;

export const boardNameSchema = z.string().trim().min(1).max(120);
export const columnNameSchema = z.string().trim().min(1).max(80);

export const createBoardRequestSchema = z
  .object({
    name: boardNameSchema,
    departmentId: z.uuid().nullable().optional(),
  })
  .strict();

export type CreateBoardRequestInput = z.infer<typeof createBoardRequestSchema>;

export const updateBoardRequestSchema = z
  .object({
    name: boardNameSchema.optional(),
    departmentId: z.uuid().nullable().optional(),
    unarchive: z.boolean().optional(),
  })
  .strict();

export type UpdateBoardRequestInput = z.infer<typeof updateBoardRequestSchema>;

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

function parseLimitInput(raw: unknown): unknown {
  const value = emptyToUndefined(raw);
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value.trim());
  }
  return Number.NaN;
}

export const listBoardsQuerySchema = z.object({
  departmentId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  includeArchived: z.preprocess(
    parseStrictBooleanInput,
    z.boolean().default(false),
  ),
  q: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(200).optional(),
  ),
  cursor: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(512).optional(),
  ),
  limit: z.preprocess(
    parseLimitInput,
    z.number().int().min(1).max(100).default(20),
  ),
});

export type ListBoardsQueryInput = z.infer<typeof listBoardsQuerySchema>;

export const createColumnRequestSchema = z
  .object({
    name: columnNameSchema,
    orderIndex: z.number().int().min(0).optional(),
  })
  .strict();

export type CreateColumnRequestInput = z.infer<
  typeof createColumnRequestSchema
>;

export const updateColumnRequestSchema = z
  .object({
    name: columnNameSchema,
  })
  .strict();

export type UpdateColumnRequestInput = z.infer<
  typeof updateColumnRequestSchema
>;

export const reorderColumnsRequestSchema = z
  .object({
    columnIds: z.array(z.uuid()).min(1),
  })
  .strict();

export type ReorderColumnsRequestInput = z.infer<
  typeof reorderColumnsRequestSchema
>;
