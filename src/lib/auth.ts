import { z } from 'zod';

export const SESSION_COOKIE_NAME = 'beam_session';
export const DEFAULT_LOGIN_REDIRECT = '/boards';

export const studentIdSchema = z.string().trim().min(1).max(64);

export const loginFormSchema = z.object({
  studentId: studentIdSchema,
  remember: z.boolean(),
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;

export const loginRequestSchema = z.object({
  studentId: studentIdSchema,
  remember: z.boolean().optional().default(false),
  returnTo: z.string().nullable().optional(),
});

export type LoginRequestInput = z.infer<typeof loginRequestSchema>;

export const updateMeRequestSchema = z.object({
  locale: z.enum(['vi', 'en']),
});

export type UpdateMeRequestInput = z.infer<typeof updateMeRequestSchema>;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const ENCODED_SLASH_PREFIX = /^\/(%2f|%5c)/i;

function hasUnsafePathShape(trimmed: string): boolean {
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return true;
  }
  if (ENCODED_SLASH_PREFIX.test(trimmed)) {
    return true;
  }
  return trimmed.includes('\\') || CONTROL_CHAR_PATTERN.test(trimmed);
}

function isBlockedTargetPath(pathname: string): boolean {
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return true;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return true;
  }
  return pathname.startsWith('//');
}

export function sanitizeReturnTo(
  raw: string | null | undefined,
  fallback = DEFAULT_LOGIN_REDIRECT,
): string {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || hasUnsafePathShape(trimmed)) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed, 'http://local.invalid');
    if (
      parsed.origin !== 'http://local.invalid' ||
      parsed.username ||
      parsed.password
    ) {
      return fallback;
    }
    if (isBlockedTargetPath(parsed.pathname)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
