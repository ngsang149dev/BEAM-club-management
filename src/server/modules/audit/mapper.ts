import { toMemberAvatarUrl } from '@/lib/media';
import { redactLogMeta } from '@/server/shared/logger';
import type { AuditLogRecord, AuditUserSummaryRecord } from './repository';

export interface AuditDepartmentSummaryDto {
  readonly id: string;
  readonly name: string;
}

export interface AuditMemberPublicSummaryDto {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly leftAt: string | null;
  readonly departments: AuditDepartmentSummaryDto[];
  readonly avatarUrl: string | null;
}

export interface AuditLogDto {
  readonly id: string;
  readonly actor: AuditMemberPublicSummaryDto;
  readonly targetUser: AuditMemberPublicSummaryDto | null;
  readonly action: string;
  readonly detail: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AuditCursorPageMetaDto {
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface AuditLogPageResponseDto {
  readonly items: AuditLogDto[];
  readonly meta: AuditCursorPageMetaDto;
}

function toMemberPublicSummaryDto(
  record: AuditUserSummaryRecord,
): AuditMemberPublicSummaryDto {
  return {
    id: record.id,
    fullName: record.fullName,
    isActive: record.isActive,
    leftAt: record.leftAt ? record.leftAt.toISOString() : null,
    departments: record.departments.map((dept) => ({ id: dept.id, name: dept.name })),
    avatarUrl: toMemberAvatarUrl(record.id, record.avatarUpdatedAt),
  };
}

export function toAuditLogDto(record: AuditLogRecord): AuditLogDto {
  return {
    id: record.id,
    actor: toMemberPublicSummaryDto(record.actor),
    targetUser: record.targetUser ? toMemberPublicSummaryDto(record.targetUser) : null,
    action: record.action,
    detail: redactLogMeta(record.detail) ?? {},
    createdAt: record.createdAt.toISOString(),
  };
}

export function toAuditLogPageResponseDto(input: {
  readonly items: readonly AuditLogRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}): AuditLogPageResponseDto {
  return {
    items: input.items.map(toAuditLogDto),
    meta: {
      nextCursor: input.nextCursor,
      limit: input.limit,
    },
  };
}
