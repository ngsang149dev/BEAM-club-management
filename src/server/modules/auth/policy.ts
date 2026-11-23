import { createHmac, randomBytes } from 'node:crypto';
import type { Config } from '@/server/shared/config';

export const RATE_LIMIT_WINDOW_MINUTES = 15;
export const RATE_LIMIT_MAX_FAILED_ATTEMPTS = 10;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export type SessionTtlConfig = Pick<
  Config,
  'sessionTtlDefaultHours' | 'sessionTtlRememberDays'
>;

export function isRateLimited(recentFailedAttempts: number): boolean {
  return recentFailedAttempts >= RATE_LIMIT_MAX_FAILED_ATTEMPTS;
}

export function computeSessionExpiry(
  now: Date,
  rememberMe: boolean,
  config: SessionTtlConfig,
): Date {
  const ttlMs = rememberMe
    ? config.sessionTtlRememberDays * MS_PER_DAY
    : config.sessionTtlDefaultHours * MS_PER_HOUR;
  return new Date(now.getTime() + ttlMs);
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

export function computeSlidingExpiry(
  now: Date,
  session: { readonly rememberMe: boolean; readonly expiresAt: Date },
  config: Pick<Config, 'sessionTtlRememberDays'>,
): Date {
  if (!session.rememberMe) {
    return new Date(session.expiresAt.getTime());
  }
  return new Date(now.getTime() + config.sessionTtlRememberDays * MS_PER_DAY);
}

export function generateOpaqueSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
}
