'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';

export type ReminderSettingsDto = components['schemas']['ReminderSettingsDto'];
export type ReminderSettingsResponse = components['schemas']['ReminderSettingsResponse'];
export type UpdateReminderSettingsRequest = components['schemas']['UpdateReminderSettingsRequest'];
export type ReminderPreviewTaskDto = components['schemas']['TaskDto'];
export type ReminderPreviewTasksResponse = components['schemas']['TaskPageResponse'];

export type ReminderErrorKey =
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'network'
  | 'unknown';

export interface ReminderErrorDescriptor {
  readonly key: ReminderErrorKey;
  readonly requestId?: string;
}

const CODE_TO_KEY: Record<string, ReminderErrorKey> = {
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'unauthorized',
  ACCOUNT_INACTIVE: 'unauthorized',
  FORBIDDEN: 'forbidden',
  VALIDATION_ERROR: 'validation',
  BAD_REQUEST: 'validation',
  NETWORK_ERROR: 'network',
};

const STATUS_TO_KEY: Record<number, ReminderErrorKey> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
};

export function describeReminderError(error: unknown): ReminderErrorDescriptor | null {
  if (!error) return null;
  if (!isApiClientError(error)) {
    return { key: 'unknown' };
  }
  const key = CODE_TO_KEY[error.code] ?? STATUS_TO_KEY[error.status] ?? 'unknown';
  return { key, requestId: error.requestId };
}

export const REMINDERS_QUERY_KEYS = {
  settings: ['reminderSettings'] as const,
  previewTasks: ['myTasks', 'reminderPreview'] as const,
};

function shouldRetryReminderQuery(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error) && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return false;
  }
  return failureCount < 1;
}

export async function invalidateAfterReminderSettingsUpdate(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: REMINDERS_QUERY_KEYS.settings }),
    queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
  ]);
}

export function useReminderSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: REMINDERS_QUERY_KEYS.settings,
    queryFn: ({ signal }) => apiFetch('/settings/reminders', { signal }),
    enabled,
    retry: shouldRetryReminderQuery,
  });
}

export function buildUpdateReminderSettingsMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (payload: UpdateReminderSettingsRequest) =>
      apiFetch('/settings/reminders', { method: 'put', body: payload }),
    onSuccess: async (data: ReminderSettingsResponse) => {
      queryClient.setQueryData(REMINDERS_QUERY_KEYS.settings, data);
      await invalidateAfterReminderSettingsUpdate(queryClient);
    },
  };
}

export function useUpdateReminderSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation(buildUpdateReminderSettingsMutationOptions(queryClient));
}

export function useReminderPreviewTasksQuery(enabled: boolean) {
  return useQuery({
    queryKey: REMINDERS_QUERY_KEYS.previewTasks,
    queryFn: ({ signal }) =>
      apiFetch('/me/tasks', { query: { includeDone: false, limit: 100 }, signal }),
    enabled,
    retry: shouldRetryReminderQuery,
  });
}
