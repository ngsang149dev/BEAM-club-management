'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch, type components } from '@/features/shared/api/client';
import { AUDIT_QUERY_KEYS } from '@/features/audit/hooks/useAuditLogs';
import { AUTH_QUERY_KEYS } from '@/features/auth/hooks/useAuth';
import { DEPARTMENT_QUERY_KEYS } from '@/features/departments/hooks/useDepartments';

export type MemberDetail = components['schemas']['MemberDetail'];
export type MemberPublicSummary = components['schemas']['MemberPublicSummary'];
export type MemberListItem = components['schemas']['MemberListItem'];
export type MemberPageResponse = components['schemas']['MemberPageResponse'];
export type MemberItemResponse = components['schemas']['MemberItemResponse'];
export type CreateMemberRequest = components['schemas']['CreateMemberRequest'];
export type UpdateMemberRequest = components['schemas']['UpdateMemberRequest'];
export type ResetMemberPasswordRequest = components['schemas']['ResetMemberPasswordRequest'];
export type ImageUploadRequest = components['schemas']['ImageUploadRequest'];

export type MemberStatusFilter = 'active' | 'inactive' | 'all';

export interface MembersFilterState {
  q: string;
  departmentId: string;
  status: MemberStatusFilter;
  limit?: number;
}

export const MEMBERS_QUERY_KEYS = {
  all: ['members'] as const,
  list: (filters: MembersFilterState) => ['members', 'list', filters] as const,
};

export function isMemberDetail(member: MemberListItem): member is MemberDetail {
  return (
    'studentId' in member &&
    typeof member.studentId === 'string' &&
    'email' in member &&
    typeof member.email === 'string'
  );
}

function buildMembersQuery(
  filters: MembersFilterState,
  cursor: string | undefined
): {
  q?: string;
  departmentId?: string;
  isActive?: boolean;
  cursor?: string;
  limit?: number;
} {
  const trimmedQuery = filters.q.trim();
  return {
    ...(trimmedQuery ? { q: trimmedQuery } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.status === 'all' ? {} : { isActive: filters.status === 'active' }),
    ...(cursor ? { cursor } : {}),
    limit: filters.limit ?? 20,
  };
}

export function useMembersInfiniteQuery(filters: MembersFilterState, enabled = true) {
  return useInfiniteQuery({
    queryKey: MEMBERS_QUERY_KEYS.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/members', {
        query: buildMembersQuery(filters, pageParam),
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
  });
}

export function useCreateMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateMemberRequest) =>
      apiFetch('/members', { method: 'post', body: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
      ]);
    },
  });
}

export function useUpdateMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateMemberRequest }) =>
      apiFetch('/members/{id}', { method: 'patch', params: { id }, body: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.me }),
      ]);
    },
  });
}

export function useDeactivateMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/members/{id}/deactivate', { method: 'post', params: { id } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
      ]);
    },
  });
}

export function useActivateMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/members/{id}/activate', { method: 'post', params: { id } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: DEPARTMENT_QUERY_KEYS.all }),
      ]);
    },
  });
}

export function useResetMemberPasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ResetMemberPasswordRequest }) =>
      apiFetch('/members/{id}/reset-password', { method: 'post', params: { id }, body: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_KEYS.all }),
      ]);
    },
  });
}

export async function invalidateMemberAvatarRelatedQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEYS.all }),
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.me }),
    queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_KEYS.all }),
    queryClient.invalidateQueries({ queryKey: ['boardDetail'] }),
    queryClient.invalidateQueries({ queryKey: ['taskDetail'] }),
    queryClient.invalidateQueries({ queryKey: ['myTasks'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks', 'assigneeMembers'] }),
  ]);
}

export function useUpdateMemberAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dataUrl }: { id: string; dataUrl: string }) =>
      apiFetch('/members/{id}/avatar', {
        method: 'put',
        params: { id },
        body: { dataUrl },
      }),
    onSuccess: async () => {
      await invalidateMemberAvatarRelatedQueries(queryClient);
    },
  });
}

export function useRemoveMemberAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/members/{id}/avatar', { method: 'delete', params: { id } }),
    onSuccess: async () => {
      await invalidateMemberAvatarRelatedQueries(queryClient);
    },
  });
}
