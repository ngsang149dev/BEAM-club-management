import type {
  DepartmentRecord,
  ProfileWithDepartmentsRecord,
  SessionRecord,
} from './types';

export interface SelectedAuthProfileRow {
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
  readonly locale: string;
}

export interface SessionRowShape {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly rememberMe: boolean;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
}

export function mapSessionRow(row: SessionRowShape): SessionRecord {
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

export function mapProfileWithDepartmentsRow(
  row: SelectedAuthProfileRow,
  departments: readonly DepartmentRecord[],
): ProfileWithDepartmentsRecord {
  return {
    id: row.id,
    studentId: row.studentId,
    email: row.email,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    mustChangePassword: row.mustChangePassword,
    avatarUpdatedAt: row.avatarUpdatedAt,
    isAdmin: row.isAdmin,
    isActive: row.isActive,
    leftAt: row.leftAt,
    locale: row.locale === 'en' ? 'en' : 'vi',
    departments,
  };
}
