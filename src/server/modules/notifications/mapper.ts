import type { NotificationType } from '@/lib/notifications';
import {
  type TaskMemberPublicSummaryDto,
  toTaskMemberPublicSummaryDto,
} from '@/server/modules/tasks';
import type { NotificationRecord } from './types';

export interface NotificationDto {
  readonly id: string;
  readonly type: NotificationType;
  readonly taskId: string;
  readonly boardId: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly boardName: string;
  readonly taskTitle: string | null;
  readonly isHiddenTask: boolean;
  readonly actor: TaskMemberPublicSummaryDto;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface NotificationPageResponseDto {
  readonly items: NotificationDto[];
  readonly unreadCount: number;
  readonly meta: {
    readonly nextCursor: string | null;
    readonly limit: number;
  };
}

export interface NotificationReadResponseDto {
  readonly notification: NotificationDto;
  readonly unreadCount: number;
}

export interface NotificationReadAllResponseDto {
  readonly updatedCount: number;
  readonly unreadCount: number;
}

export function toNotificationDto(record: NotificationRecord): NotificationDto {
  return {
    id: record.id,
    type: record.type,
    taskId: record.taskId,
    boardId: record.boardId,
    departmentId: record.departmentId,
    departmentName: record.departmentName,
    boardName: record.boardName,
    taskTitle: record.isHiddenTask ? null : record.taskTitle,
    isHiddenTask: record.isHiddenTask,
    actor: toTaskMemberPublicSummaryDto(record.actor),
    readAt: record.readAt ? record.readAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toNotificationPageResponseDto(input: {
  readonly items: readonly NotificationRecord[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
  readonly limit: number;
}): NotificationPageResponseDto {
  return {
    items: input.items.map(toNotificationDto),
    unreadCount: input.unreadCount,
    meta: {
      nextCursor: input.nextCursor,
      limit: input.limit,
    },
  };
}

export function toNotificationReadResponseDto(input: {
  readonly notification: NotificationRecord;
  readonly unreadCount: number;
}): NotificationReadResponseDto {
  return {
    notification: toNotificationDto(input.notification),
    unreadCount: input.unreadCount,
  };
}

export function toNotificationReadAllResponseDto(input: {
  readonly updatedCount: number;
  readonly unreadCount: number;
}): NotificationReadAllResponseDto {
  return {
    updatedCount: input.updatedCount,
    unreadCount: input.unreadCount,
  };
}
