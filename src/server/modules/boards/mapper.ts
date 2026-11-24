import { toMemberAvatarUrl } from '@/lib/media';
import { type TaskDto, type TaskRecord, toTaskDto } from '@/server/modules/tasks';
import type { BoardMemberSummaryRecord, BoardSummaryRecord, ColumnRecord } from './repository';

export interface BoardDepartmentSummaryDto {
  readonly id: string;
  readonly name: string;
}

export interface BoardMemberPublicSummaryDto {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly leftAt: string | null;
  readonly departments: BoardDepartmentSummaryDto[];
  readonly avatarUrl: string | null;
}

export interface ColumnDto {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly taskCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoardSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly department: BoardDepartmentSummaryDto | null;
  readonly archivedAt: string | null;
  readonly createdBy: BoardMemberPublicSummaryDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoardDetailDto extends BoardSummaryDto {
  readonly columns: ColumnDto[];
  readonly tasks: TaskDto[];
}

export interface BoardPageMetaDto {
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface BoardPageResponseDto {
  readonly items: BoardSummaryDto[];
  readonly meta: BoardPageMetaDto;
}

export interface BoardSummaryResponseDto {
  readonly board: BoardSummaryDto;
}

export interface BoardDetailResponseDto {
  readonly board: BoardDetailDto;
}

export interface ColumnResponseDto {
  readonly column: ColumnDto;
}

export interface ColumnListResponseDto {
  readonly items: ColumnDto[];
}

export interface DeleteColumnResponseDto {
  readonly deleted: boolean;
  readonly id: string;
}

function toMemberSummaryDto(record: BoardMemberSummaryRecord): BoardMemberPublicSummaryDto {
  return {
    id: record.id,
    fullName: record.fullName,
    isActive: record.isActive,
    leftAt: record.leftAt ? record.leftAt.toISOString() : null,
    departments: record.departments.map((dept) => ({ id: dept.id, name: dept.name })),
    avatarUrl: toMemberAvatarUrl(record.id, record.avatarUpdatedAt),
  };
}

export function countVisibleTasksByColumn(tasks: readonly TaskRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!task.columnId) continue;
    counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1);
  }
  return counts;
}

export function toColumnDto(record: ColumnRecord, taskCount: number): ColumnDto {
  return {
    id: record.id,
    boardId: record.boardId,
    name: record.name,
    orderIndex: record.orderIndex,
    taskCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toBoardSummaryDto(record: BoardSummaryRecord): BoardSummaryDto {
  return {
    id: record.id,
    name: record.name,
    department: record.department
      ? { id: record.department.id, name: record.department.name }
      : null,
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
    createdBy: toMemberSummaryDto(record.createdBy),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toBoardPageResponseDto(input: {
  readonly items: readonly BoardSummaryRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}): BoardPageResponseDto {
  return {
    items: input.items.map(toBoardSummaryDto),
    meta: { nextCursor: input.nextCursor, limit: input.limit },
  };
}

export function toBoardDetailResponseDto(input: {
  readonly board: BoardSummaryRecord;
  readonly columns: readonly ColumnRecord[];
  readonly visibleTasks: readonly TaskRecord[];
}): BoardDetailResponseDto {
  const counts = countVisibleTasksByColumn(input.visibleTasks);
  return {
    board: {
      ...toBoardSummaryDto(input.board),
      columns: input.columns.map((col) => toColumnDto(col, counts.get(col.id) ?? 0)),
      tasks: input.visibleTasks.map(toTaskDto),
    },
  };
}
