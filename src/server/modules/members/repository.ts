import { and, asc, count, eq, exists, gt, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { departments, memberDepartments, profiles, sessions, userPermissions } from '@db/schema';
import { badRequest, conflict } from '@/lib/errors';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { escapeLikePattern } from './policy';
import type { CreateMemberParams, ListMembersParams, MemberAvatarRecord, MemberDepartmentRecord, MemberProfileRecord, MembersRepository, UpdateMemberParams } from './types';

export type { CreateMemberParams, ListMembersParams, MemberAvatarRecord, MemberDepartmentRecord, MemberProfileRecord, MembersRepository, UpdateMemberParams };

const MEMBER_PROFILE_COLUMNS = {
  id: profiles.id,
  studentId: profiles.studentId,
  email: profiles.email,
  fullName: profiles.fullName,
  avatarUpdatedAt: profiles.avatarUpdatedAt,
  isAdmin: profiles.isAdmin,
  isActive: profiles.isActive,
  leftAt: profiles.leftAt,
  locale: profiles.locale,
  mustChangePassword: profiles.mustChangePassword,
};

interface SelectedMemberProfileRow {
  readonly id: string;
  readonly studentId: string;
  readonly email: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly locale: string;
  readonly mustChangePassword: boolean;
}

function extractPgErrorInfo(error: unknown): { code?: string; constraint?: string; hint?: string } {
  let cur: unknown = error;
  for (let i = 0; i < 3 && typeof cur === 'object' && cur !== null; i += 1) {
    const rec = cur as { code?: unknown; constraint?: unknown; hint?: unknown; cause?: unknown };
    if (typeof rec.code === 'string') {
      return { code: rec.code, constraint: typeof rec.constraint === 'string' ? rec.constraint : undefined, hint: typeof rec.hint === 'string' ? rec.hint : undefined };
    }
    cur = rec.cause;
  }
  return {};
}

function mapUniqueViolation(constraint: string | undefined): Error {
  if (constraint === 'profiles_student_id_uq') return conflict('errors.studentIdExists', {}, 'STUDENT_ID_EXISTS');
  if (constraint === 'profiles_email_lower_uq') return conflict('errors.emailExists', {}, 'EMAIL_EXISTS');
  return conflict('errors.conflict', {}, 'CONFLICT');
}

function rethrowMemberWriteError(error: unknown): never {
  const pgErr = extractPgErrorInfo(error);
  if (pgErr.code === '23505') throw mapUniqueViolation(pgErr.constraint);
  if (pgErr.code === '23503' && pgErr.constraint === 'member_departments_department_id_fkey') {
    throw badRequest('errors.invalidDepartmentIds', {}, 'INVALID_DEPARTMENT_IDS');
  }
  if (pgErr.code === 'P0001' && pgErr.hint === 'LAST_ACTIVE_ADMIN') throw conflict('errors.lastActiveAdmin', {}, 'LAST_ACTIVE_ADMIN');
  if (pgErr.code === 'P0001' && pgErr.hint === 'STUDENT_ID_IMMUTABLE') throw badRequest('errors.badRequest', {}, 'STUDENT_ID_IMMUTABLE');
  throw error;
}

function toMemberRecord(row: SelectedMemberProfileRow, deptList: readonly MemberDepartmentRecord[]): MemberProfileRecord {
  return {
    id: row.id, studentId: row.studentId, email: row.email, fullName: row.fullName,
    avatarUpdatedAt: row.avatarUpdatedAt, isAdmin: row.isAdmin, isActive: row.isActive,
    leftAt: row.leftAt, locale: row.locale === 'en' ? 'en' : 'vi', mustChangePassword: row.mustChangePassword, departments: deptList,
  };
}

function buildSearchCondition(q: string | undefined, includeSid: boolean): SQL | undefined {
  if (!q || q.trim().length === 0) return undefined;
  const pattern = `%${escapeLikePattern(q.trim())}%`;
  return includeSid ? or(ilike(profiles.fullName, pattern), ilike(profiles.studentId, pattern)) : ilike(profiles.fullName, pattern);
}

function buildListConditions(db: DbExecutor, params: ListMembersParams): SQL | undefined {
  const filters: SQL[] = [];
  const searchCond = buildSearchCondition(params.q, params.includeStudentIdSearch);
  if (searchCond) filters.push(searchCond);
  if (params.departmentId) {
    filters.push(exists(db.select({ one: sql`1` }).from(memberDepartments).where(and(eq(memberDepartments.userId, profiles.id), eq(memberDepartments.departmentId, params.departmentId)))));
  }
  if (params.isActive !== undefined) filters.push(eq(profiles.isActive, params.isActive));
  if (params.cursor) {
    const { fullName, id } = params.cursor;
    const cursorCond = or(gt(profiles.fullName, fullName), and(eq(profiles.fullName, fullName), gt(profiles.id, id)));
    if (cursorCond) filters.push(cursorCond);
  }
  return filters.length > 0 ? and(...filters) : undefined;
}

export class DrizzleMembersRepository implements MembersRepository {
  constructor(private readonly db: DbExecutor) {}

  async listMembers(params: ListMembersParams): Promise<{ readonly rows: MemberProfileRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db.select(MEMBER_PROFILE_COLUMNS).from(profiles).where(buildListConditions(this.db, params)).orderBy(asc(profiles.fullName), asc(profiles.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    const deptMap = await this.loadDepartmentsMap(pageRows.map((r) => r.id), this.db);
    return { rows: pageRows.map((row) => toMemberRecord(row, deptMap.get(row.id) ?? [])), hasMore };
  }

  async findById(id: string, tx?: TransactionContext): Promise<MemberProfileRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor.select(MEMBER_PROFILE_COLUMNS).from(profiles).where(eq(profiles.id, id)).limit(1);
    return rows[0] ? this.hydrateSingle(rows[0], executor) : null;
  }

  async lockAndFindById(id: string, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    const rows = await tx.select(MEMBER_PROFILE_COLUMNS).from(profiles).where(eq(profiles.id, id)).for('update').limit(1);
    return rows[0] ? this.hydrateSingle(rows[0], tx) : null;
  }

  async findAvatarById(id: string): Promise<MemberAvatarRecord | null> {
    const rows = await this.db
      .select({ id: profiles.id, avatarData: profiles.avatarData, avatarMime: profiles.avatarMime })
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findExistingDepartmentIds(ids: readonly string[], tx: TransactionContext): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx.select({ id: departments.id }).from(departments).where(inArray(departments.id, [...ids]));
    return rows.map((row) => row.id);
  }

  async createMember(input: CreateMemberParams, tx: TransactionContext): Promise<MemberProfileRecord> {
    try {
      const [created] = await tx.insert(profiles).values({
        studentId: input.studentId, email: input.email, fullName: input.fullName,
        passwordHash: input.passwordHash, mustChangePassword: input.mustChangePassword,
        locale: input.locale, isAdmin: false, isActive: true, createdAt: input.now, updatedAt: input.now,
      }).returning(MEMBER_PROFILE_COLUMNS);
      if (!created) throw new Error('Failed to create member profile');
      await this.insertDepartments(created.id, input.departmentIds, input.now, tx);
      if (input.defaultPermissions.length > 0) {
        await tx.insert(userPermissions).values(input.defaultPermissions.map((permissionCode) => ({
          userId: created.id, permissionCode, grantedBy: input.grantedBy, grantedAt: input.now, createdAt: input.now,
        })));
      }
      return this.hydrateSingle(created, tx);
    } catch (error) {
      rethrowMemberWriteError(error);
    }
  }

  async updateMember(input: UpdateMemberParams, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    try {
      const patch: Partial<typeof profiles.$inferInsert> = { updatedAt: input.now };
      if (input.email !== undefined) patch.email = input.email;
      if (input.fullName !== undefined) patch.fullName = input.fullName;
      if (input.locale !== undefined) patch.locale = input.locale;
      const [updated] = await tx.update(profiles).set(patch).where(eq(profiles.id, input.id)).returning(MEMBER_PROFILE_COLUMNS);
      if (!updated) return null;
      if (input.departmentIds !== undefined) {
        await tx.delete(memberDepartments).where(eq(memberDepartments.userId, input.id));
        await this.insertDepartments(input.id, input.departmentIds, input.now, tx);
      }
      return this.hydrateSingle(updated, tx);
    } catch (error) {
      rethrowMemberWriteError(error);
    }
  }

  async countActiveAdmins(tx: TransactionContext): Promise<number> {
    const rows = await tx.select({ value: count() }).from(profiles).where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true)));
    return Number(rows[0]?.value ?? 0);
  }

  async deactivateMember(input: { readonly id: string; readonly leftAt: Date; readonly now: Date }, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    return this.updateActiveState({ id: input.id, isActive: false, leftAt: input.leftAt, now: input.now }, tx);
  }

  async revokeAllActiveSessions(userId: string, now: Date, tx: TransactionContext): Promise<void> {
    await tx.update(sessions).set({ revokedAt: now, updatedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async activateMember(input: { readonly id: string; readonly now: Date }, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    return this.updateActiveState({ id: input.id, isActive: true, leftAt: null, now: input.now }, tx);
  }

  async resetPasswordAndRevokeAllSessions(
    input: { readonly userId: string; readonly passwordHash: string; readonly mustChangePassword: boolean; readonly now: Date },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null> {
    try {
      const [updated] = await tx.update(profiles)
        .set({ passwordHash: input.passwordHash, mustChangePassword: input.mustChangePassword, updatedAt: input.now })
        .where(eq(profiles.id, input.userId)).returning(MEMBER_PROFILE_COLUMNS);
      if (!updated) return null;
      await this.revokeAllActiveSessions(input.userId, input.now, tx);
      return this.hydrateSingle(updated, tx);
    } catch (error) {
      rethrowMemberWriteError(error);
    }
  }

  async updateAvatar(
    input: { readonly id: string; readonly avatarData: Buffer; readonly avatarMime: string; readonly now: Date },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null> {
    const [updated] = await tx.update(profiles)
      .set({ avatarData: input.avatarData, avatarMime: input.avatarMime, avatarUpdatedAt: input.now, updatedAt: input.now })
      .where(eq(profiles.id, input.id)).returning(MEMBER_PROFILE_COLUMNS);
    return updated ? this.hydrateSingle(updated, tx) : null;
  }

  async clearAvatar(input: { readonly id: string; readonly now: Date }, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    const [updated] = await tx.update(profiles)
      .set({ avatarData: null, avatarMime: null, avatarUpdatedAt: null, updatedAt: input.now })
      .where(eq(profiles.id, input.id)).returning(MEMBER_PROFILE_COLUMNS);
    return updated ? this.hydrateSingle(updated, tx) : null;
  }

  private async updateActiveState(patch: { readonly id: string; readonly isActive: boolean; readonly leftAt: Date | null; readonly now: Date }, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    try {
      const [updated] = await tx.update(profiles).set({ isActive: patch.isActive, leftAt: patch.leftAt, updatedAt: patch.now }).where(eq(profiles.id, patch.id)).returning(MEMBER_PROFILE_COLUMNS);
      return updated ? this.hydrateSingle(updated, tx) : null;
    } catch (error) {
      rethrowMemberWriteError(error);
    }
  }

  private async insertDepartments(userId: string, departmentIds: readonly string[], now: Date, tx: TransactionContext): Promise<void> {
    if (departmentIds.length === 0) return;
    await tx.insert(memberDepartments).values(departmentIds.map((departmentId) => ({ userId, departmentId, createdAt: now })));
  }

  private async hydrateSingle(row: SelectedMemberProfileRow, executor: DbExecutor): Promise<MemberProfileRecord> {
    const map = await this.loadDepartmentsMap([row.id], executor);
    return toMemberRecord(row, map.get(row.id) ?? []);
  }

  private async loadDepartmentsMap(userIds: readonly string[], executor: DbExecutor): Promise<Map<string, MemberDepartmentRecord[]>> {
    const map = new Map<string, MemberDepartmentRecord[]>();
    if (userIds.length === 0) return map;
    const rows = await executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name })
      .from(memberDepartments).innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
      .where(inArray(memberDepartments.userId, [...userIds])).orderBy(asc(departments.name), asc(departments.id));
    for (const row of rows) {
      const list = map.get(row.userId);
      const dept = { id: row.id, name: row.name };
      if (list) list.push(dept);
      else map.set(row.userId, [dept]);
    }
    return map;
  }
}
