import { forbidden } from '@/lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CRON_PREFIX = '/api/v1/internal/cron';
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

export interface CsrfValidationOptions {
  readonly appUrl?: string | null;
}

export type CsrfValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isCronPath(pathname: string): boolean {
  return pathname === CRON_PREFIX || pathname.startsWith(`${CRON_PREFIX}/`);
}

function resolveRequestProtocol(request: Request, parsedUrl: URL | null): string {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto;
  }
  const urlProto = parsedUrl?.protocol.replace(/:$/, '').toLowerCase();
  return urlProto === 'https' ? 'https' : 'http';
}

function addHostOrigin(
  allowed: Set<string>,
  rawHost: string | null,
  proto: string,
): void {
  const host = rawHost?.split(',')[0]?.trim();
  if (!host) {
    return;
  }
  const parsed = tryParseUrl(`${proto}://${host}`);
  if (parsed && parsed.origin !== 'null') {
    allowed.add(parsed.origin);
  }
}

function buildAllowedOrigins(
  request: Request,
  parsedUrl: URL | null,
  options?: CsrfValidationOptions,
): Set<string> {
  const allowed = new Set<string>();
  if (parsedUrl && parsedUrl.origin !== 'null') {
    allowed.add(parsedUrl.origin);
  }
  const proto = resolveRequestProtocol(request, parsedUrl);
  addHostOrigin(allowed, request.headers.get('x-forwarded-host'), proto);
  addHostOrigin(allowed, request.headers.get('host'), proto);

  const appUrl = options?.appUrl?.trim();
  if (appUrl) {
    const parsedApp = tryParseUrl(appUrl);
    if (parsedApp && parsedApp.origin !== 'null') {
      allowed.add(parsedApp.origin);
    }
  }
  return allowed;
}

function validateOriginHeader(
  rawOrigin: string,
  allowedOrigins: ReadonlySet<string>,
): CsrfValidationResult {
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return { ok: false, reason: 'origin_null' };
  }
  const parsed = tryParseUrl(trimmed);
  if (!parsed || parsed.origin === 'null') {
    return { ok: false, reason: 'origin_invalid' };
  }
  if (!allowedOrigins.has(parsed.origin)) {
    return { ok: false, reason: 'origin_mismatch' };
  }
  return { ok: true };
}

function validateSecFetchSite(request: Request): CsrfValidationResult {
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return { ok: false, reason: 'sec_fetch_site_mismatch' };
  }
  return { ok: true };
}

function validateRefererHeader(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): CsrfValidationResult {
  const referer = request.headers.get('referer')?.trim();
  if (referer) {
    const parsed = tryParseUrl(referer);
    if (!parsed || !allowedOrigins.has(parsed.origin)) {
      return { ok: false, reason: 'referer_mismatch' };
    }
  }
  return { ok: true };
}

export function validateCsrfRequest(
  request: Request,
  options?: CsrfValidationOptions,
): CsrfValidationResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true };
  }

  const parsedUrl = tryParseUrl(request.url);
  if (parsedUrl && isCronPath(parsedUrl.pathname)) {
    return { ok: true };
  }

  const fetchSiteResult = validateSecFetchSite(request);
  if (!fetchSiteResult.ok) {
    return fetchSiteResult;
  }

  const allowedOrigins = buildAllowedOrigins(request, parsedUrl, options);
  if (request.headers.has('origin')) {
    return validateOriginHeader(
      request.headers.get('origin') ?? '',
      allowedOrigins,
    );
  }

  return validateRefererHeader(request, allowedOrigins);
}

export function assertValidCsrfRequest(
  request: Request,
  options?: CsrfValidationOptions,
): void {
  const result = validateCsrfRequest(request, options);
  if (!result.ok) {
    throw forbidden(
      'errors.forbidden',
      { reason: result.reason },
      'CSRF_ORIGIN_MISMATCH',
    );
  }
}
