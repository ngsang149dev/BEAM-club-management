import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { maxDuration as archivePurgeMaxDuration } from '@/app/api/v1/internal/cron/archive-purge/route';
import { maxDuration as remindersMaxDuration } from '@/app/api/v1/internal/cron/reminders/route';
import { AppError } from '@/lib/errors';
import {
  BINARY_IMAGE_CSP,
  BINARY_IMAGE_HEADER_SOURCES,
  buildAllowedDevOrigins,
  buildContentSecurityPolicy,
  buildGlobalSecurityHeaders,
  buildNextHeaderRules,
} from '@/lib/security-headers';
import { config as proxyConfig, proxy } from '@/proxy';
import { assertValidCsrfRequest, validateCsrfRequest } from '@/server/shared/csrf';
import { buildBinaryImageResponse } from '@/server/shared/media';

const SAMPLE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('OWASP security headers & CSP', () => {
  it('builds strict CSP across production, development, and test environments', () => {
    const prodCsp = buildContentSecurityPolicy({
      isProduction: true,
      isDevelopment: false,
    });
    expect(prodCsp).toContain("default-src 'self'");
    expect(prodCsp).toContain("base-uri 'self'");
    expect(prodCsp).toContain("form-action 'self'");
    expect(prodCsp).toContain("frame-ancestors 'none'");
    expect(prodCsp).toContain("object-src 'none'");
    expect(prodCsp).toContain("img-src 'self' data: blob:");
    expect(prodCsp).toContain("font-src 'self' data:");
    expect(prodCsp).toContain("style-src 'self' 'unsafe-inline'");
    expect(prodCsp).toContain("script-src 'self' 'unsafe-inline'");
    expect(prodCsp).toContain("connect-src 'self'");
    expect(prodCsp).toContain('upgrade-insecure-requests');
    expect(prodCsp).not.toContain("'unsafe-eval'");
    expect(prodCsp).not.toContain('ws:');

    const devCsp = buildContentSecurityPolicy({
      isProduction: false,
      isDevelopment: true,
    });
    expect(devCsp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(devCsp).toContain("connect-src 'self' ws: wss:");
    expect(devCsp).not.toContain('upgrade-insecure-requests');

    const testCsp = buildContentSecurityPolicy({
      isProduction: false,
      isDevelopment: false,
    });
    expect(testCsp).not.toContain("'unsafe-eval'");
    expect(testCsp).not.toContain('ws:');
    expect(testCsp).not.toContain('upgrade-insecure-requests');
  });

  it('emits required OWASP headers and adds HSTS only in production', () => {
    const prodHeaders = new Map(
      buildGlobalSecurityHeaders({ nodeEnv: 'production' }).map((h) => [
        h.key,
        h.value,
      ]),
    );
    expect(prodHeaders.get('X-Frame-Options')).toBe('DENY');
    expect(prodHeaders.get('X-Content-Type-Options')).toBe('nosniff');
    expect(prodHeaders.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(prodHeaders.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    );
    expect(prodHeaders.get('X-DNS-Prefetch-Control')).toBe('off');
    expect(prodHeaders.get('Content-Security-Policy')).toContain(
      'upgrade-insecure-requests',
    );
    expect(prodHeaders.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains',
    );

    const devHeaders = new Map(
      buildGlobalSecurityHeaders({ nodeEnv: 'development' }).map((h) => [
        h.key,
        h.value,
      ]),
    );
    expect(devHeaders.has('Strict-Transport-Security')).toBe(false);
    expect(devHeaders.get('Content-Security-Policy')).toContain("'unsafe-eval'");

    const testHeaders = new Map(
      buildGlobalSecurityHeaders({ nodeEnv: 'test' }).map((h) => [
        h.key,
        h.value,
      ]),
    );
    expect(testHeaders.has('Strict-Transport-Security')).toBe(false);
  });

  it('orders Next.js header rules so binary image routes override global CSP with strict sandbox CSP', () => {
    const rules = buildNextHeaderRules({ nodeEnv: 'production' });
    expect(rules).toHaveLength(1 + BINARY_IMAGE_HEADER_SOURCES.length);

    const [globalRule, ...binaryRules] = rules;
    expect(globalRule?.source).toBe('/(.*)');
    expect(
      globalRule?.headers.find((h) => h.key === 'Content-Security-Policy')?.value,
    ).toContain("default-src 'self'");
    expect(
      globalRule?.headers.find((h) => h.key === 'Strict-Transport-Security')
        ?.value,
    ).toBe('max-age=63072000; includeSubDomains');

    expect(binaryRules.map((rule) => rule.source)).toEqual([
      '/api/v1/branding/logo',
      '/api/v1/branding/wordmark',
      '/api/v1/branding/gallery/:id/image',
      '/api/v1/members/:id/avatar',
    ]);
    for (const rule of binaryRules) {
      expect(rule.headers).toEqual([
        { key: 'Content-Security-Policy', value: BINARY_IMAGE_CSP },
      ]);
    }
  });
});

describe('CSRF Origin / Sec-Fetch-Site / Referer guard & Next.js proxy', () => {
  it('exempts safe methods and internal cron paths even when Origin is cross-site', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const req = new Request('https://beam.example/api/v1/boards', {
        method,
        headers: { origin: 'https://evil.example' },
      });
      expect(validateCsrfRequest(req)).toEqual({ ok: true });
    }

    for (const cronPath of [
      '/api/v1/internal/cron',
      '/api/v1/internal/cron/reminders',
      '/api/v1/internal/cron/archive-purge',
    ]) {
      const req = new Request(`https://beam.example${cronPath}`, {
        method: 'POST',
        headers: {
          origin: 'https://github.com',
          authorization: 'Bearer test-secret',
        },
      });
      expect(validateCsrfRequest(req)).toEqual({ ok: true });
    }
  });

  it('validates Origin against request URL, host, x-forwarded-host, and appUrl', () => {
    expect(
      validateCsrfRequest(
        new Request('http://localhost:3000/api/v1/tasks', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
        }),
      ),
    ).toEqual({ ok: true });

    expect(
      validateCsrfRequest(
        new Request('http://internal.local/api/v1/tasks', {
          method: 'POST',
          headers: {
            origin: 'https://beam.eiu.edu.vn',
            'x-forwarded-host': 'beam.eiu.edu.vn',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toEqual({ ok: true });

    expect(
      validateCsrfRequest(
        new Request('http://localhost:3000/api/v1/tasks', {
          method: 'PUT',
          headers: { origin: 'https://app.beam.example' },
        }),
        { appUrl: 'https://app.beam.example' },
      ),
    ).toEqual({ ok: true });

    for (const badOrigin of [
      'https://evil.example',
      'null',
      '   ',
      'not-a-valid-origin',
    ]) {
      const req = new Request('https://beam.example/api/v1/tasks', {
        method: 'DELETE',
        headers: { origin: badOrigin },
      });
      expect(validateCsrfRequest(req).ok).toBe(false);
      expect(() => assertValidCsrfRequest(req)).toThrow(AppError);
      try {
        assertValidCsrfRequest(req);
      } catch (error) {
        const appError = error as AppError;
        expect(appError.httpStatus).toBe(403);
        expect(appError.code).toBe('CSRF_ORIGIN_MISMATCH');
        expect(appError.messageKey).toBe('errors.forbidden');
      }
    }
  });

  it('checks Sec-Fetch-Site and Referer when Origin is absent, and allows non-browser callers without them', () => {
    expect(
      validateCsrfRequest(
        new Request('https://beam.example/api/v1/tasks', { method: 'POST' }),
      ),
    ).toEqual({ ok: true });

    for (const safeSite of ['same-origin', 'none']) {
      expect(
        validateCsrfRequest(
          new Request('https://beam.example/api/v1/tasks', {
            method: 'PATCH',
            headers: { 'sec-fetch-site': safeSite },
          }),
        ),
      ).toEqual({ ok: true });
    }

    for (const unsafeSite of ['cross-site', 'same-site']) {
      expect(
        validateCsrfRequest(
          new Request('https://beam.example/api/v1/tasks', {
            method: 'POST',
            headers: { 'sec-fetch-site': unsafeSite },
          }),
        ),
      ).toEqual({ ok: false, reason: 'sec_fetch_site_mismatch' });

      // Even if Origin matches, an unsafe Sec-Fetch-Site must still be rejected
      expect(
        validateCsrfRequest(
          new Request('https://beam.example/api/v1/tasks', {
            method: 'POST',
            headers: {
              origin: 'https://beam.example',
              'sec-fetch-site': unsafeSite,
            },
          }),
        ),
      ).toEqual({ ok: false, reason: 'sec_fetch_site_mismatch' });
    }

    expect(
      validateCsrfRequest(
        new Request('https://beam.example/api/v1/tasks', {
          method: 'POST',
          headers: { referer: 'https://beam.example/boards' },
        }),
      ),
    ).toEqual({ ok: true });

    expect(
      validateCsrfRequest(
        new Request('https://beam.example/api/v1/tasks', {
          method: 'POST',
          headers: { referer: 'https://evil.example/phish' },
        }),
      ),
    ).toEqual({ ok: false, reason: 'referer_mismatch' });
  });

  it('enforces CSRF in src/proxy.ts with uniform 403 payload and matcher config', async () => {
    expect(proxyConfig.matcher).toEqual(['/api/v1/:path*']);

    const blockedReq = new NextRequest('http://localhost:3000/api/v1/boards', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-request-id': 'proxy-req-403',
      },
    });
    const blockedRes = proxy(blockedReq);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.headers.get('cache-control')).toBe('no-store');
    expect(blockedRes.headers.get('x-request-id')).toBe('proxy-req-403');
    expect(await blockedRes.json()).toEqual({
      error: {
        code: 'CSRF_ORIGIN_MISMATCH',
        messageKey: 'errors.forbidden',
        details: {
          reason: 'origin_mismatch',
          requestId: 'proxy-req-403',
        },
      },
    });

    const allowedReq = new NextRequest('http://localhost:3000/api/v1/boards', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });
    const allowedRes = proxy(allowedReq);
    expect(allowedRes.status).toBe(200);
    expect(allowedRes.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('Binary image CDN caching, ETag/304, and cron maxDuration', () => {
  it('defaults to private no-store without ETag for member avatars', () => {
    const res = buildBinaryImageResponse({
      data: SAMPLE_PNG_BYTES,
      mimeType: 'image/png',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    );
  });

  it('emits public CDN cache headers, SHA-256 ETag, versioned long TTL, and 304 Not Modified', async () => {
    const unversionedReq = new Request('http://localhost:3000/api/v1/branding/logo');
    const unversionedRes = buildBinaryImageResponse({
      data: SAMPLE_PNG_BYTES,
      mimeType: 'image/png',
      request: unversionedReq,
      cacheMode: 'public-cdn',
    });
    expect(unversionedRes.status).toBe(200);
    expect(unversionedRes.headers.get('cache-control')).toBe(
      'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
    );
    const etag = unversionedRes.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(unversionedRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(unversionedRes.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    );

    const versionedReq = new Request(
      'http://localhost:3000/api/v1/branding/logo?v=1764000000000',
    );
    const versionedRes = buildBinaryImageResponse({
      data: SAMPLE_PNG_BYTES,
      mimeType: 'image/png',
      request: versionedReq,
      cacheMode: 'public-cdn',
    });
    expect(versionedRes.status).toBe(200);
    expect(versionedRes.headers.get('cache-control')).toBe(
      'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    );
    expect(versionedRes.headers.get('etag')).toBe(etag);

    for (const ifNoneMatch of [etag!, `W/${etag!}`, `"other", ${etag!}`, '*']) {
      const conditionalReq = new Request(
        'http://localhost:3000/api/v1/branding/logo?v=1764000000000',
        { headers: { 'if-none-match': ifNoneMatch } },
      );
      const res304 = buildBinaryImageResponse({
        data: SAMPLE_PNG_BYTES,
        mimeType: 'image/png',
        request: conditionalReq,
        cacheMode: 'public-cdn',
      });
      expect(res304.status).toBe(304);
      expect(res304.headers.get('etag')).toBe(etag);
      expect(res304.headers.get('cache-control')).toBe(
        'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      );
      expect(res304.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res304.headers.get('content-security-policy')).toBe(
        "default-src 'none'; sandbox",
      );
      expect((await res304.arrayBuffer()).byteLength).toBe(0);
    }

    const mismatchReq = new Request(
      'http://localhost:3000/api/v1/branding/logo',
      { headers: { 'if-none-match': '"stale-etag"' } },
    );
    const res200 = buildBinaryImageResponse({
      data: SAMPLE_PNG_BYTES,
      mimeType: 'image/png',
      request: mismatchReq,
      cacheMode: 'public-cdn',
    });
    expect(res200.status).toBe(200);
    expect(Buffer.from(await res200.arrayBuffer()).equals(SAMPLE_PNG_BYTES)).toBe(
      true,
    );
  });

  it('exports maxDuration = 60 on both cron route handlers', () => {
    expect(remindersMaxDuration).toBe(60);
    expect(archivePurgeMaxDuration).toBe(60);
  });

  it('builds deduplicated private LAN and custom allowedDevOrigins patterns', () => {
    const defaults = buildAllowedDevOrigins();
    expect(defaults).toContain('127.0.0.1');
    expect(defaults).toContain('192.168.*.*');
    expect(defaults).toContain('10.*.*.*');
    expect(defaults).toContain('*.local');
    for (let second = 16; second <= 31; second += 1) {
      expect(defaults).toContain(`172.${second}.*.*`);
    }
    expect(defaults).not.toContain('172.15.*.*');
    expect(defaults).not.toContain('172.32.*.*');

    const withCustom = buildAllowedDevOrigins(
      ' 192.168.*.* , beam-dev.local, , 100.64.1.2 , beam-dev.local ',
    );
    expect(withCustom).toContain('beam-dev.local');
    expect(withCustom).toContain('100.64.1.2');
    expect(withCustom.filter((origin) => origin === '192.168.*.*')).toHaveLength(1);
    expect(withCustom.filter((origin) => origin === 'beam-dev.local')).toHaveLength(1);
  });
});
