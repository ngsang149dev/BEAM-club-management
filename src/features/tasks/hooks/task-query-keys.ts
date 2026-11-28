import type { QueryClient } from '@tanstack/react-query';
import type { components } from '@/features/shared/api/client';

export type TaskDto = components['schemas']['TaskDto'];
export type TaskAssigneeDto = components['schemas']['TaskAssigneeDto'];
export type TaskDeliverableDto = components['schemas']['TaskDeliverableDto'];
export type TaskResponse = components['schemas']['TaskResponse'];
export type TaskPageResponse = components['schemas']['TaskPageResponse'];
export type TaskMutationResponse = components['schemas']['TaskMutationResponse'];
export type CreateTaskRequest = components['schemas']['CreateTaskRequest'];
export type UpdateTaskRequest = components['schemas']['UpdateTaskRequest'];
export type ReplaceTaskAssigneesRequest = components['schemas']['ReplaceTaskAssigneesRequest'];
export type UpdateTaskHiddenRequest = components['schemas']['UpdateTaskHiddenRequest'];
export type UpdateTaskAcceptanceRequest = components['schemas']['UpdateTaskAcceptanceRequest'];
export type CreateTaskDeliverableRequest = components['schemas']['CreateTaskDeliverableRequest'];
export type TaskDeliverableMutationResponse = components['schemas']['TaskDeliverableMutationResponse'];
export type DeleteTaskDeliverableResponse = components['schemas']['DeleteTaskDeliverableResponse'];
export type MemberPublicSummary = components['schemas']['MemberPublicSummary'];
export type DepartmentSummaryDto = components['schemas']['DepartmentSummary'];
export type DepartmentDto = components['schemas']['DepartmentDto'];
export type NotificationDto = components['schemas']['NotificationDto'];

export const TASKS_QUERY_KEYS = {
  calendarRoot: ['tasks', 'calendar'] as const,
  detail: (taskId: string) => ['taskDetail', taskId] as const,
  progressRoot: ['tasks', 'progress'] as const,
  assigneeMembers: ['members', 'activeCatalog'] as const,
  departments: ['departments'] as const,
};

export async function invalidateTaskQueries(
  queryClient: QueryClient,
  taskId?: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.calendarRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.progressRoot }),
    queryClient.invalidateQueries({ queryKey: ['archive'] }),
    ...(taskId ? [queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.detail(taskId) })] : []),
  ]);
}
