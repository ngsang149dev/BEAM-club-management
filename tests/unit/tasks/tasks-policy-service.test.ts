import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import type { NotificationsDispatcher, NotifyDepartmentAssignmentInput } from '@/server/modules/notifications';
import {
  assertCanEditTask,
  assertCanViewTask,
  buildTaskUpdateChanges,
  canEditTask,
  canToggleTaskHidden,
  canViewTask,
  type CreateTaskRepoParams,
  decodeMyTasksCursor,
  decodeTaskCursor,
  encodeMyTasksCursor,
  encodeTaskCursor,
  isActorAssignedToTask,
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
const DEPT_MEMBER_ID = '10000000-0000-4000-8000-000000000013';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const DEPT_1 = '20000000-0000-4000-8000-000000000001';
const DEPT_2 = '20000000-0000-4000-8000-000000000002';
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
          assignedDepartmentIds: t.assignedDepartments.map((d) => d.id),
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
        (!params.departmentId || t.assignedDepartments.some((d) => d.id === params.departmentId)) &&
        canViewTask(actor, {
          isHidden: t.isHidden,
          createdBy: t.createdBy,
          assigneeIds: t.assignees.map((a) => a.id),
          assignedDepartmentIds: t.assignedDepartments.map((d) => d.id),
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
      (t) =>
        t.deletedAt === null &&
        isActorAssignedToTask(actor, {
          isHidden: t.isHidden,
          createdBy: t.createdBy,
          assigneeIds: t.assignees.map((a) => a.id),
          assignedDepartmentIds: t.assignedDepartments.map((d) => d.id),
        }),
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
      assignedDepartments: input.departmentIds.map((did) => ({ id: did, name: `Dept ${did.slice(-2)}` })),
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
      assignedDepartments: input.nextDepartmentIds.map((did) => ({ id: did, name: `Dept ${did.slice(-2)}` })),
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

function createHarness(options: { failDispatch?: boolean } = {}) {
  const repo = new InMemoryTasksRepository();
  const clock = new FakeClock('2026-11-24T05:00:00.000Z');
  const logs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => logs.push(line),
    writeErr: (line) => logs.push(line),
  });
  const dispatches: NotifyDepartmentAssignmentInput[] = [];
  const notificationsDispatcher: NotificationsDispatcher = {
    notifyDepartmentAssignment: async (input) => {
      if (options.failDispatch) throw new Error('SMTP down');
      dispatches.push(input);
    },
  };
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
    assignedDepartments: [{ id: DEPT_1, name: 'Dept 1' }],
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
    assignedDepartments: [{ id: DEPT_1, name: 'Dept 1' }],
    creator: makeUser(CREATOR_ID, 'Creator'),
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  const service = new TasksService({
    tasksRepo: repo,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
    notificationsDispatcher,
  });
  return { repo, service, dispatches, logs };
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
const DEPT_MEMBER_ACTOR: AuthActor = {
  id: DEPT_MEMBER_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['task.update_assigned'],
  departmentIds: [DEPT_1],
};
const CREATE_NO_ASSIGN: AuthActor = {
  id: OTHER_USER_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['task.create'],
};

describe('tasks policy & TasksService', () => {
  it('enforces taskVisibilityPolicy (including department assignment & revocation), edit rules, and hidden toggle', () => {
    const hiddenSubject = {
      isHidden: true,
      createdBy: CREATOR_ID,
      assigneeIds: [ASSIGNEE_ID],
      assignedDepartmentIds: [DEPT_1],
    };
    expect(canViewTask(INACTIVE, hiddenSubject)).toBe(false);
    expect(canViewTask(ADMIN, hiddenSubject)).toBe(true);
    expect(canViewTask(ASSIGNED_ONLY, hiddenSubject)).toBe(true);
    expect(canViewTask(DEPT_MEMBER_ACTOR, hiddenSubject)).toBe(true);
    expect(canEditTask(DEPT_MEMBER_ACTOR, hiddenSubject)).toBe(true);
    expect(canViewTask(UPDATE_ANY_OTHER, hiddenSubject)).toBe(false);

    // Leaving department immediately revokes hidden-task view and edit rights
    const leftDeptActor: AuthActor = { ...DEPT_MEMBER_ACTOR, departmentIds: [DEPT_2] };
    expect(canViewTask(leftDeptActor, hiddenSubject)).toBe(false);
    expect(canEditTask(leftDeptActor, hiddenSubject)).toBe(false);
    expect(() => assertCanViewTask(leftDeptActor, hiddenSubject)).toThrowError(
      expect.objectContaining({ httpStatus: 404, code: 'NOT_FOUND' }),
    );

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
    const dueCursor = encodeTaskCursor({ sortBy: 'dueAt', sortOrder: 'desc', value: null, id: TASK_1 });
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

  it('computes task diffs strictly', () => {
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

  it('enforces AC-06 create permissions for assigneeIds & departmentIds, partial replaceAssignees, and non-blocking notifications', async () => {
    const { service, repo, dispatches } = createHarness();

    await expect(service.listTasks(INACTIVE, { sortBy: 'position', sortOrder: 'asc', limit: 20 })).rejects.toMatchObject({ httpStatus: 401 });
    await expect(service.getTask(UPDATE_ANY_OTHER, TASK_HIDDEN)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.updateTask(UPDATE_ANY_OTHER, TASK_HIDDEN, { title: 'Steal', version: 1 })).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.replaceAssignees(UPDATE_ANY_OTHER, TASK_HIDDEN, { assigneeIds: [], notifyDepartmentMembers: true })).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.deleteTask(UPDATE_ANY_OTHER, TASK_HIDDEN)).rejects.toMatchObject({ httpStatus: 404 });

    // task.assign enforced for both assigneeIds and departmentIds
    await expect(
      service.createTask(CREATE_NO_ASSIGN, {
        boardId: BOARD_ID, columnId: COL_TODO, title: 'Fail Assign',
        priority: 2, assigneeIds: [ASSIGNEE_ID], departmentIds: [], notifyDepartmentMembers: true, isHidden: false,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(
      service.createTask(CREATE_NO_ASSIGN, {
        boardId: BOARD_ID, columnId: COL_TODO, title: 'Fail Dept Assign',
        priority: 2, assigneeIds: [], departmentIds: [DEPT_1], notifyDepartmentMembers: true, isHidden: false,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    const createdNoDept = await service.createTask(CREATE_NO_ASSIGN, {
      boardId: BOARD_ID, columnId: COL_TODO, title: 'Unassigned Ok',
      priority: 2, assigneeIds: [], departmentIds: [], notifyDepartmentMembers: true, isHidden: false,
    });
    expect(createdNoDept.eventId).toBeTruthy();
    expect(dispatches).toHaveLength(0);

    // Create with departmentIds + notifyDepartmentMembers=false skips dispatcher
    await service.createTask(ADMIN, {
      boardId: BOARD_ID, columnId: COL_TODO, title: 'Silent Dept Task',
      priority: 2, assigneeIds: [], departmentIds: [DEPT_1], notifyDepartmentMembers: false, isHidden: false,
    });
    expect(dispatches).toHaveLength(0);

    // Create with departmentIds + notifyDepartmentMembers=true dispatches
    const createdDept = await service.createTask(ADMIN, {
      boardId: BOARD_ID, columnId: COL_TODO, title: 'Loud Dept Task',
      priority: 2, assigneeIds: [], departmentIds: [DEPT_1], notifyDepartmentMembers: true, isHidden: true,
    });
    expect(createdDept.task.assignedDepartments).toHaveLength(1);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      taskId: createdDept.task.id,
      departmentIds: [DEPT_1],
      assigneeIds: [],
      notifyInApp: true,
      notifyEmail: true,
      isHiddenTask: true,
    });

    // Partial replaceAssignees: omitting assigneeIds preserves assignees, only newly added DEPT_2 triggers notification
    const deptOnlyUpdate = await service.replaceAssignees(UPDATE_ANY_OTHER, TASK_1, {
      departmentIds: [DEPT_1, DEPT_2],
      notifyDepartmentMembers: true,
      version: 1,
    });
    expect(deptOnlyUpdate.task.assignees.map((a) => a.id)).toEqual([ASSIGNEE_ID]);
    expect(deptOnlyUpdate.task.assignedDepartments.map((d) => d.id)).toEqual([DEPT_1, DEPT_2]);
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1]!.departmentIds).toEqual([DEPT_2]);
    expect(dispatches[1]!.assigneeIds).toEqual([]);

    // Partial replaceAssignees: omitting departmentIds preserves assignedDepartments and triggers 0 notifications when only removing assignees
    const userOnlyUpdate = await service.replaceAssignees(UPDATE_ANY_OTHER, TASK_1, {
      assigneeIds: [],
      notifyDepartmentMembers: true,
      version: 2,
    });
    expect(userOnlyUpdate.task.assignees).toEqual([]);
    expect(userOnlyUpdate.task.assignedDepartments.map((d) => d.id)).toEqual([DEPT_1, DEPT_2]);
    expect(dispatches).toHaveLength(2);

    // Non-assigned loses edit right when neither direct nor department assigned
    await service.replaceAssignees(UPDATE_ANY_OTHER, TASK_1, {
      departmentIds: [],
      notifyDepartmentMembers: true,
      version: 3,
    });
    await expect(service.updateTask(DEPT_MEMBER_ACTOR, TASK_1, { title: 'Deny', version: 4 })).rejects.toMatchObject({ httpStatus: 403 });

    // Direct assignee additions + independent notifyInApp / notifyEmail channels
    const createdDirect = await service.createTask(ADMIN, {
      boardId: BOARD_ID,
      columnId: COL_TODO,
      title: 'Direct InApp Only',
      priority: 2,
      assigneeIds: [ASSIGNEE_ID, OTHER_USER_ID],
      departmentIds: [],
      notifyDepartmentMembers: true,
      notifyInApp: true,
      notifyEmail: false,
      isHidden: false,
    });
    expect(dispatches).toHaveLength(3);
    expect(dispatches[2]).toMatchObject({
      taskId: createdDirect.task.id,
      departmentIds: [],
      assigneeIds: [ASSIGNEE_ID, OTHER_USER_ID],
      notifyInApp: true,
      notifyEmail: false,
      isHiddenTask: false,
    });

    // Both channels false -> skips dispatcher even when assignees & departments exist
    await service.createTask(ADMIN, {
      boardId: BOARD_ID,
      columnId: COL_TODO,
      title: 'Both Off',
      priority: 2,
      assigneeIds: [ASSIGNEE_ID],
      departmentIds: [DEPT_1],
      notifyDepartmentMembers: true,
      notifyInApp: false,
      notifyEmail: false,
      isHidden: false,
    });
    expect(dispatches).toHaveLength(3);

    // replaceAssignees dispatches ONLY newly added assigneeIds (not pre-existing) and respects notifyInApp=false / notifyEmail=true
    const addedDirectRes = await service.replaceAssignees(ADMIN, createdDirect.task.id, {
      assigneeIds: [ASSIGNEE_ID, OTHER_USER_ID, DEPT_MEMBER_ID],
      notifyDepartmentMembers: false,
      notifyInApp: false,
      notifyEmail: true,
      version: 1,
    });
    expect(addedDirectRes.eventId).toBeTruthy();
    expect(dispatches).toHaveLength(4);
    expect(dispatches[3]).toMatchObject({
      taskId: createdDirect.task.id,
      departmentIds: [],
      assigneeIds: [DEPT_MEMBER_ID],
      notifyInApp: false,
      notifyEmail: true,
    });

    // No-op replaceAssignees -> eventId null and 0 dispatches
    const noopAssignRes = await service.replaceAssignees(ADMIN, createdDirect.task.id, {
      assigneeIds: [DEPT_MEMBER_ID, ASSIGNEE_ID, OTHER_USER_ID],
      notifyDepartmentMembers: true,
      version: 2,
    });
    expect(noopAssignRes.eventId).toBeNull();
    expect(dispatches).toHaveLength(4);

    // departmentId query param forwarded to repo
    await service.listTasks(ADMIN, { departmentId: DEPT_1, sortBy: 'position', sortOrder: 'asc', limit: 20 });
    expect(repo.lastListParams?.departmentId).toBe(DEPT_1);
    await service.listTasks(ADMIN, {
      boardId: BOARD_ID,
      columnId: COL_TODO,
      assigneeId: ASSIGNEE_ID,
      departmentId: DEPT_1,
      priority: 4,
      dueStatus: 'overdue',
      q: 'urgent',
      sortBy: 'dueAt',
      sortOrder: 'desc',
      limit: 10,
    });
    expect(repo.lastListParams).toMatchObject({
      boardId: BOARD_ID,
      columnId: COL_TODO,
      assigneeId: ASSIGNEE_ID,
      departmentId: DEPT_1,
      priority: 4,
      dueStatus: 'overdue',
      q: 'urgent',
      sortBy: 'dueAt',
      sortOrder: 'desc',
      limit: 10,
    });
    await service.listMyTasks(DEPT_MEMBER_ACTOR, { departmentId: DEPT_1, includeDone: false, limit: 20 });
    expect(repo.lastMyParams?.departmentId).toBe(DEPT_1);
  });

  it('does not fail task creation or assignee update when notificationsDispatcher throws', async () => {
    const { service, logs } = createHarness({ failDispatch: true });
    const created = await service.createTask(ADMIN, {
      boardId: BOARD_ID,
      columnId: COL_TODO,
      title: 'Resilient Task',
      priority: 2,
      assigneeIds: [],
      departmentIds: [DEPT_1],
      notifyDepartmentMembers: true,
      isHidden: false,
    });
    expect(created.eventId).toBeTruthy();
    expect(logs.some((l) => l.includes('Failed to dispatch task department notifications'))).toBe(true);
  });
});
