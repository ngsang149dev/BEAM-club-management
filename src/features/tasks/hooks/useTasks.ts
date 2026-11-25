'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';
import type { TaskDueStatus, TaskPriority, TaskSortBy, TaskSortOrder } from '@/lib/tasks';
import { updateCachedBoardDetailOnTaskMove } from '../optimistic-move';

export { updateCachedBoardDetailOnTaskMove };

export type TaskDto = components['schemas']['TaskDto'];
export type TaskResponse = components['schemas']['TaskResponse'];
export type TaskPageResponse = components['schemas']['TaskPageResponse'];
export type TaskMutationResponse = components['schemas']['TaskMutationResponse'];
export type CreateTaskRequest = components['schemas']['CreateTaskRequest'];
export type UpdateTaskRequest = components['schemas']['UpdateTaskRequest'];
export type MoveTaskRequest = components['schemas']['MoveTaskRequest'];
export type ReplaceTaskAssigneesRequest = components['schemas']['ReplaceTaskAssigneesRequest'];
export type UpdateTaskHiddenRequest = components['schemas']['UpdateTaskHiddenRequest'];
export type MemberPublicSummary = components['schemas']['MemberPublicSummary'];
export type DepartmentSummaryDto = components['schemas']['DepartmentSummary'];
export type DepartmentDto = components['schemas']['DepartmentDto'];
export type NotificationDto = components['schemas']['NotificationDto'];
export type BoardDetailResponse = components['schemas']['BoardDetailResponse'];

export interface MyTasksFiltersState {
  readonly q: string;
  readonly priority: '' | TaskPriority;
  readonly departmentId: string;
  readonly includeDone: boolean;
  readonly boardId?: string;
  readonly limit?: number;
}

export const DEFAULT_MY_TASKS_FILTERS: MyTasksFiltersState = {
  q: '',
  priority: '',
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
  boardListRoot: ['tasks', 'boardList'] as const,
  boardList: (boardId: string, filters: BoardTasksQueryFilters) =>
    ['tasks', 'boardList', boardId, filters] as const,
  detail: (taskId: string) => ['taskDetail', taskId] as const,
  myTasksRoot: ['myTasks'] as const,
  myTasksList: (filters: MyTasksFiltersState) => ['myTasks', 'list', filters] as const,
  assigneeMembers: ['tasks', 'assigneeMembers'] as const,
  departments: ['tasks', 'departments'] as const,
};

async function invalidateTaskQueries(
  queryClient: QueryClient,
  boardId: string,
  taskId?: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['boards'] }),
    queryClient.invalidateQueries({ queryKey: ['boardDetail', boardId] }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.boardListRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.myTasksRoot }),
    ...(taskId ? [queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.detail(taskId) })] : []),
  ]);
}

function shouldRetryTaskDetail(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error) && (error.status === 404 || error.status === 403 || error.status === 401)) {
    return false;
  }
  return failureCount < 1;
}

export function useTaskDetailQuery(taskId: string | null) {
  return useQuery({
    queryKey: TASKS_QUERY_KEYS.detail(taskId ?? 'none'),
    queryFn: ({ signal }) => apiFetch('/tasks/{id}', { params: { id: taskId ?? '' }, signal }),
    enabled: Boolean(taskId),
    retry: shouldRetryTaskDetail,
  });
}

function buildMyTasksQuery(filters: MyTasksFiltersState, cursor?: string) {
  const trimmedQ = filters.q.trim();
  return {
    ...(trimmedQ ? { q: trimmedQ } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.boardId ? { boardId: filters.boardId } : {}),
    includeDone: filters.includeDone,
    ...(cursor ? { cursor } : {}),
    limit: filters.limit ?? 20,
  };
}

export function buildBoardTasksQueryParams(boardId: string, filters: BoardTasksQueryFilters) {
  const trimmedQ = filters.q.trim();
  return {
    boardId,
    ...(trimmedQ ? { q: trimmedQ } : {}),
    ...(filters.columnId ? { columnId: filters.columnId } : {}),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.dueStatus ? { dueStatus: filters.dueStatus } : {}),
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    limit: 100,
  };
}

export function useBoardFilteredTasksQuery(
  boardId: string,
  filters: BoardTasksQueryFilters,
  enabled: boolean
) {
  const normalizedFilters: BoardTasksQueryFilters = { ...filters, q: filters.q.trim() };
  return useQuery({
    queryKey: TASKS_QUERY_KEYS.boardList(boardId, normalizedFilters),
    queryFn: ({ signal }) =>
      apiFetch('/tasks', {
        query: buildBoardTasksQueryParams(boardId, normalizedFilters),
        signal,
      }),
    enabled: enabled && Boolean(boardId),
  });
}

export function useMyTasksInfiniteQuery(filters: MyTasksFiltersState, enabled = true) {
  return useInfiniteQuery({
    queryKey: TASKS_QUERY_KEYS.myTasksList(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/me/tasks', { query: buildMyTasksQuery(filters, pageParam), signal }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
  });
}

export function useTaskAssigneeMembersQuery(enabled: boolean) {
  return useQuery({
    queryKey: TASKS_QUERY_KEYS.assigneeMembers,
    queryFn: ({ signal }) => apiFetch('/members', { query: { isActive: true, limit: 100 }, signal }),
    enabled,
  });
}

export function useTaskDepartmentsQuery(enabled = true) {
  return useQuery({
    queryKey: TASKS_QUERY_KEYS.departments,
    queryFn: ({ signal }) => apiFetch('/departments', { signal }),
    enabled,
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateTaskRequest) => apiFetch('/tasks', { method: 'post', body: payload }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTaskRequest }) =>
      apiFetch('/tasks/{id}', { method: 'patch', params: { id }, body: payload }),
    onSuccess: async (data) => {
      await invalidateTaskQueries(queryClient, data.task.boardId, data.task.id);
    },
  });
}

export function useReplaceTaskAssigneesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReplaceTaskAssigneesRequest }) =>
      apiFetch('/tasks/{id}/assignees', { method: 'put', params: { id }, body: payload }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });
}

export function buildDeleteTaskMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (id: string) => apiFetch('/tasks/{id}', { method: 'delete', params: { id } }),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEYS.detail(id) });
    },
    onSuccess: async (data: TaskMutationResponse) => {
      await invalidateTaskQueries(queryClient, data.task.boardId);
    },
    onSettled: (_data: TaskMutationResponse | undefined, error: unknown, id: string) => {
      if (!error) {
        queryClient.removeQueries({ queryKey: TASKS_QUERY_KEYS.detail(id), exact: true });
      }
    },
  };
}

export function useDeleteTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation(buildDeleteTaskMutationOptions(queryClient));
}

export function useMoveTaskMutation(boardId: string) {
  const queryClient = useQueryClient();
  const boardKey = ['boardDetail', boardId] as const;

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MoveTaskRequest }) =>
      apiFetch('/tasks/{id}/move', { method: 'post', params: { id }, body: payload }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardDetailResponse>(boardKey);
      queryClient.setQueryData<BoardDetailResponse>(boardKey, (old) =>
        updateCachedBoardDetailOnTaskMove(old, variables.id, variables.payload)
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardKey, context.previous);
      }
    },
    onSettled: async (_data, _error, variables) => {
      await invalidateTaskQueries(queryClient, boardId, variables.id);
    },
  });
}

export function useUpdateTaskHiddenMutation(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTaskHiddenRequest }) =>
      apiFetch('/tasks/{id}/hidden', { method: 'put', params: { id }, body: payload }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, boardId || data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['boards', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['archive'] }),
      ]);
    },
  });
}
