import type { QueryClient } from '@tanstack/react-query';
import type { components } from '@/features/shared/api/client';
import type { TaskDueStatus, TaskPriority, TaskSortBy, TaskSortOrder } from '@/lib/tasks';
import type { CalendarDeadlineTier } from '../formatters';

export type TaskDto = components['schemas']['TaskDto'];
export type TaskAssigneeDto = components['schemas']['TaskAssigneeDto'];
export type TaskDeliverableDto = components['schemas']['TaskDeliverableDto'];
export type TaskResponse = components['schemas']['TaskResponse'];
export type TaskPageResponse = components['schemas']['TaskPageResponse'];
export type TaskMutationResponse = components['schemas']['TaskMutationResponse'];
export type CreateTaskRequest = Omit<components['schemas']['CreateTaskRequest'], 'priority'> & {
  priority?: number;
};
export type UpdateTaskRequest = components['schemas']['UpdateTaskRequest'];
export type MoveTaskRequest = components['schemas']['MoveTaskRequest'];
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
export type BoardDetailResponse = components['schemas']['BoardDetailResponse'];

export type MyTasksDeadlineFilter = '' | Exclude<CalendarDeadlineTier, 'unscheduled'>;

export interface MyTasksFiltersState {
  readonly q: string;
  readonly deadlineFilter: MyTasksDeadlineFilter;
  readonly departmentId: string;
  readonly includeDone: boolean;
  readonly boardId?: string;
  readonly limit?: number;
}

export const DEFAULT_MY_TASKS_FILTERS: MyTasksFiltersState = {
  q: '',
  deadlineFilter: '',
  departmentId: '',
  includeDone: false,
  limit: 20,
};

export interface BoardTasksQueryFilters {
  readonly q: string;
  readonly departmentId: string;
  readonly assigneeId: string;
  readonly priority: '' | TaskPriority;
  readonly dueStatus: '' | TaskDueStatus;
  readonly columnId: string;
  readonly sortBy: TaskSortBy;
  readonly sortOrder: TaskSortOrder;
}

export const TASKS_QUERY_KEYS = {
  calendarRoot: ['tasks', 'calendar'] as const,
  boardListRoot: ['tasks', 'boardList'] as const,
  boardList: (boardId: string, filters: BoardTasksQueryFilters) =>
    ['tasks', 'boardList', boardId, filters] as const,
  detail: (taskId: string) => ['taskDetail', taskId] as const,
  myTasksRoot: ['myTasks'] as const,
  myTasksList: (filters: MyTasksFiltersState) => ['myTasks', 'list', filters] as const,
  progressRoot: ['tasks', 'progress'] as const,
  assigneeMembers: ['tasks', 'assigneeMembers'] as const,
  departments: ['tasks', 'departments'] as const,
};

export async function invalidateTaskQueries(
  queryClient: QueryClient,
  boardId: string,
  taskId?: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.calendarRoot }),
    queryClient.invalidateQueries({ queryKey: ['boards'] }),
    queryClient.invalidateQueries({ queryKey: ['boardDetail', boardId] }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.boardListRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.myTasksRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.progressRoot }),
    ...(taskId ? [queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.detail(taskId) })] : []),
  ]);
}
