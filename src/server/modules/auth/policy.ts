import { createHmac, randomBytes } from 'node:crypto';
import { DEFAULT_LOGIN_REDIRECT, sanitizeReturnTo } from '@/lib/auth';
import type { Config } from '@/server/shared/config';

export const RATE_LIMIT_WINDOW_MINUTES = 15;
export const RATE_LIMIT_MAX_FAILED_PER_PAIR = 5;
export const RATE_LIMIT_MAX_FAILED_ATTEMPTS = 20;
export const PASSWORD_CHANGE_RATE_LIMIT_MAX_FAILED = 5;
export const PASSWORD_CHANGE_ATTEMPT_PREFIX = 'pwd:';
export const LOGIN_ATTEMPT_ESCAPE_PREFIX = 'login:';
export const FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT = '/profile?changePassword=1';
export const DEFAULT_SESSION_TTL_MINUTES = 30;
export const SESSION_TOUCH_THROTTLE_MS = 30_000;

const MS_PER_MINUTE = 60 * 1000;

export type SessionTtlConfig = Pick<Config, 'sessionTtlMinutes'>;

export function buildPasswordChangeAttemptKey(userId: string): string {
  return `${PASSWORD_CHANGE_ATTEMPT_PREFIX}${userId}`;
}

export function buildLoginAttemptKey(studentId: string): string {
  const lower = studentId.toLowerCase();
  if (
    lower.startsWith(PASSWORD_CHANGE_ATTEMPT_PREFIX) ||
    lower.startsWith(LOGIN_ATTEMPT_ESCAPE_PREFIX)
  ) {
    return `${LOGIN_ATTEMPT_ESCAPE_PREFIX}${studentId}`;
  }
  return studentId;
}

export function isPairRateLimited(recentFailedAttempts: number): boolean {
  return recentFailedAttempts >= RATE_LIMIT_MAX_FAILED_PER_PAIR;
}

export function isRateLimited(recentFailedAttempts: number): boolean {
  return recentFailedAttempts >= RATE_LIMIT_MAX_FAILED_ATTEMPTS;
}

export function isPasswordChangeRateLimited(recentFailedAttempts: number): boolean {
  return recentFailedAttempts >= PASSWORD_CHANGE_RATE_LIMIT_MAX_FAILED;
}

export function computeSessionExpiry(
  now: Date,
  config: SessionTtlConfig,
): Date {
  return new Date(now.getTime() + config.sessionTtlMinutes * MS_PER_MINUTE);
}

export function isSessionExpired(
  session: { readonly expiresAt: Date; readonly revokedAt: Date | null },
  now: Date,
): boolean {
  if (session.revokedAt !== null) {
    return true;
  }
  return session.expiresAt.getTime() <= now.getTime();
}

export const computeSlidingExpiry = computeSessionExpiry;

export function shouldThrottleSessionTouch(
  session: { readonly lastSeenAt: Date },
  now: Date,
): boolean {
  const elapsedMs = now.getTime() - session.lastSeenAt.getTime();
  return elapsedMs >= 0 && elapsedMs < SESSION_TOUCH_THROTTLE_MS;
}

export function generateOpaqueSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
}

export function resolveLoginRedirect(
  returnTo: string | null | undefined,
  mustChangePassword: boolean,
): string {
  const defaultRedirect = mustChangePassword
    ? FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT
    : DEFAULT_LOGIN_REDIRECT;
  return sanitizeReturnTo(returnTo, defaultRedirect);
}
