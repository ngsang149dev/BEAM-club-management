import type { RevertableTaskEventType } from '@/lib/task-events';
import type { TaskPriority } from '@/lib/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';
import type { TaskMemberSummaryRecord, TaskRecord } from '@/server/modules/tasks';

export interface TaskEventRecord {
  readonly id: string;
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly actor: TaskMemberSummaryRecord;
  readonly type: string;
  readonly changes: Record<string, unknown>;
  readonly revertsEventId: string | null;
  readonly forced: boolean;
  readonly createdAt: Date;
}

export interface TaskEventContext {
  readonly task: TaskRecord;
  readonly boardArchivedAt: Date | null;
}

export interface TaskEventCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface BoardTrashCursor {
  readonly deletedAt: Date;
  readonly id: string;
}

export interface ListTaskEventsRepoParams {
  readonly taskId: string;
  readonly cursor?: TaskEventCursor;
  readonly limit: number;
}

export interface ListBoardTrashRepoParams {
  readonly boardId: string;
  readonly actor: AuthActor;
  readonly cursor?: BoardTrashCursor;
  readonly limit: number;
}

export interface RevertColumnLookup {
  readonly desiredColumnId: string | null;
  readonly desiredPosition: number | null;
}

export interface TaskUpdatedChangesPayload {
  readonly title?: { readonly from: string; readonly to: string };
  readonly description?: { readonly from: string | null; readonly to: string | null };
  readonly start_at?: { readonly from: string | null; readonly to: string | null };
  readonly due_at?: { readonly from: string | null; readonly to: string | null };
  readonly is_completed?: { readonly from: boolean; readonly to: boolean };
  readonly priority?: { readonly from: TaskPriority; readonly to: TaskPriority };
}

export interface RevertTargetIntent {
  readonly columnLookup?: RevertColumnLookup;
  readonly desiredAssigneeIds?: readonly string[];
  readonly desiredDepartmentIds?: readonly string[];
  readonly updatedChanges?: TaskUpdatedChangesPayload;
  readonly nextIsHidden?: boolean;
}

export interface RevertResolvedColumn {
  readonly columnId: string;
  readonly position: number;
}

export interface RevertResolvedTargets {
  readonly column?: RevertResolvedColumn;
  readonly validAssigneeIds?: readonly string[];
  readonly validDepartmentIds?: readonly string[];
}

export interface RevertTaskPatch {
  readonly title?: string;
  readonly description?: string | null;
  readonly startAt?: Date | null;
  readonly dueAt?: Date | null;
  readonly isCompleted?: boolean;
  readonly completedAt?: Date | null;
  readonly priority?: TaskPriority;
  readonly columnId?: string | null;
  readonly position?: string;
  readonly isHidden?: boolean;
  readonly deletedAt?: Date | null;
}

export interface RevertPersistencePlan {
  readonly taskPatch: RevertTaskPatch;
  readonly replaceAssigneeIds?: readonly string[];
  readonly replaceDepartmentIds?: readonly string[];
  readonly compensatingType: RevertableTaskEventType;
  readonly compensatingChanges: Record<string, unknown>;
}

export interface ApplyRevertRepoParams {
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly expectedVersion: number;
  readonly revertsEventId: string;
  readonly forced: boolean;
  readonly plan: RevertPersistencePlan;
  readonly now: Date;
}

export interface RevertTaskEventMutationResult {
  readonly task: TaskRecord;
  readonly eventId: string;
  readonly revertedEventId: string;
}

export interface TaskEventsRepository {
  findTaskContext(taskId: string, tx?: TransactionContext): Promise<TaskEventContext | null>;
  listByTaskId(
    params: ListTaskEventsRepoParams,
  ): Promise<{ readonly rows: TaskEventRecord[]; readonly hasMore: boolean }>;
  findEventByIdForTask(
    params: { readonly taskId: string; readonly eventId: string },
    tx: TransactionContext,
  ): Promise<TaskEventRecord | null>;
  resolveRevertTargets(
    params: {
      readonly boardId: string;
      readonly taskId: string;
      readonly intent: RevertTargetIntent;
    },
    tx: TransactionContext,
  ): Promise<RevertResolvedTargets>;
  applyRevertAndInsertEvent(
    params: ApplyRevertRepoParams,
    tx: TransactionContext,
  ): Promise<{ readonly task: TaskRecord; readonly eventId: string }>;
  boardExists(boardId: string): Promise<boolean>;
  listBoardTrash(
    params: ListBoardTrashRepoParams,
  ): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }>;
}
