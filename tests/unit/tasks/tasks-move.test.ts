import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  computeTaskMovePlan,
  MIN_POSITION_GAP,
  type MoveTaskRepoParams,
  type OrderedMoveSibling,
  POSITION_STEP,
  type TaskMutationResult,
  type TaskOptionalEventMutationResult,
  type TaskRecord,
  TasksService,
  type TasksRepository,
} from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const BOARD_ID = '40000000-0000-4000-8000-000000000001';
const COL_A = '50000000-0000-4000-8000-000000000001';
const COL_B = '50000000-0000-4000-8000-000000000002';
const CREATOR_ID = '10000000-0000-4000-8000-000000000010';
const ASSIGNEE_ID = '10000000-0000-4000-8000-000000000011';
const OTHER_ID = '10000000-0000-4000-8000-000000000012';
const TASK_TARGET = '60000000-0000-4000-8000-000000000001';
const SIB_1 = '60000000-0000-4000-8000-000000000002';
const SIB_2 = '60000000-0000-4000-8000-000000000003';
const SIB_HIDDEN = '60000000-0000-4000-8000-000000000004';
const TASK_HIDDEN = '60000000-0000-4000-8000-000000000005';

function makeUser(id: string, name: string) {
  return { id, fullName: name, avatarUpdatedAt: null, isActive: true, leftAt: null, departments: [] };
}

class MoveFakeTasksRepository implements TasksRepository {
  readonly records = new Map<string, TaskRecord>();
  private eventSeq = 0;

  async listVisibleByBoardId(): Promise<TaskRecord[]> {
    return [];
  }
  async listVisibleTasks(): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    return { rows: [], hasMore: false };
  }
  async listMyTasks(): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }> {
    return { rows: [], hasMore: false };
  }
  async findActiveById(taskId: string): Promise<TaskRecord | null> {
    const rec = this.records.get(taskId);
    return rec && rec.deletedAt === null ? rec : null;
  }
  async createTaskWithEvent(): Promise<TaskMutationResult> {
    throw new Error('unused');
  }
  async updateTaskWithEvent(): Promise<TaskMutationResult> {
    throw new Error('unused');
  }
  async replaceAssigneesWithEvent(): Promise<TaskMutationResult> {
    throw new Error('unused');
  }
  async softDeleteTaskWithEvent(): Promise<TaskMutationResult> {
    throw new Error('unused');
  }

  async moveTaskWithEvent(input: MoveTaskRepoParams): Promise<TaskOptionalEventMutationResult> {
    if (input.currentTask.version !== input.expectedVersion) {
      throw new AppError('TASK_VERSION_CONFLICT', 'errors.taskVersionConflict', 409);
    }
    const orderedSiblings: OrderedMoveSibling[] = Array.from(this.records.values())
      .filter((t) => t.columnId === input.destinationColumnId && t.deletedAt === null && t.id !== input.id)
      .sort((a, b) => Number(a.position) - Number(b.position) || a.id.localeCompare(b.id))
      .map((t) => ({
        id: t.id,
        position: Number(t.position),
        visibleToActor: input.actor.isAdmin || !t.isHidden || t.createdBy === input.actor.id || t.assignees.some((a) => a.id === input.actor.id),
      }));

    const plan = computeTaskMovePlan({
      targetTaskId: input.id,
      currentColumnId: input.currentTask.columnId,
      currentPosition: Number(input.currentTask.position),
      destinationColumnId: input.destinationColumnId,
      orderedSiblings,
      beforeId: input.beforeId,
      afterId: input.afterId,
    });

    if (plan.kind === 'noop') return { task: input.currentTask, eventId: null };
    if (plan.kind === 'rebalance') {
      for (const u of plan.siblingUpdates) {
        const sib = this.records.get(u.id)!;
        this.records.set(u.id, { ...sib, position: String(u.position) });
      }
    }
    this.eventSeq += 1;
    const moved: TaskRecord = {
      ...input.currentTask,
      columnId: input.destinationColumnId,
      position: String(plan.targetPosition),
      version: input.currentTask.version + 1,
      updatedAt: input.now,
    };
    this.records.set(input.id, moved);
    return { task: moved, eventId: `80000000-0000-4000-8000-${String(this.eventSeq).padStart(12, '0')}` };
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

describe('computeTaskMovePlan positioning policy', () => {
  it('handles empty column, append, prepend, midpoint, and rebalance on gap < 0.001', () => {
    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1000,
        destinationColumnId: COL_B,
        orderedSiblings: [],
      }),
    ).toEqual({ kind: 'single', targetPosition: POSITION_STEP });

    const siblings: OrderedMoveSibling[] = [
      { id: SIB_1, position: 1000, visibleToActor: true },
      { id: SIB_2, position: 2000, visibleToActor: true },
    ];

    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1000,
        destinationColumnId: COL_B,
        orderedSiblings: siblings,
      }),
    ).toEqual({ kind: 'single', targetPosition: 3000 });

    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1000,
        destinationColumnId: COL_B,
        orderedSiblings: siblings,
        afterId: SIB_1,
      }),
    ).toEqual({ kind: 'single', targetPosition: 0 });

    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1000,
        destinationColumnId: COL_B,
        orderedSiblings: siblings,
        beforeId: SIB_1,
        afterId: SIB_2,
      }),
    ).toEqual({ kind: 'single', targetPosition: 1500 });

    const tightSiblings: OrderedMoveSibling[] = [
      { id: SIB_1, position: 1000, visibleToActor: true },
      { id: SIB_2, position: 1000 + MIN_POSITION_GAP / 2, visibleToActor: true },
    ];
    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1000,
        destinationColumnId: COL_B,
        orderedSiblings: tightSiblings,
        beforeId: SIB_1,
        afterId: SIB_2,
      }),
    ).toEqual({
      kind: 'rebalance',
      targetPosition: 2000,
      siblingUpdates: [
        { id: SIB_1, position: 1000 },
        { id: SIB_2, position: 3000 },
      ],
    });
  });

  it('rejects hidden sibling IDs, self-references, duplicate or reversed siblings with 400 VALIDATION_ERROR', () => {
    const siblings: OrderedMoveSibling[] = [
      { id: SIB_1, position: 1000, visibleToActor: true },
      { id: SIB_HIDDEN, position: 1500, visibleToActor: false },
      { id: SIB_2, position: 2000, visibleToActor: true },
    ];

    for (const badArgs of [
      { beforeId: TASK_TARGET },
      { afterId: TASK_TARGET },
      { beforeId: SIB_1, afterId: SIB_1 },
      { beforeId: SIB_2, afterId: SIB_1 },
      { beforeId: SIB_HIDDEN },
      { afterId: SIB_HIDDEN },
      { beforeId: '60000000-0000-4000-8000-999999999999' },
    ]) {
      expect(() =>
        computeTaskMovePlan({
          targetTaskId: TASK_TARGET,
          currentColumnId: COL_A,
          currentPosition: 1000,
          destinationColumnId: COL_B,
          orderedSiblings: siblings,
          ...badArgs,
        }),
      ).toThrowError(expect.objectContaining({ httpStatus: 400, code: 'VALIDATION_ERROR' }));
    }

    // Moving between visible SIB_1 and SIB_2 across a hidden sibling in between works
    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1000,
        destinationColumnId: COL_B,
        orderedSiblings: siblings,
        beforeId: SIB_1,
        afterId: SIB_2,
      }),
    ).toEqual({ kind: 'single', targetPosition: 1250 });
  });

  it('detects same-column no-op cleanly including around hidden siblings', () => {
    const siblings: OrderedMoveSibling[] = [
      { id: SIB_1, position: 1000, visibleToActor: true },
      { id: SIB_HIDDEN, position: 1500, visibleToActor: false },
      { id: SIB_2, position: 3000, visibleToActor: true },
    ];

    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 2000,
        destinationColumnId: COL_A,
        orderedSiblings: siblings,
        beforeId: SIB_1,
        afterId: SIB_2,
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 4000,
        destinationColumnId: COL_A,
        orderedSiblings: siblings,
      }),
    ).toEqual({ kind: 'noop' });

    // Not a no-op if a hidden task sits after target when appending to end
    expect(
      computeTaskMovePlan({
        targetTaskId: TASK_TARGET,
        currentColumnId: COL_A,
        currentPosition: 1200,
        destinationColumnId: COL_A,
        orderedSiblings: siblings,
      }),
    ).toEqual({ kind: 'single', targetPosition: 4000 });
  });
});

describe('TasksService.moveTask authorization, optimistic lock & noop', () => {
  function setupService() {
    const repo = new MoveFakeTasksRepository();
    const clock = new FakeClock('2026-11-24T09:00:00.000Z');
    const logger = new StructuredLogger({ writeOut: () => undefined, writeErr: () => undefined });
    const now = clock.now();
    repo.records.set(TASK_TARGET, {
      id: TASK_TARGET, boardId: BOARD_ID, columnId: COL_A, title: 'Visible', description: null,
      dueAt: null, priority: 2, position: '1000', isHidden: false, version: 1, deletedAt: null,
      createdBy: CREATOR_ID, assignees: [makeUser(ASSIGNEE_ID, 'Assignee')], creator: makeUser(CREATOR_ID, 'Creator'),
      commentCount: 0, createdAt: now, updatedAt: now,
    });
    repo.records.set(TASK_HIDDEN, {
      id: TASK_HIDDEN, boardId: BOARD_ID, columnId: COL_A, title: 'Hidden', description: null,
      dueAt: null, priority: 2, position: '2000', isHidden: true, version: 1, deletedAt: null,
      createdBy: CREATOR_ID, assignees: [makeUser(ASSIGNEE_ID, 'Assignee')], creator: makeUser(CREATOR_ID, 'Creator'),
      commentCount: 0, createdAt: now, updatedAt: now,
    });
    return { service: new TasksService({ tasksRepo: repo, transactionRunner: MOCK_TX_RUNNER, clock, logger }) };
  }

  it('enforces 401 inactive, 404 hidden for update_any, 403 unassigned, 409 version conflict, and noop eventId=null', async () => {
    const { service } = setupService();
    const inactive: AuthActor = { id: ASSIGNEE_ID, isActive: false, isAdmin: true, permissions: [] };
    const updateAnyOther: AuthActor = { id: OTHER_ID, isActive: true, isAdmin: false, permissions: ['task.update_any'] };
    const unassignedBasic: AuthActor = { id: OTHER_ID, isActive: true, isAdmin: false, permissions: ['task.update_assigned'] };
    const assignedMember: AuthActor = { id: ASSIGNEE_ID, isActive: true, isAdmin: false, permissions: ['task.update_assigned'] };

    await expect(service.moveTask(inactive, TASK_TARGET, { columnId: COL_B, version: 1 })).rejects.toMatchObject({ httpStatus: 401 });
    await expect(service.moveTask(updateAnyOther, TASK_HIDDEN, { columnId: COL_B, version: 1 })).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.moveTask(unassignedBasic, TASK_TARGET, { columnId: COL_B, version: 1 })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(service.moveTask(assignedMember, TASK_TARGET, { columnId: COL_B, version: 2 })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'TASK_VERSION_CONFLICT',
      messageKey: 'errors.taskVersionConflict',
    });

    const moved = await service.moveTask(assignedMember, TASK_HIDDEN, { columnId: COL_B, version: 1 });
    expect(moved.task.columnId).toBe(COL_B);
    expect(moved.task.version).toBe(2);
    expect(moved.eventId).toBeTruthy();

    const noop = await service.moveTask(assignedMember, TASK_HIDDEN, { columnId: COL_B, version: 2 });
    expect(noop.eventId).toBeNull();
    expect(noop.task.version).toBe(2);
  });
});
