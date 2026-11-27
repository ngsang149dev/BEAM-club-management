'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch, type components } from '@/features/shared/api/client';
import { updateCachedBoardDetailOnTaskMove } from '../optimistic-move';
import {
  TASKS_QUERY_KEYS,
  invalidateTaskQueries,
  type BoardDetailResponse,
  type CreateTaskDeliverableRequest,
  type CreateTaskRequest,
  type MoveTaskRequest,
  type ReplaceTaskAssigneesRequest,
  type TaskMutationResponse,
  type UpdateTaskHiddenRequest,
  type UpdateTaskRequest,
} from './task-query-keys';

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateTaskRequest) =>
      apiFetch('/tasks', {
        method: 'post',
        body: payload as components['schemas']['CreateTaskRequest'],
      }),
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
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
      ]);
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
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
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
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
      ]);
    },
  });
}

export function useUpdateTaskAcceptanceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      apiFetch('/tasks/{id}/acceptance', {
        method: 'put',
        params: { id },
        body: { accepted },
      }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
      ]);
    },
  });
}

export function useCreateTaskDeliverableMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateTaskDeliverableRequest }) =>
      apiFetch('/tasks/{id}/deliverables', { method: 'post', params: { id }, body: payload }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
      ]);
    },
  });
}

export function useDeleteTaskDeliverableMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, deliverableId }: { id: string; deliverableId: string }) =>
      apiFetch('/tasks/{id}/deliverables/{deliverableId}', {
        method: 'delete',
        params: { id, deliverableId },
      }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.boardId, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
      ]);
    },
  });
}
