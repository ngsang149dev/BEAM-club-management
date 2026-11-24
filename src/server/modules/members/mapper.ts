import type { MemberProfileRecord } from './repository';

export interface DepartmentSummaryDto {
  readonly id: string;
  readonly name: string;
}

export interface MemberPublicSummaryDto {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly leftAt: string | null;
  readonly departments: DepartmentSummaryDto[];
}

export interface MemberDetailDto extends MemberPublicSummaryDto {
  readonly studentId: string;
  readonly email: string;
  readonly locale: 'vi' | 'en';
  readonly isAdmin: boolean;
}

export type MemberDto = MemberDetailDto | MemberPublicSummaryDto;

export interface CursorPageMetaDto {
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface MemberPageResponseDto {
  readonly items: MemberDto[];
  readonly meta: CursorPageMetaDto;
}

export interface MemberItemResponseDto {
  readonly member: MemberDto;
}

export function toMemberDto(
  record: MemberProfileRecord,
  includeDetail: boolean,
): MemberDto {
  const baseSummary: MemberPublicSummaryDto = {
    id: record.id,
    fullName: record.fullName,
    isActive: record.isActive,
    leftAt: record.leftAt ? record.leftAt.toISOString() : null,
    departments: record.departments.map((department) => ({
      id: department.id,
      name: department.name,
    })),
  };

  if (!includeDetail) {
    return baseSummary;
  }

  return {
    ...baseSummary,
    studentId: record.studentId,
    email: record.email,
    locale: record.locale,
    isAdmin: record.isAdmin,
  };
}

export function toMemberItemResponseDto(
  record: MemberProfileRecord,
  includeDetail: boolean,
): MemberItemResponseDto {
  return {
    member: toMemberDto(record, includeDetail),
  };
}

export function toMemberPageResponseDto(input: {
  readonly items: readonly MemberProfileRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
  readonly includeDetail: boolean;
}): MemberPageResponseDto {
  return {
    items: input.items.map((item) => toMemberDto(item, input.includeDetail)),
    meta: {
      nextCursor: input.nextCursor,
      limit: input.limit,
    },
  };
}
