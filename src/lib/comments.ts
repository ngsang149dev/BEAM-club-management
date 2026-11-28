import { z } from 'zod';
import {
  defaultQueryLimitSchema,
  optionalCursorQuerySchema,
} from './query-params';

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
  limit: defaultQueryLimitSchema,
});

export type ListCommentsQueryInput = z.infer<typeof listCommentsQuerySchema>;
