import {
  type TaskMemberPublicSummaryDto,
  toTaskMemberPublicSummaryDto,
} from '@/server/modules/tasks';
import type {
  CommentMutationResult,
  CommentRecord,
  DeleteCommentMutationResult,
} from './types';

export interface CommentDto {
  readonly id: string;
  readonly taskId: string;
  readonly author: TaskMemberPublicSummaryDto;
  readonly body: string;
  readonly createdAt: string;
}

export interface CommentPageMetaDto {
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface CommentPageResponseDto {
  readonly items: CommentDto[];
  readonly meta: CommentPageMetaDto;
}

export interface CreateCommentResponseDto {
  readonly comment: CommentDto;
  readonly eventId: string;
}

export interface DeleteCommentResponseDto {
  readonly deleted: boolean;
  readonly id: string;
  readonly eventId: string;
}

export function toCommentDto(record: CommentRecord): CommentDto {
  return {
    id: record.id,
    taskId: record.taskId,
    author: toTaskMemberPublicSummaryDto(record.author),
    body: record.body,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toCommentPageResponseDto(input: {
  readonly items: readonly CommentRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}): CommentPageResponseDto {
  return {
    items: input.items.map(toCommentDto),
    meta: { nextCursor: input.nextCursor, limit: input.limit },
  };
}

export function toCreateCommentResponseDto(
  result: CommentMutationResult,
): CreateCommentResponseDto {
  return {
    comment: toCommentDto(result.comment),
    eventId: result.eventId,
  };
}

export function toDeleteCommentResponseDto(
  result: DeleteCommentMutationResult,
): DeleteCommentResponseDto {
  return {
    deleted: true,
    id: result.id,
    eventId: result.eventId,
  };
}
