import type {
  ArchiveEntityType,
  ArchivePurgeMode,
  ArchiveRetentionDays,
} from '@/lib/archive';
import type { BoardSummaryRecord } from '@/server/modules/boards';
import type { MemberProfileRecord } from '@/server/modules/members';
import type { TaskMemberSummaryRecord, TaskRecord } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';
import type {
  ArchiveBoardsCursor,
  ArchiveMembersCursor,
  ArchiveTasksCursor,
} from './policy';

export type ArchiveUserSummaryRecord = TaskMemberSummaryRecord;

export interface ArchivedTaskItemRecord {
  readonly task: TaskRecord;
  readonly boardName: string;
  readonly boardArchived: boolean;
  readonly columnName: string | null;
}

export interface ArchivedBoardItemRecord {
  readonly board: BoardSummaryRecord;
  readonly taskCount: number;
}

export interface ListArchivedTasksParams {
  readonly actor: AuthActor;
  readonly q?: string;
  readonly cursor?: ArchiveTasksCursor;
  readonly limit: number;
}

export interface ListArchivedMembersParams {
  readonly q?: string;
  readonly includeStudentIdSearch: boolean;
  readonly cursor?: ArchiveMembersCursor;
  readonly limit: number;
}

export interface ListArchivedBoardsParams {
  readonly actor: AuthActor;
  readonly q?: string;
  readonly cursor?: ArchiveBoardsCursor;
  readonly limit: number;
}

export interface RestoreTaskTargetRecord {
  readonly task: TaskRecord;
  readonly boardArchivedAt: Date | null;
  readonly boardPurgedAt: Date | null;
  readonly hasOriginalColumn: boolean;
  readonly firstColumnId: string | null;
}

export interface RestoreTaskRepoParams {
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly prevDeletedAt: Date;
  readonly prevColumnId: string | null;
  readonly targetColumnId: string;
  readonly currentPosition: string;
  readonly useFallbackPosition: boolean;
  readonly now: Date;
}

export interface RestoreTaskRepoResult {
  readonly task: TaskRecord;
  readonly eventId: string;
}

export interface ArchiveRetentionRecord {
  readonly retentionDays: ArchiveRetentionDays;
  readonly updatedAt: Date | null;
  readonly updatedBy: ArchiveUserSummaryRecord | null;
}

export interface PurgeEntityResult {
  readonly entityType: ArchiveEntityType;
  readonly id: string;
  readonly mode: ArchivePurgeMode;
  readonly detail: Record<string, unknown>;
  readonly targetUserId: string | null;
}

export interface AutoPurgeExecutionResult {
  readonly purgedTasks: number;
  readonly purgedBoards: number;
  readonly purgedMembers: number;
}

export interface ArchiveRepository {
  listArchivedTasks(params: ListArchivedTasksParams): Promise<{
    readonly rows: ArchivedTaskItemRecord[];
    readonly hasMore: boolean;
  }>;
  listArchivedMembers(params: ListArchivedMembersParams): Promise<{
    readonly rows: MemberProfileRecord[];
    readonly hasMore: boolean;
  }>;
  listArchivedBoards(params: ListArchivedBoardsParams): Promise<{
    readonly rows: ArchivedBoardItemRecord[];
    readonly hasMore: boolean;
  }>;
  findTaskForRestore(
    taskId: string,
    tx: TransactionContext,
  ): Promise<RestoreTaskTargetRecord | null>;
  restoreTaskWithEvent(
    input: RestoreTaskRepoParams,
    tx: TransactionContext,
  ): Promise<RestoreTaskRepoResult>;
  lockAndRestoreMember(
    memberId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
  lockAndRestoreBoard(
    boardId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<BoardSummaryRecord | null>;
  purgeTask(
    taskId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<PurgeEntityResult>;
  purgeBoard(
    boardId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<PurgeEntityResult>;
  purgeMember(
    memberId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<PurgeEntityResult>;
  getRetentionSetting(tx?: TransactionContext): Promise<ArchiveRetentionRecord>;
  upsertRetentionSetting(
    input: {
      readonly retentionDays: ArchiveRetentionDays;
      readonly actorId: string;
      readonly now: Date;
    },
    tx: TransactionContext,
  ): Promise<{
    readonly previousRetentionDays: ArchiveRetentionDays;
    readonly current: ArchiveRetentionRecord;
  }>;
  runAutoPurge(
    cutoff: Date,
    now: Date,
    tx: TransactionContext,
  ): Promise<AutoPurgeExecutionResult>;
}
