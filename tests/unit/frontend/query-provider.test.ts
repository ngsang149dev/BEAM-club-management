import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/features/shared/api/client';
import { createQueryClient } from '@/features/shared/providers/QueryProvider';

function makeApiError(status: number, code: string): ApiClientError {
  return new ApiClientError({
    status,
    code,
    messageKey: `errors.${code.toLowerCase()}`,
    details: {},
  });
}

describe('QueryProvider createQueryClient auto-logout 401 handler (CR-08-02)', () => {
  it('invalidates ["auth", "session"] when another query fails with 401 UNAUTHORIZED or SESSION_EXPIRED', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await expect(
      queryClient.fetchQuery({
        queryKey: ['notifications', 'list'],
        queryFn: () => Promise.reject(makeApiError(401, 'UNAUTHORIZED')),
        retry: false,
      })
    ).rejects.toThrow();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['auth', 'session'] });

    invalidateSpy.mockClear();

    await expect(
      queryClient.fetchQuery({
        queryKey: ['boards'],
        queryFn: () => Promise.reject(makeApiError(401, 'SESSION_EXPIRED')),
        retry: false,
      })
    ).rejects.toThrow();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['auth', 'session'] });
  });

  it('does NOT recursively invalidate when ["auth", "session"] itself fails with 401', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await expect(
      queryClient.fetchQuery({
        queryKey: ['auth', 'session'],
        queryFn: () => Promise.reject(makeApiError(401, 'UNAUTHORIZED')),
        retry: false,
      })
    ).rejects.toThrow();

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does NOT invalidate on 401 INVALID_CREDENTIALS or non-401 query errors', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    for (const [queryKey, err] of [
      [['auth', 'me'], makeApiError(401, 'INVALID_CREDENTIALS')],
      [['tasks'], makeApiError(403, 'FORBIDDEN')],
      [['tasks', 'calendar'], makeApiError(404, 'NOT_FOUND')],
      [['members'], makeApiError(500, 'INTERNAL_ERROR')],
      [['progress'], makeApiError(0, 'NETWORK_ERROR')],
    ] as const) {
      await expect(
        queryClient.fetchQuery({
          queryKey,
          queryFn: () => Promise.reject(err),
          retry: false,
        })
      ).rejects.toThrow();
    }

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates ["auth", "session"] on non-login 401 mutation errors and ignores INVALID_CREDENTIALS / non-401 mutations', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const runMutationError = async (error: unknown) => {
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: () => Promise.reject(error),
      });
      await expect(mutation.execute(undefined)).rejects.toThrow();
    };

    await runMutationError(makeApiError(401, 'INVALID_CREDENTIALS'));
    await runMutationError(makeApiError(409, 'CONFLICT'));
    await runMutationError(makeApiError(500, 'INTERNAL_ERROR'));
    expect(invalidateSpy).not.toHaveBeenCalled();

    await runMutationError(makeApiError(401, 'SESSION_EXPIRED'));
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenLastCalledWith({ queryKey: ['auth', 'session'] });

    await runMutationError(makeApiError(401, 'UNAUTHORIZED'));
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenLastCalledWith({ queryKey: ['auth', 'session'] });
  });
});
