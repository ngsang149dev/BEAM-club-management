import type {
  ArchiveEntityType,
  ArchivePurgeMode,
  ArchiveRetentionDays,
  ArchiveTab,
} from '@/lib/archive';
import {
  type BoardSummaryDto,
  toBoardSummaryDto,
} from '@/server/modules/boards';
import {
  type MemberDto,
  toMemberDto,
} from '@/server/modules/members';
import {
  type TaskDto,
  type TaskMemberPublicSummaryDto,
  toTaskDto,
  toTaskMemberPublicSummaryDto,
} from '@/server/modules/tasks';
import type {
  ArchiveRetentionRecord,
  ArchivedBoardItemRecord,
  ArchivedTaskItemRecord,
  AutoPurgeExecutionResult,
  PurgeEntityResult,
} from './types';

export interface ArchiveTaskItemDto {
  readonly task: TaskDto;
  readonly boardName: string;
  readonly boardArchived: boolean;
  readonly columnName: string | null;
}

export interface ArchiveBoardItemDto {
  readonly board: BoardSummaryDto;
  readonly taskCount: number;
}

export interface ArchivePageResponseDto {
  readonly tab: ArchiveTab;
  readonly tasks: ArchiveTaskItemDto[];
  readonly members: MemberDto[];
  readonly boards: ArchiveBoardItemDto[];
  readonly meta: {
    readonly nextCursor: string | null;
    readonly limit: number;
  };
}

export interface PurgeArchiveItemResponseDto {
  readonly purged: boolean;
  readonly entityType: ArchiveEntityType;
  readonly id: string;
  readonly mode: ArchivePurgeMode;
}

export interface ArchiveRetentionSettingsDto {
  readonly retentionDays: ArchiveRetentionDays;
  readonly updatedAt: string | null;
  readonly updatedBy: TaskMemberPublicSummaryDto | null;
}

export interface ArchiveRetentionSettingsResponseDto {
  readonly settings: ArchiveRetentionSettingsDto;
}

export interface CronArchivePurgeResponseDto {
  readonly retentionDays: ArchiveRetentionDays;
  readonly cutoffAt: string | null;
  readonly purgedTasks: number;
  readonly purgedBoards: number;
  readonly purgedMembers: number;
}

export function toArchiveTaskItemDto(
  record: ArchivedTaskItemRecord,
): ArchiveTaskItemDto {
  return {
    task: toTaskDto(record.task),
    boardName: record.boardName,
    boardArchived: record.boardArchived,
    columnName: record.columnName,
  };
}

export function toArchiveBoardItemDto(
  record: ArchivedBoardItemRecord,
): ArchiveBoardItemDto {
  return {
    board: {
      ...toBoardSummaryDto(record.board),
      visibleTaskCount: 0,
      overdueTaskCount: 0,
    },
    taskCount: record.taskCount,
  };
}

export function toArchivePageResponseDto(input: {
  readonly tab: ArchiveTab;
  readonly tasks?: readonly ArchivedTaskItemRecord[];
  readonly members?: readonly Parameters<typeof toMemberDto>[0][];
  readonly includeMemberDetail?: boolean;
  readonly boards?: readonly ArchivedBoardItemRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}): ArchivePageResponseDto {
  const includeDetail = input.includeMemberDetail ?? false;
  return {
    tab: input.tab,
    tasks: (input.tasks ?? []).map(toArchiveTaskItemDto),
    members: (input.members ?? []).map((m) => toMemberDto(m, includeDetail)),
    boards: (input.boards ?? []).map(toArchiveBoardItemDto),
    meta: {
      nextCursor: input.nextCursor,
      limit: input.limit,
    },
  };
}

export function toPurgeArchiveItemResponseDto(
  result: PurgeEntityResult,
): PurgeArchiveItemResponseDto {
  return {
    purged: true,
    entityType: result.entityType,
    id: result.id,
    mode: result.mode,
  };
}

export function toArchiveRetentionSettingsResponseDto(
  record: ArchiveRetentionRecord,
): ArchiveRetentionSettingsResponseDto {
  return {
    settings: {
      retentionDays: record.retentionDays,
      updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
      updatedBy: record.updatedBy
        ? toTaskMemberPublicSummaryDto(record.updatedBy)
        : null,
    },
  };
}

export function toCronArchivePurgeResponseDto(
  input: AutoPurgeExecutionResult & {
    readonly retentionDays: ArchiveRetentionDays;
    readonly cutoffAt: Date | null;
  },
): CronArchivePurgeResponseDto {
  return {
    retentionDays: input.retentionDays,
    cutoffAt: input.cutoffAt ? input.cutoffAt.toISOString() : null,
    purgedTasks: input.purgedTasks,
    purgedBoards: input.purgedBoards,
    purgedMembers: input.purgedMembers,
  };
}
