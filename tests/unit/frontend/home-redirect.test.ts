import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  authenticateSession: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/server/shared/composition', () => ({
  getContainer: () => ({
    authService: {
      authenticateSession: mocks.authenticateSession,
    },
  }),
}));

import HomePage from '@/app/page';

describe('HomePage (/) server redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects unauthenticated visitors without session cookie directly to /login', async () => {
    mocks.cookies.mockResolvedValueOnce({
      get: () => undefined,
    });

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mocks.authenticateSession).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when session cookie is invalid or expired', async () => {
    mocks.cookies.mockResolvedValueOnce({
      get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: 'expired-token' } : undefined),
    });
    mocks.authenticateSession.mockRejectedValueOnce(new Error('SESSION_EXPIRED'));

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mocks.authenticateSession).toHaveBeenCalledWith('expired-token');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects authenticated active members directly to /tasks', async () => {
    mocks.cookies.mockResolvedValueOnce({
      get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: 'valid-token' } : undefined),
    });
    mocks.authenticateSession.mockResolvedValueOnce({
      profile: { id: 'u-1', mustChangePassword: false },
    });

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT:/tasks');
    expect(mocks.authenticateSession).toHaveBeenCalledWith('valid-token');
    expect(mocks.redirect).toHaveBeenCalledWith('/tasks');
  });

  it('redirects authenticated members with mustChangePassword=true to /profile?changePassword=1', async () => {
    mocks.cookies.mockResolvedValueOnce({
      get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: 'temp-token' } : undefined),
    });
    mocks.authenticateSession.mockResolvedValueOnce({
      profile: { id: 'u-2', mustChangePassword: true },
    });

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT:/profile?changePassword=1');
    expect(mocks.authenticateSession).toHaveBeenCalledWith('temp-token');
    expect(mocks.redirect).toHaveBeenCalledWith('/profile?changePassword=1');
  });
});
