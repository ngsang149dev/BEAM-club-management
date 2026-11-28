'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/features/shared/api/client';
import {
  TASKS_QUERY_KEYS,
  invalidateTaskQueries,
  type CreateTaskDeliverableRequest,
  type CreateTaskRequest,
  type ReplaceTaskAssigneesRequest,
  type TaskMutationResponse,
  type UpdateTaskHiddenRequest,
  type UpdateTaskRequest,
} from './task-query-keys';

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateTaskRequest) =>
      apiFetch('/tasks', { method: 'post', body: payload }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.id),
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
        invalidateTaskQueries(queryClient, data.task.id),
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
        invalidateTaskQueries(queryClient, data.task.id),
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
    onSuccess: async () => {
      await Promise.all([
        invalidateTaskQueries(queryClient),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'workspaceTrash'] }),
      ]);
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

export function useUpdateTaskHiddenMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTaskHiddenRequest }) =>
      apiFetch('/tasks/{id}/hidden', { method: 'put', params: { id }, body: payload }),
    onSuccess: async (data) => {
      await Promise.all([
        invalidateTaskQueries(queryClient, data.task.id),
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
        invalidateTaskQueries(queryClient, data.task.id),
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
        invalidateTaskQueries(queryClient, data.task.id),
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
        invalidateTaskQueries(queryClient, data.task.id),
        queryClient.invalidateQueries({ queryKey: ['taskEvents', data.task.id] }),
      ]);
    },
  });
}
