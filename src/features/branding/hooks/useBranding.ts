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
export type LoginGalleryItemDto = components['schemas']['LoginGalleryItemDto'];
export type CreateLoginGalleryItemRequest =
  components['schemas']['CreateLoginGalleryItemRequest'];
export type UpdateLoginGalleryItemRequest =
  components['schemas']['UpdateLoginGalleryItemRequest'];
export type ReorderLoginGalleryRequest =
  components['schemas']['ReorderLoginGalleryRequest'];

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

export function useOptionalBranding(): BrandingResponse | null {
  const contextClient = useContext(QueryClientContext);
  const query = useQuery(
    buildBrandingQueryOptions(Boolean(contextClient)),
    contextClient ?? IDLE_QUERY_CLIENT,
  );
  return contextClient ? (query.data ?? null) : null;
}

export function useOptionalClubLogoUrl(): string | null {
  return useOptionalBranding()?.logoUrl ?? null;
}

async function syncBrandingAfterGalleryChange(
  queryClient: QueryClient,
  transform: (items: readonly LoginGalleryItemDto[]) => LoginGalleryItemDto[],
) {
  queryClient.setQueryData<BrandingResponse | undefined>(
    BRANDING_QUERY_KEYS.branding,
    (previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        galleryItems: transform(previous.galleryItems ?? []),
      };
    },
  );
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: BRANDING_QUERY_KEYS.branding }),
    queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
  ]);
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

export function useCreateGalleryItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateLoginGalleryItemRequest) =>
      apiFetch('/branding/gallery', { method: 'post', body: payload }),
    onSuccess: async (data) => {
      await syncBrandingAfterGalleryChange(queryClient, (items) =>
        [...items, data.item].sort((a, b) => a.orderIndex - b.orderIndex),
      );
    },
  });
}

export function useUpdateGalleryItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateLoginGalleryItemRequest }) =>
      apiFetch('/branding/gallery/{id}', {
        method: 'patch',
        params: { id },
        body: payload,
      }),
    onSuccess: async (data) => {
      await syncBrandingAfterGalleryChange(queryClient, (items) =>
        items.map((item) => (item.id === data.item.id ? data.item : item)),
      );
    },
  });
}

export function useDeleteGalleryItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/branding/gallery/{id}', {
        method: 'delete',
        params: { id },
      }),
    onSuccess: async (data) => {
      await syncBrandingAfterGalleryChange(queryClient, (items) =>
        items
          .filter((item) => item.id !== data.id)
          .map((item, idx) => ({ ...item, orderIndex: idx })),
      );
    },
  });
}

export function useReorderGalleryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ReorderLoginGalleryRequest) =>
      apiFetch('/branding/gallery/order', { method: 'put', body: payload }),
    onSuccess: async (data) => {
      await syncBrandingAfterGalleryChange(queryClient, () => data.items);
    },
  });
}
