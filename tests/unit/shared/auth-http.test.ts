import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  attachLocaleCookie,
  attachSessionCookie,
  authenticateApiRequest,
  clearSessionCookie,
  extractClientIp,
  getRequestId,
  parseJsonBody,
  readSessionCookie,
  shouldUseSecureCookie,
} from '@/server/shared/auth-http';

const BASE_CONFIG = {
  nodeEnv: 'test' as const,
};

describe('auth-http helpers', () => {
  it('extracts and validates client IP in strict edge-header priority order', () => {
    const reqVercel = new Request('http://localhost/api/v1/auth/login', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.10, 10.0.0.1',
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '192.0.2.3',
      },
    });
    expect(extractClientIp(reqVercel)).toBe('203.0.113.10');

    const reqFallbackReal = new Request('http://localhost/api/v1/auth/login', {
      headers: {
        'x-vercel-forwarded-for': 'spoofed-not-an-ip',
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '192.0.2.3',
      },
    });
    expect(extractClientIp(reqFallbackReal)).toBe('198.51.100.2');

    const reqMultiRealRejected = new Request('http://localhost/api/v1/auth/login', {
      headers: {
        'x-real-ip': '198.51.100.2, 10.0.0.1',
        'x-forwarded-for': '2001:db8::1, 10.0.0.2',
      },
    });
    expect(extractClientIp(reqMultiRealRejected)).toBe('2001:db8::1');

    const reqUnknown = new Request('http://localhost/api/v1/auth/login', {
      headers: {
        'x-forwarded-for': 'bad-ip, 999.999.999.999',
      },
    });
    expect(extractClientIp(reqUnknown)).toBe('unknown');
  });

  it('reads beam_session cookie safely including tokens with = or malformed encoding', () => {
    const req = new Request('http://localhost/api/v1/me', {
      headers: {
        cookie: 'beam_locale=vi; beam_session=tok%2Babc%3D%3D; other=1',
      },
    });
    expect(readSessionCookie(req)).toBe('tok+abc==');

    const reqRaw = new Request('http://localhost/api/v1/me', {
      headers: { cookie: 'beam_session=%E0%A4%A' },
    });
    expect(readSessionCookie(reqRaw)).toBe('%E0%A4%A');

    expect(
      readSessionCookie(new Request('http://localhost/api/v1/me')),
    ).toBeNull();
  });

  it('determines secure cookie flag from NODE_ENV, x-forwarded-proto, or URL protocol', () => {
    const httpReq = new Request('http://localhost/api/v1/me');
    const httpsReq = new Request('https://beam.example.org/api/v1/me');
    const proxiedReq = new Request('http://localhost/api/v1/me', {
      headers: { 'x-forwarded-proto': 'https, http' },
    });

    expect(shouldUseSecureCookie(httpReq, { nodeEnv: 'test' })).toBe(false);
    expect(shouldUseSecureCookie(httpReq, { nodeEnv: 'production' })).toBe(true);
    expect(shouldUseSecureCookie(httpsReq, { nodeEnv: 'development' })).toBe(true);
    expect(shouldUseSecureCookie(proxiedReq, { nodeEnv: 'development' })).toBe(true);
  });

  it('always issues browser session cookies without Max-Age/Expires (CR-08)', () => {
    const req = new Request('http://localhost/api/v1/auth/login');

    const resDefault = NextResponse.json({ ok: true });
    attachSessionCookie(resDefault, {
      rawToken: 'tok-default',
      rememberMe: false,
      request: req,
      config: BASE_CONFIG,
    });
    const defaultCookie = resDefault.headers.getSetCookie()[0]!;
    expect(defaultCookie).toContain('beam_session=tok-default');
    expect(defaultCookie).toMatch(/HttpOnly/i);
    expect(defaultCookie).toMatch(/SameSite=Lax/i);
    expect(defaultCookie).not.toMatch(/Max-Age=/i);
    expect(defaultCookie).not.toMatch(/Expires=/i);

    const resRemember = NextResponse.json({ ok: true });
    attachSessionCookie(resRemember, {
      rawToken: 'tok-remember',
      rememberMe: true,
      request: req,
      config: BASE_CONFIG,
    });
    const rememberCookie = resRemember.headers.getSetCookie()[0]!;
    expect(rememberCookie).toContain('beam_session=tok-remember');
    expect(rememberCookie).toMatch(/HttpOnly/i);
    expect(rememberCookie).toMatch(/SameSite=Lax/i);
    expect(rememberCookie).not.toMatch(/Max-Age=/i);
    expect(rememberCookie).not.toMatch(/Expires=/i);

    const resCleared = NextResponse.json({ ok: true });
    clearSessionCookie(resCleared, req, BASE_CONFIG);
    expect(resCleared.headers.getSetCookie()[0]).toMatch(/Max-Age=0/i);

    const resLocale = NextResponse.json({ ok: true });
    attachLocaleCookie(resLocale, { locale: 'en', request: req, config: BASE_CONFIG });
    const localeCookie = resLocale.headers.getSetCookie()[0]!;
    expect(localeCookie).toContain('beam_locale=en');
    expect(localeCookie).toMatch(/Max-Age=31536000/i);
    expect(localeCookie).not.toMatch(/HttpOnly/i);
  });

  it('reuses valid x-request-id or generates UUID and parses JSON safely', async () => {
    const reqWithId = new Request('http://localhost/api/v1/me', {
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(getRequestId(reqWithId)).toBe('trace-abc-123');

    const reqOversized = new Request('http://localhost/api/v1/me', {
      headers: { 'x-request-id': 'x'.repeat(200) },
    });
    expect(getRequestId(reqOversized)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const validJsonReq = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ studentId: 'MSSV-1' }),
    });
    await expect(parseJsonBody(validJsonReq)).resolves.toEqual({
      studentId: 'MSSV-1',
    });

    const badJsonReq = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      body: '{not-valid-json',
    });
    await expect(parseJsonBody(badJsonReq)).rejects.toMatchObject({
      code: 'INVALID_JSON',
      httpStatus: 400,
    } satisfies Partial<AppError>);
  });

  it('forwards optional { touch } options through authenticateApiRequest', async () => {
    const authenticateSession = vi.fn().mockResolvedValue({
      session: {
        id: 'sess-1',
        userId: 'user-1',
        tokenHash: 'hash',
        rememberMe: false,
        expiresAt: new Date('2026-11-24T00:30:00.000Z'),
        lastSeenAt: new Date('2026-11-24T00:00:00.000Z'),
        revokedAt: null,
      },
      profile: {} as never,
      actor: {
        id: 'user-1',
        isActive: true,
        isAdmin: false,
        permissions: [],
        departmentIds: [],
      },
    });
    const req = new Request('http://localhost/api/v1/notifications', {
      headers: { cookie: 'beam_session=raw-tok-1' },
    });

    await authenticateApiRequest(req, { authService: { authenticateSession } });
    expect(authenticateSession).toHaveBeenNthCalledWith(1, 'raw-tok-1', undefined);

    await authenticateApiRequest(
      req,
      { authService: { authenticateSession } },
      { touch: false },
    );
    expect(authenticateSession).toHaveBeenNthCalledWith(2, 'raw-tok-1', {
      touch: false,
    });
  });
});
