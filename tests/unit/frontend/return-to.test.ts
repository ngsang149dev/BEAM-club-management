import { describe, expect, it } from 'vitest';
import { resolveExplicitReturnTo, sanitizeReturnTo } from '@/features/auth/return-to';

describe('sanitizeReturnTo', () => {
  it('allows safe internal paths with queries and hashes', () => {
    expect(sanitizeReturnTo('/boards')).toBe('/boards');
    expect(sanitizeReturnTo('/boards/123?tab=history#top')).toBe('/boards/123?tab=history#top');
    expect(sanitizeReturnTo('/my-tasks?priority=4')).toBe('/my-tasks?priority=4');
    expect(sanitizeReturnTo('/profile')).toBe('/profile');
    expect(sanitizeReturnTo('  /members  ')).toBe('/members');
  });

  it('falls back on empty, missing, or malformed inputs', () => {
    expect(sanitizeReturnTo(undefined)).toBe('/boards');
    expect(sanitizeReturnTo(null)).toBe('/boards');
    expect(sanitizeReturnTo('')).toBe('/boards');
    expect(sanitizeReturnTo('   ')).toBe('/boards');
    expect(sanitizeReturnTo('boards')).toBe('/boards');
    expect(sanitizeReturnTo(undefined, '/profile')).toBe('/profile');
  });

  it('blocks open-redirect protocols, double slashes, backslashes, and control chars', () => {
    expect(sanitizeReturnTo('https://evil.com/phish')).toBe('/boards');
    expect(sanitizeReturnTo('http://localhost:3000/boards')).toBe('/boards');
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/boards');
    expect(sanitizeReturnTo('data:text/html,<h1>x</h1>')).toBe('/boards');
    expect(sanitizeReturnTo('//evil.com')).toBe('/boards');
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/boards');
    expect(sanitizeReturnTo('/%2fevil.com')).toBe('/boards');
    expect(sanitizeReturnTo('/%5cevil.com')).toBe('/boards');
    expect(sanitizeReturnTo('/boards\nSet-Cookie: a=b')).toBe('/boards');
    expect(sanitizeReturnTo('/boards\u0000')).toBe('/boards');
    expect(sanitizeReturnTo('/@evil.com')).toBe('/@evil.com');
    expect(sanitizeReturnTo('//user@evil.com')).toBe('/boards');
    expect(sanitizeReturnTo('https://user:pass@evil.com')).toBe('/boards');
  });

  it('blocks login redirect loops and /api endpoints', () => {
    expect(sanitizeReturnTo('/login')).toBe('/boards');
    expect(sanitizeReturnTo('/login?expired=1')).toBe('/boards');
    expect(sanitizeReturnTo('/login/callback')).toBe('/boards');
    expect(sanitizeReturnTo('/api')).toBe('/boards');
    expect(sanitizeReturnTo('/api/v1/auth/logout')).toBe('/boards');
  });
});

describe('resolveExplicitReturnTo', () => {
  it('returns null for absent, blank, blocked, or external URLs instead of falling back to /boards', () => {
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

  it('preserves safe internal paths including explicit /boards', () => {
    expect(resolveExplicitReturnTo('/boards')).toBe('/boards');
    expect(resolveExplicitReturnTo('  /my-tasks?priority=4  ')).toBe('/my-tasks?priority=4');
  });
});
