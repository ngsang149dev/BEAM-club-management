import { z } from 'zod';

export const SESSION_COOKIE_NAME = 'beam_session';
export const DEFAULT_LOGIN_REDIRECT = '/boards';
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const studentIdSchema = z.string().trim().min(1).max(64);
export const passwordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, {
    message: 'Password cannot be whitespace only',
  });

export const loginFormSchema = z.object({
  studentId: studentIdSchema,
  password: passwordInputSchema,
  remember: z.boolean(),
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;

export const loginRequestSchema = z.object({
  studentId: studentIdSchema,
  password: passwordInputSchema,
  remember: z.boolean().optional().default(false),
  returnTo: z.string().nullable().optional(),
});

export type LoginRequestInput = z.infer<typeof loginRequestSchema>;

export const updateMeRequestSchema = z.object({
  locale: z.enum(['vi', 'en']),
});

export const changeMyPasswordFormSchema = z
  .object({
    currentPassword: passwordInputSchema,
    newPassword: newPasswordSchema,
    confirmPassword: newPasswordSchema,
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export type ChangeMyPasswordFormInput = z.infer<
  typeof changeMyPasswordFormSchema
>;

export const changeMyPasswordRequestSchema = z
  .object({
    currentPassword: passwordInputSchema,
    newPassword: newPasswordSchema,
  })
  .strict();

export type ChangeMyPasswordRequestInput = z.infer<
  typeof changeMyPasswordRequestSchema
>;

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
