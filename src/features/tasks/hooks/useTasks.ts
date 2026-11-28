'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, isApiClientError } from '@/features/shared/api/client';
import { TASKS_QUERY_KEYS } from './task-query-keys';

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
