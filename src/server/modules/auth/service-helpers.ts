import { badRequest, tooManyRequests, unauthorized } from '@/lib/errors';
import type { PermissionCode } from '@/lib/permissions';
import type { AuditLogWriter } from '@/server/modules/audit';
import type { AuthActor } from '@/server/shared/authorize';
import type { Logger } from '@/server/shared/logger';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '@/server/shared/password';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  buildLoginAttemptKey,
  buildPasswordChangeAttemptKey,
  computeSlidingExpiry,
  isPairRateLimited,
  isPasswordChangeRateLimited,
  isRateLimited,
  RATE_LIMIT_WINDOW_MINUTES,
  type SessionTtlConfig,
} from './policy';
import type {
  AuthRepository,
  LoginCommand,
  ProfileWithDepartmentsRecord,
  SessionRecord,
} from './types';

const MS_PER_MINUTE = 60 * 1000;

function computeRateLimitSince(now: Date): Date {
  return new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * MS_PER_MINUTE);
}

function throwRateLimited(): never {
  throw tooManyRequests(
    'errors.tooManyRequests',
    { retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 },
    'RATE_LIMITED',
  );
}

export async function assertLoginWithinRateLimit(params: {
  readonly authRepo: AuthRepository;
  readonly logger: Logger;
  readonly ip: string;
  readonly studentId: string;
  readonly now: Date;
}): Promise<void> {
  const since = computeRateLimitSince(params.now);
  const loginAttemptKey = buildLoginAttemptKey(params.studentId);
  const pairFailedCount =
    await params.authRepo.countRecentFailedLoginAttemptsForPair(
      params.ip,
      loginAttemptKey,
      since,
    );
  if (isPairRateLimited(pairFailedCount)) {
    params.logger.warn('Login rate limit exceeded', {
      scope: 'pair',
      failedCount: pairFailedCount,
    });
    throwRateLimited();
  }

  const ipFailedCount = await params.authRepo.countRecentFailedLoginAttempts(
    params.ip,
    since,
  );
  if (isRateLimited(ipFailedCount)) {
    params.logger.warn('Login rate limit exceeded', {
      scope: 'ip',
      failedCount: ipFailedCount,
    });
    throwRateLimited();
  }
}

async function assertPasswordChangeWithinRateLimit(params: {
  readonly authRepo: AuthRepository;
  readonly logger: Logger;
  readonly userId: string;
  readonly attemptKey: string;
  readonly now: Date;
}): Promise<void> {
  const failedCount = await params.authRepo.countRecentFailedAttemptsByKey(
    params.attemptKey,
    computeRateLimitSince(params.now),
  );
  if (isPasswordChangeRateLimited(failedCount)) {
    params.logger.warn('Password change rate limit exceeded', {
      userId: params.userId,
      failedCount,
    });
    throwRateLimited();
  }
}

export async function verifyCurrentPasswordForChange(params: {
  readonly authRepo: AuthRepository;
  readonly logger: Logger;
  readonly profile: ProfileWithDepartmentsRecord;
  readonly currentPassword: string;
  readonly ip?: string;
  readonly now: Date;
}): Promise<void> {
  const attemptKey = buildPasswordChangeAttemptKey(params.profile.id);
  await assertPasswordChangeWithinRateLimit({
    authRepo: params.authRepo,
    logger: params.logger,
    userId: params.profile.id,
    attemptKey,
    now: params.now,
  });

  const currentValid = await verifyPassword(
    params.currentPassword,
    params.profile.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!currentValid) {
    await params.authRepo.recordLoginAttempt({
      studentId: attemptKey,
      ip: params.ip ?? 'unknown',
      success: false,
      createdAt: params.now,
    });
    params.logger.warn('Failed password change attempt', {
      userId: params.profile.id,
    });
    throw badRequest(
      'errors.invalidCurrentPassword',
      {},
      'INVALID_CURRENT_PASSWORD',
    );
  }
}

export async function verifyLoginProfile(params: {
  readonly authRepo: AuthRepository;
  readonly logger: Logger;
  readonly input: LoginCommand;
  readonly now: Date;
}): Promise<ProfileWithDepartmentsRecord> {
  const profile = await params.authRepo.findProfileWithDepartmentsByStudentId(
    params.input.studentId,
  );
  const activeHash =
    profile?.isActive && profile.passwordHash ? profile.passwordHash : null;
  const passwordMatches = await verifyPassword(
    params.input.password,
    activeHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!profile || !activeHash || !passwordMatches) {
    await params.authRepo.recordLoginAttempt({
      studentId: buildLoginAttemptKey(params.input.studentId),
      ip: params.input.ip,
      success: false,
      createdAt: params.now,
    });
    params.logger.warn('Failed login attempt', { reason: 'rejected' });
    throw unauthorized('auth.invalidCredentials', {}, 'INVALID_CREDENTIALS');
  }
  return profile;
}

export async function persistMyAvatarUpdate(params: {
  readonly authRepo: AuthRepository;
  readonly auditWriter: AuditLogWriter;
  readonly userId: string;
  readonly avatarData: Buffer;
  readonly avatarMime: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<ProfileWithDepartmentsRecord> {
  const updated = await params.authRepo.updateUserAvatar(
    {
      userId: params.userId,
      avatarData: params.avatarData,
      avatarMime: params.avatarMime,
      now: params.now,
    },
    params.tx,
  );
  if (!updated) {
    throw unauthorized('errors.sessionExpired', {}, 'SESSION_EXPIRED');
  }
  await params.auditWriter.record(
    {
      actorId: params.userId,
      action: 'member.avatar_updated',
      targetUserId: params.userId,
      detail: {
        mimeType: params.avatarMime,
        byteLength: params.avatarData.byteLength,
      },
      createdAt: params.now,
    },
    params.tx,
  );
  return updated;
}

export async function persistMyAvatarRemoval(params: {
  readonly authRepo: AuthRepository;
  readonly auditWriter: AuditLogWriter;
  readonly userId: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<ProfileWithDepartmentsRecord> {
  const updated = await params.authRepo.clearUserAvatar(
    {
      userId: params.userId,
      now: params.now,
    },
    params.tx,
  );
  if (!updated) {
    throw unauthorized('errors.sessionExpired', {}, 'SESSION_EXPIRED');
  }
  await params.auditWriter.record(
    {
      actorId: params.userId,
      action: 'member.avatar_removed',
      targetUserId: params.userId,
      detail: { removed: true },
      createdAt: params.now,
    },
    params.tx,
  );
  return updated;
}

export async function issueSingleActiveSession(params: {
  readonly authRepo: AuthRepository;
  readonly transactionRunner: TransactionRunner;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly now: Date;
}): Promise<SessionRecord> {
  return params.transactionRunner.runInTransaction(async (tx) => {
    await params.authRepo.revokeAllActiveSessions(
      { userId: params.userId, revokedAt: params.now },
      tx,
    );
    return params.authRepo.createSession(
      {
        userId: params.userId,
        tokenHash: params.tokenHash,
        rememberMe: false,
        expiresAt: params.expiresAt,
        now: params.now,
      },
      tx,
    );
  });
}

export async function applySlidingSessionTouch(params: {
  readonly authRepo: AuthRepository;
  readonly session: SessionRecord;
  readonly now: Date;
  readonly config: SessionTtlConfig;
  readonly shouldTouch: boolean;
}): Promise<SessionRecord> {
  if (!params.shouldTouch) {
    return params.session;
  }
  const nextExpiresAt = computeSlidingExpiry(params.now, params.config);
  await params.authRepo.touchSession({
    sessionId: params.session.id,
    lastSeenAt: params.now,
    expiresAt: nextExpiresAt,
  });
  return {
    ...params.session,
    lastSeenAt: params.now,
    expiresAt: nextExpiresAt,
  };
}

export function buildAuthActor(
  profile: ProfileWithDepartmentsRecord,
  permissions: PermissionCode[],
): AuthActor {
  return {
    id: profile.id,
    isActive: profile.isActive,
    isAdmin: profile.isAdmin,
    permissions,
    departmentIds: profile.departments.map((d) => d.id),
  };
}
