import type { PermissionCode } from '@/lib/permissions';
import type { TransactionContext } from '@/server/shared/transaction';
import type { MemberCursor } from './policy';

export interface MemberDepartmentRecord {
  readonly id: string;
  readonly name: string;
}

export interface MemberProfileRecord {
  readonly id: string;
  readonly studentId: string;
  readonly email: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly locale: 'vi' | 'en';
  readonly mustChangePassword: boolean;
  readonly departments: readonly MemberDepartmentRecord[];
}

export interface MemberAvatarRecord {
  readonly id: string;
  readonly avatarData: Buffer | null;
  readonly avatarMime: string | null;
}

export interface ListMembersParams {
  readonly q?: string;
  readonly includeStudentIdSearch: boolean;
  readonly departmentId?: string;
  readonly isActive?: boolean;
  readonly cursor?: MemberCursor;
  readonly limit: number;
}

export interface CreateMemberParams {
  readonly studentId: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly locale: 'vi' | 'en';
  readonly departmentIds: readonly string[];
  readonly defaultPermissions: readonly PermissionCode[];
  readonly grantedBy: string;
  readonly now: Date;
}

export interface UpdateMemberParams {
  readonly id: string;
  readonly email?: string;
  readonly fullName?: string;
  readonly locale?: 'vi' | 'en';
  readonly departmentIds?: readonly string[];
  readonly now: Date;
}

export interface MembersRepository {
  listMembers(params: ListMembersParams): Promise<{
    readonly rows: MemberProfileRecord[];
    readonly hasMore: boolean;
  }>;
  findById(id: string, tx?: TransactionContext): Promise<MemberProfileRecord | null>;
  lockAndFindById(id: string, tx: TransactionContext): Promise<MemberProfileRecord | null>;
  findAvatarById(id: string): Promise<MemberAvatarRecord | null>;
  findExistingDepartmentIds(
    ids: readonly string[],
    tx: TransactionContext,
  ): Promise<string[]>;
  createMember(
    input: CreateMemberParams,
    tx: TransactionContext,
  ): Promise<MemberProfileRecord>;
  updateMember(
    input: UpdateMemberParams,
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
  countActiveAdmins(tx: TransactionContext): Promise<number>;
  deactivateMember(
    input: { readonly id: string; readonly leftAt: Date; readonly now: Date },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
  revokeAllActiveSessions(
    userId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<void>;
  activateMember(
    input: { readonly id: string; readonly now: Date },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
  resetPasswordAndRevokeAllSessions(
    input: {
      readonly userId: string;
      readonly passwordHash: string;
      readonly mustChangePassword: boolean;
      readonly now: Date;
    },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
  updateAvatar(
    input: {
      readonly id: string;
      readonly avatarData: Buffer;
      readonly avatarMime: string;
      readonly now: Date;
    },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
  clearAvatar(
    input: { readonly id: string; readonly now: Date },
    tx: TransactionContext,
  ): Promise<MemberProfileRecord | null>;
}
