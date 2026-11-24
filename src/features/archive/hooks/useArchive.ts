'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';
import type { PermissionCode } from '@/features/shared/permissions/can';

export type ArchiveTab = components['schemas']['ArchiveTab'];
export type ArchivePurgeMode = components['schemas']['ArchivePurgeMode'];
export type ArchiveRetentionDays = components['schemas']['ArchiveRetentionDays'];
export type ArchiveTaskItem = components['schemas']['ArchiveTaskItem'];
export type ArchiveBoardItem = components['schemas']['ArchiveBoardItem'];
export type ArchivePageResponse = components['schemas']['ArchivePageResponse'];
export type PurgeArchiveItemResponse = components['schemas']['PurgeArchiveItemResponse'];
export type ArchiveRetentionSettingsDto = components['schemas']['ArchiveRetentionSettingsDto'];
export type ArchiveRetentionSettingsResponse =
  components['schemas']['ArchiveRetentionSettingsResponse'];
export type UpdateArchiveRetentionRequest = components['schemas']['UpdateArchiveRetentionRequest'];
export type MemberListItem = components['schemas']['MemberListItem'];

export interface ArchiveListFilters {
  readonly tab: ArchiveTab;
  readonly q: string;
  readonly limit?: number;
}

export const ARCHIVE_QUERY_KEYS = {
  all: ['archive'] as const,
  list: (filters: ArchiveListFilters) => ['archive', 'list', filters] as const,
  retention: ['archive', 'retention'] as const,
};

const ARCHIVE_INVALIDATION_KEYS = [
  ['archive'],
  ['boards'],
  ['boardDetail'],
  ['board'],
  ['myTasks'],
  ['taskDetail'],
  ['tasks', 'assigneeMembers'],
  ['members'],
  ['departments'],
  ['auditLogs'],
  ['permissions', 'members'],
] as const;

export function getPermittedArchiveTabs(
  isAdmin: boolean,
  can: (permission: PermissionCode) => boolean
): ArchiveTab[] {
  const tabs: ArchiveTab[] = [];
  if (isAdmin || can('task.delete')) tabs.push('tasks');
  if (isAdmin || can('member.deactivate')) tabs.push('members');
  if (isAdmin || can('board.delete')) tabs.push('boards');
  return tabs;
}

export async function invalidateAfterArchiveMutation(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    ARCHIVE_INVALIDATION_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );
}

function shouldRetryArchiveQuery(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error) && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return false;
  }
  return failureCount < 1;
}

function buildArchiveListQuery(filters: ArchiveListFilters, cursor?: string) {
  const trimmedQ = filters.q.trim();
  return {
    tab: filters.tab,
    ...(trimmedQ ? { q: trimmedQ } : {}),
    ...(cursor ? { cursor } : {}),
    limit: filters.limit ?? 20,
  };
}

export function useArchiveInfiniteQuery(filters: ArchiveListFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ARCHIVE_QUERY_KEYS.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/archive', {
        query: buildArchiveListQuery(filters, pageParam),
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
    retry: shouldRetryArchiveQuery,
  });
}

export function useArchiveRetentionQuery(enabled = true) {
  return useQuery({
    queryKey: ARCHIVE_QUERY_KEYS.retention,
    queryFn: ({ signal }) => apiFetch('/settings/archive-retention', { signal }),
    enabled,
    retry: shouldRetryArchiveQuery,
  });
}

export function useUpdateArchiveRetentionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateArchiveRetentionRequest) =>
      apiFetch('/settings/archive-retention', { method: 'put', body: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ARCHIVE_QUERY_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
      ]);
    },
  });
}

export function useRestoreArchiveTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/archive/tasks/{id}/restore', { method: 'post', params: { id } }),
    onSuccess: async () => {
      await invalidateAfterArchiveMutation(queryClient);
    },
  });
}

export function useRestoreArchiveMemberMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/archive/members/{id}/restore', { method: 'post', params: { id } }),
    onSuccess: async () => {
      await invalidateAfterArchiveMutation(queryClient);
    },
  });
}

export function useRestoreArchiveBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/archive/boards/{id}/restore', { method: 'post', params: { id } }),
    onSuccess: async () => {
      await invalidateAfterArchiveMutation(queryClient);
    },
  });
}

export function usePurgeArchiveItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entityType, id }: { entityType: ArchiveTab; id: string }) =>
      apiFetch('/archive/{entityType}/{id}', { method: 'delete', params: { entityType, id } }),
    onSuccess: async () => {
      await invalidateAfterArchiveMutation(queryClient);
    },
  });
}
