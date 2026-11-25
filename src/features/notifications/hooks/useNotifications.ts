'use client';

import { useContext } from 'react';
import {
  QueryClient,
  QueryClientContext,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';

export type NotificationDto = components['schemas']['NotificationDto'];
export type NotificationPageResponse = components['schemas']['NotificationPageResponse'];
export type NotificationReadResponse = components['schemas']['NotificationReadResponse'];
export type NotificationReadAllResponse = components['schemas']['NotificationReadAllResponse'];

export const NOTIFICATIONS_QUERY_KEYS = {
  root: ['notifications'] as const,
  list: (unreadOnly?: boolean) => ['notifications', 'list', { unreadOnly }] as const,
};

const IDLE_QUERY_CLIENT = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});

function shouldRetryNotificationQuery(failureCount: number, error: unknown): boolean {
  if (
    isApiClientError(error) &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    return false;
  }
  return failureCount < 1;
}

export function useNotificationsQuery(enabled = true) {
  const contextClient = useContext(QueryClientContext);
  const queryEnabled = enabled && Boolean(contextClient);

  return useQuery(
    {
      queryKey: NOTIFICATIONS_QUERY_KEYS.list(),
      queryFn: ({ signal }) => apiFetch('/notifications', { query: { limit: 20 }, signal }),
      enabled: queryEnabled,
      refetchInterval: queryEnabled ? 30_000 : false,
      retry: shouldRetryNotificationQuery,
    },
    contextClient ?? IDLE_QUERY_CLIENT,
  );
}

export function buildMarkNotificationReadMutationOptions(targetClient: QueryClient) {
  return {
    mutationFn: (id: string) =>
      apiFetch('/notifications/{id}/read', { method: 'post', params: { id } }),
    onSuccess: async (data: NotificationReadResponse) => {
      targetClient.setQueryData<NotificationPageResponse>(
        NOTIFICATIONS_QUERY_KEYS.list(),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            unreadCount: data.unreadCount,
            items: old.items.map((item) =>
              item.id === data.notification.id ? data.notification : item
            ),
          };
        }
      );
      await targetClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.root });
    },
    onError: async (error: unknown) => {
      if (isApiClientError(error) && error.status === 404) {
        await targetClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.root });
      }
    },
  };
}

export function useMarkNotificationReadMutation() {
  const contextClient = useContext(QueryClientContext);
  const targetClient = contextClient ?? IDLE_QUERY_CLIENT;
  return useMutation(buildMarkNotificationReadMutationOptions(targetClient), targetClient);
}

export function buildMarkAllNotificationsReadMutationOptions(targetClient: QueryClient) {
  return {
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'post' }),
    onSuccess: async (data: NotificationReadAllResponse) => {
      const nowIso = new Date().toISOString();
      targetClient.setQueryData<NotificationPageResponse>(
        NOTIFICATIONS_QUERY_KEYS.list(),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            unreadCount: data.unreadCount,
            items: old.items.map((item) =>
              item.readAt === null ? { ...item, readAt: nowIso } : item
            ),
          };
        }
      );
      await targetClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEYS.root });
    },
  };
}

export function useMarkAllNotificationsReadMutation() {
  const contextClient = useContext(QueryClientContext);
  const targetClient = contextClient ?? IDLE_QUERY_CLIENT;
  return useMutation(buildMarkAllNotificationsReadMutationOptions(targetClient), targetClient);
}
