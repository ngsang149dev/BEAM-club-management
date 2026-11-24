import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  assertCanEditTask,
  assertCanViewTask,
  buildTaskUpdateChanges,
  canToggleTaskHidden,
  canViewTask,
  type CreateTaskRepoParams,
  decodeMyTasksCursor,
  decodeTaskCursor,
  encodeMyTasksCursor,
  encodeTaskCursor,
  type ListMyTasksParams,
  type ListVisibleTasksParams,
  type MoveTaskRepoParams,
  type ReplaceAssigneesRepoParams,
  type SoftDeleteTaskRepoParams,
  type TaskMutationResult,
  type TaskOptionalEventMutationResult,
  type TaskRecord,
  TasksService,
  type TasksRepository,
  type UpdateTaskRepoParams,
} from '@/server/modules/tasks';

const BOARD_ID = '40000000-0000-4000-8000-000000000001';
const COL_TODO = '50000000-0000-4000-8000-000000000001';
const CREATOR_ID = '10000000-0000-4000-8000-000000000010';
const ASSIGNEE_ID = '10000000-0000-4000-8000-000000000011';
const OTHER_USER_ID = '10000000-0000-4000-8000-000000000012';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const TASK_1 = '60000000-0000-4000-8000-000000000001';
const TASK_HIDDEN = '60000000-0000-4000-8000-000000000002';

function makeUser(id: string, name: string) {
  return { id, fullName: name, avatarUpdatedAt: null, isActive: true, leftAt: null, departments: [] };
}

class InMemoryTasksRepository implements TasksRepository {
  readonly records = new Map<string, TaskRecord>();
  lastListParams: ListVisibleTasksParams | null = null;
  lastMyParams: ListMyTasksParams | null = null;
  private eventSeq = 0;

  async listVisibleByBoardId(boardId: string, actor: AuthActor): Promise<TaskRecord[]> {
    return Array.from(this.records.values()).filter(
      (t) =>
        t.boardId === boardId &&
        t.deletedAt === null &&
        canViewTask(actor, {
          isHidden: t.isHidden,
          createdBy: t.createdBy,
          assigneeIds: t.assignees.map((a) => a.id),
        }),
    );
  }

  async listVisibleTasks(
    actor: AuthActor,
    params: ListVisibleTasksParams,
  ): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    this.lastListParams = params;
    const rows = Array.from(this.records.values()).filter(
      (t) =>
        t.deletedAt === null &&
        canViewTask(actor, {
          isHidden: t.isHidden,
          createdBy: t.createdBy,
          assigneeIds: t.assignees.map((a) => a.id),
        }),
    );
    return { rows: rows.slice(0, params.limit), hasMore: rows.length > params.limit };
  }

  async listMyTasks(
    actor: AuthActor,
    params: ListMyTasksParams,
  ): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    this.lastMyParams = params;
    const rows = Array.from(this.records.values()).filter(
      (t) => t.deletedAt === null && t.assignees.some((a) => a.id === actor.id),
    );
    return { rows: rows.slice(0, params.limit), hasMore: rows.length > params.limit };
  }

  async findActiveById(taskId: string): Promise<TaskRecord | null> {
    const rec = this.records.get(taskId);
    return rec && rec.deletedAt === null ? rec : null;
  }

  async createTaskWithEvent(input: CreateTaskRepoParams): Promise<TaskMutationResult> {
    this.eventSeq += 1;
    const id = `60000000-0000-4000-8000-${String(this.eventSeq + 10).padStart(12, '0')}`;
    const task: TaskRecord = {
      id,
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt ?? null,
      priority: input.priority,
      position: '1000',
      isHidden: input.isHidden,
      version: 1,
      deletedAt: null,
      createdBy: input.actorId,
      assignees: input.assigneeIds.map((aid) => makeUser(aid, `User ${aid.slice(-2)}`)),
      creator: makeUser(input.actorId, 'Creator'),
      commentCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.records.set(id, task);
    return { task, eventId: `80000000-0000-4000-8000-${String(this.eventSeq).padStart(12, '0')}` };
  }

  async updateTaskWithEvent(input: UpdateTaskRepoParams): Promise<TaskMutationResult> {
    const current = this.records.get(input.id);
    if (!current || current.version !== input.version) {
      throw new AppError('TASK_VERSION_CONFLICT', 'errors.taskVersionConflict', 409);
    }
    this.eventSeq += 1;
    const next: TaskRecord = {
      ...current,
      title: input.title ?? current.title,
      description: input.description !== undefined ? input.description : current.description,
      dueAt: input.dueAt !== undefined ? input.dueAt : current.dueAt,
      priority: input.priority ?? current.priority,
      version: current.version + 1,
      updatedAt: input.now,
    };
    this.records.set(input.id, next);
    return { task: next, eventId: `80000000-0000-4000-8000-${String(this.eventSeq).padStart(12, '0')}` };
  }

  async replaceAssigneesWithEvent(input: ReplaceAssigneesRepoParams): Promise<TaskMutationResult> {
    const current = this.records.get(input.id)!;
    this.eventSeq += 1;
    const next: TaskRecord = {
      ...current,
      version: current.version + 1,
      assignees: input.nextAssigneeIds.map((aid) => makeUser(aid, `User ${aid.slice(-2)}`)),
      updatedAt: input.now,
    };
    this.records.set(input.id, next);
    return { task: next, eventId: `80000000-0000-4000-8000-${String(this.eventSeq).padStart(12, '0')}` };
  }

  async moveTaskWithEvent(input: MoveTaskRepoParams): Promise<TaskOptionalEventMutationResult> {
    return { task: input.currentTask, eventId: null };
  }

  async softDeleteTaskWithEvent(input: SoftDeleteTaskRepoParams): Promise<TaskMutationResult> {
    const current = this.records.get(input.id)!;
    this.eventSeq += 1;
    const next: TaskRecord = {
      ...current,
      version: current.version + 1,
      deletedAt: input.now,
      updatedAt: input.now,
    };
    this.records.set(input.id, next);
    return { task: next, eventId: `80000000-0000-4000-8000-${String(this.eventSeq).padStart(12, '0')}` };
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

function createHarness() {
  const repo = new InMemoryTasksRepository();
  const clock = new FakeClock('2026-11-24T05:00:00.000Z');
  const logger = new StructuredLogger({ writeOut: () => undefined, writeErr: () => undefined });
  const now = clock.now();

  repo.records.set(TASK_1, {
    id: TASK_1,
    boardId: BOARD_ID,
    columnId: COL_TODO,
    title: 'Public Task',
    description: 'Initial',
    dueAt: new Date('2026-11-25T00:00:00.000Z'),
    priority: 2,
    position: '1000',
    isHidden: false,
    version: 1,
    deletedAt: null,
    createdBy: CREATOR_ID,
    assignees: [makeUser(ASSIGNEE_ID, 'Assignee')],
    creator: makeUser(CREATOR_ID, 'Creator'),
    commentCount: 2,
    createdAt: now,
    updatedAt: now,
  });

  repo.records.set(TASK_HIDDEN, {
    id: TASK_HIDDEN,
    boardId: BOARD_ID,
    columnId: COL_TODO,
    title: 'Hidden Task',
    description: null,
    dueAt: null,
    priority: 3,
    position: '2000',
    isHidden: true,
    version: 1,
    deletedAt: null,
    createdBy: CREATOR_ID,
    assignees: [makeUser(ASSIGNEE_ID, 'Assignee')],
    creator: makeUser(CREATOR_ID, 'Creator'),
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  const service = new TasksService({ tasksRepo: repo, transactionRunner: MOCK_TX_RUNNER, clock, logger });
  return { repo, service };
}

const ADMIN: AuthActor = { id: ADMIN_ID, isActive: true, isAdmin: true, permissions: [] };
const INACTIVE: AuthActor = { id: CREATOR_ID, isActive: false, isAdmin: true, permissions: [] };
const UPDATE_ANY_OTHER: AuthActor = {
  id: OTHER_USER_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['task.update_any', 'task.delete', 'task.assign'],
};
const ASSIGNED_ONLY: AuthActor = {
  id: ASSIGNEE_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['task.update_assigned'],
};
const CREATE_NO_ASSIGN: AuthActor = {
  id: OTHER_USER_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['task.create'],
};

describe('tasks policy & TasksService', () => {
  it('enforces taskVisibilityPolicy (404 on hidden for non-viewers, never 403), edit rules, and hidden toggle', () => {
    const hiddenSubject = { isHidden: true, createdBy: CREATOR_ID, assigneeIds: [ASSIGNEE_ID] };
    expect(canViewTask(INACTIVE, hiddenSubject)).toBe(false);
    expect(canViewTask(ADMIN, hiddenSubject)).toBe(true);
    expect(canViewTask(ASSIGNED_ONLY, hiddenSubject)).toBe(true);
    expect(canViewTask(UPDATE_ANY_OTHER, hiddenSubject)).toBe(false);

    expect(() => assertCanViewTask(UPDATE_ANY_OTHER, hiddenSubject)).toThrowError(
      expect.objectContaining({ httpStatus: 404, code: 'NOT_FOUND' }),
    );
    expect(() => assertCanEditTask(UPDATE_ANY_OTHER, hiddenSubject)).toThrowError(
      expect.objectContaining({ httpStatus: 404, code: 'NOT_FOUND' }),
    );
    expect(() =>
      assertCanEditTask(CREATE_NO_ASSIGN, { isHidden: false, createdBy: CREATOR_ID, assigneeIds: [] }),
    ).toThrowError(expect.objectContaining({ httpStatus: 403, code: 'FORBIDDEN' }));

    expect(canToggleTaskHidden(ADMIN, { createdBy: CREATOR_ID })).toBe(true);
    expect(canToggleTaskHidden({ ...CREATE_NO_ASSIGN, id: CREATOR_ID }, { createdBy: CREATOR_ID })).toBe(true);
    expect(canToggleTaskHidden(UPDATE_ANY_OTHER, { createdBy: CREATOR_ID })).toBe(false);
  });

  it('encodes/decodes task and my-tasks cursors strictly and rejects bad cursors', () => {
    const dueCursor = encodeTaskCursor({
      sortBy: 'dueAt',
      sortOrder: 'desc',
      value: null,
      id: TASK_1,
    });
    expect(decodeTaskCursor(dueCursor, 'dueAt', 'desc')).toEqual({
      sortBy: 'dueAt',
      sortOrder: 'desc',
      value: null,
      id: TASK_1,
    });
    expect(() => decodeTaskCursor(dueCursor, 'position', 'asc')).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );

    const myCursor = encodeMyTasksCursor({ dueAt: null, priority: 4, id: TASK_1 });
    expect(decodeMyTasksCursor(myCursor)).toEqual({ dueAt: null, priority: 4, id: TASK_1 });
    expect(() => decodeMyTasksCursor('tampered')).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );
  });

  it('computes task diffs strictly and maps DTO position as number without PII', () => {
    const due = new Date('2026-11-25T00:00:00.000Z');
    expect(
      buildTaskUpdateChanges(
        { title: 'Same', description: null, dueAt: due, priority: 2 },
        { title: 'Same', description: null, dueAt: new Date('2026-11-25T00:00:00.000Z'), priority: 2, version: 1 },
      ),
    ).toEqual({});

    expect(
      buildTaskUpdateChanges(
        { title: 'Old', description: null, dueAt: due, priority: 2 },
        { title: 'New', dueAt: null, priority: 4, version: 1 },
      ),
    ).toEqual({
      title: { from: 'Old', to: 'New' },
      due_at: { from: '2026-11-25T00:00:00.000Z', to: null },
      priority: { from: 2, to: 4 },
    });
  });

  it('enforces AC-06 create permissions, version conflicts, no-op eventId=null, and hidden-task 404 across mutations', async () => {
    const { service } = createHarness();

    await expect(service.listTasks(INACTIVE, { sortBy: 'position', sortOrder: 'asc', limit: 20 })).rejects.toMatchObject({ httpStatus: 401 });
    await expect(service.getTask(UPDATE_ANY_OTHER, TASK_HIDDEN)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.updateTask(UPDATE_ANY_OTHER, TASK_HIDDEN, { title: 'Steal', version: 1 })).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.replaceAssignees(UPDATE_ANY_OTHER, TASK_HIDDEN, { assigneeIds: [] })).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.deleteTask(UPDATE_ANY_OTHER, TASK_HIDDEN)).rejects.toMatchObject({ httpStatus: 404 });

    // task.delete deny on visible task (even when caller can edit) + 404 on hidden task
    const updateAnyNoDelete: AuthActor = {
      id: OTHER_USER_ID,
      isActive: true,
      isAdmin: false,
      permissions: ['task.update_any'],
    };
    await expect(service.deleteTask(ASSIGNED_ONLY, TASK_1)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(service.deleteTask(updateAnyNoDelete, TASK_1)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(service.deleteTask(updateAnyNoDelete, TASK_HIDDEN)).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    // AC-06: task.create without task.assign cannot assign on create
    await expect(
      service.createTask(CREATE_NO_ASSIGN, {
        boardId: BOARD_ID,
        columnId: COL_TODO,
        title: 'Fail Assign',
        priority: 2,
        assigneeIds: [ASSIGNEE_ID],
        isHidden: false,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    const created = await service.createTask(CREATE_NO_ASSIGN, {
      boardId: BOARD_ID,
      columnId: COL_TODO,
      title: 'Unassigned Ok',
      priority: 2,
      assigneeIds: [],
      isHidden: false,
    });
    expect(created.eventId).toBeTruthy();
    expect(created.task.position).toBe(1000);

    // No-op PATCH with matching version -> eventId: null; stale version -> 409
    const noop = await service.updateTask(ASSIGNED_ONLY, TASK_1, { title: 'Public Task', version: 1 });
    expect(noop.eventId).toBeNull();
    await expect(service.updateTask(ASSIGNED_ONLY, TASK_1, { title: 'Public Task', version: 9 })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'TASK_VERSION_CONFLICT',
      messageKey: 'errors.taskVersionConflict',
    });

    const edited = await service.updateTask(ASSIGNED_ONLY, TASK_1, { title: 'Edited', version: 1 });
    expect(edited.eventId).toBeTruthy();
    expect(edited.task.version).toBe(2);

    // Non-assigned task.update_assigned cannot edit TASK_1 if unassigned
    const assignNoop = await service.replaceAssignees(UPDATE_ANY_OTHER, TASK_1, { assigneeIds: [ASSIGNEE_ID], version: 2 });
    expect(assignNoop.eventId).toBeNull();

    const reassigned = await service.replaceAssignees(UPDATE_ANY_OTHER, TASK_1, { assigneeIds: [], version: 2 });
    expect(reassigned.eventId).toBeTruthy();
    await expect(service.updateTask(ASSIGNED_ONLY, TASK_1, { title: 'Deny', version: 3 })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
  });
});
