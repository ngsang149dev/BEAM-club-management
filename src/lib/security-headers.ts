export interface SecurityHeader {
  readonly key: string;
  readonly value: string;
}

export interface NextHeaderRule {
  readonly source: string;
  readonly headers: SecurityHeader[];
}

export interface ContentSecurityPolicyOptions {
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
}

export interface GlobalSecurityHeadersOptions {
  readonly nodeEnv: string | undefined;
}

export const BINARY_IMAGE_CSP = "default-src 'none'; sandbox";

export const BINARY_IMAGE_HEADER_SOURCES = [
  '/api/v1/branding/logo',
  '/api/v1/branding/wordmark',
  '/api/v1/branding/gallery/:id/image',
  '/api/v1/members/:id/avatar',
] as const;

const HSTS_HEADER_VALUE = 'max-age=63072000; includeSubDomains';
const PERMISSIONS_POLICY_VALUE =
  'camera=(), microphone=(), geolocation=(), interest-cohort=()';

export function buildContentSecurityPolicy({
  isProduction,
  isDevelopment,
}: ContentSecurityPolicyOptions): string {
  const scriptSrc = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  const connectSrc = isDevelopment
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self'";

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    connectSrc,
  ];

  if (isProduction) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function buildGlobalSecurityHeaders({
  nodeEnv,
}: GlobalSecurityHeadersOptions): SecurityHeader[] {
  const isProduction = nodeEnv === 'production';
  const isDevelopment = nodeEnv === 'development';

  const headers: SecurityHeader[] = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY_VALUE },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy({ isProduction, isDevelopment }),
    },
  ];

  if (isProduction) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: HSTS_HEADER_VALUE,
    });
  }

  return headers;
}

export function buildNextHeaderRules({
  nodeEnv,
}: GlobalSecurityHeadersOptions): NextHeaderRule[] {
  return [
    {
      source: '/(.*)',
      headers: buildGlobalSecurityHeaders({ nodeEnv }),
    },
    ...BINARY_IMAGE_HEADER_SOURCES.map((source) => ({
      source,
      headers: [{ key: 'Content-Security-Policy', value: BINARY_IMAGE_CSP }],
    })),
  ];
}
