import { isRevertableTaskEventType } from '@/lib/task-events';
import {
  type TaskDto,
  type TaskMemberPublicSummaryDto,
  toTaskDto,
  toTaskMemberPublicSummaryDto,
} from '@/server/modules/tasks';
import type { RevertTaskEventMutationResult, TaskEventRecord } from './types';

export interface TaskEventDto {
  readonly id: string;
  readonly taskId: string;
  readonly boardId: string;
  readonly actor: TaskMemberPublicSummaryDto;
  readonly type: string;
  readonly changes: Record<string, unknown>;
  readonly revertsEventId: string | null;
  readonly forced: boolean;
  readonly revertable: boolean;
  readonly createdAt: string;
}

export interface TaskEventPageMetaDto {
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface TaskEventPageResponseDto {
  readonly items: TaskEventDto[];
  readonly meta: TaskEventPageMetaDto;
}

export interface RevertTaskEventResponseDto {
  readonly task: TaskDto;
  readonly eventId: string;
  readonly revertedEventId: string;
}

export function toTaskEventDto(record: TaskEventRecord): TaskEventDto {
  return {
    id: record.id,
    taskId: record.taskId,
    boardId: record.boardId,
    actor: toTaskMemberPublicSummaryDto(record.actor),
    type: record.type,
    changes: record.changes,
    revertsEventId: record.revertsEventId,
    forced: record.forced,
    revertable: isRevertableTaskEventType(record.type),
    createdAt: record.createdAt.toISOString(),
  };
}

export function toTaskEventPageResponseDto(input: {
  readonly items: readonly TaskEventRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}): TaskEventPageResponseDto {
  return {
    items: input.items.map(toTaskEventDto),
    meta: { nextCursor: input.nextCursor, limit: input.limit },
  };
}

export function toRevertTaskEventResponseDto(
  result: RevertTaskEventMutationResult,
): RevertTaskEventResponseDto {
  return {
    task: toTaskDto(result.task),
    eventId: result.eventId,
    revertedEventId: result.revertedEventId,
  };
}
