import { describe, expect, it } from 'vitest';
import {
  COMMENT_BODY_MAX,
  createCommentRequestSchema,
  listCommentsQuerySchema,
} from '@/lib/comments';
import {
  assertCanDeleteComment,
  canDeleteComment,
  type CommentMutationResult,
  type CommentRecord,
  type CommentsRepository,
  CommentsService,
  type CreateCommentRepoParams,
  decodeCommentCursor,
  type DeleteCommentMutationResult,
  type DeleteCommentRepoParams,
  encodeCommentCursor,
  type ListCommentsRepoParams,
  type RawCommentRow,
} from '@/server/modules/comments';
import type { TaskRecord, TasksRepository } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const BOARD_ID = '40000000-0000-4000-8000-000000000001';
const COL_ID = '50000000-0000-4000-8000-000000000001';
const TASK_PUBLIC = '60000000-0000-4000-8000-000000000001';
const TASK_HIDDEN = '60000000-0000-4000-8000-000000000002';
const TASK_DELETED = '60000000-0000-4000-8000-000000000003';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const CREATOR_ID = '10000000-0000-4000-8000-000000000010';
const ASSIGNEE_ID = '10000000-0000-4000-8000-000000000011';
const COMMENTER_ID = '10000000-0000-4000-8000-000000000012';
const DELETE_ANY_ID = '10000000-0000-4000-8000-000000000013';
const NO_PERM_ID = '10000000-0000-4000-8000-000000000014';

function makeMember(id: string, fullName: string, isActive = true) {
  return {
    id,
    fullName,
    avatarUpdatedAt: null,
    isActive,
    leftAt: isActive ? null : new Date('2026-10-01T00:00:00.000Z'),
    departments: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Media' }],
  };
}

class InMemoryCommentsRepository implements CommentsRepository {
  readonly records = new Map<string, CommentRecord>();
  readonly events: Array<{ readonly type: string; readonly commentId: string }> = [];
  private seq = 0;

  async listByTaskId(
    params: ListCommentsRepoParams,
  ): Promise<{ readonly rows: CommentRecord[]; readonly hasMore: boolean }> {
    const ordered = Array.from(this.records.values())
      .filter((c) => c.taskId === params.taskId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
      );
    const filtered = params.cursor
      ? ordered.filter(
          (c) =>
            c.createdAt.getTime() < params.cursor!.createdAt.getTime() ||
            (c.createdAt.getTime() === params.cursor!.createdAt.getTime() &&
              c.id < params.cursor!.id),
        )
      : ordered;
    const hasMore = filtered.length > params.limit;
    return {
      rows: hasMore ? filtered.slice(0, params.limit) : filtered,
      hasMore,
    };
  }

  async createCommentWithEvent(
    input: CreateCommentRepoParams,
  ): Promise<CommentMutationResult> {
    this.seq += 1;
    const id = `70000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    const eventId = `80000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    const comment: CommentRecord = {
      id,
      taskId: input.taskId,
      userId: input.actorId,
      author: makeMember(input.actorId, `Member ${input.actorId.slice(-2)}`),
      body: input.body,
      createdAt: input.now,
    };
    this.records.set(id, comment);
    this.events.push({ type: 'comment.added', commentId: id });
    return { comment, eventId };
  }

  async findByIdForUpdate(commentId: string): Promise<RawCommentRow | null> {
    const rec = this.records.get(commentId);
    if (!rec) return null;
    return {
      id: rec.id,
      taskId: rec.taskId,
      userId: rec.userId,
      body: rec.body,
      createdAt: rec.createdAt,
    };
  }

  async deleteCommentWithEvent(
    input: DeleteCommentRepoParams,
  ): Promise<DeleteCommentMutationResult> {
    this.seq += 1;
    this.records.delete(input.commentId);
    const eventId = `80000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    this.events.push({ type: 'comment.deleted', commentId: input.commentId });
    return { id: input.commentId, eventId };
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

function createHarness() {
  const clock = new FakeClock('2026-11-26T04:00:00.000Z');
  const now = clock.now();
  const taskMap = new Map<string, TaskRecord>([
    [
      TASK_PUBLIC,
      {
        id: TASK_PUBLIC,
        boardId: BOARD_ID,
        columnId: COL_ID,
        title: 'Public Task',
        description: null,
        dueAt: null,
        priority: 2,
        position: '1000',
        isHidden: false,
        version: 1,
        deletedAt: null,
        createdBy: CREATOR_ID,
        assignees: [makeMember(ASSIGNEE_ID, 'Assignee')],
        assignedDepartments: [],
        creator: makeMember(CREATOR_ID, 'Creator'),
        commentCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [
      TASK_HIDDEN,
      {
        id: TASK_HIDDEN,
        boardId: BOARD_ID,
        columnId: COL_ID,
        title: 'Hidden Task',
        description: null,
        dueAt: null,
        priority: 3,
        position: '2000',
        isHidden: true,
        version: 1,
        deletedAt: null,
        createdBy: CREATOR_ID,
        assignees: [makeMember(ASSIGNEE_ID, 'Assignee')],
        assignedDepartments: [],
        creator: makeMember(CREATOR_ID, 'Creator'),
        commentCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
  ]);

  const tasksRepo: Pick<TasksRepository, 'findActiveById'> = {
    findActiveById: async (taskId) => {
      const rec = taskMap.get(taskId);
      return rec && rec.deletedAt === null ? rec : null;
    },
  };
  const commentsRepo = new InMemoryCommentsRepository();
  const logs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => logs.push(line),
    writeErr: (line) => logs.push(line),
  });
  const service = new CommentsService({
    commentsRepo,
    tasksRepo,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
  });

  return { clock, commentsRepo, taskMap, service, logs };
}

const ADMIN: AuthActor = { id: ADMIN_ID, isActive: true, isAdmin: true, permissions: [] };
const INACTIVE: AuthActor = { id: COMMENTER_ID, isActive: false, isAdmin: true, permissions: [] };
const COMMENTER: AuthActor = {
  id: COMMENTER_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['comment.create'],
};
const ASSIGNEE_NO_COMMENT_PERM: AuthActor = {
  id: ASSIGNEE_ID,
  isActive: true,
  isAdmin: false,
  permissions: [],
};
const DELETE_ANY_ACTOR: AuthActor = {
  id: DELETE_ANY_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['comment.delete_any'],
};
const NO_PERM_OUTSIDER: AuthActor = {
  id: NO_PERM_ID,
  isActive: true,
  isAdmin: false,
  permissions: [],
};

describe('comments schemas, policy & CommentsService', () => {
  it('validates createCommentRequestSchema and listCommentsQuerySchema bounds', () => {
    expect(createCommentRequestSchema.parse({ body: '  Hello BEAM  ' })).toEqual({
      body: 'Hello BEAM',
    });
    expect(() => createCommentRequestSchema.parse({ body: '   ' })).toThrow();
    expect(() =>
      createCommentRequestSchema.parse({ body: 'a'.repeat(COMMENT_BODY_MAX + 1) }),
    ).toThrow();
    expect(listCommentsQuerySchema.parse({ cursor: '', limit: null })).toEqual({
      cursor: undefined,
      limit: 20,
    });
    expect(() => listCommentsQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it('enforces canDeleteComment, canonical cursor decode, and 404 before 403 across list/create/delete', async () => {
    const { clock, commentsRepo, service, logs } = createHarness();

    expect(canDeleteComment(INACTIVE, { userId: COMMENTER_ID })).toBe(false);
    expect(canDeleteComment(COMMENTER, { userId: COMMENTER_ID })).toBe(true);
    expect(canDeleteComment(DELETE_ANY_ACTOR, { userId: COMMENTER_ID })).toBe(true);
    expect(canDeleteComment(ADMIN, { userId: COMMENTER_ID })).toBe(true);
    expect(canDeleteComment(NO_PERM_OUTSIDER, { userId: COMMENTER_ID })).toBe(false);
    expect(() => assertCanDeleteComment(NO_PERM_OUTSIDER, { userId: COMMENTER_ID })).toThrow(
      /forbidden/,
    );

    const encoded = encodeCommentCursor({
      createdAt: new Date('2026-11-26T04:00:00.000Z'),
      id: TASK_PUBLIC,
    });
    expect(decodeCommentCursor(encoded)).toEqual({
      createdAt: new Date('2026-11-26T04:00:00.000Z'),
      id: TASK_PUBLIC,
    });
    expect(() => decodeCommentCursor(`${encoded}==`)).toThrow();
    expect(() => decodeCommentCursor('not-valid')).toThrow();

    // Missing / soft-deleted task -> 404
    await expect(service.listComments(ADMIN, TASK_DELETED, { limit: 20 })).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    await expect(
      service.createComment(ADMIN, TASK_DELETED, { body: 'Hi' }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    // Hidden task: non-viewer without comment.create MUST get 404 (not 403!)
    await expect(
      service.listComments(NO_PERM_OUTSIDER, TASK_HIDDEN, { limit: 20 }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(
      service.createComment(NO_PERM_OUTSIDER, TASK_HIDDEN, { body: 'Probe hidden' }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(
      service.createComment(COMMENTER, TASK_HIDDEN, { body: 'Probe hidden' }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    // Visible task without comment.create -> 403
    await expect(
      service.createComment(NO_PERM_OUTSIDER, TASK_PUBLIC, { body: 'Denied' }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    // Create 3 comments on public task & verify pagination + zero PII
    const c1 = await service.createComment(COMMENTER, TASK_PUBLIC, { body: 'First secret body' });
    clock.advanceByMs(1000);
    const c2 = await service.createComment(ADMIN, TASK_PUBLIC, { body: 'Second' });
    clock.advanceByMs(1000);
    const c3 = await service.createComment(COMMENTER, TASK_PUBLIC, { body: 'Third' });
    expect(c1.eventId).toBeTruthy();

    // Logs must never include comment body or PII
    expect(logs.join('\n')).not.toContain('First secret body');
    expect(Object.keys(c1.comment.author).sort()).toEqual([
      'avatarUrl',
      'departments',
      'fullName',
      'id',
      'isActive',
      'leftAt',
    ]);

    const page1 = await service.listComments(NO_PERM_OUTSIDER, TASK_PUBLIC, { limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual([c3.comment.id, c2.comment.id]);
    expect(page1.meta.nextCursor).toBeTruthy();

    const page2 = await service.listComments(NO_PERM_OUTSIDER, TASK_PUBLIC, {
      cursor: page1.meta.nextCursor!,
      limit: 2,
    });
    expect(page2.items.map((i) => i.id)).toEqual([c1.comment.id]);
    expect(page2.meta.nextCursor).toBeNull();

    // Seed comment on hidden task by creator, verify DELETE on hidden task returns 404 for outsider WITH comment.delete_any!
    const hiddenComment = await service.createComment(ADMIN, TASK_HIDDEN, { body: 'Hidden note' });
    await expect(
      service.deleteComment(DELETE_ANY_ACTOR, hiddenComment.comment.id),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(
      service.deleteComment(NO_PERM_OUTSIDER, hiddenComment.comment.id),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    // Assignee on hidden task CAN view it, so without delete permission receives 403
    await expect(
      service.deleteComment(ASSIGNEE_NO_COMMENT_PERM, hiddenComment.comment.id),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    // On public task: non-author without comment.delete_any gets 403; author and comment.delete_any succeed
    await expect(service.deleteComment(NO_PERM_OUTSIDER, c1.comment.id)).rejects.toMatchObject({
      httpStatus: 403,
      code: 'FORBIDDEN',
    });
    const delOwn = await service.deleteComment(COMMENTER, c1.comment.id);
    expect(delOwn).toMatchObject({ deleted: true, id: c1.comment.id });
    const delAny = await service.deleteComment(DELETE_ANY_ACTOR, c2.comment.id);
    expect(delAny).toMatchObject({ deleted: true, id: c2.comment.id });

    // Missing comment -> 404
    await expect(service.deleteComment(ADMIN, c1.comment.id)).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    expect(commentsRepo.events.map((e) => e.type)).toEqual([
      'comment.added',
      'comment.added',
      'comment.added',
      'comment.added',
      'comment.deleted',
      'comment.deleted',
    ]);
  });
});
