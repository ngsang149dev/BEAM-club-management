import { and, asc, count, eq, gte, isNull, ne, notLike, type SQL } from 'drizzle-orm';
import {
  departments,
  loginAttempts,
  memberDepartments,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { dedupeCanonicalPermissions, isPermissionCode, type PermissionCode } from '@/lib/permissions';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { PASSWORD_CHANGE_ATTEMPT_PREFIX } from './policy';
import {
  buildAvatarUpdateValues,
  buildClearAvatarValues,
  buildCreateSessionValues,
  mapProfileWithDepartmentsRow,
  mapSessionRow,
  requireCreatedSession,
  type SelectedAuthProfileRow,
} from './repository-mappers';
import type {
  AuthRepository,
  CreateSessionInput,
  ProfileWithDepartmentsRecord,
  RevokeAllActiveSessionsInput,
  SessionRecord,
} from './types';

const AUTH_PROFILE_COLUMNS = {
  id: profiles.id,
  studentId: profiles.studentId,
  email: profiles.email,
  fullName: profiles.fullName,
  passwordHash: profiles.passwordHash,
  mustChangePassword: profiles.mustChangePassword,
  avatarUpdatedAt: profiles.avatarUpdatedAt,
  isAdmin: profiles.isAdmin,
  isActive: profiles.isActive,
  leftAt: profiles.leftAt,
  locale: profiles.locale,
};

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: DbExecutor) {}

  async countRecentFailedLoginAttempts(ip: string, since: Date): Promise<number> {
    return this.countAttempts(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, since),
        notLike(loginAttempts.studentId, `${PASSWORD_CHANGE_ATTEMPT_PREFIX}%`),
      ),
    );
  }

  async countRecentFailedLoginAttemptsForPair(
    ip: string,
    studentId: string,
    since: Date,
  ): Promise<number> {
    return this.countAttempts(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.studentId, studentId),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, since),
      ),
    );
  }

  async countRecentFailedAttemptsByKey(key: string, since: Date): Promise<number> {
    return this.countAttempts(
      and(
        eq(loginAttempts.studentId, key),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, since),
      ),
    );
  }

  private async countAttempts(condition: SQL | undefined): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(loginAttempts)
      .where(condition);
    return Number(rows[0]?.value ?? 0);
  }

  async recordLoginAttempt(input: {
    readonly studentId: string;
    readonly ip: string;
    readonly success: boolean;
    readonly createdAt: Date;
  }): Promise<void> {
    await this.db.insert(loginAttempts).values({
      studentId: input.studentId,
      ip: input.ip,
      success: input.success,
      createdAt: input.createdAt,
    });
  }

  async findProfileWithDepartmentsByStudentId(
    studentId: string,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    const rows = await this.db
      .select(AUTH_PROFILE_COLUMNS)
      .from(profiles)
      .where(eq(profiles.studentId, studentId))
      .limit(1);
    return rows[0] ? this.hydrateProfile(rows[0]) : null;
  }

  async findProfileWithDepartmentsById(
    userId: string,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    const rows = await this.db
      .select(AUTH_PROFILE_COLUMNS)
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return rows[0] ? this.hydrateProfile(rows[0]) : null;
  }

  async findUserPermissions(userId: string): Promise<PermissionCode[]> {
    const rows = await this.db
      .select({ permissionCode: userPermissions.permissionCode })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId));
    return dedupeCanonicalPermissions(
      rows.map((row) => row.permissionCode).filter((code): code is PermissionCode => isPermissionCode(code)),
    );
  }

  async createSession(
    input: CreateSessionInput,
    tx?: TransactionContext,
  ): Promise<SessionRecord> {
    const executor = tx ?? this.db;
    const rows = await executor
      .insert(sessions)
      .values(buildCreateSessionValues(input))
      .returning();
    return requireCreatedSession(rows[0]);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? mapSessionRow(rows[0]) : null;
  }

  async touchSession(input: {
    readonly sessionId: string;
    readonly lastSeenAt: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        lastSeenAt: input.lastSeenAt,
        expiresAt: input.expiresAt,
        updatedAt: input.lastSeenAt,
      })
      .where(eq(sessions.id, input.sessionId));
  }

  async revokeSession(input: {
    readonly sessionId: string;
    readonly revokedAt: Date;
  }): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: input.revokedAt, updatedAt: input.revokedAt })
      .where(eq(sessions.id, input.sessionId));
  }

  async revokeAllActiveSessions(
    input: RevokeAllActiveSessionsInput,
    tx?: TransactionContext,
  ): Promise<void> {
    const executor = tx ?? this.db;
    // Lock the profile row first so concurrent logins for the same account serialize cleanly.
    await executor
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, input.userId))
      .for('update');
    await executor
      .update(sessions)
      .set({ revokedAt: input.revokedAt, updatedAt: input.revokedAt })
      .where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)));
  }

  async updateProfileLocale(input: {
    readonly userId: string;
    readonly locale: 'vi' | 'en';
    readonly updatedAt: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    const rows = await this.db
      .update(profiles)
      .set({ locale: input.locale, updatedAt: input.updatedAt })
      .where(eq(profiles.id, input.userId))
      .returning(AUTH_PROFILE_COLUMNS);
    return rows[0] ? this.hydrateProfile(rows[0]) : null;
  }

  async updatePasswordAndRevokeOtherSessions(input: {
    readonly userId: string;
    readonly currentSessionId: string;
    readonly passwordHash: string;
    readonly mustChangePassword: boolean;
    readonly now: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(profiles)
        .set({
          passwordHash: input.passwordHash,
          mustChangePassword: input.mustChangePassword,
          updatedAt: input.now,
        })
        .where(eq(profiles.id, input.userId))
        .returning(AUTH_PROFILE_COLUMNS);
      const updated = rows[0];
      if (!updated) return null;
      await tx
        .update(sessions)
        .set({ revokedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(sessions.userId, input.userId),
            isNull(sessions.revokedAt),
            ne(sessions.id, input.currentSessionId),
          ),
        );
      return this.hydrateProfile(updated, tx);
    });
  }

  async updateUserAvatar(
    input: {
      readonly userId: string;
      readonly avatarData: Buffer;
      readonly avatarMime: string;
      readonly now: Date;
    },
    tx?: TransactionContext,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor
      .update(profiles)
      .set(buildAvatarUpdateValues(input))
      .where(eq(profiles.id, input.userId))
      .returning(AUTH_PROFILE_COLUMNS);
    return rows[0] ? this.hydrateProfile(rows[0], executor) : null;
  }

  async clearUserAvatar(
    input: { readonly userId: string; readonly now: Date },
    tx?: TransactionContext,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor
      .update(profiles)
      .set(buildClearAvatarValues(input.now))
      .where(eq(profiles.id, input.userId))
      .returning(AUTH_PROFILE_COLUMNS);
    return rows[0] ? this.hydrateProfile(rows[0], executor) : null;
  }

  private async hydrateProfile(
    row: SelectedAuthProfileRow,
    executor: DbExecutor = this.db,
  ): Promise<ProfileWithDepartmentsRecord> {
    const deptRows = await executor
      .select({ id: departments.id, name: departments.name })
      .from(memberDepartments)
      .innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
      .where(eq(memberDepartments.userId, row.id))
      .orderBy(asc(departments.name));
    return mapProfileWithDepartmentsRow(row, deptRows);
  }
}
