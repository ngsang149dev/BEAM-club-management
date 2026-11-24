import { and, asc, count, eq, gte, isNull, ne } from 'drizzle-orm';
import {
  departments,
  loginAttempts,
  memberDepartments,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { isPermissionCode, type PermissionCode } from '@/lib/permissions';
import type { DbExecutor } from '@/server/shared/db';

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

export interface AuthRepository {
  countRecentFailedLoginAttempts(ip: string, since: Date): Promise<number>;
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
  createSession(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly rememberMe: boolean;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<SessionRecord>;
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
}

type ProfileRow = typeof profiles.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    rememberMe: row.rememberMe,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: DbExecutor) {}

  async countRecentFailedLoginAttempts(ip: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.success, false),
          gte(loginAttempts.createdAt, since),
        ),
      );
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
      .select()
      .from(profiles)
      .where(eq(profiles.studentId, studentId))
      .limit(1);
    const row = rows[0];
    return row ? this.hydrateProfile(row) : null;
  }

  async findProfileWithDepartmentsById(
    userId: string,
  ): Promise<ProfileWithDepartmentsRecord | null> {
    const rows = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const row = rows[0];
    return row ? this.hydrateProfile(row) : null;
  }

  async findUserPermissions(userId: string): Promise<PermissionCode[]> {
    const rows = await this.db
      .select({ permissionCode: userPermissions.permissionCode })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId));
    return rows
      .map((row) => row.permissionCode)
      .filter((code): code is PermissionCode => isPermissionCode(code));
  }

  async createSession(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly rememberMe: boolean;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<SessionRecord> {
    const rows = await this.db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        rememberMe: input.rememberMe,
        expiresAt: input.expiresAt,
        lastSeenAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    const created = rows[0];
    if (!created) {
      throw new Error('Failed to create session record');
    }
    return mapSessionRow(created);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    return row ? mapSessionRow(row) : null;
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
      .set({
        revokedAt: input.revokedAt,
        updatedAt: input.revokedAt,
      })
      .where(eq(sessions.id, input.sessionId));
  }

  async updateProfileLocale(input: {
    readonly userId: string;
    readonly locale: 'vi' | 'en';
    readonly updatedAt: Date;
  }): Promise<ProfileWithDepartmentsRecord | null> {
    const rows = await this.db
      .update(profiles)
      .set({
        locale: input.locale,
        updatedAt: input.updatedAt,
      })
      .where(eq(profiles.id, input.userId))
      .returning();
    const updated = rows[0];
    return updated ? this.hydrateProfile(updated) : null;
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
        .returning();
      const updated = rows[0];
      if (!updated) {
        return null;
      }
      await tx
        .update(sessions)
        .set({
          revokedAt: input.now,
          updatedAt: input.now,
        })
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

  private async hydrateProfile(
    row: ProfileRow,
    executor: DbExecutor = this.db,
  ): Promise<ProfileWithDepartmentsRecord> {
    const deptRows = await executor
      .select({
        id: departments.id,
        name: departments.name,
      })
      .from(memberDepartments)
      .innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
      .where(eq(memberDepartments.userId, row.id))
      .orderBy(asc(departments.name));

    return {
      id: row.id,
      studentId: row.studentId,
      email: row.email,
      fullName: row.fullName,
      passwordHash: row.passwordHash,
      mustChangePassword: row.mustChangePassword,
      isAdmin: row.isAdmin,
      isActive: row.isActive,
      leftAt: row.leftAt,
      locale: row.locale === 'en' ? 'en' : 'vi',
      departments: deptRows,
    };
  }
}
