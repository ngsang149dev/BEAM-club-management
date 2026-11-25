import { z } from 'zod';
import { optionalCursorQuerySchema, parseIntegerInput } from './tasks';

export const COMMENT_BODY_MAX = 4000;

export const commentBodySchema = z.string().trim().min(1).max(COMMENT_BODY_MAX);

export const createCommentRequestSchema = z
  .object({
    body: commentBodySchema,
  })
  .strict();

export type CreateCommentRequestInput = z.infer<
  typeof createCommentRequestSchema
>;

export const listCommentsQuerySchema = z.object({
  cursor: optionalCursorQuerySchema,
  limit: z.preprocess(
    parseIntegerInput,
    z.number().int().min(1).max(100).default(20),
  ),
});

export type ListCommentsQueryInput = z.infer<typeof listCommentsQuerySchema>;
