import { DEFAULT_LOGIN_REDIRECT, sanitizeReturnTo } from '@/lib/auth';

export { DEFAULT_LOGIN_REDIRECT, sanitizeReturnTo };

export function resolveExplicitReturnTo(raw: string | null | undefined): string | null {
  const safePath = sanitizeReturnTo(raw, '');
  return safePath.length > 0 ? safePath : null;
}
