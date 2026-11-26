'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';
import { resolveImageUploadErrorKey } from '@/features/shared/image-compress';
import { writeLocaleCookie, type AppLocale } from '@/i18n/locale';
import { sanitizeReturnTo } from '../return-to';

export { resolveImageUploadErrorKey as resolveAuthImageErrorKey };

export type LoginRequest = Omit<components['schemas']['LoginRequest'], 'remember'> & {
  remember?: boolean;
};
export type LoginResponse = components['schemas']['LoginResponse'];
export type SessionInfoResponse = components['schemas']['SessionInfoResponse'];
export type MeResponse = components['schemas']['MeResponse'];
export type ChangeMyPasswordRequest = components['schemas']['ChangeMyPasswordRequest'];
export type ImageUploadRequest = components['schemas']['ImageUploadRequest'];

export const AUTH_QUERY_KEYS = {
  session: ['auth', 'session'] as const,
  me: ['auth', 'me'] as const,
  loggedOut: ['auth', 'loggedOut'] as const,
};

export function useLoggedOutState(): boolean {
  const { data } = useQuery<boolean>({
    queryKey: AUTH_QUERY_KEYS.loggedOut,
    queryFn: () => false,
    enabled: false,
    initialData: false,
  });
  return Boolean(data);
}

function shouldRetryAuthQuery(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error) && error.status === 401) {
    return false;
  }
  return failureCount < 1;
}

export function useSessionQuery(enabled = true) {
  const isLoggedOut = useLoggedOutState();
  return useQuery({
    queryKey: AUTH_QUERY_KEYS.session,
    queryFn: ({ signal }) => apiFetch('/auth/session', { signal }),
    enabled: enabled && !isLoggedOut,
    retry: shouldRetryAuthQuery,
    refetchOnWindowFocus: true,
  });
}

export function useMeQuery(enabled = true) {
  const isLoggedOut = useLoggedOutState();
  return useQuery({
    queryKey: AUTH_QUERY_KEYS.me,
    queryFn: ({ signal }) => apiFetch('/me', { signal }),
    enabled: enabled && !isLoggedOut,
    retry: shouldRetryAuthQuery,
  });
}

export function resolveLoginRedirectTarget(
  returnToInput: string | null | undefined,
  response: LoginResponse
): string {
  const hasExplicitReturnTo =
    typeof returnToInput === 'string' && returnToInput.trim().length > 0;
  if (!hasExplicitReturnTo && response.user.mustChangePassword) {
    return '/profile?changePassword=1';
  }
  return sanitizeReturnTo(response.redirectTo);
}

export function useLoginMutation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: LoginRequest) =>
      apiFetch('/auth/login', {
        method: 'post',
        body: payload as components['schemas']['LoginRequest'],
      }),
    onSuccess: (data, variables) => {
      writeLocaleCookie(data.user.locale);
      queryClient.clear();
      queryClient.setQueryData(AUTH_QUERY_KEYS.loggedOut, false);
      router.replace(resolveLoginRedirectTarget(variables.returnTo, data));
      router.refresh();
    },
  });
}

async function completeLogout(
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>
): Promise<void> {
  queryClient.setQueryData(AUTH_QUERY_KEYS.loggedOut, true);
  await queryClient.cancelQueries();
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] !== AUTH_QUERY_KEYS.loggedOut[0] ||
      query.queryKey[1] !== AUTH_QUERY_KEYS.loggedOut[1],
  });
  router.replace('/login');
  router.refresh();
}

export function useLogoutMutation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch('/auth/logout', { method: 'post' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['auth'] });
    },
    onSuccess: () => completeLogout(queryClient, router),
    onError: async (error) => {
      if (isApiClientError(error) && error.status === 401) {
        await completeLogout(queryClient, router);
      }
    },
  });
}

export function useUpdateLocaleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (locale: AppLocale) => apiFetch('/me', { method: 'patch', body: { locale } }),
    onSuccess: (data) => {
      writeLocaleCookie(data.profile.locale);
      queryClient.setQueryData(AUTH_QUERY_KEYS.me, data);
    },
  });
}

export function useChangeMyPasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ChangeMyPasswordRequest) =>
      apiFetch('/me/password', { method: 'post', body: payload }),
    onSuccess: async (data) => {
      queryClient.setQueryData(AUTH_QUERY_KEYS.me, data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.me }),
        queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.session }),
      ]);
    },
  });
}

export async function invalidateMyAvatarRelatedQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.me }),
    queryClient.invalidateQueries({ queryKey: ['members'] }),
    queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
    queryClient.invalidateQueries({ queryKey: ['boardDetail'] }),
    queryClient.invalidateQueries({ queryKey: ['taskDetail'] }),
    queryClient.invalidateQueries({ queryKey: ['myTasks'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks', 'assigneeMembers'] }),
  ]);
}

export function useUpdateMyAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ImageUploadRequest) =>
      apiFetch('/me/avatar', { method: 'put', body: payload }),
    onSuccess: async (data) => {
      queryClient.setQueryData(AUTH_QUERY_KEYS.me, data);
      await invalidateMyAvatarRelatedQueries(queryClient);
    },
  });
}

export function useRemoveMyAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch('/me/avatar', { method: 'delete' }),
    onSuccess: async (data) => {
      queryClient.setQueryData(AUTH_QUERY_KEYS.me, data);
      await invalidateMyAvatarRelatedQueries(queryClient);
    },
  });
}
