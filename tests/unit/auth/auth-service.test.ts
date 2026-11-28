import { beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { MAX_IMAGE_BYTES } from '@/lib/media';
import type { PermissionCode } from '@/lib/permissions';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  type AuthRepository,
  AuthService,
  PASSWORD_CHANGE_ATTEMPT_PREFIX,
  type ProfileWithDepartmentsRecord,
  type SessionRecord,
} from '@/server/modules/auth';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import { type Logger, type LogMeta, StructuredLogger } from '@/server/shared/logger';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

class InMemoryAuthRepository implements AuthRepository {
  readonly profiles = new Map<string, ProfileWithDepartmentsRecord>();
  readonly avatars = new Map<string, { data: Buffer; mimeType: string }>();
  readonly permissions = new Map<string, PermissionCode[]>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly loginAttempts: Array<{
    studentId: string;
    ip: string;
    success: boolean;
    createdAt: Date;
  }> = [];
  touchCalls = 0;
  private seq = 0;

  async countRecentFailedLoginAttempts(ip: string, since: Date): Promise<number> {
    return this.loginAttempts.filter(
      (attempt) =>
        attempt.ip === ip &&
        !attempt.success &&
        attempt.createdAt.getTime() >= since.getTime() &&
        !attempt.studentId.startsWith(PASSWORD_CHANGE_ATTEMPT_PREFIX),
    ).length;
  }

  async countRecentFailedLoginAttemptsForPair(
    ip: string,
    studentId: string,
    since: Date,
  ): Promise<number> {
    return this.loginAttempts.filter(
      (attempt) =>
        attempt.ip === ip &&
        attempt.studentId === studentId &&
        !attempt.success &&
        attempt.createdAt.getTime() >= since.getTime(),
    ).length;
  }

  async countRecentFailedAttemptsByKey(key: string, since: Date): Promise<number> {
    return this.loginAttempts.filter(
      (attempt) =>
        attempt.studentId === key &&
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

  async createSession(
    input: {
      userId: string;
      tokenHash: string;
      rememberMe: boolean;
      expiresAt: Date;
      now: Date;
    },
    tx?: TransactionContext,
  ): Promise<SessionRecord> {
    void tx;
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
    this.touchCalls += 1;
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

  async revokeAllActiveSessions(
    input: { userId: string; revokedAt: Date },
    tx?: TransactionContext,
  ): Promise<void> {
    void tx;
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === input.userId && session.revokedAt === null) {
        this.sessions.set(id, { ...session, revokedAt: input.revokedAt });
      }
    }
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

  async updatePasswordAndRevokeOtherSessions(input: {
    userId: string;
    currentSessionId: string;
    passwordHash: string;
    mustChangePassword: boolean;
    now: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    const existing = this.profiles.get(input.userId);
    if (!existing) return null;
    const updated: ProfileWithDepartmentsRecord = {
      ...existing,
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword,
    };
    this.profiles.set(input.userId, updated);
    for (const [id, session] of this.sessions.entries()) {
      if (
        session.userId === input.userId &&
        session.revokedAt === null &&
        id !== input.currentSessionId
      ) {
        this.sessions.set(id, { ...session, revokedAt: input.now });
      }
    }
    return updated;
  }

  async updateUserAvatar(input: {
    userId: string;
    avatarData: Buffer;
    avatarMime: string;
    now: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    const existing = this.profiles.get(input.userId);
    if (!existing) return null;
    const updated: ProfileWithDepartmentsRecord = {
      ...existing,
      avatarUpdatedAt: input.now,
    };
    this.profiles.set(input.userId, updated);
    this.avatars.set(input.userId, {
      data: Buffer.from(input.avatarData),
      mimeType: input.avatarMime,
    });
    return updated;
  }

  async clearUserAvatar(input: {
    userId: string;
    now: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    const existing = this.profiles.get(input.userId);
    if (!existing) return null;
    const updated: ProfileWithDepartmentsRecord = {
      ...existing,
      avatarUpdatedAt: null,
    };
    this.profiles.set(input.userId, updated);
    this.avatars.delete(input.userId);
    return updated;
  }
}

class SpyAuditWriter implements AuditLogWriter {
  readonly entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

const TEST_CONFIG: Config = {
  nodeEnv: 'test',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  sessionSecret: 'unit-test-session-secret-0123456789',
  sessionTtlMinutes: 30,
  allowedEmailDomain: 'eiu.edu.vn',
  defaultInitialPassword: DEV_SEED_PASSWORD,
  cronSecret: 'unit-test-cron-secret',
  smtp: {},
  appUrl: 'http://localhost:3000',
};

let seedPasswordHash = '';

beforeAll(async () => {
  seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
});

function createTestHarness() {
  const repo = new InMemoryAuthRepository();
  const auditWriter = new SpyAuditWriter();
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
    passwordHash: seedPasswordHash,
    mustChangePassword: false,
    avatarUpdatedAt: null,
    isAdmin: false,
    isActive: true,
    leftAt: null,
    locale: 'vi',
    departments: [{ id: 'dept-1', name: 'Tech' }],
  });
  repo.permissions.set('user-1', ['member.view', 'board.create']);

  repo.profiles.set('user-first-login', {
    id: 'user-first-login',
    studentId: 'MSSV-UNIT-FIRST',
    email: 'first@eiu.edu.vn',
    fullName: 'First Login User',
    passwordHash: seedPasswordHash,
    mustChangePassword: true,
    avatarUpdatedAt: null,
    isAdmin: false,
    isActive: true,
    leftAt: null,
    locale: 'vi',
    departments: [],
  });

  repo.profiles.set('user-no-hash', {
    id: 'user-no-hash',
    studentId: 'MSSV-UNIT-NOHASH',
    email: 'nohash@eiu.edu.vn',
    fullName: 'Unset Password User',
    passwordHash: null,
    mustChangePassword: false,
    avatarUpdatedAt: null,
    isAdmin: false,
    isActive: true,
    leftAt: null,
    locale: 'vi',
    departments: [],
  });

  repo.profiles.set('user-inactive', {
    id: 'user-inactive',
    studentId: 'MSSV-UNIT-INACTIVE',
    email: 'unit-inactive@eiu.edu.vn',
    fullName: 'Inactive Member',
    passwordHash: seedPasswordHash,
    mustChangePassword: false,
    avatarUpdatedAt: null,
    isAdmin: false,
    isActive: false,
    leftAt: new Date('2026-10-01T00:00:00.000Z'),
    locale: 'vi',
    departments: [],
  });

  const service = new AuthService({
    authRepo: repo,
    auditWriter,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    config: TEST_CONFIG,
    logger,
  });
  return { repo, auditWriter, clock, rawLogs, metaCaptures, service };
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
  it('returns identical generic 401 errors for unknown MSSV, inactive accounts, null hash, and wrong password (AC-01, AC-02)', async () => {
    const { repo, rawLogs, service } = createTestHarness();

    const unknownErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-DOES-NOT-EXIST',
        password: DEV_SEED_PASSWORD,
        ip: '10.0.0.1',
      }),
    );
    const inactiveErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-INACTIVE',
        password: DEV_SEED_PASSWORD,
        ip: '10.0.0.2',
      }),
    );
    const nullHashErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-NOHASH',
        password: DEV_SEED_PASSWORD,
        ip: '10.0.0.3',
      }),
    );
    const wrongPassErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-001',
        password: 'WrongPassword#99',
        ip: '10.0.0.4',
      }),
    );

    expect(unknownErr.httpStatus).toBe(401);
    expect(unknownErr.code).toBe('INVALID_CREDENTIALS');
    expect(unknownErr.messageKey).toBe('auth.invalidCredentials');
    for (const err of [inactiveErr, nullHashErr, wrongPassErr]) {
      expect(err.httpStatus).toBe(unknownErr.httpStatus);
      expect(err.code).toBe(unknownErr.code);
      expect(err.messageKey).toBe(unknownErr.messageKey);
      expect(err.details).toEqual(unknownErr.details);
    }
    expect(repo.loginAttempts).toHaveLength(4);
    expect(repo.loginAttempts.every((attempt) => attempt.success === false)).toBe(true);
    expect(JSON.stringify(rawLogs)).not.toContain('MSSV-DOES-NOT-EXIST');
    expect(JSON.stringify(rawLogs)).not.toContain('MSSV-UNIT-INACTIVE');
    expect(JSON.stringify(rawLogs)).not.toContain('unit-inactive@eiu.edu.vn');
    expect(JSON.stringify(rawLogs)).not.toContain(DEV_SEED_PASSWORD);
    expect(JSON.stringify(rawLogs)).not.toContain('WrongPassword#99');
    expect(JSON.stringify(rawLogs)).not.toContain(seedPasswordHash);
  });

  it('redirects first-login accounts (mustChangePassword=true) to /profile?changePassword=1 unless returnTo is explicit', async () => {
    const { service } = createTestHarness();

    const defaultRedirectLogin = await service.login({
      studentId: 'MSSV-UNIT-FIRST',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.6',
    });
    expect(defaultRedirectLogin.response.redirectTo).toBe('/profile?changePassword=1');
    expect(defaultRedirectLogin.response.user.mustChangePassword).toBe(true);
    expect('passwordHash' in defaultRedirectLogin.response.user).toBe(false);

    const explicitRedirectLogin = await service.login({
      studentId: 'MSSV-UNIT-FIRST',
      password: DEV_SEED_PASSWORD,
      returnTo: '/my-tasks',
      ip: '10.0.0.6',
    });
    expect(explicitRedirectLogin.response.redirectTo).toBe('/my-tasks');
  });

  it('enforces 2-layer login rate limit: pair (5) isolates accounts on shared IP while global IP cap (20) stops spray attacks (AC-12, E11-02)', async () => {
    const { clock, service } = createTestHarness();
    const sharedIp = '10.0.0.9';

    // 1. 5 failed attempts for one student blocks ONLY that (ip, studentId) pair
    for (let i = 0; i < 5; i += 1) {
      await captureAppError(() =>
        service.login({
          studentId: 'MSSV-UNIT-FIRST',
          password: 'WrongPassword#1',
          ip: sharedIp,
        }),
      );
    }

    const pairRateErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-FIRST',
        password: DEV_SEED_PASSWORD,
        ip: sharedIp,
      }),
    );
    expect(pairRateErr.httpStatus).toBe(429);
    expect(pairRateErr.code).toBe('RATE_LIMITED');
    expect(pairRateErr.messageKey).toBe('errors.tooManyRequests');
    expect(pairRateErr.details.retryAfterSeconds).toBe(900);

    // Another member on the same shared Wi-Fi IP is NOT blocked
    const unaffectedLogin = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: sharedIp,
    });
    expect(unaffectedLogin.response.user.id).toBe('user-1');

    // 2. 15 more failures across other studentIds reaches global IP cap of 20
    for (let i = 0; i < 15; i += 1) {
      await captureAppError(() =>
        service.login({
          studentId: `MSSV-SPRAY-${Math.floor(i / 3)}`,
          password: DEV_SEED_PASSWORD,
          ip: sharedIp,
        }),
      );
    }

    const globalIpRateErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-001',
        password: DEV_SEED_PASSWORD,
        ip: sharedIp,
      }),
    );
    expect(globalIpRateErr.httpStatus).toBe(429);
    expect(globalIpRateErr.code).toBe('RATE_LIMITED');
    expect(globalIpRateErr.details.retryAfterSeconds).toBe(900);

    clock.advanceByMs(15 * 60 * 1000 + 1);
    const okAfterWindow = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: sharedIp,
    });
    expect(okAfterWindow.response.user.id).toBe('user-1');
  });

  it('enforces password-change rate limit (5 failed attempts / 15m) without affecting IP login budget (E11-02)', async () => {
    const { clock, repo, rawLogs, service } = createTestHarness();
    const sharedIp = '10.0.0.19';
    const loggedIn = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: sharedIp,
    });
    const authSession = await service.authenticateSession(loggedIn.rawToken);

    for (let i = 0; i < 5; i += 1) {
      const err = await captureAppError(() =>
        service.changeMyPassword({
          actor: authSession.actor,
          currentSessionId: authSession.session.id,
          input: {
            currentPassword: `WrongCurrent#${i}`,
            newPassword: 'UpdatedPass#2026',
          },
          ip: sharedIp,
        }),
      );
      expect(err.httpStatus).toBe(400);
      expect(err.code).toBe('INVALID_CURRENT_PASSWORD');
    }

    // 6th attempt is blocked with 429 even if currentPassword is correct
    const rateErr = await captureAppError(() =>
      service.changeMyPassword({
        actor: authSession.actor,
        currentSessionId: authSession.session.id,
        input: {
          currentPassword: DEV_SEED_PASSWORD,
          newPassword: 'UpdatedPass#2026',
        },
        ip: sharedIp,
      }),
    );
    expect(rateErr.httpStatus).toBe(429);
    expect(rateErr.code).toBe('RATE_LIMITED');
    expect(rateErr.details.retryAfterSeconds).toBe(900);

    // Failed pwd: entries do NOT count against login IP rate limit
    const ipLoginCount = await repo.countRecentFailedLoginAttempts(
      sharedIp,
      new Date(clock.now().getTime() - 15 * 60 * 1000),
    );
    expect(ipLoginCount).toBe(0);

    // After 15 minutes, password change succeeds again
    clock.advanceByMs(15 * 60 * 1000 + 1);
    const updated = await service.changeMyPassword({
      actor: authSession.actor,
      currentSessionId: authSession.session.id,
      input: {
        currentPassword: DEV_SEED_PASSWORD,
        newPassword: 'UpdatedPass#2026',
      },
      ip: sharedIp,
    });
    expect(updated.profile.id).toBe('user-1');

    const logsSerialized = JSON.stringify(rawLogs);
    expect(logsSerialized).not.toContain('MSSV-UNIT-001');
    expect(logsSerialized).not.toContain('WrongCurrent#0');
    expect(logsSerialized).not.toContain('UpdatedPass#2026');
  });

  it('prevents pwd: prefix collision: login with studentId="pwd:<userId>" cannot DoS /me/password and rotating pwd:<n> still hits global IP 429', async () => {
    const { service } = createTestHarness();
    const attackerIp = '10.0.0.29';
    const loggedIn = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.28',
    });
    const authSession = await service.authenticateSession(loggedIn.rawToken);

    // 1. 5 failed logins with studentId="pwd:user-1" MUST NOT lock out user-1 from changeMyPassword
    for (let i = 0; i < 5; i += 1) {
      const err = await captureAppError(() =>
        service.login({
          studentId: 'pwd:user-1',
          password: 'WrongPassword#1',
          ip: attackerIp,
        }),
      );
      expect(err.httpStatus).toBe(401);
    }

    const updated = await service.changeMyPassword({
      actor: authSession.actor,
      currentSessionId: authSession.session.id,
      input: {
        currentPassword: DEV_SEED_PASSWORD,
        newPassword: 'SafeAfterAttack#2026',
      },
      ip: '10.0.0.28',
    });
    expect(updated.profile.id).toBe('user-1');

    // 2. 15 more rotating pwd:<n> / PWD:<n> logins (20 total on attackerIp) trigger global IP 429
    for (let i = 0; i < 15; i += 1) {
      const prefix = i % 2 === 0 ? 'pwd:' : 'PWD:';
      const err = await captureAppError(() =>
        service.login({
          studentId: `${prefix}spray-${i}`,
          password: 'WrongPassword#1',
          ip: attackerIp,
        }),
      );
      expect(err.httpStatus).toBe(401);
    }

    const globalBlocked = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-001',
        password: 'SafeAfterAttack#2026',
        ip: attackerIp,
      }),
    );
    expect(globalBlocked.httpStatus).toBe(429);
    expect(globalBlocked.code).toBe('RATE_LIMITED');
  });

  it('enforces 30-minute sliding TTL, ignores legacy remember=true, and exempts background polling ({ touch: false }) from extending expiry (CR-08)', async () => {
    const { clock, service } = createTestHarness();

    const loginResult = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      remember: true,
      returnTo: '//evil.com',
      ip: '10.0.0.3',
    });
    expect(loginResult.rememberMe).toBe(false);
    expect(loginResult.response.redirectTo).toBe('/tasks');
    expect(loginResult.response.expiresAt).toBe('2026-11-24T00:30:00.000Z');

    const initialInfo = await service.getSessionInfo(loginResult.rawToken);
    expect(initialInfo.rememberMe).toBe(false);
    expect(initialInfo.expiresAt).toBe('2026-11-24T00:30:00.000Z');

    // Active user request at +20m slides expiry to +50m
    clock.advanceByMs(20 * 60 * 1000);
    const activeInfo = await service.getSessionInfo(loginResult.rawToken);
    expect(activeInfo.rememberMe).toBe(false);
    expect(activeInfo.expiresAt).toBe('2026-11-24T00:50:00.000Z');

    // Background poll at +25m MUST NOT extend expiresAt or lastSeenAt
    clock.advanceByMs(5 * 60 * 1000);
    const pollSession = await service.authenticateSession(loginResult.rawToken, {
      touch: false,
    });
    expect(pollSession.session.expiresAt.toISOString()).toBe('2026-11-24T00:50:00.000Z');
    expect(pollSession.session.lastSeenAt.toISOString()).toBe('2026-11-24T00:20:00.000Z');

    // Idle >= 30m after last active touch (+25m more -> +50m total) expires both normal & background poll
    clock.advanceByMs(25 * 60 * 1000);
    const idleExpired = await captureAppError(() =>
      service.getSessionInfo(loginResult.rawToken),
    );
    expect(idleExpired.httpStatus).toBe(401);
    expect(idleExpired.code).toBe('SESSION_EXPIRED');

    const pollExpired = await captureAppError(() =>
      service.authenticateSession(loginResult.rawToken, { touch: false }),
    );
    expect(pollExpired.httpStatus).toBe(401);
    expect(pollExpired.code).toBe('SESSION_EXPIRED');
  });

  it('revokes prior active sessions on login in a transaction while leaving other users active (CR-08 single active session)', async () => {
    const { clock, repo, service } = createTestHarness();

    const user1First = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.10',
    });
    const user2Session = await service.login({
      studentId: 'MSSV-UNIT-FIRST',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.11',
    });

    await expect(service.getSessionInfo(user1First.rawToken)).resolves.toMatchObject({
      userId: 'user-1',
    });
    await expect(service.getSessionInfo(user2Session.rawToken)).resolves.toMatchObject({
      userId: 'user-first-login',
    });

    clock.advanceByMs(60_000);
    const user1Second = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.12',
    });

    // Old token fails immediately with 401 SESSION_EXPIRED (both active and background poll)
    const oldTokenErr = await captureAppError(() =>
      service.getSessionInfo(user1First.rawToken),
    );
    expect(oldTokenErr.httpStatus).toBe(401);
    expect(oldTokenErr.code).toBe('SESSION_EXPIRED');

    const oldPollErr = await captureAppError(() =>
      service.authenticateSession(user1First.rawToken, { touch: false }),
    );
    expect(oldPollErr.httpStatus).toBe(401);
    expect(oldPollErr.code).toBe('SESSION_EXPIRED');

    // New token succeeds, and user-2's session remains untouched
    await expect(service.getSessionInfo(user1Second.rawToken)).resolves.toMatchObject({
      userId: 'user-1',
    });
    await expect(service.getSessionInfo(user2Session.rawToken)).resolves.toMatchObject({
      userId: 'user-first-login',
    });

    const user1ActiveSessions = Array.from(repo.sessions.values()).filter(
      (s) => s.userId === 'user-1' && s.revokedAt === null,
    );
    expect(user1ActiveSessions).toHaveLength(1);
  });

  it('reflects live permission revocation and account deactivation immediately (AC-07)', async () => {
    const { repo, service } = createTestHarness();
    const { rawToken } = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
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

  it('changes password returning 400 on wrong currentPassword, clears mustChangePassword, revokes other sessions while keeping current session, and leaks zero secrets', async () => {
    const { clock, repo, rawLogs, service } = createTestHarness();
    const sessionOne = await service.login({
      studentId: 'MSSV-UNIT-FIRST',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.7',
    });
    const sessionTwo = await service.login({
      studentId: 'MSSV-UNIT-FIRST',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.8',
    });

    // CR-08 single active session: sessionOne is already revoked by sessionTwo login
    const revokedByNewLoginErr = await captureAppError(() =>
      service.authenticateSession(sessionOne.rawToken),
    );
    expect(revokedByNewLoginErr.httpStatus).toBe(401);
    expect(revokedByNewLoginErr.code).toBe('SESSION_EXPIRED');

    // Seed an extra unrevoked session directly to verify changeMyPassword defense-in-depth revocation
    const legacyOtherSession = await repo.createSession({
      userId: 'user-first-login',
      tokenHash: 'legacy-extra-hash',
      rememberMe: false,
      expiresAt: new Date(clock.now().getTime() + 30 * 60 * 1000),
      now: clock.now(),
    });

    const authSessionTwo = await service.authenticateSession(sessionTwo.rawToken);
    const actor: AuthActor = authSessionTwo.actor;

    const wrongCurrentErr = await captureAppError(() =>
      service.changeMyPassword({
        actor,
        currentSessionId: authSessionTwo.session.id,
        input: {
          currentPassword: 'NotCurrent#1',
          newPassword: 'UpdatedPass#2026',
        },
      }),
    );
    expect(wrongCurrentErr.httpStatus).toBe(400);
    expect(wrongCurrentErr.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(wrongCurrentErr.messageKey).toBe('errors.invalidCurrentPassword');

    const inactiveActorErr = await captureAppError(() =>
      service.changeMyPassword({
        actor: { ...actor, isActive: false },
        currentSessionId: authSessionTwo.session.id,
        input: {
          currentPassword: DEV_SEED_PASSWORD,
          newPassword: 'UpdatedPass#2026',
        },
      }),
    );
    expect(inactiveActorErr.httpStatus).toBe(401);

    const updatedMe = await service.changeMyPassword({
      actor,
      currentSessionId: authSessionTwo.session.id,
      input: {
        currentPassword: DEV_SEED_PASSWORD,
        newPassword: 'UpdatedPass#2026',
      },
    });
    expect(updatedMe.profile.mustChangePassword).toBe(false);
    expect('passwordHash' in updatedMe.profile).toBe(false);

    // Current session stays active; legacy extra session is revoked by defense-in-depth
    await expect(service.getMe(sessionTwo.rawToken)).resolves.toMatchObject({
      response: { profile: { mustChangePassword: false } },
    });
    expect(repo.sessions.get(legacyOtherSession.id)?.revokedAt).not.toBeNull();

    // Old password rejected, new password accepted with default /tasks redirect
    const oldPassErr = await captureAppError(() =>
      service.login({
        studentId: 'MSSV-UNIT-FIRST',
        password: DEV_SEED_PASSWORD,
        ip: '10.0.0.7',
      }),
    );
    expect(oldPassErr.httpStatus).toBe(401);

    const relogin = await service.login({
      studentId: 'MSSV-UNIT-FIRST',
      password: 'UpdatedPass#2026',
      ip: '10.0.0.7',
    });
    expect(relogin.response.user.mustChangePassword).toBe(false);
    expect(relogin.response.redirectTo).toBe('/tasks');

    const stored = repo.profiles.get('user-first-login')!;
    const logsSerialized = JSON.stringify(rawLogs);
    expect(logsSerialized).not.toContain('UpdatedPass#2026');
    expect(logsSerialized).not.toContain('NotCurrent#1');
    expect(logsSerialized).not.toContain(DEV_SEED_PASSWORD);
    expect(logsSerialized).not.toContain(stored.passwordHash ?? '');
  });

  it('supports logout revocation, /me profile lookup, locale update, and zero PII in logs', async () => {
    const { rawLogs, service } = createTestHarness();
    const { rawToken } = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.5',
    });

    const me = await service.getMe(rawToken);
    expect(me.rememberMe).toBe(false);
    expect(me.response.profile.studentId).toBe('MSSV-UNIT-001');
    expect(me.response.profile.email).toBe('unit001@eiu.edu.vn');
    expect(me.response.profile.locale).toBe('vi');
    expect(me.response.profile.mustChangePassword).toBe(false);

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

  it('updates and removes own avatar via updateMyAvatar/removeMyAvatar, validates image bytes, records audit_logs, and leaks zero binary/PII', async () => {
    const { repo, auditWriter, clock, rawLogs, service } = createTestHarness();
    const { rawToken } = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: '10.0.0.15',
    });
    const session = await service.authenticateSession(rawToken);
    expect(session.profile.avatarUpdatedAt).toBeNull();

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
    const oversized = Buffer.concat([pngBytes, Buffer.alloc(MAX_IMAGE_BYTES + 1 - pngBytes.length, 0x01)]);

    await expect(
      service.updateMyAvatar({ actor: { ...session.actor, isActive: false }, dataUrl: pngDataUrl }),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });

    await expect(
      service.updateMyAvatar({ actor: session.actor, dataUrl: svgDataUrl }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_IMAGE_FORMAT' });

    await expect(
      service.updateMyAvatar({
        actor: session.actor,
        dataUrl: `data:image/png;base64,${oversized.toString('base64')}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'IMAGE_TOO_LARGE' });

    clock.advanceByMs(10_000);
    const updatedMe = await service.updateMyAvatar({
      actor: session.actor,
      dataUrl: pngDataUrl,
    });
    expect(updatedMe.profile.avatarUrl).toBe(
      `/api/v1/members/user-1/avatar?v=${clock.now().getTime()}`,
    );
    expect(repo.avatars.get('user-1')?.mimeType).toBe('image/png');

    const meAfterUpload = await service.getMe(rawToken);
    expect(meAfterUpload.response.profile.avatarUrl).toBe(updatedMe.profile.avatarUrl);

    clock.advanceByMs(5_000);
    const removedMe = await service.removeMyAvatar({ actor: session.actor });
    expect(removedMe.profile.avatarUrl).toBeNull();
    expect(repo.avatars.has('user-1')).toBe(false);

    expect(auditWriter.entries.map((e) => e.action)).toEqual([
      'member.avatar_updated',
      'member.avatar_removed',
    ]);
    expect(auditWriter.entries[0]?.detail).toEqual({
      mimeType: 'image/png',
      byteLength: pngBytes.byteLength,
    });
    expect(auditWriter.entries[1]?.detail).toEqual({ removed: true });

    const serializedAudit = JSON.stringify(auditWriter.entries);
    const serializedLogs = JSON.stringify(rawLogs);
    expect(serializedAudit).not.toContain(pngDataUrl);
    expect(serializedAudit).not.toContain('MSSV-UNIT-001');
    expect(serializedAudit).not.toContain('unit001@eiu.edu.vn');
    expect(serializedLogs).not.toContain(pngDataUrl);
    expect(serializedLogs).not.toContain('MSSV-UNIT-001');
    expect(serializedLogs).not.toContain('unit001@eiu.edu.vn');
  });

  it('throttles touchSession writes within 30 seconds and skips touching on logout', async () => {
    const { repo, clock, service } = createTestHarness();
    const login = await service.login({
      studentId: 'MSSV-UNIT-001',
      password: DEV_SEED_PASSWORD,
      ip: '127.0.0.1',
    });

    clock.advanceByMs(15_000);
    await service.authenticateSession(login.rawToken);
    expect(repo.touchCalls).toBe(0);

    clock.advanceByMs(15_000);
    await service.authenticateSession(login.rawToken);
    expect(repo.touchCalls).toBe(1);

    clock.advanceByMs(60_000);
    await service.logout(login.rawToken);
    expect(repo.touchCalls).toBe(1);
  });
});
