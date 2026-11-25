import type { TaskDueStatus, TaskPriority, TaskSortBy, TaskSortOrder } from '@/lib/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';
import type { MyTasksCursor, TaskListCursor, TaskUpdateChanges } from './policy';

export interface TaskDepartmentSummaryRecord {
  readonly id: string;
  readonly name: string;
}

export interface TaskMemberSummaryRecord {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly departments: readonly TaskDepartmentSummaryRecord[];
}

export interface TaskRecord {
  readonly id: string;
  readonly boardId: string;
  readonly columnId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: Date | null;
  readonly priority: TaskPriority;
  readonly position: string;
  readonly isHidden: boolean;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly assignees: readonly TaskMemberSummaryRecord[];
  readonly assignedDepartments: readonly TaskDepartmentSummaryRecord[];
  readonly creator: TaskMemberSummaryRecord;
  readonly commentCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListVisibleTasksParams {
  readonly boardId?: string;
  readonly columnId?: string;
  readonly assigneeId?: string;
  readonly departmentId?: string;
  readonly priority?: TaskPriority;
  readonly dueStatus?: TaskDueStatus;
  readonly q?: string;
  readonly sortBy: TaskSortBy;
  readonly sortOrder: TaskSortOrder;
  readonly cursor?: TaskListCursor;
  readonly limit: number;
  readonly now: Date;
}

export interface ListMyTasksParams {
  readonly boardId?: string;
  readonly departmentId?: string;
  readonly q?: string;
  readonly includeDone: boolean;
  readonly priority?: TaskPriority;
  readonly cursor?: MyTasksCursor;
  readonly limit: number;
}

export interface CreateTaskRepoParams {
  readonly boardId: string;
  readonly columnId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly dueAt?: Date | null;
  readonly priority: TaskPriority;
  readonly assigneeIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly isHidden: boolean;
  readonly actorId: string;
  readonly now: Date;
}

export interface UpdateTaskRepoParams {
  readonly id: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly version: number;
  readonly title?: string;
  readonly description?: string | null;
  readonly dueAt?: Date | null;
  readonly priority?: TaskPriority;
  readonly changes: TaskUpdateChanges;
  readonly now: Date;
}

export interface ReplaceAssigneesRepoParams {
  readonly id: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly currentAssigneeIds: readonly string[];
  readonly nextAssigneeIds: readonly string[];
  readonly currentDepartmentIds: readonly string[];
  readonly nextDepartmentIds: readonly string[];
  readonly expectedVersion?: number;
  readonly now: Date;
}

export interface TaskAssignmentNotifier {
  notifyDepartmentAssignment(input: {
    readonly taskId: string;
    readonly boardId: string;
    readonly actorId: string;
    readonly departmentIds: readonly string[];
    readonly isHiddenTask: boolean;
    readonly now: Date;
  }): Promise<void>;
}

export interface SoftDeleteTaskRepoParams {
  readonly id: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly version: number;
  readonly now: Date;
}

export interface MoveTaskRepoParams {
  readonly id: string;
  readonly boardId: string;
  readonly actor: AuthActor;
  readonly currentTask: TaskRecord;
  readonly destinationColumnId: string;
  readonly beforeId?: string | null;
  readonly afterId?: string | null;
  readonly expectedVersion: number;
  readonly now: Date;
}

export interface TaskMutationResult {
  readonly task: TaskRecord;
  readonly eventId: string;
}

export interface TaskOptionalEventMutationResult {
  readonly task: TaskRecord;
  readonly eventId: string | null;
}

export interface TasksRepository {
  listVisibleByBoardId(
    boardId: string,
    actor: AuthActor,
    tx?: TransactionContext,
  ): Promise<TaskRecord[]>;
  listVisibleTasks(
    actor: AuthActor,
    params: ListVisibleTasksParams,
  ): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }>;
  listMyTasks(
    actor: AuthActor,
    params: ListMyTasksParams,
  ): Promise<{ readonly rows: TaskRecord[]; readonly hasMore: boolean }>;
  findActiveById(taskId: string, tx?: TransactionContext): Promise<TaskRecord | null>;
  createTaskWithEvent(
    input: CreateTaskRepoParams,
    tx: TransactionContext,
  ): Promise<TaskMutationResult>;
  updateTaskWithEvent(
    input: UpdateTaskRepoParams,
    tx: TransactionContext,
  ): Promise<TaskMutationResult>;
  moveTaskWithEvent(
    input: MoveTaskRepoParams,
    tx: TransactionContext,
  ): Promise<TaskOptionalEventMutationResult>;
  replaceAssigneesWithEvent(
    input: ReplaceAssigneesRepoParams,
    tx: TransactionContext,
  ): Promise<TaskMutationResult>;
  softDeleteTaskWithEvent(
    input: SoftDeleteTaskRepoParams,
    tx: TransactionContext,
  ): Promise<TaskMutationResult>;
}
