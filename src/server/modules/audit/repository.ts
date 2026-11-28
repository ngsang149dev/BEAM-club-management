import { and, desc, eq, exists, gte, lt, lte, notExists, or, type SQL, sql } from 'drizzle-orm';
import { auditLogs, tasks } from '@db/schema';
import { taskAccessSqlCondition } from '@/server/modules/tasks';
import type { AuditLogEntry, AuditLogWriter } from '@/server/shared/audit-writer';
import type { AuthActor } from '@/server/shared/authorize';
import type { DbExecutor } from '@/server/shared/db';
import { redactLogMeta } from '@/server/shared/logger';
import type { TransactionContext } from '@/server/shared/transaction';
import { loadUserSummariesMap } from '@/server/shared/user-summaries';
import type { AuditLogCursor } from './policy';

export type { AuditLogEntry, AuditLogWriter };

export interface AuditDepartmentSummaryRecord {
  readonly id: string;
  readonly name: string;
}

export interface AuditUserSummaryRecord {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly departments: readonly AuditDepartmentSummaryRecord[];
}

export interface AuditLogRecord {
  readonly id: string;
  readonly actor: AuditUserSummaryRecord;
  readonly targetUser: AuditUserSummaryRecord | null;
  readonly action: string;
  readonly detail: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface ListAuditLogsParams {
  readonly actor?: AuthActor;
  readonly actorId?: string;
  readonly targetUserId?: string;
  readonly action?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly cursor?: AuditLogCursor;
  readonly limit: number;
}

export interface AuditRepository extends AuditLogWriter {
  listAuditLogs(
    params: ListAuditLogsParams,
  ): Promise<{ readonly rows: AuditLogRecord[]; readonly hasMore: boolean }>;
}

function buildHiddenTaskAuditFilter(db: DbExecutor, actor: AuthActor): SQL {
  const noTaskId = sql`NOT jsonb_exists(${auditLogs.detail}, 'taskId')`;
  const visibleExistingTask = exists(
    db
      .select({ one: sql`1` })
      .from(tasks)
      .where(
        and(
          sql`${tasks.id}::text = ${auditLogs.detail}->>'taskId'`,
          taskAccessSqlCondition(db, actor),
        ),
      ),
  );
  const orphanTaskVisibility = and(
    notExists(
      db
        .select({ one: sql`1` })
        .from(tasks)
        .where(sql`${tasks.id}::text = ${auditLogs.detail}->>'taskId'`),
    ),
    or(
      sql`COALESCE((${auditLogs.detail}->>'isHidden')::boolean, (${auditLogs.detail}->>'wasHidden')::boolean, false) = false`,
      eq(auditLogs.actorId, actor.id),
    ),
  );
  return or(noTaskId, visibleExistingTask, orphanTaskVisibility)!;
}

function buildAuditCursorCondition(cursor?: AuditLogCursor): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(auditLogs.createdAt, cursor.createdAt),
    and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
  );
}

function buildAuditListConditions(db: DbExecutor, params: ListAuditLogsParams): SQL | undefined {
  const cursorCond = buildAuditCursorCondition(params.cursor);
  const filters: SQL[] = [
    ...(params.actor && !params.actor.isAdmin ? [buildHiddenTaskAuditFilter(db, params.actor)] : []),
    ...(params.actorId ? [eq(auditLogs.actorId, params.actorId)] : []),
    ...(params.targetUserId ? [eq(auditLogs.targetUserId, params.targetUserId)] : []),
    ...(params.action ? [eq(auditLogs.action, params.action)] : []),
    ...(params.from ? [gte(auditLogs.createdAt, params.from)] : []),
    ...(params.to ? [lte(auditLogs.createdAt, params.to)] : []),
    ...(cursorCond ? [cursorCond] : []),
  ];
  return filters.length > 0 ? and(...filters) : undefined;
}

function collectProfileIds(
  rows: ReadonlyArray<{ readonly actorId: string; readonly targetUserId: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.actorId);
    if (row.targetUserId) ids.add(row.targetUserId);
  }
  return Array.from(ids);
}

export class DrizzleAuditRepository implements AuditRepository {
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

  async listAuditLogs(
    params: ListAuditLogsParams,
  ): Promise<{ readonly rows: AuditLogRecord[]; readonly hasMore: boolean }> {
    const fetched = await this.db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        targetUserId: auditLogs.targetUserId,
        action: auditLogs.action,
        detail: auditLogs.detail,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(buildAuditListConditions(this.db, params))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(params.limit + 1);

    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    const userMap = await loadUserSummariesMap(this.db, collectProfileIds(pageRows));

    const rows = pageRows.map((row) => {
      const actor = userMap.get(row.actorId);
      if (!actor) throw new Error('Missing audit actor profile');
      const targetUser = row.targetUserId ? (userMap.get(row.targetUserId) ?? null) : null;
      return { id: row.id, actor, targetUser, action: row.action, detail: row.detail, createdAt: row.createdAt };
    });

    return { rows, hasMore };
  }
}
