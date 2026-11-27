'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { BOARDS_QUERY_KEYS } from '@/features/boards/hooks/useBoards';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';
import { TASKS_QUERY_KEYS } from '@/features/tasks/hooks/useTasks';

export type CommentDto = components['schemas']['CommentDto'];
export type CommentPageResponse = components['schemas']['CommentPageResponse'];
export type CreateCommentRequest = components['schemas']['CreateCommentRequest'];
export type CreateCommentResponse = components['schemas']['CreateCommentResponse'];
export type DeleteCommentResponse = components['schemas']['DeleteCommentResponse'];

export const COMMENTS_PAGE_SIZE = 10;

export const COMMENTS_QUERY_KEYS = {
  root: ['comments'] as const,
  byTask: (taskId: string) => ['comments', 'task', taskId] as const,
};

function shouldRetryCommentQuery(failureCount: number, error: unknown): boolean {
  if (
    isApiClientError(error) &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    return false;
  }
  return failureCount < 1;
}

async function invalidateCommentQueries(
  queryClient: QueryClient,
  taskId: string,
  boardId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: COMMENTS_QUERY_KEYS.byTask(taskId) }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.detail(taskId) }),
    ...(boardId
      ? [queryClient.invalidateQueries({ queryKey: BOARDS_QUERY_KEYS.detail(boardId) })]
      : []),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.boardListRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.myTasksRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.progressRoot }),
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    queryClient.invalidateQueries({ queryKey: ['archive'] }),
  ]);
}

export function useTaskCommentsInfiniteQuery(taskId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: COMMENTS_QUERY_KEYS.byTask(taskId ?? 'none'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/tasks/{id}/comments', {
        params: { id: taskId ?? '' },
        query: { ...(pageParam ? { cursor: pageParam } : {}), limit: COMMENTS_PAGE_SIZE },
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled: enabled && Boolean(taskId),
    retry: shouldRetryCommentQuery,
  });
}

export function useCreateCommentMutation(taskId: string, boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateCommentRequest) =>
      apiFetch('/tasks/{id}/comments', {
        method: 'post',
        params: { id: taskId },
        body: payload,
      }),
    onSuccess: async () => {
      await invalidateCommentQueries(queryClient, taskId, boardId);
    },
  });
}

export function useDeleteCommentMutation(taskId: string, boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch('/comments/{id}', {
        method: 'delete',
        params: { id: commentId },
      }),
    onSuccess: async () => {
      await invalidateCommentQueries(queryClient, taskId, boardId);
    },
  });
}
