import type { PermissionCode } from '@/lib/permissions';
import type { AuthActor } from '@/server/shared/authorize';
import type { ProfileWithDepartmentsRecord, SessionRecord } from './repository';

export interface DepartmentSummaryDto {
  readonly id: string;
  readonly name: string;
}

export interface MemberDetailDto {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly leftAt: string | null;
  readonly departments: DepartmentSummaryDto[];
  readonly studentId: string;
  readonly email: string;
  readonly locale: 'vi' | 'en';
  readonly isAdmin: boolean;
}

export interface LoginResponseDto {
  readonly user: MemberDetailDto;
  readonly redirectTo: string;
  readonly expiresAt: string;
}

export interface SessionInfoResponseDto {
  readonly authenticated: boolean;
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissions: PermissionCode[];
  readonly rememberMe: boolean;
  readonly expiresAt: string;
}

export interface MeResponseDto {
  readonly profile: MemberDetailDto;
  readonly permissions: PermissionCode[];
}

export function toMemberDetailDto(
  profile: ProfileWithDepartmentsRecord,
): MemberDetailDto {
  return {
    id: profile.id,
    fullName: profile.fullName,
    isActive: profile.isActive,
    leftAt: profile.leftAt ? profile.leftAt.toISOString() : null,
    departments: profile.departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
    })),
    studentId: profile.studentId,
    email: profile.email,
    locale: profile.locale,
    isAdmin: profile.isAdmin,
  };
}

export function toLoginResponseDto(input: {
  readonly profile: ProfileWithDepartmentsRecord;
  readonly redirectTo: string;
  readonly expiresAt: Date;
}): LoginResponseDto {
  return {
    user: toMemberDetailDto(input.profile),
    redirectTo: input.redirectTo,
    expiresAt: input.expiresAt.toISOString(),
  };
}

export function toSessionInfoResponseDto(
  session: SessionRecord,
  actor: AuthActor,
): SessionInfoResponseDto {
  return {
    authenticated: true,
    userId: actor.id,
    isAdmin: actor.isAdmin,
    permissions: [...actor.permissions],
    rememberMe: session.rememberMe,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function toMeResponseDto(
  profile: ProfileWithDepartmentsRecord,
  permissions: readonly PermissionCode[],
): MeResponseDto {
  return {
    profile: toMemberDetailDto(profile),
    permissions: [...permissions],
  };
}
