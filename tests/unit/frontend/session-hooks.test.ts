import { afterEach, describe, expect, it, vi } from 'vitest';

const reactMock = vi.hoisted(() => ({
  contextValue: {} as unknown,
}));

const rqMock = vi.hoisted(() => ({
  lastQueryOptions: null as Record<string, unknown> | null,
  lastMutationOptions: null as Record<string, unknown> | null,
  queryClient: {
    clear: vi.fn(),
    setQueryData: vi.fn(),
  },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useContext: () => reactMock.contextValue,
  };
});

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: Record<string, unknown>) => {
      rqMock.lastQueryOptions = options;
      return { data: undefined, isPending: true, isError: false, error: null };
    },
    useMutation: (options: Record<string, unknown>) => {
      rqMock.lastMutationOptions = options;
      return { mutate: vi.fn(), isPending: false, error: null };
    },
    useQueryClient: () => rqMock.queryClient,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { useLoginMutation, useSessionQuery } from '@/features/auth/hooks/useAuth';
import { useNotificationsQuery } from '@/features/notifications/hooks/useNotifications';

describe('Session & background notification hooks (CR-08-02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rqMock.lastQueryOptions = null;
    rqMock.lastMutationOptions = null;
  });

  it('configures useSessionQuery with refetchOnWindowFocus: true', () => {
    useSessionQuery();
    expect(rqMock.lastQueryOptions?.queryKey).toEqual(['auth', 'session']);
    expect(rqMock.lastQueryOptions?.refetchOnWindowFocus).toBe(true);
  });

  it('sends x-beam-background: 1 header when useNotificationsQuery polls /notifications', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], unreadCount: 0, meta: { nextCursor: null, limit: 20 } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    useNotificationsQuery(true);
    expect(rqMock.lastQueryOptions?.refetchInterval).toBe(30_000);
    const queryFn = rqMock.lastQueryOptions?.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>;
    const controller = new AbortController();
    await queryFn({ signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/notifications?limit=20');
    expect(new Headers(init.headers).get('x-beam-background')).toBe('1');
  });

  it('sends login payload without requiring remember in useLoginMutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'u-1',
            fullName: 'Nguyen Van A',
            isActive: true,
            leftAt: null,
            departments: [],
            studentId: '21010001',
            email: 'a@eiu.edu.vn',
            locale: 'vi',
            isAdmin: false,
            mustChangePassword: false,
          },
          redirectTo: '/boards',
          expiresAt: '2026-11-26T17:30:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    useLoginMutation();
    const mutationFn = rqMock.lastMutationOptions?.mutationFn as (payload: {
      studentId: string;
      password: string;
      returnTo: string | null;
    }) => Promise<unknown>;
    await mutationFn({ studentId: '21010001', password: 'Password1!', returnTo: '/boards' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      studentId: '21010001',
      password: 'Password1!',
      returnTo: '/boards',
    });
  });
});
