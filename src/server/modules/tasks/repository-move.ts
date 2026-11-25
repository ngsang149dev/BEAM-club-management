import type { TransactionContext } from '@/server/shared/transaction';
import { canViewTask } from './policy';
import { computeTaskMovePlan, type OrderedMoveSibling } from './positioning';
import type {
  MoveTaskRepoParams,
  TaskOptionalEventMutationResult,
  TaskRecord,
} from './types';

export interface RawMoveSibling {
  readonly id: string;
  readonly position: number;
  readonly isHidden: boolean;
  readonly createdBy: string;
  readonly assigneeIds: readonly string[];
  readonly assignedDepartmentIds: readonly string[];
}

export interface MoveTaskPersistence {
  readonly lockDestinationColumn: (
    boardId: string,
    columnId: string,
    tx: TransactionContext,
  ) => Promise<void>;
  readonly loadColumnSiblings: (
    columnId: string,
    excludeTaskId: string,
    tx: TransactionContext,
  ) => Promise<RawMoveSibling[]>;
  readonly applySiblingRebalance: (
    updates: ReadonlyArray<{ readonly id: string; readonly position: number }>,
    tx: TransactionContext,
  ) => Promise<void>;
  readonly persistMovedTaskAndEvent: (
    params: {
      readonly id: string;
      readonly boardId: string;
      readonly actorId: string;
      readonly fromColumnId: string | null;
      readonly fromPosition: number;
      readonly toColumnId: string;
      readonly toPosition: number;
      readonly expectedVersion: number;
      readonly now: Date;
    },
    tx: TransactionContext,
  ) => Promise<{ readonly task: TaskRecord; readonly eventId: string }>;
}

function toOrderedMoveSiblings(
  rawSiblings: readonly RawMoveSibling[],
  actor: MoveTaskRepoParams['actor'],
): OrderedMoveSibling[] {
  return rawSiblings.map((sibling) => ({
    id: sibling.id,
    position: sibling.position,
    visibleToActor: canViewTask(actor, {
      isHidden: sibling.isHidden,
      createdBy: sibling.createdBy,
      assigneeIds: sibling.assigneeIds,
      assignedDepartmentIds: sibling.assignedDepartmentIds,
    }),
  }));
}

export async function executeMoveTaskWithEvent(
  input: MoveTaskRepoParams,
  tx: TransactionContext,
  store: MoveTaskPersistence,
): Promise<TaskOptionalEventMutationResult> {
  await store.lockDestinationColumn(input.boardId, input.destinationColumnId, tx);
  const rawSiblings = await store.loadColumnSiblings(input.destinationColumnId, input.id, tx);
  const plan = computeTaskMovePlan({
    targetTaskId: input.id,
    currentColumnId: input.currentTask.columnId,
    currentPosition: Number(input.currentTask.position),
    destinationColumnId: input.destinationColumnId,
    orderedSiblings: toOrderedMoveSiblings(rawSiblings, input.actor),
    beforeId: input.beforeId,
    afterId: input.afterId,
  });

  if (plan.kind === 'noop') return { task: input.currentTask, eventId: null };
  if (plan.kind === 'rebalance') await store.applySiblingRebalance(plan.siblingUpdates, tx);

  return store.persistMovedTaskAndEvent(
    {
      id: input.id,
      boardId: input.boardId,
      actorId: input.actor.id,
      fromColumnId: input.currentTask.columnId,
      fromPosition: Number(input.currentTask.position),
      toColumnId: input.destinationColumnId,
      toPosition: plan.targetPosition,
      expectedVersion: input.expectedVersion,
      now: input.now,
    },
    tx,
  );
}
