import { and, asc, count, desc, eq, exists, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { boards, departments, memberDepartments, notifications, profiles, tasks } from '@db/schema';
import { notificationTypeSchema } from '@/lib/notifications';
import { type TaskMemberSummaryRecord, visibleTaskSqlCondition } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import type {
  CreateNotificationRowInput,
  DepartmentAssignmentContextRecord,
  ListNotificationsRepoParams,
  NotificationDepartmentSummaryRecord,
  NotificationRecord,
  NotificationsRepository,
} from './types';

interface SelectedNotificationRow {
  readonly id: string;
  readonly type: string;
  readonly taskId: string;
  readonly boardId: string;
  readonly departmentId: string | null;
  readonly actorId: string;
  readonly isHiddenTask: boolean;
  readonly payload: Record<string, unknown>;
  readonly readAt: Date | null;
  readonly createdAt: Date;
  readonly liveTaskTitle: string;
  readonly liveTaskIsHidden: boolean;
  readonly liveBoardName: string;
  readonly liveDepartmentName: string | null;
}

function visibleNotificationWhere(db: DbExecutor, actor: AuthActor): SQL {
  return and(
    eq(notifications.userId, actor.id),
    isNull(boards.purgedAt),
    visibleTaskSqlCondition(db, actor),
  )!;
}

function buildListWhere(db: DbExecutor, actor: AuthActor, params: ListNotificationsRepoParams): SQL {
  const filters: SQL[] = [visibleNotificationWhere(db, actor)];
  if (params.unreadOnly) filters.push(isNull(notifications.readAt));
  if (params.cursor) {
    const { createdAt, id } = params.cursor;
    filters.push(
      or(
        lt(notifications.createdAt, createdAt),
        and(eq(notifications.createdAt, createdAt), lt(notifications.id, id)),
      )!,
    );
  }
  return and(...filters)!;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const val = payload[key];
  return typeof val === 'string' && val.length > 0 ? val : null;
}

export class DrizzleNotificationsRepository implements NotificationsRepository {
  constructor(private readonly db: DbExecutor) {}

  async loadDepartmentAssignmentContext(input: {
    readonly taskId: string;
    readonly boardId: string;
    readonly actorId: string;
    readonly departmentIds: readonly string[];
  }): Promise<DepartmentAssignmentContextRecord | null> {
    if (input.departmentIds.length === 0) return null;
    const [[taskRow], [boardRow], [actorRow], deptRows, memberRows] = await Promise.all([
      this.db.select({ id: tasks.id, title: tasks.title, isHidden: tasks.isHidden }).from(tasks).where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt), isNull(tasks.purgedAt))).limit(1),
      this.db.select({ id: boards.id, name: boards.name }).from(boards).where(and(eq(boards.id, input.boardId), isNull(boards.purgedAt))).limit(1),
      this.db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, input.actorId)).limit(1),
      this.db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...input.departmentIds])).orderBy(asc(departments.name), asc(departments.id)),
      this.db.select({ userId: profiles.id, email: profiles.email, fullName: profiles.fullName, locale: profiles.locale, departmentId: memberDepartments.departmentId })
        .from(memberDepartments)
        .innerJoin(profiles, eq(memberDepartments.userId, profiles.id))
        .where(and(inArray(memberDepartments.departmentId, [...input.departmentIds]), eq(profiles.isActive, true), isNull(profiles.purgedAt), ne(profiles.id, input.actorId))),
    ]);
    if (!taskRow || !boardRow || !actorRow) return null;
    return {
      task: taskRow,
      board: boardRow,
      actor: actorRow,
      departments: deptRows,
      members: memberRows.map((m) => ({ ...m, locale: m.locale === 'en' ? 'en' : 'vi' })),
    };
  }

  async insertNotifications(
    rows: readonly CreateNotificationRowInput[],
    tx?: TransactionContext,
  ): Promise<ReadonlyArray<{ readonly id: string; readonly userId: string }>> {
    if (rows.length === 0) return [];
    const executor = tx ?? this.db;
    return executor
      .insert(notifications)
      .values(
        rows.map((row) => ({
          userId: row.userId,
          type: row.type,
          taskId: row.taskId,
          boardId: row.boardId,
          departmentId: row.departmentId,
          actorId: row.actorId,
          isHiddenTask: row.isHiddenTask,
          payload: { ...row.payload },
          createdAt: row.createdAt,
        })),
      )
      .returning({ id: notifications.id, userId: notifications.userId });
  }

  async listVisibleForUser(
    actor: AuthActor,
    params: ListNotificationsRepoParams,
  ): Promise<{ readonly rows: NotificationRecord[]; readonly unreadCount: number; readonly hasMore: boolean }> {
    const [fetched, unreadCount] = await Promise.all([
      this.selectNotificationRows(this.db)
        .where(buildListWhere(this.db, actor, params))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(params.limit + 1),
      this.countUnread(actor, this.db),
    ]);
    const hasMore = fetched.length > params.limit;
    const pageRows = hasMore ? fetched.slice(0, params.limit) : fetched;
    return { rows: await this.hydrateRows(this.db, pageRows), unreadCount, hasMore };
  }

  async markReadForUser(
    actor: AuthActor,
    notificationId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<{ readonly notification: NotificationRecord; readonly unreadCount: number } | null> {
    const [locked] = await tx
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, actor.id)))
      .for('update')
      .limit(1);
    if (!locked) return null;
    const [visibleCheck] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .innerJoin(tasks, eq(notifications.taskId, tasks.id))
      .innerJoin(boards, eq(notifications.boardId, boards.id))
      .where(and(eq(notifications.id, notificationId), visibleNotificationWhere(tx, actor)))
      .limit(1);
    if (!visibleCheck) return null;
    if (locked.readAt === null) {
      await tx.update(notifications).set({ readAt: now }).where(eq(notifications.id, notificationId));
    }
    const [rows, unreadCount] = await Promise.all([
      this.selectNotificationRows(tx).where(eq(notifications.id, notificationId)).limit(1),
      this.countUnread(actor, tx),
    ]);
    const hydrated = await this.hydrateRows(tx, rows);
    if (!hydrated[0]) return null;
    return { notification: hydrated[0], unreadCount };
  }

  async markAllReadForUser(
    actor: AuthActor,
    now: Date,
    tx: TransactionContext,
  ): Promise<{ readonly updatedCount: number; readonly unreadCount: number }> {
    const updated = await tx
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.userId, actor.id),
          isNull(notifications.readAt),
          exists(
            tx
              .select({ one: sql`1` })
              .from(tasks)
              .innerJoin(boards, eq(tasks.boardId, boards.id))
              .where(
                and(
                  eq(tasks.id, notifications.taskId),
                  eq(boards.id, notifications.boardId),
                  isNull(boards.purgedAt),
                  visibleTaskSqlCondition(tx, actor),
                ),
              ),
          ),
        ),
      )
      .returning({ id: notifications.id });
    const unreadCount = await this.countUnread(actor, tx);
    return { updatedCount: updated.length, unreadCount };
  }

  private selectNotificationRows(executor: DbExecutor) {
    return executor
      .select({
        id: notifications.id,
        type: notifications.type,
        taskId: notifications.taskId,
        boardId: notifications.boardId,
        departmentId: notifications.departmentId,
        actorId: notifications.actorId,
        isHiddenTask: notifications.isHiddenTask,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        liveTaskTitle: tasks.title,
        liveTaskIsHidden: tasks.isHidden,
        liveBoardName: boards.name,
        liveDepartmentName: departments.name,
      })
      .from(notifications)
      .innerJoin(tasks, eq(notifications.taskId, tasks.id))
      .innerJoin(boards, eq(notifications.boardId, boards.id))
      .leftJoin(departments, eq(notifications.departmentId, departments.id));
  }

  private async countUnread(actor: AuthActor, executor: DbExecutor): Promise<number> {
    const [row] = await executor
      .select({ total: count() })
      .from(notifications)
      .innerJoin(tasks, eq(notifications.taskId, tasks.id))
      .innerJoin(boards, eq(notifications.boardId, boards.id))
      .where(and(visibleNotificationWhere(executor, actor), isNull(notifications.readAt)));
    return Number(row?.total ?? 0);
  }

  private async hydrateRows(
    executor: DbExecutor,
    rows: readonly SelectedNotificationRow[],
  ): Promise<NotificationRecord[]> {
    if (rows.length === 0) return [];
    const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
    const actorMap = await this.loadActors(executor, actorIds);
    return rows.map((row) => {
      const isHiddenTask = row.isHiddenTask || row.liveTaskIsHidden;
      const parsedType = notificationTypeSchema.safeParse(row.type);
      return {
        id: row.id,
        type: parsedType.success ? parsedType.data : 'task.department_assigned',
        taskId: row.taskId,
        boardId: row.boardId,
        departmentId: row.departmentId,
        departmentName: readPayloadString(row.payload, 'departmentName') ?? row.liveDepartmentName ?? null,
        boardName: row.liveBoardName || readPayloadString(row.payload, 'boardName') || '',
        taskTitle: isHiddenTask ? null : row.liveTaskTitle,
        isHiddenTask,
        actor: actorMap.get(row.actorId)!,
        readAt: row.readAt,
        createdAt: row.createdAt,
      };
    });
  }

  private async loadActors(
    executor: DbExecutor,
    userIds: readonly string[],
  ): Promise<Map<string, TaskMemberSummaryRecord>> {
    const [profileRows, deptRows] = await Promise.all([
      executor.select({ id: profiles.id, fullName: profiles.fullName, avatarUpdatedAt: profiles.avatarUpdatedAt, isActive: profiles.isActive, leftAt: profiles.leftAt }).from(profiles).where(inArray(profiles.id, [...userIds])),
      executor.select({ userId: memberDepartments.userId, id: departments.id, name: departments.name }).from(memberDepartments).innerJoin(departments, eq(memberDepartments.departmentId, departments.id)).where(inArray(memberDepartments.userId, [...userIds])).orderBy(asc(departments.name), asc(departments.id)),
    ]);
    const deptMap = new Map<string, NotificationDepartmentSummaryRecord[]>();
    for (const row of deptRows) {
      const list = deptMap.get(row.userId);
      const dept = { id: row.id, name: row.name };
      if (list) list.push(dept);
      else deptMap.set(row.userId, [dept]);
    }
    const map = new Map<string, TaskMemberSummaryRecord>();
    for (const row of profileRows) map.set(row.id, { ...row, departments: deptMap.get(row.id) ?? [] });
    return map;
  }
}
