import { toMemberAvatarUrl } from '@/lib/media';
import type { DepartmentLeadSummaryRecord, DepartmentRecord } from './repository';

export interface DepartmentLeadSummaryDto {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly leftAt: string | null;
  readonly departments: Array<{ readonly id: string; readonly name: string }>;
  readonly avatarUrl: string | null;
}

export interface DepartmentDto {
  readonly id: string;
  readonly name: string;
  readonly lead: DepartmentLeadSummaryDto | null;
  readonly memberCount: number;
  readonly boardCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepartmentListResponseDto {
  readonly items: DepartmentDto[];
}

export interface DepartmentResponseDto {
  readonly department: DepartmentDto;
}

export interface DeleteDepartmentResponseDto {
  readonly deleted: boolean;
  readonly id: string;
}

function toDepartmentLeadDto(lead: DepartmentLeadSummaryRecord): DepartmentLeadSummaryDto {
  return {
    id: lead.id,
    fullName: lead.fullName,
    isActive: lead.isActive,
    leftAt: lead.leftAt ? lead.leftAt.toISOString() : null,
    departments: lead.departments.map((d) => ({ id: d.id, name: d.name })),
    avatarUrl: toMemberAvatarUrl(lead.id, lead.avatarUpdatedAt),
  };
}

export function toDepartmentDto(record: DepartmentRecord): DepartmentDto {
  return {
    id: record.id,
    name: record.name,
    lead: record.lead ? toDepartmentLeadDto(record.lead) : null,
    memberCount: record.memberCount,
    boardCount: record.boardCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toDepartmentListResponseDto(
  records: readonly DepartmentRecord[],
): DepartmentListResponseDto {
  return {
    items: records.map(toDepartmentDto),
  };
}

export function toDepartmentResponseDto(
  record: DepartmentRecord,
): DepartmentResponseDto {
  return {
    department: toDepartmentDto(record),
  };
}

export function toDeleteDepartmentResponseDto(
  id: string,
): DeleteDepartmentResponseDto {
  return {
    deleted: true,
    id,
  };
}
