import type { TaskPriority } from '@/lib/tasks';
import type { TaskMemberSummaryRecord, TaskRecord } from './types';

export interface TaskDepartmentSummaryDto {
  readonly id: string;
  readonly name: string;
}

export interface TaskMemberPublicSummaryDto {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly leftAt: string | null;
  readonly departments: TaskDepartmentSummaryDto[];
}

export interface TaskDto {
  readonly id: string;
  readonly boardId: string;
  readonly columnId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string | null;
  readonly priority: TaskPriority;
  readonly position: number;
  readonly isHidden: boolean;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly assignees: TaskMemberPublicSummaryDto[];
  readonly creator: TaskMemberPublicSummaryDto;
  readonly commentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskResponseDto {
  readonly task: TaskDto;
}

export interface TaskPageMetaDto {
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface TaskPageResponseDto {
  readonly items: TaskDto[];
  readonly meta: TaskPageMetaDto;
}

export interface TaskMutationResponseDto {
  readonly task: TaskDto;
  readonly eventId: string | null;
}

export function toTaskMemberPublicSummaryDto(
  record: TaskMemberSummaryRecord,
): TaskMemberPublicSummaryDto {
  return {
    id: record.id,
    fullName: record.fullName,
    isActive: record.isActive,
    leftAt: record.leftAt ? record.leftAt.toISOString() : null,
    departments: record.departments.map((dept) => ({ id: dept.id, name: dept.name })),
  };
}

export function toTaskDto(record: TaskRecord): TaskDto {
  return {
    id: record.id,
    boardId: record.boardId,
    columnId: record.columnId,
    title: record.title,
    description: record.description,
    dueAt: record.dueAt ? record.dueAt.toISOString() : null,
    priority: record.priority,
    position: Number(record.position),
    isHidden: record.isHidden,
    version: record.version,
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    assignees: record.assignees.map(toTaskMemberPublicSummaryDto),
    creator: toTaskMemberPublicSummaryDto(record.creator),
    commentCount: record.commentCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toTaskResponseDto(record: TaskRecord): TaskResponseDto {
  return { task: toTaskDto(record) };
}

export function toTaskPageResponseDto(input: {
  readonly items: readonly TaskRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}): TaskPageResponseDto {
  return {
    items: input.items.map(toTaskDto),
    meta: { nextCursor: input.nextCursor, limit: input.limit },
  };
}

export function toTaskMutationResponseDto(input: {
  readonly task: TaskRecord;
  readonly eventId: string | null;
}): TaskMutationResponseDto {
  return { task: toTaskDto(input.task), eventId: input.eventId };
}
