import type { DepartmentRecord } from './repository';

export interface DepartmentDto {
  readonly id: string;
  readonly name: string;
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

export function toDepartmentDto(record: DepartmentRecord): DepartmentDto {
  return {
    id: record.id,
    name: record.name,
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
