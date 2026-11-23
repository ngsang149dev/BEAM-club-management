import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiClientError, isApiClientError } from '@/features/shared/api/client';

describe('apiFetch typed OpenAPI client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('performs GET requests against /api/v1 and returns parsed JSON', async () => {
    const payload = {
      profile: {
        id: 'u-1',
        fullName: 'Nguyen Van A',
        isActive: true,
        leftAt: null,
        departments: [],
        studentId: '21010001',
        email: 'a@eiu.edu.vn',
        locale: 'vi',
        isAdmin: false,
      },
      permissions: ['member.view'],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/me');

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
  });

  it('interpolates path params, serializes query params, and sends JSON body', async () => {
    const responsePayload = {
      member: {
        id: 'm/1',
        fullName: 'Tran Thi B',
        isActive: true,
        leftAt: null,
        departments: [],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const updated = await apiFetch('/members/{id}', {
      method: 'patch',
      params: { id: 'm/1' },
      body: { fullName: 'Tran Thi B', locale: 'en' },
    });

    expect(updated).toEqual(responsePayload);
    const [patchUrl, patchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(patchUrl).toBe('/api/v1/members/m%2F1');
    expect(patchInit.method).toBe('PATCH');
    expect(patchInit.body).toBe(JSON.stringify({ fullName: 'Tran Thi B', locale: 'en' }));
    expect(new Headers(patchInit.headers).get('content-type')).toBe('application/json');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], meta: { nextCursor: null, limit: 20 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await apiFetch('/members', {
      query: { q: 'an', isActive: true, departmentId: undefined, limit: 20 },
    });

    const [listUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(listUrl).toBe('/api/v1/members?q=an&isActive=true&limit=20');
  });

  it('parses structured API error envelopes into ApiClientError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            messageKey: 'errors.forbidden',
            details: { requiredPermission: 'board.create' },
          },
        }),
        {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'REQ-403A',
          },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await apiFetch('/boards', {
        method: 'post',
        body: { name: 'Test Board' },
      });
    } catch (err) {
      caught = err;
    }

    expect(isApiClientError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(ApiClientError);
    const apiErr = caught as ApiClientError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe('FORBIDDEN');
    expect(apiErr.messageKey).toBe('errors.forbidden');
    expect(apiErr.details).toEqual({ requiredPermission: 'board.create' });
    expect(apiErr.requestId).toBe('REQ-403A');
  });

  it('falls back to details.requestId when x-request-id response header is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            messageKey: 'errors.validation',
            details: { requestId: 'REQ-BODY-99', fields: ['studentId'] },
          },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/me')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 400,
      code: 'VALIDATION_ERROR',
      messageKey: 'errors.validation',
      requestId: 'REQ-BODY-99',
    });
  });

  it('falls back safely to ApiClientError on non-JSON error responses across statuses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: {
            'content-type': 'text/html',
            'x-request-id': 'REQ-502B',
          },
        })
      )
      .mockResolvedValueOnce(
        new Response('', {
          status: 404,
          headers: { 'x-request-id': 'REQ-404C' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/me')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 502,
      code: 'INTERNAL_ERROR',
      messageKey: 'errors.internal',
      details: {},
      requestId: 'REQ-502B',
    });

    await expect(apiFetch('/boards/{id}', { params: { id: 'missing' } })).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 404,
      code: 'NOT_FOUND',
      messageKey: 'errors.notFound',
      details: {},
      requestId: 'REQ-404C',
    });
  });

  it('falls back safely to ApiClientError when a 2xx response contains invalid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/me')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 200,
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
      details: {},
    });
  });

  it('falls back safely to ApiClientError on network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/auth/session')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 0,
      code: 'NETWORK_ERROR',
      messageKey: 'errors.network',
      details: {},
    });
  });

  it('rethrows AbortError without wrapping it as a network error', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/auth/session')).rejects.toBe(abortError);
  });
});
