'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch, isApiClientError } from '@/features/shared/api/client';
import { updateCachedBoardDetailOnTaskMove } from '../optimistic-move';
import {
  TASKS_QUERY_KEYS,
  type BoardTasksQueryFilters,
  type MyTasksFiltersState,
} from './task-query-keys';

export { updateCachedBoardDetailOnTaskMove };
export * from './task-query-keys';
export * from './useTaskMutations';

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
  const includeDone = filters.includeDone || filters.deadlineFilter === 'done';
  return {
    ...(trimmedQ ? { q: trimmedQ } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.boardId ? { boardId: filters.boardId } : {}),
    includeDone,
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
