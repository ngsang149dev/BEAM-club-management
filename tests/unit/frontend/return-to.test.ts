import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOGIN_REDIRECT,
  resolveExplicitReturnTo,
  sanitizeReturnTo,
} from '@/features/auth/return-to';

describe('sanitizeReturnTo', () => {
  it('allows safe internal paths with queries and hashes', () => {
    expect(sanitizeReturnTo('/tasks')).toBe('/tasks');
    expect(sanitizeReturnTo('/tasks?task=t-1&deadline=overdue#top')).toBe('/tasks?task=t-1&deadline=overdue#top');
    expect(sanitizeReturnTo('/my-tasks?deadline=overdue')).toBe('/my-tasks?deadline=overdue');
    expect(sanitizeReturnTo('/profile')).toBe('/profile');
    expect(sanitizeReturnTo('  /members  ')).toBe('/members');
  });

  it('falls back on empty, missing, or malformed inputs', () => {
    expect(sanitizeReturnTo(undefined)).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo(null)).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('   ')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('tasks')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo(undefined, '/profile')).toBe('/profile');
  });

  it('blocks open-redirect protocols, double slashes, backslashes, and control chars', () => {
    expect(sanitizeReturnTo('https://evil.com/phish')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('http://localhost:3000/tasks')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('data:text/html,<h1>x</h1>')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('//evil.com')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/\\evil.com')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/%2fevil.com')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/%5cevil.com')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/tasks\nSet-Cookie: a=b')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/tasks\u0000')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/@evil.com')).toBe('/@evil.com');
    expect(sanitizeReturnTo('//user@evil.com')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('https://user:pass@evil.com')).toBe(DEFAULT_LOGIN_REDIRECT);
  });

  it('blocks login redirect loops and /api endpoints', () => {
    expect(sanitizeReturnTo('/login')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/login?expired=1')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/login/callback')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/api')).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(sanitizeReturnTo('/api/v1/auth/logout')).toBe(DEFAULT_LOGIN_REDIRECT);
  });
});

describe('resolveExplicitReturnTo', () => {
  it('returns null for absent, blank, blocked, or external URLs instead of falling back', () => {
    expect(resolveExplicitReturnTo(undefined)).toBeNull();
    expect(resolveExplicitReturnTo(null)).toBeNull();
    expect(resolveExplicitReturnTo('')).toBeNull();
    expect(resolveExplicitReturnTo('   ')).toBeNull();
    expect(resolveExplicitReturnTo('https://evil.example/phish')).toBeNull();
    expect(resolveExplicitReturnTo('//evil.com')).toBeNull();
    expect(resolveExplicitReturnTo('javascript:alert(1)')).toBeNull();
    expect(resolveExplicitReturnTo('/login')).toBeNull();
    expect(resolveExplicitReturnTo('/api/v1/auth/logout')).toBeNull();
  });

  it('preserves safe internal paths including explicit /tasks', () => {
    expect(resolveExplicitReturnTo('/tasks')).toBe('/tasks');
    expect(resolveExplicitReturnTo('  /my-tasks?deadline=overdue  ')).toBe('/my-tasks?deadline=overdue');
  });
});
