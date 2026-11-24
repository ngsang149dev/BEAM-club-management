import type { ListAuditLogsQueryInput } from '@/lib/permissions';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Logger } from '@/server/shared/logger';
import {
  type AuditLogPageResponseDto,
  toAuditLogPageResponseDto,
} from './mapper';
import {
  assertValidAuditDateRange,
  decodeAuditCursor,
  encodeAuditCursor,
} from './policy';
import type { AuditRepository } from './repository';

export interface AuditServiceDeps {
  readonly auditRepo: AuditRepository;
  readonly logger: Logger;
}

export class AuditService {
  constructor(private readonly deps: AuditServiceDeps) {}

  async listAuditLogs(
    actor: AuthActor,
    query: ListAuditLogsQueryInput,
  ): Promise<AuditLogPageResponseDto> {
    authorize(actor, 'audit.view');
    assertValidAuditDateRange(query.from, query.to);
    const cursor = query.cursor ? decodeAuditCursor(query.cursor) : undefined;

    const { rows, hasMore } = await this.deps.auditRepo.listAuditLogs({
      actorId: query.actorId,
      targetUserId: query.targetUserId,
      action: query.action,
      from: query.from,
      to: query.to,
      cursor,
      limit: query.limit,
    });

    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    this.deps.logger.info('Audit logs listed', {
      actorId: actor.id,
      resultCount: rows.length,
    });

    return toAuditLogPageResponseDto({
      items: rows,
      nextCursor,
      limit: query.limit,
    });
  }
}
