import type { CreateCommentRequestInput, ListCommentsQueryInput } from '@/lib/comments';
import { notFound } from '@/lib/errors';
import {
  assertActorActive,
  assertCanViewTask,
  type TasksRepository,
  toTaskVisibilitySubject,
} from '@/server/modules/tasks';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  type CommentPageResponseDto,
  type CreateCommentResponseDto,
  type DeleteCommentResponseDto,
  toCommentPageResponseDto,
  toCreateCommentResponseDto,
  toDeleteCommentResponseDto,
} from './mapper';
import {
  assertCanDeleteComment,
  decodeCommentCursor,
  encodeCommentCursor,
} from './policy';
import type { CommentsRepository } from './types';

export interface CommentsServiceDeps {
  readonly commentsRepo: CommentsRepository;
  readonly tasksRepo: Pick<TasksRepository, 'findActiveById'>;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class CommentsService {
  constructor(private readonly deps: CommentsServiceDeps) {}

  async listComments(
    actor: AuthActor,
    taskId: string,
    query: ListCommentsQueryInput,
  ): Promise<CommentPageResponseDto> {
    assertActorActive(actor);
    const task = await this.deps.tasksRepo.findActiveById(taskId);
    if (!task) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    assertCanViewTask(actor, toTaskVisibilitySubject(task));

    const cursor = query.cursor ? decodeCommentCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.commentsRepo.listByTaskId({
      taskId,
      cursor,
      limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCommentCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return toCommentPageResponseDto({
      items: rows,
      nextCursor,
      limit: query.limit,
    });
  }

  async createComment(
    actor: AuthActor,
    taskId: string,
    input: CreateCommentRequestInput,
  ): Promise<CreateCommentResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const task = await this.deps.tasksRepo.findActiveById(taskId, tx);
      if (!task) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      // Enforce visibility before comment.create so unauthorized probing of hidden tasks returns 404.
      assertCanViewTask(actor, toTaskVisibilitySubject(task));
      authorize(actor, 'comment.create');
      return this.deps.commentsRepo.createCommentWithEvent(
        {
          taskId,
          boardId: task.boardId,
          actorId: actor.id,
          body: input.body,
          now,
        },
        tx,
      );
    });
    this.deps.logger.info('Comment created', {
      actorId: actor.id,
      taskId,
      commentId: result.comment.id,
      eventId: result.eventId,
    });
    return toCreateCommentResponseDto(result);
  }

  async deleteComment(
    actor: AuthActor,
    commentId: string,
  ): Promise<DeleteCommentResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const { deleted, taskId } = await this.deps.transactionRunner.runInTransaction(
      async (tx) => {
        const comment = await this.deps.commentsRepo.findByIdForUpdate(commentId, tx);
        if (!comment) throw notFound('errors.notFound', {}, 'NOT_FOUND');
        const task = await this.deps.tasksRepo.findActiveById(comment.taskId, tx);
        if (!task) throw notFound('errors.notFound', {}, 'NOT_FOUND');
        // Enforce parent task visibility before delete permission so hidden tasks return 404.
        assertCanViewTask(actor, toTaskVisibilitySubject(task));
        assertCanDeleteComment(actor, comment);
        const mutation = await this.deps.commentsRepo.deleteCommentWithEvent(
          {
            commentId,
            taskId: task.id,
            boardId: task.boardId,
            actorId: actor.id,
            now,
          },
          tx,
        );
        return { deleted: mutation, taskId: task.id };
      },
    );
    this.deps.logger.info('Comment deleted', {
      actorId: actor.id,
      taskId,
      commentId,
      eventId: deleted.eventId,
    });
    return toDeleteCommentResponseDto(deleted);
  }
}
