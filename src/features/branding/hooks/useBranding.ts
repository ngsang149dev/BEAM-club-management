'use client';

import { useContext } from 'react';
import {
  QueryClient,
  QueryClientContext,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch, type components } from '@/features/shared/api/client';

export type BrandingResponse = components['schemas']['BrandingResponse'];
export type ImageUploadRequest = components['schemas']['ImageUploadRequest'];

export const BRANDING_QUERY_KEYS = {
  branding: ['branding'] as const,
};

const IDLE_QUERY_CLIENT = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});

function buildBrandingQueryOptions(enabled: boolean) {
  return {
    queryKey: BRANDING_QUERY_KEYS.branding,
    queryFn: ({ signal }: { signal: AbortSignal }) => apiFetch('/branding', { signal }),
    enabled,
    staleTime: 60_000,
  };
}

export function useBrandingQuery(enabled = true) {
  return useQuery(buildBrandingQueryOptions(enabled));
}

export function useOptionalClubLogoUrl(): string | null {
  const contextClient = useContext(QueryClientContext);
  const query = useQuery(
    buildBrandingQueryOptions(Boolean(contextClient)),
    contextClient ?? IDLE_QUERY_CLIENT,
  );
  return contextClient ? (query.data?.logoUrl ?? null) : null;
}

export function useUpdateClubLogoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ImageUploadRequest) =>
      apiFetch('/branding/logo', { method: 'put', body: payload }),
    onSuccess: async (data) => {
      queryClient.setQueryData(BRANDING_QUERY_KEYS.branding, data);
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
    },
  });
}

export function useRemoveClubLogoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch('/branding/logo', { method: 'delete' }),
    onSuccess: async (data) => {
      queryClient.setQueryData(BRANDING_QUERY_KEYS.branding, data);
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
    },
  });
}
