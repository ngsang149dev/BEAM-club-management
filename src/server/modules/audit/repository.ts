import { and, asc, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm';
import { auditLogs, departments, memberDepartments, profiles } from '@db/schema';
import type { DbExecutor } from '@/server/shared/db';
import { redactLogMeta } from '@/server/shared/logger';
import type { TransactionContext } from '@/server/shared/transaction';
import type { AuditLogCursor } from './policy';

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

export interface AuditDepartmentSummaryRecord {
  readonly id: string;
  readonly name: string;
}

export interface AuditUserSummaryRecord {
  readonly id: string;
  readonly fullName: string;
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

function buildAuditListConditions(params: ListAuditLogsParams): SQL | undefined {
  const filters: SQL[] = [];
  if (params.actorId) filters.push(eq(auditLogs.actorId, params.actorId));
  if (params.targetUserId) filters.push(eq(auditLogs.targetUserId, params.targetUserId));
  if (params.action) filters.push(eq(auditLogs.action, params.action));
  if (params.from) filters.push(gte(auditLogs.createdAt, params.from));
  if (params.to) filters.push(lte(auditLogs.createdAt, params.to));
  if (params.cursor) {
    const { createdAt, id } = params.cursor;
    const cursorCond = or(
      lt(auditLogs.createdAt, createdAt),
      and(eq(auditLogs.createdAt, createdAt), lt(auditLogs.id, id)),
    );
    if (cursorCond) filters.push(cursorCond);
  }
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
      .where(buildAuditListConditions(params))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(params.limit + 1);

    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    const userMap = await this.loadUserSummaries(collectProfileIds(pageRows));

    const rows = pageRows.map((row) => {
      const actor = userMap.get(row.actorId);
      if (!actor) throw new Error('Missing audit actor profile');
      const targetUser = row.targetUserId ? (userMap.get(row.targetUserId) ?? null) : null;
      return { id: row.id, actor, targetUser, action: row.action, detail: row.detail, createdAt: row.createdAt };
    });

    return { rows, hasMore };
  }

  private async loadUserSummaries(
    userIds: readonly string[],
  ): Promise<Map<string, AuditUserSummaryRecord>> {
    const map = new Map<string, AuditUserSummaryRecord>();
    if (userIds.length === 0) return map;

    const [profileRows, deptRows] = await Promise.all([
      this.db
        .select({
          id: profiles.id,
          fullName: profiles.fullName,
          isActive: profiles.isActive,
          leftAt: profiles.leftAt,
        })
        .from(profiles)
        .where(inArray(profiles.id, [...userIds])),
      this.db
        .select({ userId: memberDepartments.userId, id: departments.id, name: departments.name })
        .from(memberDepartments)
        .innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
        .where(inArray(memberDepartments.userId, [...userIds]))
        .orderBy(asc(departments.name), asc(departments.id)),
    ]);

    const deptMap = new Map<string, AuditDepartmentSummaryRecord[]>();
    for (const row of deptRows) {
      const list = deptMap.get(row.userId);
      const dept = { id: row.id, name: row.name };
      if (list) list.push(dept);
      else deptMap.set(row.userId, [dept]);
    }
    for (const row of profileRows) {
      map.set(row.id, { ...row, departments: deptMap.get(row.id) ?? [] });
    }
    return map;
  }
}
