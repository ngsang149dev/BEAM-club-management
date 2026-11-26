import { conflict, notFound } from '@/lib/errors';
import { MAX_DELIVERABLES_PER_TASK } from '@/lib/tasks';
import type { TransactionContext } from '@/server/shared/transaction';
import type {
  AddTaskDeliverableRepoParams,
  AddTaskDeliverableResult,
  RemoveTaskDeliverableRepoParams,
  RemoveTaskDeliverableResult,
  SetTaskAcceptanceRepoParams,
  TaskMutationResult,
  TaskRecord,
} from './types';

export interface TaskDeliverablesPersistence {
  readonly upsertTaskAssigneeAcceptance: (
    params: {
      readonly taskId: string;
      readonly userId: string;
      readonly acceptedAt: Date | null;
      readonly now: Date;
    },
    tx: TransactionContext,
  ) => Promise<void>;
  readonly countDeliverablesForTask: (
    taskId: string,
    tx: TransactionContext,
  ) => Promise<number>;
  readonly insertDeliverable: (
    params: {
      readonly taskId: string;
      readonly title: string;
      readonly url: string;
      readonly submittedBy: string;
      readonly now: Date;
    },
    tx: TransactionContext,
  ) => Promise<string>;
  readonly deleteDeliverable: (
    params: { readonly taskId: string; readonly deliverableId: string },
    tx: TransactionContext,
  ) => Promise<boolean>;
  readonly bumpTaskVersion: (
    params: { readonly taskId: string; readonly now: Date },
    tx: TransactionContext,
  ) => Promise<boolean>;
  readonly insertTaskEvent: (
    params: {
      readonly taskId: string;
      readonly boardId: string;
      readonly actorId: string;
      readonly type: string;
      readonly changes: Record<string, unknown>;
      readonly now: Date;
    },
    tx: TransactionContext,
  ) => Promise<string>;
  readonly loadHydratedTask: (
    taskId: string,
    tx: TransactionContext,
  ) => Promise<TaskRecord>;
}

export async function executeSetAcceptanceWithEvent(
  input: SetTaskAcceptanceRepoParams,
  tx: TransactionContext,
  store: TaskDeliverablesPersistence,
): Promise<TaskMutationResult> {
  await store.upsertTaskAssigneeAcceptance(
    {
      taskId: input.id,
      userId: input.actorId,
      acceptedAt: input.nextAccepted ? input.now : null,
      now: input.now,
    },
    tx,
  );
  const bumped = await store.bumpTaskVersion(
    { taskId: input.id, now: input.now },
    tx,
  );
  if (!bumped) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
  const eventId = await store.insertTaskEvent(
    {
      taskId: input.id,
      boardId: input.boardId,
      actorId: input.actorId,
      type: 'task.accepted',
      changes: {
        user_id: input.actorId,
        accepted: { from: input.currentAccepted, to: input.nextAccepted },
      },
      now: input.now,
    },
    tx,
  );
  const task = await store.loadHydratedTask(input.id, tx);
  return { task, eventId };
}

function assertDeliverableCapacity(currentCount: number): void {
  if (currentCount >= MAX_DELIVERABLES_PER_TASK) {
    throw conflict(
      'errors.deliverableLimitReached',
      { maxDeliverables: MAX_DELIVERABLES_PER_TASK },
      'DELIVERABLE_LIMIT_REACHED',
    );
  }
}

export async function executeAddDeliverableWithEvent(
  input: AddTaskDeliverableRepoParams,
  tx: TransactionContext,
  store: TaskDeliverablesPersistence,
): Promise<AddTaskDeliverableResult> {
  assertDeliverableCapacity(await store.countDeliverablesForTask(input.taskId, tx));
  const deliverableId = await store.insertDeliverable(
    { taskId: input.taskId, title: input.title, url: input.url, submittedBy: input.actorId, now: input.now },
    tx,
  );
  const bumped = await store.bumpTaskVersion({ taskId: input.taskId, now: input.now }, tx);
  if (!bumped) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  const eventId = await store.insertTaskEvent(
    {
      taskId: input.taskId,
      boardId: input.boardId,
      actorId: input.actorId,
      type: 'task.deliverable_added',
      changes: { deliverable_id: deliverableId },
      now: input.now,
    },
    tx,
  );
  const task = await store.loadHydratedTask(input.taskId, tx);
  const deliverable = task.deliverables.find((d) => d.id === deliverableId);
  if (!deliverable) throw new Error('Failed to hydrate created task deliverable');
  return { deliverable, task, eventId };
}

export async function executeRemoveDeliverableWithEvent(
  input: RemoveTaskDeliverableRepoParams,
  tx: TransactionContext,
  store: TaskDeliverablesPersistence,
): Promise<RemoveTaskDeliverableResult> {
  const deleted = await store.deleteDeliverable(
    { taskId: input.taskId, deliverableId: input.deliverableId },
    tx,
  );
  if (!deleted) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
  const bumped = await store.bumpTaskVersion(
    { taskId: input.taskId, now: input.now },
    tx,
  );
  if (!bumped) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
  const eventId = await store.insertTaskEvent(
    {
      taskId: input.taskId,
      boardId: input.boardId,
      actorId: input.actorId,
      type: 'task.deliverable_removed',
      changes: { deliverable_id: input.deliverableId },
      now: input.now,
    },
    tx,
  );
  const task = await store.loadHydratedTask(input.taskId, tx);
  return { id: input.deliverableId, task, eventId };
}
