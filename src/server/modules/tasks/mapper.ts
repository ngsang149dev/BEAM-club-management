import { toMemberAvatarUrl } from '@/lib/media';
import type { TaskPriority } from '@/lib/tasks';
import type {
  TaskAssigneeRecord,
  TaskDeliverableRecord,
  TaskMemberSummaryRecord,
  TaskRecord,
} from './types';

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
  readonly avatarUrl: string | null;
}

export interface TaskAssigneePublicSummaryDto extends TaskMemberPublicSummaryDto {
  readonly acceptedAt: string | null;
}

export interface TaskDeliverableDto {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly submittedBy: TaskMemberPublicSummaryDto;
  readonly createdAt: string;
}

export interface TaskDto {
  readonly id: string;
  readonly boardId: string;
  readonly columnId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: string;
  readonly dueAt: string;
  readonly isCompleted: boolean;
  readonly completedAt: string | null;
  readonly priority: TaskPriority;
  readonly position: number;
  readonly isHidden: boolean;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly assignees: TaskAssigneePublicSummaryDto[];
  readonly assignedDepartments: TaskDepartmentSummaryDto[];
  readonly deliverables: TaskDeliverableDto[];
  readonly deliverableCount: number;
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

export interface TaskDeliverablesResponseDto {
  readonly items: TaskDeliverableDto[];
}

export interface TaskDeliverableMutationResponseDto {
  readonly deliverable: TaskDeliverableDto;
  readonly task: TaskDto;
  readonly eventId: string | null;
}

export interface DeleteTaskDeliverableResponseDto {
  readonly deleted: boolean;
  readonly id: string;
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
    avatarUrl: toMemberAvatarUrl(record.id, record.avatarUpdatedAt),
  };
}

export function toTaskAssigneePublicSummaryDto(
  record: TaskAssigneeRecord,
): TaskAssigneePublicSummaryDto {
  return {
    ...toTaskMemberPublicSummaryDto(record),
    acceptedAt: record.acceptedAt ? record.acceptedAt.toISOString() : null,
  };
}

export function toTaskDeliverableDto(
  record: TaskDeliverableRecord,
): TaskDeliverableDto {
  return {
    id: record.id,
    title: record.title,
    url: record.url,
    submittedBy: toTaskMemberPublicSummaryDto(record.submittedBy),
    createdAt: record.createdAt.toISOString(),
  };
}

export function toTaskDto(record: TaskRecord): TaskDto {
  return {
    id: record.id,
    boardId: record.boardId,
    columnId: record.columnId,
    title: record.title,
    description: record.description,
    startAt: record.startAt.toISOString(),
    dueAt: record.dueAt.toISOString(),
    isCompleted: record.isCompleted,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    priority: record.priority,
    position: Number(record.position),
    isHidden: record.isHidden,
    version: record.version,
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    assignees: record.assignees.map(toTaskAssigneePublicSummaryDto),
    assignedDepartments: record.assignedDepartments.map((dept) => ({
      id: dept.id,
      name: dept.name,
    })),
    deliverables: record.deliverables.map(toTaskDeliverableDto),
    deliverableCount: record.deliverableCount,
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

export function toTaskDeliverablesResponseDto(
  deliverables: readonly TaskDeliverableRecord[],
): TaskDeliverablesResponseDto {
  return { items: deliverables.map(toTaskDeliverableDto) };
}

export function toTaskDeliverableMutationResponseDto(input: {
  readonly deliverable: TaskDeliverableRecord;
  readonly task: TaskRecord;
  readonly eventId: string | null;
}): TaskDeliverableMutationResponseDto {
  return {
    deliverable: toTaskDeliverableDto(input.deliverable),
    task: toTaskDto(input.task),
    eventId: input.eventId,
  };
}

export function toDeleteTaskDeliverableResponseDto(input: {
  readonly id: string;
  readonly task: TaskRecord;
  readonly eventId: string | null;
}): DeleteTaskDeliverableResponseDto {
  return {
    deleted: true,
    id: input.id,
    task: toTaskDto(input.task),
    eventId: input.eventId,
  };
}
