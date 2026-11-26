import { badRequest, tooManyRequests, unauthorized } from '@/lib/errors';
import type { AuditLogWriter } from '@/server/modules/audit';
import type { Logger } from '@/server/shared/logger';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '@/server/shared/password';
import type { TransactionContext } from '@/server/shared/transaction';
import {
  buildLoginAttemptKey,
  buildPasswordChangeAttemptKey,
  isPairRateLimited,
  isPasswordChangeRateLimited,
  isRateLimited,
  RATE_LIMIT_WINDOW_MINUTES,
} from './policy';
import type {
  AuthRepository,
  LoginCommand,
  ProfileWithDepartmentsRecord,
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
