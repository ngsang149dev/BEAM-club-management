import { describe, expect, it } from 'vitest';
import {
  changeMyPasswordFormSchema,
  changeMyPasswordRequestSchema,
  DEFAULT_LOGIN_REDIRECT,
  loginFormSchema,
  loginRequestSchema,
  sanitizeReturnTo,
  studentIdSchema,
  updateMeRequestSchema,
} from '@/lib/auth';
import {
  buildLoginAttemptKey,
  buildPasswordChangeAttemptKey,
  computeSessionExpiry,
  computeSlidingExpiry,
  FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT,
  generateOpaqueSessionToken,
  hashSessionToken,
  isPairRateLimited,
  isPasswordChangeRateLimited,
  isRateLimited,
  isSessionExpired,
  LOGIN_ATTEMPT_ESCAPE_PREFIX,
  PASSWORD_CHANGE_ATTEMPT_PREFIX,
  PASSWORD_CHANGE_RATE_LIMIT_MAX_FAILED,
  RATE_LIMIT_MAX_FAILED_ATTEMPTS,
  RATE_LIMIT_MAX_FAILED_PER_PAIR,
  resolveLoginRedirect,
} from '@/server/modules/auth/policy';

describe('sanitizeReturnTo', () => {
  it('accepts safe internal paths with query and hash', () => {
    expect(sanitizeReturnTo('/boards')).toBe('/boards');
    expect(sanitizeReturnTo('  /boards/abc?view=kanban#card-1  ')).toBe(
      '/boards/abc?view=kanban#card-1',
    );
    expect(sanitizeReturnTo('/my-tasks?filter=due')).toBe('/my-tasks?filter=due');
    expect(sanitizeReturnTo('/@evil.com')).toBe('/@evil.com');
    expect(sanitizeReturnTo('/boards/../members')).toBe('/members');
    expect(sanitizeReturnTo('https://evil.example', '/me')).toBe('/me');
  });

  it('blocks external URLs, protocol-relative, encoded slash, credentials, backslashes, schemes, control chars, /login loops, and /api paths', () => {
    const attackVectors = [
      null,
      undefined,
      '',
      '   ',
      'boards',
      'https://evil.example/boards',
      'https://user:pass@evil.com/boards',
      'http://evil.example',
      '//evil.example/boards',
      '///evil.example',
      '/%2fevil.com',
      '/%2Fevil.com',
      '/%5cevil.com',
      '/%5Cevil.com',
      '/\\evil.example',
      '/boards\\secret',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/boards\r\nSet-Cookie: hacked=1',
      '/boards\tfoo',
      '/boards\u0000',
      '/login',
      '/login?returnTo=/boards',
      '/login/callback',
      '/boards/../login',
      '/api',
      '/api/v1/me',
      '/boards/../api/v1/auth/session',
    ];

    for (const raw of attackVectors) {
      expect(sanitizeReturnTo(raw)).toBe(DEFAULT_LOGIN_REDIRECT);
    }
  });
});

describe('auth schemas', () => {
  it('validates studentIdSchema, loginFormSchema, loginRequestSchema, and password schemas', () => {
    const max64 = 'A'.repeat(64);
    const tooLong65 = 'A'.repeat(65);

    expect(studentIdSchema.parse(`  ${max64}  `)).toBe(max64);
    expect(studentIdSchema.safeParse(tooLong65).success).toBe(false);

    expect(
      loginFormSchema.parse({
        studentId: ' MSSV-DEV-001 ',
        password: 'BeamDev@2026',
        remember: true,
      }),
    ).toEqual({
      studentId: 'MSSV-DEV-001',
      password: 'BeamDev@2026',
      remember: true,
    });
    expect(
      loginFormSchema.safeParse({
        studentId: tooLong65,
        password: 'BeamDev@2026',
        remember: false,
      }).success,
    ).toBe(false);
    expect(
      loginFormSchema.safeParse({
        studentId: 'MSSV-DEV-001',
        password: '',
        remember: false,
      }).success,
    ).toBe(false);

    const parsed = loginRequestSchema.parse({
      studentId: '  MSSV-DEV-001  ',
      password: 'BeamDev@2026',
    });
    expect(parsed).toEqual({
      studentId: 'MSSV-DEV-001',
      password: 'BeamDev@2026',
      remember: false,
    });
    expect(
      loginRequestSchema.safeParse({ studentId: '   ', password: 'BeamDev@2026' })
        .success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ studentId: 'MSSV-DEV-001' }).success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ studentId: tooLong65, password: 'BeamDev@2026' })
        .success,
    ).toBe(false);

    expect(
      changeMyPasswordRequestSchema.parse({
        currentPassword: 'OldPassword#1',
        newPassword: 'NewPassword#2',
      }),
    ).toEqual({
      currentPassword: 'OldPassword#1',
      newPassword: 'NewPassword#2',
    });
    expect(
      changeMyPasswordRequestSchema.safeParse({
        currentPassword: 'OldPassword#1',
        newPassword: 'short',
      }).success,
    ).toBe(false);
    expect(
      changeMyPasswordRequestSchema.safeParse({
        currentPassword: 'OldPassword#1',
        newPassword: '        ',
      }).success,
    ).toBe(false);
    expect(
      changeMyPasswordRequestSchema.safeParse({
        currentPassword: 'OldPassword#1',
        newPassword: 'NewPassword#2',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      changeMyPasswordFormSchema.safeParse({
        currentPassword: 'OldPassword#1',
        newPassword: 'NewPassword#2',
        confirmPassword: 'MismatchPassword#2',
      }).success,
    ).toBe(false);
  });

  it('validates updateMeRequestSchema locales', () => {
    expect(updateMeRequestSchema.parse({ locale: 'vi' })).toEqual({ locale: 'vi' });
    expect(updateMeRequestSchema.parse({ locale: 'en' })).toEqual({ locale: 'en' });
    expect(updateMeRequestSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });
});

describe('auth policy rules', () => {
  const ttlConfig = {
    sessionTtlDefaultHours: 24,
    sessionTtlRememberDays: 30,
  };

  it('computes 24h default expiry and 30d remember expiry (AC-05)', () => {
    const now = new Date('2026-11-24T00:00:00.000Z');
    expect(computeSessionExpiry(now, false, ttlConfig).toISOString()).toBe(
      '2026-11-25T00:00:00.000Z',
    );
    expect(computeSessionExpiry(now, true, ttlConfig).toISOString()).toBe(
      '2026-12-24T00:00:00.000Z',
    );
  });

  it('slides expiry only when rememberMe is true (AC-13)', () => {
    const originalExpiry = new Date('2026-11-25T00:00:00.000Z');
    const later = new Date('2026-11-24T12:00:00.000Z');

    expect(
      computeSlidingExpiry(
        later,
        { rememberMe: false, expiresAt: originalExpiry },
        ttlConfig,
      ).toISOString(),
    ).toBe('2026-11-25T00:00:00.000Z');

    expect(
      computeSlidingExpiry(
        later,
        { rememberMe: true, expiresAt: new Date('2026-12-24T00:00:00.000Z') },
        ttlConfig,
      ).toISOString(),
    ).toBe('2026-12-24T12:00:00.000Z');
  });

  it('detects expired and revoked sessions at exact boundaries', () => {
    const expiresAt = new Date('2026-11-25T00:00:00.000Z');
    expect(
      isSessionExpired({ expiresAt, revokedAt: null }, new Date('2026-11-24T23:59:59.999Z')),
    ).toBe(false);
    expect(isSessionExpired({ expiresAt, revokedAt: null }, expiresAt)).toBe(true);
    expect(
      isSessionExpired(
        { expiresAt, revokedAt: new Date('2026-11-24T01:00:00.000Z') },
        new Date('2026-11-24T02:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('enforces 2-layer login and password-change rate limit thresholds (AC-12, E11-02)', () => {
    expect(RATE_LIMIT_MAX_FAILED_PER_PAIR).toBe(5);
    expect(RATE_LIMIT_MAX_FAILED_ATTEMPTS).toBe(20);
    expect(PASSWORD_CHANGE_RATE_LIMIT_MAX_FAILED).toBe(5);
    expect(buildPasswordChangeAttemptKey('user-123')).toBe(
      `${PASSWORD_CHANGE_ATTEMPT_PREFIX}user-123`,
    );
    expect(buildLoginAttemptKey('MSSV-2026-001')).toBe('MSSV-2026-001');
    expect(buildLoginAttemptKey('pwd:user-123')).toBe(
      `${LOGIN_ATTEMPT_ESCAPE_PREFIX}pwd:user-123`,
    );
    expect(buildLoginAttemptKey('PWD:user-123')).toBe(
      `${LOGIN_ATTEMPT_ESCAPE_PREFIX}PWD:user-123`,
    );
    expect(buildLoginAttemptKey('login:pwd:user-123')).toBe(
      `${LOGIN_ATTEMPT_ESCAPE_PREFIX}login:pwd:user-123`,
    );

    expect(isPairRateLimited(0)).toBe(false);
    expect(isPairRateLimited(RATE_LIMIT_MAX_FAILED_PER_PAIR - 1)).toBe(false);
    expect(isPairRateLimited(RATE_LIMIT_MAX_FAILED_PER_PAIR)).toBe(true);

    expect(isRateLimited(0)).toBe(false);
    expect(isRateLimited(RATE_LIMIT_MAX_FAILED_ATTEMPTS - 1)).toBe(false);
    expect(isRateLimited(RATE_LIMIT_MAX_FAILED_ATTEMPTS)).toBe(true);

    expect(isPasswordChangeRateLimited(0)).toBe(false);
    expect(
      isPasswordChangeRateLimited(PASSWORD_CHANGE_RATE_LIMIT_MAX_FAILED - 1),
    ).toBe(false);
    expect(
      isPasswordChangeRateLimited(PASSWORD_CHANGE_RATE_LIMIT_MAX_FAILED),
    ).toBe(true);
  });

  it('generates opaque tokens and deterministic HMAC-SHA256 hashes', () => {
    const t1 = generateOpaqueSessionToken();
    const t2 = generateOpaqueSessionToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(40);

    const h1a = hashSessionToken(t1, 'secret-a');
    const h1b = hashSessionToken(t1, 'secret-a');
    const h1OtherSecret = hashSessionToken(t1, 'secret-b');
    const h2 = hashSessionToken(t2, 'secret-a');

    expect(h1a).toMatch(/^[a-f0-9]{64}$/);
    expect(h1a).toBe(h1b);
    expect(h1a).not.toBe(h1OtherSecret);
    expect(h1a).not.toBe(h2);
  });

  it('resolves login redirect with mustChangePassword default fallback', () => {
    expect(resolveLoginRedirect(undefined, false)).toBe(DEFAULT_LOGIN_REDIRECT);
    expect(resolveLoginRedirect(null, true)).toBe(
      FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT,
    );
    expect(resolveLoginRedirect('   ', true)).toBe(
      FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT,
    );
    expect(resolveLoginRedirect('https://evil.example', true)).toBe(
      FIRST_LOGIN_PASSWORD_CHANGE_REDIRECT,
    );
    expect(resolveLoginRedirect('/my-tasks', true)).toBe('/my-tasks');
  });
});
