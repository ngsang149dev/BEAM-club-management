'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';
import type { TaskPriority } from '@/lib/tasks';

export type TaskDto = components['schemas']['TaskDto'];
export type TaskResponse = components['schemas']['TaskResponse'];
export type TaskPageResponse = components['schemas']['TaskPageResponse'];
export type TaskMutationResponse = components['schemas']['TaskMutationResponse'];
export type CreateTaskRequest = components['schemas']['CreateTaskRequest'];
export type UpdateTaskRequest = components['schemas']['UpdateTaskRequest'];
export type MoveTaskRequest = components['schemas']['MoveTaskRequest'];
export type ReplaceTaskAssigneesRequest = components['schemas']['ReplaceTaskAssigneesRequest'];
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

export const TASKS_QUERY_KEYS = {
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

function compareBoardTaskPositions(a: TaskDto, b: TaskDto): number {
  const diff = Number(a.position) - Number(b.position);
  return Number.isFinite(diff) && diff !== 0 ? diff : a.createdAt.localeCompare(b.createdAt);
}

function computeOptimisticMovePosition(
  siblings: readonly TaskDto[],
  beforeId: string | null | undefined,
  afterId: string | null | undefined
): number {
  if (siblings.length === 0) return 1000;
  const beforeIdx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  if (beforeIdx >= 0) {
    const beforePos = Number(siblings[beforeIdx]!.position);
    const nextPos =
      beforeIdx + 1 < siblings.length ? Number(siblings[beforeIdx + 1]!.position) : beforePos + 2000;
    return (beforePos + nextPos) / 2;
  }
  const afterIdx = afterId ? siblings.findIndex((s) => s.id === afterId) : -1;
  if (afterIdx >= 0) {
    const afterPos = Number(siblings[afterIdx]!.position);
    const prevPos = afterIdx > 0 ? Number(siblings[afterIdx - 1]!.position) : afterPos - 2000;
    return (prevPos + afterPos) / 2;
  }
  return Number(siblings[siblings.length - 1]!.position) + 1000;
}

function updateColumnCountsOnMove(
  columns: BoardDetailResponse['board']['columns'],
  fromColumnId: string | null,
  toColumnId: string
): BoardDetailResponse['board']['columns'] {
  if (fromColumnId === toColumnId) return [...columns];
  return columns.map((col) => {
    if (col.id === fromColumnId) return { ...col, taskCount: Math.max(0, col.taskCount - 1) };
    if (col.id === toColumnId) return { ...col, taskCount: col.taskCount + 1 };
    return col;
  });
}

export function updateCachedBoardDetailOnTaskMove(
  cached: BoardDetailResponse | undefined,
  taskId: string,
  payload: MoveTaskRequest
): BoardDetailResponse | undefined {
  if (!cached) return cached;
  const moving = cached.board.tasks.find((t) => t.id === taskId);
  if (!moving) return cached;
  const siblings = cached.board.tasks
    .filter((t) => t.id !== taskId && t.columnId === payload.columnId)
    .sort(compareBoardTaskPositions);
  const nextPosition = computeOptimisticMovePosition(siblings, payload.beforeId, payload.afterId);
  const nextTasks = cached.board.tasks.map((t) =>
    t.id === taskId ? { ...t, columnId: payload.columnId, position: nextPosition } : t
  );
  const nextColumns = updateColumnCountsOnMove(cached.board.columns, moving.columnId, payload.columnId);
  return { board: { ...cached.board, columns: nextColumns, tasks: nextTasks } };
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
