import { badRequest, tooManyRequests, unauthorized } from '@/lib/errors';
import type { AuthActor } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from '@/server/shared/password';
import {
  type LoginResponseDto,
  type MeResponseDto,
  type SessionInfoResponseDto,
  toLoginResponseDto,
  toMeResponseDto,
  toSessionInfoResponseDto,
} from './mapper';
import {
  computeSessionExpiry,
  computeSlidingExpiry,
  generateOpaqueSessionToken,
  hashSessionToken,
  isRateLimited,
  isSessionExpired,
  RATE_LIMIT_WINDOW_MINUTES,
  resolveLoginRedirect,
} from './policy';
import type {
  AuthRepository,
  ProfileWithDepartmentsRecord,
  SessionRecord,
} from './repository';
import type { ChangeMyPasswordRequestInput } from './schemas';

export interface AuthServiceDeps {
  readonly authRepo: AuthRepository;
  readonly clock: Clock;
  readonly config: Config;
  readonly logger: Logger;
}

export interface LoginCommand {
  readonly studentId: string;
  readonly password: string;
  readonly remember?: boolean;
  readonly returnTo?: string | null;
  readonly ip: string;
}

export interface ChangeMyPasswordCommand {
  readonly actor: AuthActor;
  readonly currentSessionId: string;
  readonly input: ChangeMyPasswordRequestInput;
}

export interface LoginResult {
  readonly rawToken: string;
  readonly rememberMe: boolean;
  readonly locale: 'vi' | 'en';
  readonly response: LoginResponseDto;
}

export interface AuthenticatedSession {
  readonly session: SessionRecord;
  readonly profile: ProfileWithDepartmentsRecord;
  readonly actor: AuthActor;
}

export interface MeResult {
  readonly response: MeResponseDto;
  readonly rememberMe: boolean;
}

const MS_PER_MINUTE = 60 * 1000;

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(input: LoginCommand): Promise<LoginResult> {
    const now = this.deps.clock.now();
    await this.assertIpWithinRateLimit(input.ip, now);

    const profile = await this.verifyLoginProfile(input, now);
    await this.deps.authRepo.recordLoginAttempt({
      studentId: profile.studentId,
      ip: input.ip,
      success: true,
      createdAt: now,
    });

    const rememberMe = Boolean(input.remember);
    const rawToken = generateOpaqueSessionToken();
    const tokenHash = hashSessionToken(rawToken, this.deps.config.sessionSecret);
    const expiresAt = computeSessionExpiry(now, rememberMe, this.deps.config);
    const session = await this.deps.authRepo.createSession({
      userId: profile.id,
      tokenHash,
      rememberMe,
      expiresAt,
      now,
    });

    const redirectTo = resolveLoginRedirect(
      input.returnTo,
      profile.mustChangePassword,
    );
    this.deps.logger.info('User authenticated', { userId: profile.id, rememberMe });
    return {
      rawToken,
      rememberMe,
      locale: profile.locale,
      response: toLoginResponseDto({
        profile,
        redirectTo,
        expiresAt: session.expiresAt,
      }),
    };
  }

  async authenticateSession(
    rawToken: string | null | undefined,
  ): Promise<AuthenticatedSession> {
    if (!rawToken) {
      throw unauthorized('errors.unauthorized', {}, 'UNAUTHORIZED');
    }

    const tokenHash = hashSessionToken(rawToken, this.deps.config.sessionSecret);
    const session = await this.deps.authRepo.findSessionByTokenHash(tokenHash);
    const now = this.deps.clock.now();
    if (!session || isSessionExpired(session, now)) {
      throw unauthorized('errors.sessionExpired', {}, 'SESSION_EXPIRED');
    }

    const profile = await this.deps.authRepo.findProfileWithDepartmentsById(
      session.userId,
    );
    if (!profile || !profile.isActive) {
      await this.deps.authRepo.revokeSession({ sessionId: session.id, revokedAt: now });
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }

    const permissions = await this.deps.authRepo.findUserPermissions(profile.id);
    const nextExpiresAt = computeSlidingExpiry(now, session, this.deps.config);
    await this.deps.authRepo.touchSession({
      sessionId: session.id,
      lastSeenAt: now,
      expiresAt: nextExpiresAt,
    });

    const updatedSession: SessionRecord = {
      ...session,
      lastSeenAt: now,
      expiresAt: nextExpiresAt,
    };
    const actor: AuthActor = {
      id: profile.id,
      isActive: profile.isActive,
      isAdmin: profile.isAdmin,
      permissions,
    };
    return { session: updatedSession, profile, actor };
  }

  async getSessionInfo(
    rawToken: string | null | undefined,
  ): Promise<SessionInfoResponseDto> {
    const { session, actor } = await this.authenticateSession(rawToken);
    return toSessionInfoResponseDto(session, actor);
  }

  async logout(rawToken: string | null | undefined): Promise<{ readonly ok: boolean }> {
    const { session } = await this.authenticateSession(rawToken);
    await this.deps.authRepo.revokeSession({
      sessionId: session.id,
      revokedAt: this.deps.clock.now(),
    });
    this.deps.logger.info('User signed out', { userId: session.userId });
    return { ok: true };
  }

  async getMe(rawToken: string | null | undefined): Promise<MeResult> {
    const { session, profile, actor } = await this.authenticateSession(rawToken);
    return {
      response: toMeResponseDto(profile, actor.permissions),
      rememberMe: session.rememberMe,
    };
  }

  async updateMeLocale(
    rawToken: string | null | undefined,
    locale: 'vi' | 'en',
  ): Promise<MeResult> {
    const { session, profile, actor } = await this.authenticateSession(rawToken);
    const updated = await this.deps.authRepo.updateProfileLocale({
      userId: profile.id,
      locale,
      updatedAt: this.deps.clock.now(),
    });
    if (!updated) {
      throw unauthorized('errors.sessionExpired', {}, 'SESSION_EXPIRED');
    }
    return {
      response: toMeResponseDto(updated, actor.permissions),
      rememberMe: session.rememberMe,
    };
  }

  async changeMyPassword(
    command: ChangeMyPasswordCommand,
  ): Promise<MeResponseDto> {
    if (!command.actor.isActive) {
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }
    const profile = await this.deps.authRepo.findProfileWithDepartmentsById(
      command.actor.id,
    );
    if (!profile || !profile.isActive) {
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }
    const currentValid = await verifyPassword(
      command.input.currentPassword,
      profile.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!currentValid) {
      throw badRequest(
        'errors.invalidCurrentPassword',
        {},
        'INVALID_CURRENT_PASSWORD',
      );
    }
    const passwordHash = await hashPassword(command.input.newPassword);
    const updated =
      await this.deps.authRepo.updatePasswordAndRevokeOtherSessions({
        userId: profile.id,
        currentSessionId: command.currentSessionId,
        passwordHash,
        mustChangePassword: false,
        now: this.deps.clock.now(),
      });
    if (!updated) {
      throw unauthorized('errors.sessionExpired', {}, 'SESSION_EXPIRED');
    }
    this.deps.logger.info('User password changed', { userId: profile.id });
    return toMeResponseDto(updated, command.actor.permissions);
  }

  private async verifyLoginProfile(
    input: LoginCommand,
    now: Date,
  ): Promise<ProfileWithDepartmentsRecord> {
    const profile = await this.deps.authRepo.findProfileWithDepartmentsByStudentId(
      input.studentId,
    );
    const activeHash =
      profile?.isActive && profile.passwordHash ? profile.passwordHash : null;
    const passwordMatches = await verifyPassword(
      input.password,
      activeHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!profile || !activeHash || !passwordMatches) {
      await this.recordFailedLogin(input.studentId, input.ip, now);
      throw unauthorized('auth.invalidCredentials', {}, 'INVALID_CREDENTIALS');
    }
    return profile;
  }

  private async assertIpWithinRateLimit(ip: string, now: Date): Promise<void> {
    const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * MS_PER_MINUTE);
    const failedCount = await this.deps.authRepo.countRecentFailedLoginAttempts(
      ip,
      since,
    );
    if (isRateLimited(failedCount)) {
      this.deps.logger.warn('Login rate limit exceeded', { failedCount });
      throw tooManyRequests(
        'errors.tooManyRequests',
        { retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 },
        'RATE_LIMITED',
      );
    }
  }

  private async recordFailedLogin(
    studentId: string,
    ip: string,
    now: Date,
  ): Promise<void> {
    await this.deps.authRepo.recordLoginAttempt({
      studentId,
      ip,
      success: false,
      createdAt: now,
    });
    this.deps.logger.warn('Failed login attempt', { reason: 'rejected' });
  }
}
