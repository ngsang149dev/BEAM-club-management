import { auditLogs } from '@db/schema';
import type { DbExecutor } from '@/server/shared/db';
import { redactLogMeta } from '@/server/shared/logger';
import type { TransactionContext } from '@/server/shared/transaction';

export interface AuditLogEntry {
  readonly actorId: string;
  readonly action: string;
  readonly targetUserId?: string | null;
  readonly detail: Record<string, unknown>;
  readonly createdAt?: Date;
}

export interface AuditLogWriter {
  record(entry: AuditLogEntry, tx?: TransactionContext): Promise<void>;
}

export class DrizzleAuditRepository implements AuditLogWriter {
  constructor(private readonly db: DbExecutor) {}

  async record(entry: AuditLogEntry, tx?: TransactionContext): Promise<void> {
    const executor = tx ?? this.db;
    const safeDetail = redactLogMeta(entry.detail) ?? {};

    await executor.insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      detail: safeDetail,
      createdAt: entry.createdAt ?? new Date(),
    });
  }
}
