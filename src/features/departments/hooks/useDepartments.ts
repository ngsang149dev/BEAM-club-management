'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type components } from '@/features/shared/api/client';

export type DepartmentDto = components['schemas']['DepartmentDto'];
export type DepartmentSummary = components['schemas']['DepartmentSummary'];
export type DepartmentListResponse = components['schemas']['DepartmentListResponse'];
export type DepartmentUpsertRequest = components['schemas']['DepartmentUpsertRequest'];
export type DepartmentLeadCandidate = components['schemas']['MemberListItem'];

export const DEPARTMENT_QUERY_KEYS = {
  all: ['departments'] as const,
  leadCandidates: ['departments', 'leadCandidates'] as const,
};

const MEMBER_LIST_KEY_PREFIX = ['members'] as const;
const TASKS_KEY_PREFIX = ['tasks'] as const;
const BOARDS_KEY_PREFIX = ['boards'] as const;

export function useDepartmentsQuery(enabled = true) {
  return useQuery({
    queryKey: DEPARTMENT_QUERY_KEYS.all,
    queryFn: ({ signal }) => apiFetch('/departments', { signal }),
    enabled,
  });
}

export function useDepartmentLeadCandidatesQuery(enabled: boolean) {
  return useQuery({
    queryKey: DEPARTMENT_QUERY_KEYS.leadCandidates,
    queryFn: ({ signal }) =>
      apiFetch('/members', { query: { isActive: true, limit: 100 }, signal }),
    enabled,
  });
}

export function useCreateDepartmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: DepartmentUpsertRequest) =>
      apiFetch('/departments', { method: 'post', body: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: TASKS_KEY_PREFIX }),
      ]);
    },
  });
}

export function useUpdateDepartmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: DepartmentUpsertRequest }) =>
      apiFetch('/departments/{id}', { method: 'patch', params: { id }, body: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: MEMBER_LIST_KEY_PREFIX }),
        queryClient.invalidateQueries({ queryKey: TASKS_KEY_PREFIX }),
        queryClient.invalidateQueries({ queryKey: BOARDS_KEY_PREFIX }),
      ]);
    },
  });
}

export function useDeleteDepartmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch('/departments/{id}', { method: 'delete', params: { id } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: MEMBER_LIST_KEY_PREFIX }),
        queryClient.invalidateQueries({ queryKey: TASKS_KEY_PREFIX }),
      ]);
    },
  });
}
