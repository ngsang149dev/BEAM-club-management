import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import type { PermissionCode } from '@/lib/permissions';
import {
  type AuthRepository,
  AuthService,
  type ProfileWithDepartmentsRecord,
  type SessionRecord,
} from '@/server/modules/auth';
import { FakeClock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import { type Logger, type LogMeta, StructuredLogger } from '@/server/shared/logger';

class InMemoryAuthRepository implements AuthRepository {
  readonly profiles = new Map<string, ProfileWithDepartmentsRecord>();
  readonly permissions = new Map<string, PermissionCode[]>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly loginAttempts: Array<{
    studentId: string;
    ip: string;
    success: boolean;
    createdAt: Date;
  }> = [];
  private seq = 0;

  async countRecentFailedLoginAttempts(ip: string, since: Date): Promise<number> {
    return this.loginAttempts.filter(
      (attempt) =>
        attempt.ip === ip &&
        !attempt.success &&
        attempt.createdAt.getTime() >= since.getTime(),
    ).length;
  }

  async recordLoginAttempt(input: {
    studentId: string;
    ip: string;
    success: boolean;
    createdAt: Date;
  }): Promise<void> {
    this.loginAttempts.push({ ...input });
  }

  async findProfileWithDepartmentsByStudentId(
    studentId: string,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    for (const profile of this.profiles.values()) {
      if (profile.studentId === studentId) {
        return profile;
      }
    }
    return null;
  }

  async findProfileWithDepartmentsById(
    userId: string,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    return this.profiles.get(userId) ?? null;
  }

  async findUserPermissions(userId: string): Promise<PermissionCode[]> {
    return [...(this.permissions.get(userId) ?? [])];
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    rememberMe: boolean;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRecord> {
    this.seq += 1;
    const record: SessionRecord = {
      id: `session-${this.seq}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      rememberMe: input.rememberMe,
      expiresAt: input.expiresAt,
      lastSeenAt: input.now,
      revokedAt: null,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        return session;
      }
    }
    return null;
  }

  async touchSession(input: {
    sessionId: string;
    lastSeenAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    const existing = this.sessions.get(input.sessionId);
    if (!existing) return;
    this.sessions.set(input.sessionId, {
      ...existing,
      lastSeenAt: input.lastSeenAt,
      expiresAt: input.expiresAt,
    });
  }

  async revokeSession(input: {
    sessionId: string;
    revokedAt: Date;
  }): Promise<void> {
    const existing = this.sessions.get(input.sessionId);
    if (!existing) return;
    this.sessions.set(input.sessionId, {
      ...existing,
      revokedAt: input.revokedAt,
    });
  }

  async updateProfileLocale(input: {
    userId: string;
    locale: 'vi' | 'en';
    updatedAt: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    const existing = this.profiles.get(input.userId);
    if (!existing) return null;
    const updated: ProfileWithDepartmentsRecord = {
      ...existing,
      locale: input.locale,
    };
    this.profiles.set(input.userId, updated);
    return updated;
  }
}

const TEST_CONFIG: Config = {
  nodeEnv: 'test',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  sessionSecret: 'unit-test-session-secret-0123456789',
  sessionTtlDefaultHours: 24,
  sessionTtlRememberDays: 30,
  allowedEmailDomain: 'eiu.edu.vn',
  cronSecret: 'unit-test-cron-secret',
  smtp: {},
  appUrl: 'http://localhost:3000',
  undoToastSeconds: 10,
};

function createTestHarness() {
  const repo = new InMemoryAuthRepository();
  const clock = new FakeClock('2026-11-24T00:00:00.000Z');
  const rawLogs: string[] = [];
  const metaCaptures: LogMeta[] = [];
  const baseLogger = new StructuredLogger({
    writeOut: (line) => rawLogs.push(line),
    writeErr: (line) => rawLogs.push(line),
  });
  const logger: Logger = {
    info: (msg, meta) => {
      if (meta) metaCaptures.push(meta);
      baseLogger.info(msg, meta);
    },
    warn: (msg, meta) => {
      if (meta) metaCaptures.push(meta);
      baseLogger.warn(msg, meta);
    },
    error: (msg, meta) => {
      if (meta) metaCaptures.push(meta);
      baseLogger.error(msg, meta);
    },
  };

  repo.profiles.set('user-1', {
    id: 'user-1',
    studentId: 'MSSV-UNIT-001',
    email: 'unit001@eiu.edu.vn',
    fullName: 'Unit Member One',
    isAdmin: false,
    isActive: true,
    leftAt: null,
    locale: 'vi',
    departments: [{ id: 'dept-1', name: 'Tech' }],
  });
  repo.permissions.set('user-1', ['member.view', 'board.create']);

  repo.profiles.set('user-inactive', {
    id: 'user-inactive',
    studentId: 'MSSV-UNIT-INACTIVE',
    email: 'unit-inactive@eiu.edu.vn',
    fullName: 'Inactive Member',
    isAdmin: false,
    isActive: false,
    leftAt: new Date('2026-10-01T00:00:00.000Z'),
    locale: 'vi',
    departments: [],
  });

  const service = new AuthService({
    authRepo: repo,
    clock,
    config: TEST_CONFIG,
    logger,
  });
  return { repo, clock, rawLogs, metaCaptures, service };
}

async function captureAppError(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
    throw new Error('Expected AppError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
}

describe('AuthService', () => {
  it('returns identical generic 401 errors for unknown MSSV and inactive accounts (AC-01, AC-02)', async () => {
    const { repo, rawLogs, service } = createTestHarness();

    const unknownErr = await captureAppError(() =>
      service.login({ studentId: 'MSSV-DOES-NOT-EXIST', ip: '10.0.0.1' }),
    );
    const inactiveErr = await captureAppError(() =>
      service.login({ studentId: 'MSSV-UNIT-INACTIVE', ip: '10.0.0.2' }),
    );

    expect(unknownErr.httpStatus).toBe(401);
    expect(unknownErr.code).toBe('INVALID_CREDENTIALS');
    expect(unknownErr.messageKey).toBe('auth.invalidCredentials');
    expect(inactiveErr.httpStatus).toBe(unknownErr.httpStatus);
    expect(inactiveErr.code).toBe(unknownErr.code);
    expect(inactiveErr.messageKey).toBe(unknownErr.messageKey);
    expect(inactiveErr.details).toEqual(unknownErr.details);
    expect(repo.loginAttempts).toHaveLength(2);
    expect(repo.loginAttempts.every((attempt) => attempt.success === false)).toBe(true);
    expect(JSON.stringify(rawLogs)).not.toContain('MSSV-DOES-NOT-EXIST');
    expect(JSON.stringify(rawLogs)).not.toContain('MSSV-UNIT-INACTIVE');
    expect(JSON.stringify(rawLogs)).not.toContain('unit-inactive@eiu.edu.vn');
  });

  it('enforces IP rate limit after 10 failed attempts within 15 minutes (AC-12)', async () => {
    const { clock, service } = createTestHarness();
    for (let i = 0; i < 10; i += 1) {
      await captureAppError(() =>
        service.login({ studentId: 'MSSV-UNKNOWN', ip: '10.0.0.9' }),
      );
    }

    const rateErr = await captureAppError(() =>
      service.login({ studentId: 'MSSV-UNIT-001', ip: '10.0.0.9' }),
    );
    expect(rateErr.httpStatus).toBe(429);
    expect(rateErr.code).toBe('RATE_LIMITED');
    expect(rateErr.messageKey).toBe('errors.tooManyRequests');
    expect(rateErr.details.retryAfterSeconds).toBe(900);

    clock.advanceByMs(15 * 60 * 1000 + 1);
    const okLogin = await service.login({
      studentId: 'MSSV-UNIT-001',
      ip: '10.0.0.9',
    });
    expect(okLogin.response.user.id).toBe('user-1');
  });

  it('handles 24h fixed TTL vs 30d sliding TTL and session expiry (AC-05, AC-13)', async () => {
    const { clock, service } = createTestHarness();

    const defaultLogin = await service.login({
      studentId: 'MSSV-UNIT-001',
      remember: false,
      returnTo: '//evil.com',
      ip: '10.0.0.3',
    });
    expect(defaultLogin.response.redirectTo).toBe('/boards');
    expect(defaultLogin.response.expiresAt).toBe('2026-11-25T00:00:00.000Z');

    clock.advanceByMs(12 * 60 * 60 * 1000);
    const defaultSession = await service.getSessionInfo(defaultLogin.rawToken);
    expect(defaultSession.expiresAt).toBe('2026-11-25T00:00:00.000Z');

    clock.advanceByMs(12 * 60 * 60 * 1000);
    const expiredErr = await captureAppError(() =>
      service.getSessionInfo(defaultLogin.rawToken),
    );
    expect(expiredErr.httpStatus).toBe(401);
    expect(expiredErr.code).toBe('SESSION_EXPIRED');

    const rememberLogin = await service.login({
      studentId: 'MSSV-UNIT-001',
      remember: true,
      returnTo: '/my-tasks?filter=due',
      ip: '10.0.0.3',
    });
    expect(rememberLogin.response.redirectTo).toBe('/my-tasks?filter=due');
    expect(rememberLogin.response.expiresAt).toBe('2026-12-25T00:00:00.000Z');

    clock.advanceByMs(20 * 24 * 60 * 60 * 1000);
    const slidSession = await service.getSessionInfo(rememberLogin.rawToken);
    expect(slidSession.expiresAt).toBe('2027-01-14T00:00:00.000Z');

    // Past the original 30-day boundary (day 40) remains valid thanks to sliding renewal
    clock.advanceByMs(20 * 24 * 60 * 60 * 1000);
    const extendedSession = await service.getSessionInfo(rememberLogin.rawToken);
    expect(extendedSession.expiresAt).toBe('2027-02-03T00:00:00.000Z');

    // Idle past the 30-day sliding window expires
    clock.advanceByMs(30 * 24 * 60 * 60 * 1000);
    const idleExpired = await captureAppError(() =>
      service.getSessionInfo(rememberLogin.rawToken),
    );
    expect(idleExpired.httpStatus).toBe(401);
    expect(idleExpired.code).toBe('SESSION_EXPIRED');
  });

  it('reflects live permission revocation and account deactivation immediately (AC-07)', async () => {
    const { repo, service } = createTestHarness();
    const { rawToken } = await service.login({
      studentId: 'MSSV-UNIT-001',
      ip: '10.0.0.4',
    });

    const before = await service.getSessionInfo(rawToken);
    expect(before.permissions).toEqual(['member.view', 'board.create']);

    repo.permissions.set('user-1', ['member.view']);
    const after = await service.getSessionInfo(rawToken);
    expect(after.permissions).toEqual(['member.view']);

    const active = repo.profiles.get('user-1')!;
    repo.profiles.set('user-1', { ...active, isActive: false });
    const inactiveErr = await captureAppError(() => service.getSessionInfo(rawToken));
    expect(inactiveErr.httpStatus).toBe(401);

    const storedSessions = Array.from(repo.sessions.values()).filter(
      (s) => s.userId === 'user-1',
    );
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]?.revokedAt).not.toBeNull();
  });

  it('supports logout revocation, /me profile lookup, locale update, and zero PII in logs', async () => {
    const { rawLogs, service } = createTestHarness();
    const { rawToken } = await service.login({
      studentId: 'MSSV-UNIT-001',
      ip: '10.0.0.5',
    });

    const me = await service.getMe(rawToken);
    expect(me.rememberMe).toBe(false);
    expect(me.response.profile.studentId).toBe('MSSV-UNIT-001');
    expect(me.response.profile.email).toBe('unit001@eiu.edu.vn');
    expect(me.response.profile.locale).toBe('vi');

    const updatedMe = await service.updateMeLocale(rawToken, 'en');
    expect(updatedMe.rememberMe).toBe(false);
    expect(updatedMe.response.profile.locale).toBe('en');

    const loggedOut = await service.logout(rawToken);
    expect(loggedOut).toEqual({ ok: true });

    const afterLogout = await captureAppError(() => service.getMe(rawToken));
    expect(afterLogout.httpStatus).toBe(401);

    const serializedLogs = JSON.stringify(rawLogs);
    expect(serializedLogs).not.toContain('MSSV-UNIT-001');
    expect(serializedLogs).not.toContain('unit001@eiu.edu.vn');
  });
});
