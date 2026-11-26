import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/locale';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { badRequest } from '@/lib/errors';
import type { AuthenticatedSession } from '@/server/modules/auth';
import type { Config } from './config';
import { assertValidCsrfRequest } from './csrf';

const LOCALE_COOKIE_MAX_AGE = 31_536_000;

function extractValidIp(rawHeader: string | null, splitComma: boolean): string | null {
  if (!rawHeader) {
    return null;
  }
  const candidate = (splitComma ? rawHeader.split(',')[0] : rawHeader)?.trim();
  if (!candidate || isIP(candidate) === 0) {
    return null;
  }
  return candidate;
}

export function extractClientIp(request: Request): string {
  return (
    extractValidIp(request.headers.get('x-vercel-forwarded-for'), true) ??
    extractValidIp(request.headers.get('x-real-ip'), false) ??
    extractValidIp(request.headers.get('x-forwarded-for'), true) ??
    'unknown'
  );
}

function decodeCookieValue(rawValue: string): string {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }
    const value = decodeCookieValue(part.slice(eqIndex + 1).trim());
    return value.length > 0 ? value : null;
  }
  return null;
}

export function shouldUseSecureCookie(
  request: Request,
  config: Pick<Config, 'nodeEnv'>,
): boolean {
  if (config.nodeEnv === 'production') {
    return true;
  }
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === 'https') {
    return true;
  }
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function attachSessionCookie(
  response: NextResponse,
  options: {
    readonly rawToken: string;
    readonly rememberMe?: boolean;
    readonly request: Request;
    readonly config: Pick<Config, 'nodeEnv'>;
  },
): void {
  // Always issue a browser session cookie (no Max-Age) under CR-08; server enforces 30m sliding TTL.
  response.cookies.set(SESSION_COOKIE_NAME, options.rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: shouldUseSecureCookie(options.request, options.config),
  });
}

export function refreshSessionCookieIfRemembered(
  response: NextResponse,
  options: {
    readonly rawToken: string | null;
    readonly rememberMe?: boolean;
    readonly request: Request;
    readonly config: Pick<Config, 'nodeEnv'>;
  },
): void {
  // Retained as a no-op for route callers; browser session cookies never carry Max-Age.
  void response;
  void options;
}

export function clearSessionCookie(
  response: NextResponse,
  request: Request,
  config: Pick<Config, 'nodeEnv'>,
): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: shouldUseSecureCookie(request, config),
    maxAge: 0,
  });
}

export function attachLocaleCookie(
  response: NextResponse,
  options: {
    readonly locale: 'vi' | 'en';
    readonly request: Request;
    readonly config: Pick<Config, 'nodeEnv'>;
  },
): void {
  response.cookies.set(LOCALE_COOKIE, options.locale, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    secure: shouldUseSecureCookie(options.request, options.config),
  });
}

export function getRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim();
  if (incoming && incoming.length <= 128 && !/[\r\n]/.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest('errors.badRequest', {}, 'INVALID_JSON');
  }
}

export async function parseOptionalJsonBody(request: Request): Promise<unknown> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw badRequest('errors.badRequest', {}, 'INVALID_JSON');
  }
  if (raw.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw badRequest('errors.badRequest', {}, 'INVALID_JSON');
  }
}

export interface ApiAuthenticator {
  readonly authService: {
    authenticateSession(
      rawToken: string | null | undefined,
      options?: { readonly touch?: boolean },
    ): Promise<AuthenticatedSession>;
  };
  readonly config?: Pick<Config, 'appUrl'>;
}

export interface AuthenticatedRequestContext extends AuthenticatedSession {
  readonly rawToken: string;
}

export async function authenticateApiRequest(
  request: Request,
  container: ApiAuthenticator,
  options?: { readonly touch?: boolean },
): Promise<AuthenticatedRequestContext> {
  assertValidCsrfRequest(request, { appUrl: container.config?.appUrl });
  const rawToken = readSessionCookie(request);
  const authenticated = await container.authService.authenticateSession(
    rawToken,
    options,
  );
  return {
    ...authenticated,
    rawToken: rawToken ?? '',
  };
}

export interface AuthenticatedJsonResponseOptions {
  readonly status?: number;
  readonly requestId: string;
  readonly rawToken: string;
  readonly rememberMe: boolean;
  readonly request: Request;
  readonly config: Pick<Config, 'nodeEnv'>;
}

export function createAuthenticatedJsonResponse<T>(
  data: T,
  options: AuthenticatedJsonResponseOptions,
): NextResponse<T> {
  const response = NextResponse.json(data, {
    status: options.status ?? 200,
    headers: {
      'Cache-Control': 'no-store',
      'x-request-id': options.requestId,
    },
  });
  refreshSessionCookieIfRemembered(response, {
    rawToken: options.rawToken,
    rememberMe: options.rememberMe,
    request: options.request,
    config: options.config,
  });
  return response;
}
