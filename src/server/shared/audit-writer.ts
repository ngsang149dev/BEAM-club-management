import type { TransactionContext } from './transaction';

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
