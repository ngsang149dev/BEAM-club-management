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
  readonly visibleTaskCount: number;
  readonly overdueTaskCount: number;
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

function resolveDoneColumnIds(columns: readonly ColumnRecord[]): Set<string> {
  if (columns.length === 0) return new Set();
  const maxOrderIndex = Math.max(...columns.map((c) => c.orderIndex));
  const ids = new Set<string>();
  for (const col of columns) {
    if (col.name.trim().toLowerCase() === 'done' || col.orderIndex === maxOrderIndex) {
      ids.add(col.id);
    }
  }
  return ids;
}

export function computeBoardTaskCounts(
  visibleTasks: readonly TaskRecord[],
  columns: readonly ColumnRecord[],
  now: Date,
): { readonly visibleTaskCount: number; readonly overdueTaskCount: number } {
  const doneColumnIds = resolveDoneColumnIds(columns);
  const nowMs = now.getTime();
  let overdueTaskCount = 0;
  for (const task of visibleTasks) {
    if (!task.dueAt || task.dueAt.getTime() >= nowMs) continue;
    if (task.columnId && doneColumnIds.has(task.columnId)) continue;
    overdueTaskCount += 1;
  }
  return { visibleTaskCount: visibleTasks.length, overdueTaskCount };
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
    visibleTaskCount: record.visibleTaskCount ?? 0,
    overdueTaskCount: record.overdueTaskCount ?? 0,
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
  readonly now?: Date;
}): BoardDetailResponseDto {
  const counts = countVisibleTasksByColumn(input.visibleTasks);
  const taskStats = computeBoardTaskCounts(input.visibleTasks, input.columns, input.now ?? new Date());
  return {
    board: {
      ...toBoardSummaryDto(input.board),
      ...taskStats,
      columns: input.columns.map((col) => toColumnDto(col, counts.get(col.id) ?? 0)),
      tasks: input.visibleTasks.map(toTaskDto),
    },
  };
}
