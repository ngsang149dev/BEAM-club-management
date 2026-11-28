import type { ChangeMyPasswordRequestInput } from '@/lib/auth';
import type { PermissionCode } from '@/lib/permissions';
import type { AuthActor } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';

export interface DepartmentRecord {
  readonly id: string;
  readonly name: string;
}

export interface ProfileWithDepartmentsRecord {
  readonly id: string;
  readonly studentId: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string | null;
  readonly mustChangePassword: boolean;
  readonly avatarUpdatedAt: Date | null;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly locale: 'vi' | 'en';
  readonly departments: readonly DepartmentRecord[];
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly rememberMe: boolean;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly rememberMe: boolean;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface RevokeAllActiveSessionsInput {
  readonly userId: string;
  readonly revokedAt: Date;
}

export interface LoginRateLimitFailures {
  readonly pairFailedCount: number;
  readonly ipFailedCount: number;
}

export interface SessionAuthContextRecord {
  readonly profile: ProfileWithDepartmentsRecord;
  readonly permissions: PermissionCode[];
}

export interface AuthRepository {
  countRecentFailedLoginAttempts(ip: string, since: Date): Promise<number>;
  countRecentFailedLoginAttemptsForPair(
    ip: string,
    studentId: string,
    since: Date,
  ): Promise<number>;
  countLoginRateLimitFailures?(params: {
    readonly ip: string;
    readonly attemptKey: string;
    readonly since: Date;
  }): Promise<LoginRateLimitFailures>;
  countRecentFailedAttemptsByKey(key: string, since: Date): Promise<number>;
  recordLoginAttempt(input: {
    readonly studentId: string;
    readonly ip: string;
    readonly success: boolean;
    readonly createdAt: Date;
  }): Promise<void>;
  findProfileWithDepartmentsByStudentId(
    studentId: string,
  ): Promise<ProfileWithDepartmentsRecord | null>;
  findProfileWithDepartmentsById(
    userId: string,
  ): Promise<ProfileWithDepartmentsRecord | null>;
  findUserPermissions(userId: string): Promise<PermissionCode[]>;
  findSessionAuthContext?(
    userId: string,
  ): Promise<SessionAuthContextRecord | null>;
  createSession(
    input: CreateSessionInput,
    tx?: TransactionContext,
  ): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(input: {
    readonly sessionId: string;
    readonly lastSeenAt: Date;
    readonly expiresAt: Date;
  }): Promise<void>;
  revokeSession(input: {
    readonly sessionId: string;
    readonly revokedAt: Date;
  }): Promise<void>;
  revokeAllActiveSessions(
    input: RevokeAllActiveSessionsInput,
    tx?: TransactionContext,
  ): Promise<void>;
  updateProfileLocale(input: {
    readonly userId: string;
    readonly locale: 'vi' | 'en';
    readonly updatedAt: Date;
  }): Promise<ProfileWithDepartmentsRecord | null>;
  updatePasswordAndRevokeOtherSessions(input: {
    readonly userId: string;
    readonly currentSessionId: string;
    readonly passwordHash: string;
    readonly mustChangePassword: boolean;
    readonly now: Date;
  }): Promise<ProfileWithDepartmentsRecord | null>;
  updateUserAvatar(
    input: {
      readonly userId: string;
      readonly avatarData: Buffer;
      readonly avatarMime: string;
      readonly now: Date;
    },
    tx?: TransactionContext,
  ): Promise<ProfileWithDepartmentsRecord | null>;
  clearUserAvatar(
    input: {
      readonly userId: string;
      readonly now: Date;
    },
    tx?: TransactionContext,
  ): Promise<ProfileWithDepartmentsRecord | null>;
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
  readonly ip?: string;
}

export interface UpdateMyAvatarCommand {
  readonly actor: AuthActor;
  readonly dataUrl: string;
}

export interface RemoveMyAvatarCommand {
  readonly actor: AuthActor;
}
