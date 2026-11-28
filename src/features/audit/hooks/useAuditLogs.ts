'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch, type components } from '@/features/shared/api/client';
import { computeAuditFromIso, type AuditDateRange } from '../formatters';

export type AuditLogDto = components['schemas']['AuditLogDto'];
export type AuditLogPageResponse = components['schemas']['AuditLogPageResponse'];
export type MemberPublicSummary = components['schemas']['MemberPublicSummary'];

export interface AuditFiltersState {
  readonly action: string;
  readonly dateRange: AuditDateRange;
  readonly actorId: string;
  readonly targetUserId: string;
  readonly limit?: number;
}

export const DEFAULT_AUDIT_FILTERS: AuditFiltersState = {
  action: '',
  dateRange: 'all',
  actorId: '',
  targetUserId: '',
  limit: 20,
};

export const AUDIT_QUERY_KEYS = {
  all: ['auditLogs'] as const,
  list: (filters: AuditFiltersState) => ['auditLogs', 'list', filters] as const,
  members: ['auditLogs', 'members'] as const,
};

function buildAuditQuery(filters: AuditFiltersState, cursor: string | undefined) {
  const from = computeAuditFromIso(filters.dateRange);
  return {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.targetUserId ? { targetUserId: filters.targetUserId } : {}),
    ...(from ? { from } : {}),
    ...(cursor ? { cursor } : {}),
    limit: filters.limit ?? 20,
  };
}

export function useAuditLogsInfiniteQuery(filters: AuditFiltersState, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: AUDIT_QUERY_KEYS.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/audit-logs', {
        query: buildAuditQuery(filters, pageParam),
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
  });
}

export function useAuditMembersFilterQuery(enabled: boolean) {
  return useQuery({
    queryKey: AUDIT_QUERY_KEYS.members,
    queryFn: ({ signal }) => apiFetch('/members', { query: { limit: 100 }, signal }),
    enabled,
  });
}
