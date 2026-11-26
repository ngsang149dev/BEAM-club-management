'use client';

import { useState, type ReactNode } from 'react';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { isApiClientError } from '@/features/shared/api/client';

const AUTH_SESSION_QUERY_KEY = ['auth', 'session'] as const;

function isAuthSessionQueryKey(queryKey: QueryKey): boolean {
  return (
    queryKey.length === AUTH_SESSION_QUERY_KEY.length &&
    queryKey[0] === AUTH_SESSION_QUERY_KEY[0] &&
    queryKey[1] === AUTH_SESSION_QUERY_KEY[1]
  );
}

function shouldInvalidateAuthSession(error: unknown): boolean {
  return isApiClientError(error) && error.status === 401 && error.code !== 'INVALID_CREDENTIALS';
}

export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (shouldInvalidateAuthSession(error) && !isAuthSessionQueryKey(query.queryKey)) {
          void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (shouldInvalidateAuthSession(error)) {
          void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return queryClient;
}

export interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
