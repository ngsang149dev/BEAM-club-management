import { z } from 'zod';
import {
  defaultQueryLimitSchema,
  emptyToUndefined,
  optionalCursorQuerySchema,
  optionalUuidQuerySchema,
  parseStrictBooleanInput,
} from './query-params';

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

export const listBoardsQuerySchema = z.object({
  departmentId: optionalUuidQuerySchema,
  includeArchived: z.preprocess(
    parseStrictBooleanInput,
    z.boolean().default(false),
  ),
  q: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(200).optional(),
  ),
  cursor: optionalCursorQuerySchema,
  limit: defaultQueryLimitSchema,
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
