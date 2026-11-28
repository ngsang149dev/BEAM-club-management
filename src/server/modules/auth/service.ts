import { unauthorized } from '@/lib/errors';
import type { AuditLogWriter } from '@/server/shared/audit-writer';
import type { AuthActor } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import { parseAndValidateImageDataUrl } from '@/server/shared/media';
import { hashPassword } from '@/server/shared/password';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  type LoginResponseDto,
  type MeResponseDto,
  type SessionInfoResponseDto,
  toLoginResponseDto,
  toMeResponseDto,
  toSessionInfoResponseDto,
} from './mapper';
import {
  buildLoginAttemptKey,
  computeSessionExpiry,
  generateOpaqueSessionToken,
  hashSessionToken,
  isSessionExpired,
  resolveLoginRedirect,
} from './policy';
import {
  applySlidingSessionTouch,
  assertLoginWithinRateLimit,
  buildAuthActor,
  issueSingleActiveSession,
  persistMyAvatarRemoval,
  persistMyAvatarUpdate,
  verifyCurrentPasswordForChange,
  verifyLoginProfile,
} from './service-helpers';
import type {
  AuthRepository,
  ChangeMyPasswordCommand,
  LoginCommand,
  ProfileWithDepartmentsRecord,
  RemoveMyAvatarCommand,
  SessionRecord,
  UpdateMyAvatarCommand,
} from './types';

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

export interface AuthenticateSessionOptions {
  readonly touch?: boolean;
}

export interface MeResult {
  readonly response: MeResponseDto;
  readonly rememberMe: boolean;
}

export type {
  ChangeMyPasswordCommand,
  LoginCommand,
  RemoveMyAvatarCommand,
  UpdateMyAvatarCommand,
};

export interface AuthServiceDeps {
  readonly authRepo: AuthRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly config: Config;
  readonly logger: Logger;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(input: LoginCommand): Promise<LoginResult> {
    const now = this.deps.clock.now();
    await assertLoginWithinRateLimit({
      authRepo: this.deps.authRepo,
      logger: this.deps.logger,
      ip: input.ip,
      studentId: input.studentId,
      now,
    });
    const profile = await verifyLoginProfile({ authRepo: this.deps.authRepo, logger: this.deps.logger, input, now });
    await this.deps.authRepo.recordLoginAttempt({
      studentId: buildLoginAttemptKey(profile.studentId),
      ip: input.ip,
      success: true,
      createdAt: now,
    });

    const rememberMe = false;
    const rawToken = generateOpaqueSessionToken();
    const tokenHash = hashSessionToken(rawToken, this.deps.config.sessionSecret);
    const expiresAt = computeSessionExpiry(now, this.deps.config);
    const session = await issueSingleActiveSession({
      authRepo: this.deps.authRepo,
      transactionRunner: this.deps.transactionRunner,
      userId: profile.id,
      tokenHash,
      expiresAt,
      now,
    });
    const redirectTo = resolveLoginRedirect(input.returnTo, profile.mustChangePassword);
    this.deps.logger.info('User authenticated', { userId: profile.id, rememberMe });
    return {
      rawToken,
      rememberMe,
      locale: profile.locale,
      response: toLoginResponseDto({ profile, redirectTo, expiresAt: session.expiresAt }),
    };
  }

  async authenticateSession(
    rawToken: string | null | undefined,
    options?: AuthenticateSessionOptions,
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
    const context = await this.loadSessionContext(session.userId);
    if (!context || !context.profile.isActive) {
      await this.deps.authRepo.revokeSession({ sessionId: session.id, revokedAt: now });
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }
    const activeSession = await applySlidingSessionTouch({
      authRepo: this.deps.authRepo,
      session,
      now,
      config: this.deps.config,
      shouldTouch: options?.touch !== false,
    });
    return {
      session: activeSession,
      profile: context.profile,
      actor: buildAuthActor(context.profile, context.permissions),
    };
  }

  private async loadSessionContext(userId: string) {
    if (this.deps.authRepo.findSessionAuthContext) {
      return this.deps.authRepo.findSessionAuthContext(userId);
    }
    const profile = await this.deps.authRepo.findProfileWithDepartmentsById(userId);
    if (!profile) return null;
    const permissions = await this.deps.authRepo.findUserPermissions(profile.id);
    return { profile, permissions };
  }

  async getSessionInfo(
    rawToken: string | null | undefined,
  ): Promise<SessionInfoResponseDto> {
    const { session, actor } = await this.authenticateSession(rawToken);
    return toSessionInfoResponseDto(session, actor);
  }

  async logout(rawToken: string | null | undefined): Promise<{ readonly ok: boolean }> {
    const { session } = await this.authenticateSession(rawToken, { touch: false });
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
    const now = this.deps.clock.now();
    await verifyCurrentPasswordForChange({
      authRepo: this.deps.authRepo,
      logger: this.deps.logger,
      profile,
      currentPassword: command.input.currentPassword,
      ip: command.ip,
      now,
    });
    const passwordHash = await hashPassword(command.input.newPassword);
    const updated =
      await this.deps.authRepo.updatePasswordAndRevokeOtherSessions({
        userId: profile.id,
        currentSessionId: command.currentSessionId,
        passwordHash,
        mustChangePassword: false,
        now,
      });
    if (!updated) {
      throw unauthorized('errors.sessionExpired', {}, 'SESSION_EXPIRED');
    }
    this.deps.logger.info('User password changed', { userId: profile.id });
    return toMeResponseDto(updated, command.actor.permissions);
  }

  async updateMyAvatar(command: UpdateMyAvatarCommand): Promise<MeResponseDto> {
    if (!command.actor.isActive) {
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }
    const parsed = parseAndValidateImageDataUrl(command.dataUrl);
    const now = this.deps.clock.now();
    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistMyAvatarUpdate({
        authRepo: this.deps.authRepo,
        auditWriter: this.deps.auditWriter,
        userId: command.actor.id,
        avatarData: parsed.buffer,
        avatarMime: parsed.mimeType,
        now,
        tx,
      }),
    );
    this.deps.logger.info('Member avatar updated', {
      actorId: command.actor.id,
      mimeType: parsed.mimeType,
      byteLength: parsed.buffer.byteLength,
    });
    return toMeResponseDto(updated, command.actor.permissions);
  }

  async removeMyAvatar(command: RemoveMyAvatarCommand): Promise<MeResponseDto> {
    if (!command.actor.isActive) {
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }
    const now = this.deps.clock.now();
    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistMyAvatarRemoval({
        authRepo: this.deps.authRepo,
        auditWriter: this.deps.auditWriter,
        userId: command.actor.id,
        now,
        tx,
      }),
    );
    this.deps.logger.info('Member avatar removed', {
      actorId: command.actor.id,
    });
    return toMeResponseDto(updated, command.actor.permissions);
  }
}
