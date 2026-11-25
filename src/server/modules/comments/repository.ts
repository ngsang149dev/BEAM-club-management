import { and, asc, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { comments, departments, memberDepartments, profiles, taskEvents } from '@db/schema';
import { notFound } from '@/lib/errors';
import { buildUserSummariesMap, type TaskMemberSummaryRecord } from '@/server/modules/tasks';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import type {
  CommentMutationResult,
  CommentRecord,
  CommentsRepository,
  CreateCommentRepoParams,
  DeleteCommentMutationResult,
  DeleteCommentRepoParams,
  ListCommentsRepoParams,
  RawCommentRow,
} from './types';

function buildListWhere(params: ListCommentsRepoParams): SQL {
  if (!params.cursor) {
    return eq(comments.taskId, params.taskId);
  }
  const { createdAt, id } = params.cursor;
  return and(
    eq(comments.taskId, params.taskId),
    or(
      lt(comments.createdAt, createdAt),
      and(eq(comments.createdAt, createdAt), lt(comments.id, id)),
    ),
  )!;
}

export class DrizzleCommentsRepository implements CommentsRepository {
  constructor(private readonly db: DbExecutor) {}

  async listByTaskId(
    params: ListCommentsRepoParams,
  ): Promise<{ readonly rows: CommentRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db
      .select({
        id: comments.id,
        taskId: comments.taskId,
        userId: comments.userId,
        body: comments.body,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(buildListWhere(params))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(params.limit + 1);

    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    const rows = await this.hydrateComments(this.db, pageRows);
    return { rows, hasMore };
  }

  async createCommentWithEvent(
    input: CreateCommentRepoParams,
    tx: TransactionContext,
  ): Promise<CommentMutationResult> {
    const [created] = await tx
      .insert(comments)
      .values({
        taskId: input.taskId,
        userId: input.actorId,
        body: input.body,
        createdAt: input.now,
      })
      .returning({
        id: comments.id,
        taskId: comments.taskId,
        userId: comments.userId,
        body: comments.body,
        createdAt: comments.createdAt,
      });
    if (!created) throw new Error('Failed to insert comment');

    const [evt] = await tx
      .insert(taskEvents)
      .values({
        taskId: input.taskId,
        boardId: input.boardId,
        actorId: input.actorId,
        type: 'comment.added',
        changes: { comment_id: created.id },
        createdAt: input.now,
      })
      .returning({ id: taskEvents.id });
    if (!evt) throw new Error('Failed to record comment event');

    const [comment] = await this.hydrateComments(tx, [created]);
    if (!comment) throw new Error('Failed to hydrate comment author');
    return { comment, eventId: evt.id };
  }

  async findByIdForUpdate(
    commentId: string,
    tx: TransactionContext,
  ): Promise<RawCommentRow | null> {
    const rows = await tx
      .select({
        id: comments.id,
        taskId: comments.taskId,
        userId: comments.userId,
        body: comments.body,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(eq(comments.id, commentId))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteCommentWithEvent(
    input: DeleteCommentRepoParams,
    tx: TransactionContext,
  ): Promise<DeleteCommentMutationResult> {
    const [deleted] = await tx
      .delete(comments)
      .where(eq(comments.id, input.commentId))
      .returning({ id: comments.id });
    if (!deleted) throw notFound('errors.notFound', {}, 'NOT_FOUND');

    const [evt] = await tx
      .insert(taskEvents)
      .values({
        taskId: input.taskId,
        boardId: input.boardId,
        actorId: input.actorId,
        type: 'comment.deleted',
        changes: { comment_id: input.commentId },
        createdAt: input.now,
      })
      .returning({ id: taskEvents.id });
    if (!evt) throw new Error('Failed to record comment deletion event');

    return { id: input.commentId, eventId: evt.id };
  }

  private async hydrateComments(
    executor: DbExecutor,
    commentRows: readonly RawCommentRow[],
  ): Promise<CommentRecord[]> {
    if (commentRows.length === 0) return [];
    const userIds = Array.from(new Set(commentRows.map((row) => row.userId)));
    const userMap = await this.loadUserSummaries(executor, userIds);
    return commentRows.map((row) => {
      const author = userMap.get(row.userId);
      if (!author) throw new Error('Missing comment author profile');
      return { ...row, author };
    });
  }

  private async loadUserSummaries(
    executor: DbExecutor,
    userIds: readonly string[],
  ): Promise<Map<string, TaskMemberSummaryRecord>> {
    if (userIds.length === 0) return new Map();
    const [profileRows, deptRows] = await Promise.all([
      executor
        .select({
          id: profiles.id,
          fullName: profiles.fullName,
          avatarUpdatedAt: profiles.avatarUpdatedAt,
          isActive: profiles.isActive,
          leftAt: profiles.leftAt,
        })
        .from(profiles)
        .where(inArray(profiles.id, [...userIds])),
      executor
        .select({
          userId: memberDepartments.userId,
          id: departments.id,
          name: departments.name,
        })
        .from(memberDepartments)
        .innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
        .where(inArray(memberDepartments.userId, [...userIds]))
        .orderBy(asc(departments.name), asc(departments.id)),
    ]);
    return buildUserSummariesMap(profileRows, deptRows);
  }
}
