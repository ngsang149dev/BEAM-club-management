import type { TaskMemberSummaryRecord } from '@/server/modules/tasks';
import type { TransactionContext } from '@/server/shared/transaction';
import type { CommentCursor } from './policy';

export interface CommentRecord {
  readonly id: string;
  readonly taskId: string;
  readonly userId: string;
  readonly author: TaskMemberSummaryRecord;
  readonly body: string;
  readonly createdAt: Date;
}

export interface RawCommentRow {
  readonly id: string;
  readonly taskId: string;
  readonly userId: string;
  readonly body: string;
  readonly createdAt: Date;
}

export interface ListCommentsRepoParams {
  readonly taskId: string;
  readonly cursor?: CommentCursor;
  readonly limit: number;
}

export interface CreateCommentRepoParams {
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly body: string;
  readonly now: Date;
}

export interface DeleteCommentRepoParams {
  readonly commentId: string;
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly now: Date;
}

export interface CommentMutationResult {
  readonly comment: CommentRecord;
  readonly eventId: string;
}

export interface DeleteCommentMutationResult {
  readonly id: string;
  readonly eventId: string;
}

export interface CommentsRepository {
  listByTaskId(
    params: ListCommentsRepoParams,
  ): Promise<{ readonly rows: CommentRecord[]; readonly hasMore: boolean }>;
  createCommentWithEvent(
    input: CreateCommentRepoParams,
    tx: TransactionContext,
  ): Promise<CommentMutationResult>;
  findByIdForUpdate(
    commentId: string,
    tx: TransactionContext,
  ): Promise<RawCommentRow | null>;
  deleteCommentWithEvent(
    input: DeleteCommentRepoParams,
    tx: TransactionContext,
  ): Promise<DeleteCommentMutationResult>;
}
