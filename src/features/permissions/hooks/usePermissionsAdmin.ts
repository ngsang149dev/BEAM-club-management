'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { AUTH_QUERY_KEYS } from '@/features/auth/hooks/useAuth';
import { apiFetch, type components } from '@/features/shared/api/client';
import type { PermissionCode } from '@/features/shared/permissions/can';
import type { PermissionPresetCode } from '@/lib/permissions';

export type PermissionDto = components['schemas']['PermissionDto'];
export type PermissionCatalogResponse = components['schemas']['PermissionCatalogResponse'];
export type PermissionPresetDto = components['schemas']['PermissionPresetDto'];
export type PermissionPresetListResponse = components['schemas']['PermissionPresetListResponse'];
export type MemberPermissionsResponse = components['schemas']['MemberPermissionsResponse'];
export type UpdateAdminFlagResponse = components['schemas']['UpdateAdminFlagResponse'];
export type MemberListItem = components['schemas']['MemberListItem'];

export const PERMISSIONS_ADMIN_KEYS = {
  catalog: ['permissions', 'catalog'] as const,
  presets: ['permissions', 'presets'] as const,
  membersRoot: ['permissions', 'members'] as const,
  memberList: (q: string) => ['permissions', 'members', q] as const,
  memberPermissions: (userId: string) => ['memberPermissions', userId] as const,
};

async function invalidateAfterPermissionMutation(
  queryClient: QueryClient,
  userId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: PERMISSIONS_ADMIN_KEYS.memberPermissions(userId) }),
    queryClient.invalidateQueries({ queryKey: PERMISSIONS_ADMIN_KEYS.membersRoot }),
    queryClient.invalidateQueries({ queryKey: ['members'] }),
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.session }),
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.me }),
    queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
  ]);
}

export function usePermissionCatalogQuery(enabled: boolean) {
  return useQuery({
    queryKey: PERMISSIONS_ADMIN_KEYS.catalog,
    queryFn: ({ signal }) => apiFetch('/permissions', { signal }),
    enabled,
  });
}

export function usePermissionPresetsQuery(enabled: boolean) {
  return useQuery({
    queryKey: PERMISSIONS_ADMIN_KEYS.presets,
    queryFn: ({ signal }) => apiFetch('/permission-presets', { signal }),
    enabled,
  });
}

export function usePermissionMembersQuery(q: string, enabled: boolean) {
  const trimmed = q.trim();
  return useInfiniteQuery({
    queryKey: PERMISSIONS_ADMIN_KEYS.memberList(trimmed),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/members', {
        query: {
          ...(trimmed ? { q: trimmed } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
          limit: 50,
        },
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
  });
}

export function useMemberPermissionsQuery(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: PERMISSIONS_ADMIN_KEYS.memberPermissions(userId ?? 'none'),
    queryFn: ({ signal }) =>
      apiFetch('/members/{id}/permissions', {
        params: { id: userId ?? '' },
        signal,
      }),
    enabled: enabled && Boolean(userId),
  });
}

export function useReplaceMemberPermissionsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      permissionCodes,
    }: {
      userId: string;
      permissionCodes: PermissionCode[];
    }) =>
      apiFetch('/members/{id}/permissions', {
        method: 'put',
        params: { id: userId },
        body: { permissionCodes },
      }),
    onSuccess: async (_data, variables) => {
      await invalidateAfterPermissionMutation(queryClient, variables.userId);
    },
  });
}

export function useApplyPermissionPresetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      presetCode,
    }: {
      userId: string;
      presetCode: PermissionPresetCode;
    }) =>
      apiFetch('/members/{id}/permissions/apply-preset', {
        method: 'post',
        params: { id: userId },
        body: { presetCode },
      }),
    onSuccess: async (_data, variables) => {
      await invalidateAfterPermissionMutation(queryClient, variables.userId);
    },
  });
}

export function useUpdateAdminFlagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      apiFetch('/members/{id}/admin', {
        method: 'put',
        params: { id: userId },
        body: { isAdmin },
      }),
    onSuccess: async (_data, variables) => {
      await invalidateAfterPermissionMutation(queryClient, variables.userId);
    },
  });
}
