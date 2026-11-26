import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { appSettings, auditLogs, boards, clubAssets, columns, comments, departments, memberDepartments, notifications, profiles, reminders, sessions, taskAssignees, taskDeliverables, taskDepartments, taskEvents, tasks, userPermissions } from '@db/schema';
import type { ArchiveRetentionDays } from '@/lib/archive';
import { conflict } from '@/lib/errors';
import type { BoardSummaryRecord } from '@/server/modules/boards';
import type { MemberProfileRecord } from '@/server/modules/members';
import { assembleTaskRecords, type RawTaskRow, taskAccessSqlCondition, type TaskRecord } from '@/server/modules/tasks';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import { type ArchiveBoardsCursor, type ArchiveMembersCursor, type ArchiveTasksCursor, escapeLikePattern, parseStoredRetentionDays } from './policy';
import * as Purge from './repository-purge';
import type * as Types from './types';

const ARCHIVE_RETENTION_KEY = 'archive_retention';

const MEMBER_COLS = {
  id: profiles.id, studentId: profiles.studentId, email: profiles.email, fullName: profiles.fullName,
  avatarUpdatedAt: profiles.avatarUpdatedAt, isAdmin: profiles.isAdmin, isActive: profiles.isActive,
  leftAt: profiles.leftAt, locale: profiles.locale, mustChangePassword: profiles.mustChangePassword,
};

function buildTaskArchiveWhere(db: DbExecutor, params: Types.ListArchivedTasksParams): SQL {
  const filters: SQL[] = [isNotNull(tasks.deletedAt), isNull(tasks.purgedAt), isNull(boards.purgedAt), taskAccessSqlCondition(db, params.actor)];
  if (params.q) {
    const pattern = `%${escapeLikePattern(params.q)}%`;
    filters.push(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))!);
  }
  if (params.cursor) {
    const { deletedAt, id } = params.cursor as ArchiveTasksCursor;
    filters.push(or(lt(tasks.deletedAt, deletedAt), and(eq(tasks.deletedAt, deletedAt), lt(tasks.id, id)))!);
  }
  return and(...filters)!;
}

function buildMemberArchiveWhere(params: Types.ListArchivedMembersParams): SQL {
  const filters: SQL[] = [eq(profiles.isActive, false), isNull(profiles.purgedAt)];
  if (params.q) {
    const pattern = `%${escapeLikePattern(params.q)}%`;
    filters.push(params.includeStudentIdSearch ? or(ilike(profiles.fullName, pattern), ilike(profiles.studentId, pattern))! : ilike(profiles.fullName, pattern));
  }
  if (params.cursor) {
    const { leftAt, id } = params.cursor as ArchiveMembersCursor;
    filters.push(leftAt === null
      ? and(isNull(profiles.leftAt), lt(profiles.id, id))!
      : or(lt(profiles.leftAt, leftAt), and(eq(profiles.leftAt, leftAt), lt(profiles.id, id)), isNull(profiles.leftAt))!);
  }
  return and(...filters)!;
}

function buildBoardArchiveWhere(params: Types.ListArchivedBoardsParams): SQL {
  const filters: SQL[] = [isNotNull(boards.archivedAt), isNull(boards.purgedAt)];
  if (params.q) filters.push(ilike(boards.name, `%${escapeLikePattern(params.q)}%`));
  if (params.cursor) {
    const { archivedAt, id } = params.cursor as ArchiveBoardsCursor;
    filters.push(or(lt(boards.archivedAt, archivedAt), and(eq(boards.archivedAt, archivedAt), lt(boards.id, id)))!);
  }
  return and(...filters)!;
}

const archivePurgeStore: Purge.ArchivePurgeStore = {
  lockTaskForPurge: async (taskId, tx) => (await tx.select({ id: tasks.id, boardId: tasks.boardId, deletedAt: tasks.deletedAt }).from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.purgedAt))).for('update').limit(1))[0] ?? null,
  async markTaskPurged(taskId, now, tx) {
    await tx.update(tasks).set({ purgedAt: now, updatedAt: now }).where(and(eq(tasks.id, taskId), isNull(tasks.purgedAt)));
    await tx.delete(taskDepartments).where(eq(taskDepartments.taskId, taskId));
    await tx.delete(taskDeliverables).where(eq(taskDeliverables.taskId, taskId));
    await tx.delete(notifications).where(eq(notifications.taskId, taskId));
  },
  lockBoardForPurge: async (boardId, tx) => (await tx.select({ id: boards.id, archivedAt: boards.archivedAt }).from(boards).where(and(eq(boards.id, boardId), isNull(boards.purgedAt))).for('update').limit(1))[0] ?? null,
  async markBoardAndCascadeTasksPurged(boardId, now, tx) {
    await tx.update(boards).set({ purgedAt: now, departmentId: null, updatedAt: now }).where(and(eq(boards.id, boardId), isNull(boards.purgedAt)));
    const rows = await tx.update(tasks).set({ deletedAt: sql`COALESCE(${tasks.deletedAt}, ${now.toISOString()}::timestamptz)`, purgedAt: now, updatedAt: now }).where(and(eq(tasks.boardId, boardId), isNull(tasks.purgedAt))).returning({ id: tasks.id });
    if (rows.length > 0) {
      const taskIds = rows.map((r) => r.id);
      await tx.delete(taskDepartments).where(inArray(taskDepartments.taskId, taskIds));
      await tx.delete(taskDeliverables).where(inArray(taskDeliverables.taskId, taskIds));
    }
    await tx.delete(notifications).where(eq(notifications.boardId, boardId));
    return rows.length;
  },
  lockMemberForPurge: async (memberId, tx) => (await tx.select({ id: profiles.id, isActive: profiles.isActive }).from(profiles).where(and(eq(profiles.id, memberId), isNull(profiles.purgedAt))).for('update').limit(1))[0] ?? null,
  async deleteDisposableMemberRows(memberId, tx) {
    await tx.delete(sessions).where(eq(sessions.userId, memberId));
    await tx.delete(memberDepartments).where(eq(memberDepartments.userId, memberId));
    await tx.delete(userPermissions).where(eq(userPermissions.userId, memberId));
    await tx.delete(notifications).where(eq(notifications.userId, memberId));
    await tx.update(departments).set({ leadUserId: null }).where(eq(departments.leadUserId, memberId));
  },
  async hasProfileHistoryReferences(memberId, tx) {
    const [row] = await tx.select({
      hasRef: sql<boolean>`(EXISTS (SELECT 1 FROM ${auditLogs} WHERE ${auditLogs.actorId} = ${memberId} OR ${auditLogs.targetUserId} = ${memberId}) OR EXISTS (SELECT 1 FROM ${taskEvents} WHERE ${taskEvents.actorId} = ${memberId}) OR EXISTS (SELECT 1 FROM ${tasks} WHERE ${tasks.createdBy} = ${memberId}) OR EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.userId} = ${memberId}) OR EXISTS (SELECT 1 FROM ${taskDeliverables} WHERE ${taskDeliverables.submittedBy} = ${memberId}) OR EXISTS (SELECT 1 FROM ${comments} WHERE ${comments.userId} = ${memberId}) OR EXISTS (SELECT 1 FROM ${boards} WHERE ${boards.createdBy} = ${memberId}) OR EXISTS (SELECT 1 FROM ${reminders} WHERE ${reminders.userId} = ${memberId}) OR EXISTS (SELECT 1 FROM ${notifications} WHERE ${notifications.actorId} = ${memberId}) OR EXISTS (SELECT 1 FROM ${appSettings} WHERE ${appSettings.updatedBy} = ${memberId}) OR EXISTS (SELECT 1 FROM ${clubAssets} WHERE ${clubAssets.updatedBy} = ${memberId}) OR EXISTS (SELECT 1 FROM ${userPermissions} WHERE ${userPermissions.grantedBy} = ${memberId}))`,
    }).from(sql`(SELECT 1) AS _probe`);
    return Boolean(row?.hasRef);
  },
  deleteProfilePhysically: async (memberId, tx) => { await tx.delete(profiles).where(eq(profiles.id, memberId)); },
  anonymizeProfile: async (memberId, patch, tx) => { await tx.update(profiles).set(patch).where(and(eq(profiles.id, memberId), isNull(profiles.purgedAt))); },
  async purgeExpiredTasks(cutoff, now, tx) {
    const rows = await tx.update(tasks).set({ purgedAt: now, updatedAt: now }).where(and(isNotNull(tasks.deletedAt), lte(tasks.deletedAt, cutoff), isNull(tasks.purgedAt))).returning({ id: tasks.id });
    if (rows.length > 0) {
      const taskIds = rows.map((r) => r.id);
      await tx.delete(taskDepartments).where(inArray(taskDepartments.taskId, taskIds));
      await tx.delete(taskDeliverables).where(inArray(taskDeliverables.taskId, taskIds));
      await tx.delete(notifications).where(inArray(notifications.taskId, taskIds));
    }
    return rows.length;
  },
  async purgeExpiredBoardsAndCascade(cutoff, now, tx) {
    const purgedBoards = await tx.update(boards).set({ purgedAt: now, departmentId: null, updatedAt: now }).where(and(isNotNull(boards.archivedAt), lte(boards.archivedAt, cutoff), isNull(boards.purgedAt))).returning({ id: boards.id });
    if (purgedBoards.length > 0) {
      const boardIds = purgedBoards.map((b) => b.id);
      const cascaded = await tx.update(tasks).set({ deletedAt: sql`COALESCE(${tasks.deletedAt}, ${now.toISOString()}::timestamptz)`, purgedAt: now, updatedAt: now }).where(and(inArray(tasks.boardId, boardIds), isNull(tasks.purgedAt))).returning({ id: tasks.id });
      if (cascaded.length > 0) {
        const taskIds = cascaded.map((t) => t.id);
        await tx.delete(taskDepartments).where(inArray(taskDepartments.taskId, taskIds));
        await tx.delete(taskDeliverables).where(inArray(taskDeliverables.taskId, taskIds));
      }
      await tx.delete(notifications).where(inArray(notifications.boardId, boardIds));
    }
    return purgedBoards.length;
  },
  findExpiredInactiveMemberIds: async (cutoff, tx) => (await tx.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.isActive, false), isNull(profiles.purgedAt), sql`COALESCE(${profiles.leftAt}, ${profiles.updatedAt}) <= ${cutoff.toISOString()}::timestamptz`)).for('update')).map((r) => r.id),
};

export class DrizzleArchiveRepository implements Types.ArchiveRepository {
  constructor(private readonly db: DbExecutor) {}

  async listArchivedTasks(params: Types.ListArchivedTasksParams): Promise<{ readonly rows: Types.ArchivedTaskItemRecord[]; readonly hasMore: boolean }> {
    const fetched: Purge.RawArchiveTaskRow[] = await this.db
      .select({
        id: tasks.id, boardId: tasks.boardId, columnId: tasks.columnId, title: tasks.title, description: tasks.description,
        startAt: tasks.startAt, dueAt: tasks.dueAt, isCompleted: tasks.isCompleted, completedAt: tasks.completedAt,
        priority: tasks.priority, position: tasks.position, isHidden: tasks.isHidden, version: tasks.version,
        deletedAt: tasks.deletedAt, createdBy: tasks.createdBy, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt,
        boardName: boards.name, boardArchivedAt: boards.archivedAt, columnName: columns.name,
      })
      .from(tasks).innerJoin(boards, eq(tasks.boardId, boards.id)).leftJoin(columns, eq(tasks.columnId, columns.id))
      .where(buildTaskArchiveWhere(this.db, params)).orderBy(desc(tasks.deletedAt), desc(tasks.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    const hydratedTasks = await this.hydrateTasks(this.db, pageRows);
    return { rows: Purge.assembleArchiveTaskItems(pageRows, hydratedTasks), hasMore };
  }

  async listArchivedMembers(params: Types.ListArchivedMembersParams): Promise<{ readonly rows: MemberProfileRecord[]; readonly hasMore: boolean }> {
    const fetched: Purge.RawArchiveMemberRow[] = await this.db.select(MEMBER_COLS).from(profiles)
      .where(buildMemberArchiveWhere(params)).orderBy(sql`${profiles.leftAt} DESC NULLS LAST`, desc(profiles.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    const deptRows = pageRows.length > 0 ? await this.loadDeptRows(this.db, pageRows.map((r) => r.id)) : [];
    return { rows: Purge.assembleArchiveMembers(pageRows, deptRows), hasMore };
  }

  async listArchivedBoards(params: Types.ListArchivedBoardsParams): Promise<{ readonly rows: Types.ArchivedBoardItemRecord[]; readonly hasMore: boolean }> {
    const fetched: Purge.RawArchiveBoardRow[] = await this.db
      .select({
        id: boards.id, name: boards.name, departmentId: boards.departmentId, departmentName: departments.name,
        archivedAt: boards.archivedAt, createdBy: boards.createdBy, createdAt: boards.createdAt, updatedAt: boards.updatedAt,
      })
      .from(boards).leftJoin(departments, eq(boards.departmentId, departments.id))
      .where(buildBoardArchiveWhere(params)).orderBy(desc(boards.archivedAt), desc(boards.id)).limit(params.limit + 1);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    if (pageRows.length === 0) return { rows: [], hasMore };
    const [userMap, countRows] = await Promise.all([
      this.loadUserSummaries(this.db, Array.from(new Set(pageRows.map((r) => r.createdBy)))),
      this.db.select({ boardId: tasks.boardId, total: count() }).from(tasks)
        .where(and(inArray(tasks.boardId, pageRows.map((r) => r.id)), isNull(tasks.deletedAt), isNull(tasks.purgedAt), taskAccessSqlCondition(this.db, params.actor)))
        .groupBy(tasks.boardId),
    ]);
    return { rows: Purge.assembleArchiveBoardItems({ boardRows: pageRows, userMap, taskCountMap: new Map(countRows.map((r) => [r.boardId, Number(r.total)])) }), hasMore };
  }

  async findTaskForRestore(taskId: string, tx: TransactionContext): Promise<Types.RestoreTaskTargetRecord | null> {
    const rows = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.purgedAt))).for('update').limit(1);
    const row = rows[0];
    if (!row) return null;
    const [[boardRow], boardCols, hydrated] = await Promise.all([
      tx.select({ archivedAt: boards.archivedAt, purgedAt: boards.purgedAt }).from(boards).where(eq(boards.id, row.boardId)).limit(1),
      tx.select({ id: columns.id }).from(columns).where(eq(columns.boardId, row.boardId)).orderBy(asc(columns.orderIndex), asc(columns.id)),
      this.hydrateTasks(tx, [row]),
    ]);
    return {
      task: hydrated[0]!, boardArchivedAt: boardRow?.archivedAt ?? null, boardPurgedAt: boardRow?.purgedAt ?? null,
      hasOriginalColumn: row.columnId !== null && boardCols.some((c) => c.id === row.columnId), firstColumnId: boardCols[0]?.id ?? null,
    };
  }

  async restoreTaskWithEvent(input: Types.RestoreTaskRepoParams, tx: TransactionContext): Promise<Types.RestoreTaskRepoResult> {
    let nextPosition = input.currentPosition;
    if (input.useFallbackPosition) {
      const maxRows = await tx.select({ maxPos: sql<string | null>`max(${tasks.position})` }).from(tasks).where(and(eq(tasks.columnId, input.targetColumnId), isNull(tasks.deletedAt), isNull(tasks.purgedAt)));
      nextPosition = String(Number(maxRows[0]?.maxPos ?? 0) + 1000);
    }
    const [updated] = await tx.update(tasks)
      .set({ deletedAt: null, columnId: input.targetColumnId, position: nextPosition, updatedAt: input.now, version: sql`${tasks.version} + 1` })
      .where(and(eq(tasks.id, input.taskId), isNotNull(tasks.deletedAt), isNull(tasks.purgedAt))).returning();
    if (!updated) throw conflict('errors.taskNotDeleted', {}, 'TASK_NOT_DELETED');
    const [evt] = await tx.insert(taskEvents).values({
      taskId: input.taskId, boardId: input.boardId, actorId: input.actorId, type: 'task.restored',
      changes: { deleted_at: { from: input.prevDeletedAt.toISOString(), to: null }, column_id: { from: input.prevColumnId, to: input.targetColumnId } },
      createdAt: input.now,
    }).returning({ id: taskEvents.id });
    if (!evt) throw new Error('Failed to record task restore event');
    return { task: (await this.hydrateTasks(tx, [updated]))[0]!, eventId: evt.id };
  }

  async lockAndRestoreMember(memberId: string, now: Date, tx: TransactionContext): Promise<MemberProfileRecord | null> {
    const locked = await tx.select({ id: profiles.id, isActive: profiles.isActive }).from(profiles).where(and(eq(profiles.id, memberId), isNull(profiles.purgedAt))).for('update').limit(1);
    const existing = locked[0];
    if (!existing) return null;
    if (existing.isActive) throw conflict('errors.memberAlreadyActive', {}, 'MEMBER_ALREADY_ACTIVE');
    const [updated] = await tx.update(profiles).set({ isActive: true, leftAt: null, updatedAt: now }).where(and(eq(profiles.id, memberId), isNull(profiles.purgedAt))).returning(MEMBER_COLS);
    if (!updated) return null;
    return Purge.assembleArchiveMembers([updated], await this.loadDeptRows(tx, [updated.id]))[0] ?? null;
  }

  async lockAndRestoreBoard(boardId: string, now: Date, tx: TransactionContext): Promise<BoardSummaryRecord | null> {
    const locked = await tx.select({ id: boards.id, archivedAt: boards.archivedAt }).from(boards).where(and(eq(boards.id, boardId), isNull(boards.purgedAt))).for('update').limit(1);
    const existing = locked[0];
    if (!existing) return null;
    if (existing.archivedAt === null) throw conflict('errors.boardNotArchived', {}, 'BOARD_NOT_ARCHIVED');
    const [updated] = await tx.update(boards).set({ archivedAt: null, updatedAt: now }).where(and(eq(boards.id, boardId), isNull(boards.purgedAt))).returning();
    if (!updated) return null;
    const [userMap, deptRows] = await Promise.all([
      this.loadUserSummaries(tx, [updated.createdBy]),
      updated.departmentId ? tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.id, updated.departmentId)).limit(1) : Promise.resolve([]),
    ]);
    return { id: updated.id, name: updated.name, department: deptRows[0] ?? null, archivedAt: updated.archivedAt, createdBy: userMap.get(updated.createdBy)!, visibleTaskCount: 0, overdueTaskCount: 0, createdAt: updated.createdAt, updatedAt: updated.updatedAt };
  }

  purgeTask(taskId: string, now: Date, tx: TransactionContext) { return Purge.executePurgeTaskTx(taskId, now, tx, archivePurgeStore); }
  purgeBoard(boardId: string, now: Date, tx: TransactionContext) { return Purge.executePurgeBoardTx(boardId, now, tx, archivePurgeStore); }
  purgeMember(memberId: string, now: Date, tx: TransactionContext) { return Purge.executePurgeMemberTx(memberId, now, tx, archivePurgeStore); }
  runAutoPurge(cutoff: Date, now: Date, tx: TransactionContext) { return Purge.executeAutoPurgeTx(cutoff, now, tx, archivePurgeStore); }

  async getRetentionSetting(tx?: TransactionContext): Promise<Types.ArchiveRetentionRecord> {
    const executor = tx ?? this.db;
    const [row] = await executor.select({ value: appSettings.value, updatedAt: appSettings.updatedAt, updatedBy: appSettings.updatedBy }).from(appSettings).where(eq(appSettings.key, ARCHIVE_RETENTION_KEY)).limit(1);
    if (!row) return { retentionDays: null, updatedAt: null, updatedBy: null };
    const userMap = row.updatedBy ? await this.loadUserSummaries(executor, [row.updatedBy]) : new Map<string, Types.ArchiveUserSummaryRecord>();
    return { retentionDays: parseStoredRetentionDays(row.value), updatedAt: row.updatedAt, updatedBy: row.updatedBy ? (userMap.get(row.updatedBy) ?? null) : null };
  }

  async upsertRetentionSetting(input: { readonly retentionDays: ArchiveRetentionDays; readonly actorId: string; readonly now: Date }, tx: TransactionContext): Promise<{ readonly previousRetentionDays: ArchiveRetentionDays; readonly current: Types.ArchiveRetentionRecord }> {
    const previous = await this.getRetentionSetting(tx);
    await tx.insert(appSettings).values({ key: ARCHIVE_RETENTION_KEY, value: { retentionDays: input.retentionDays }, updatedBy: input.actorId, createdAt: input.now, updatedAt: input.now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { retentionDays: input.retentionDays }, updatedBy: input.actorId, updatedAt: input.now } });
    return { previousRetentionDays: previous.retentionDays, current: await this.getRetentionSetting(tx) };
  }

  private async hydrateTasks(executor: DbExecutor, taskRows: readonly RawTaskRow[]): Promise<TaskRecord[]> {
    if (taskRows.length === 0) return [];
    const taskIds = taskRows.map((r) => r.id);
    const [assigneeRows, departmentRows, deliverableRows, commentCountRows] = await Promise.all([
      executor.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, acceptedAt: taskAssignees.acceptedAt }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
      executor.select({ taskId: taskDepartments.taskId, id: departments.id, name: departments.name }).from(taskDepartments).innerJoin(departments, eq(taskDepartments.departmentId, departments.id)).where(inArray(taskDepartments.taskId, taskIds)).orderBy(asc(departments.name), asc(departments.id)),
      executor.select({ id: taskDeliverables.id, taskId: taskDeliverables.taskId, title: taskDeliverables.title, url: taskDeliverables.url, submittedBy: taskDeliverables.submittedBy, createdAt: taskDeliverables.createdAt })
        .from(taskDeliverables).where(inArray(taskDeliverables.taskId, taskIds)).orderBy(desc(taskDeliverables.createdAt), desc(taskDeliverables.id)),
      executor.select({ taskId: comments.taskId, total: count() }).from(comments).where(inArray(comments.taskId, taskIds)).groupBy(comments.taskId),
    ]);
    const userIds = Array.from(new Set([...taskRows.map((r) => r.createdBy), ...assigneeRows.map((a) => a.userId), ...deliverableRows.map((d) => d.submittedBy)]));
    const userMap = await this.loadUserSummaries(executor, userIds);
    return assembleTaskRecords({ taskRows, assigneeRows, departmentRows, deliverableRows, commentCountRows, userMap });
  }

  private async loadUserSummaries(executor: DbExecutor, userIds: readonly string[]): Promise<Map<string, Types.ArchiveUserSummaryRecord>> {
    if (userIds.length === 0) return new Map();
    const [profileRows, deptRows] = await Promise.all([
      executor.select({ id: profiles.id, fullName: profiles.fullName, avatarUpdatedAt: profiles.avatarUpdatedAt, isActive: profiles.isActive, leftAt: profiles.leftAt }).from(profiles).where(inArray(profiles.id, [...userIds])),
      this.loadDeptRows(executor, userIds),
    ]);
    return Purge.buildArchiveUserSummaryMap(profileRows, deptRows);
  }

  private loadDeptRows(executor: DbExecutor, userIds: readonly string[]) {
    return executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name })
      .from(memberDepartments).innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
      .where(inArray(memberDepartments.userId, [...userIds])).orderBy(asc(departments.name), asc(departments.id));
  }
}
