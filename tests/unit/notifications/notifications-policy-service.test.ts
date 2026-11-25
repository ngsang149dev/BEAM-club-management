import { describe, expect, it } from 'vitest';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { Mailer, MailMessage } from '@/server/shared/mailer';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  buildDepartmentAssignedEmail,
  buildNotificationPayload,
  type CreateNotificationRowInput,
  decodeNotificationCursor,
  dedupeDepartmentRecipients,
  type DepartmentAssignmentContextRecord,
  encodeNotificationCursor,
  type ListNotificationsRepoParams,
  type NotificationRecord,
  NotificationsService,
  type NotificationsRepository,
  toNotificationDto,
} from '@/server/modules/notifications';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const USER_A = '10000000-0000-4000-8000-000000000002';
const USER_B = '10000000-0000-4000-8000-000000000003';
const DEPT_MEDIA = '20000000-0000-4000-8000-000000000001';
const DEPT_EVENT = '20000000-0000-4000-8000-000000000002';
const BOARD_ID = '30000000-0000-4000-8000-000000000001';
const TASK_ID = '40000000-0000-4000-8000-000000000001';
const NOTIF_1 = '50000000-0000-4000-8000-000000000001';
const NOTIF_2 = '50000000-0000-4000-8000-000000000002';

const MOCK_TX: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

class InMemoryNotificationsRepo implements NotificationsRepository {
  context: DepartmentAssignmentContextRecord | null = null;
  insertedRows: CreateNotificationRowInput[] = [];
  records: Array<NotificationRecord & { userId: string; canView?: boolean }> = [];

  async loadDepartmentAssignmentContext(): Promise<DepartmentAssignmentContextRecord | null> {
    return this.context;
  }

  async insertNotifications(rows: readonly CreateNotificationRowInput[]) {
    this.insertedRows.push(...rows);
    return rows.map((row, idx) => ({
      id: `50000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      userId: row.userId,
    }));
  }

  async listVisibleForUser(actor: AuthActor, params: ListNotificationsRepoParams) {
    const visible = this.records.filter(
      (r) => r.userId === actor.id && r.canView !== false,
    );
    const filtered = params.unreadOnly
      ? visible.filter((r) => r.readAt === null)
      : visible;
    const unreadCount = visible.filter((r) => r.readAt === null).length;
    return {
      rows: filtered.slice(0, params.limit),
      unreadCount,
      hasMore: filtered.length > params.limit,
    };
  }

  async markReadForUser(actor: AuthActor, notificationId: string, now: Date) {
    const item = this.records.find(
      (r) => r.id === notificationId && r.userId === actor.id && r.canView !== false,
    );
    if (!item) return null;
    if (item.readAt === null) {
      Object.assign(item, { readAt: now });
    }
    const unreadCount = this.records.filter(
      (r) => r.userId === actor.id && r.canView !== false && r.readAt === null,
    ).length;
    return { notification: item, unreadCount };
  }

  async markAllReadForUser(actor: AuthActor, now: Date) {
    let updatedCount = 0;
    for (const item of this.records) {
      if (item.userId === actor.id && item.canView !== false && item.readAt === null) {
        Object.assign(item, { readAt: now });
        updatedCount += 1;
      }
    }
    return { updatedCount, unreadCount: 0 };
  }
}

describe('notifications policy & NotificationsService', () => {
  it('encodes/decodes cursors, deduplicates multi-department recipients excluding actor, and enforces WQ-27 hidden task redaction', () => {
    const cursorDate = new Date('2026-11-24T08:00:00.000Z');
    const encoded = encodeNotificationCursor({ createdAt: cursorDate, id: NOTIF_1 });
    expect(decodeNotificationCursor(encoded)).toEqual({
      createdAt: cursorDate,
      id: NOTIF_1,
    });
    expect(() => decodeNotificationCursor('tampered')).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );

    const deduped = dedupeDepartmentRecipients({
      departments: [
        { id: DEPT_MEDIA, name: 'Truyền thông' },
        { id: DEPT_EVENT, name: 'Sự kiện' },
      ],
      members: [
        { userId: ACTOR_ID, email: 'actor@eiu.edu.vn', fullName: 'Actor', locale: 'vi', departmentId: DEPT_EVENT },
        { userId: USER_A, email: 'a@eiu.edu.vn', fullName: 'User A', locale: 'vi', departmentId: DEPT_MEDIA },
        { userId: USER_A, email: 'a@eiu.edu.vn', fullName: 'User A', locale: 'vi', departmentId: DEPT_EVENT },
        { userId: USER_B, email: 'b@eiu.edu.vn', fullName: 'User B', locale: 'en', departmentId: DEPT_MEDIA },
      ],
      actorId: ACTOR_ID,
    });
    expect(deduped).toHaveLength(2);
    const recA = deduped.find((r) => r.userId === USER_A)!;
    expect(recA.representativeDepartmentId).toBe(DEPT_EVENT);
    expect(recA.departmentNames).toEqual(['Sự kiện', 'Truyền thông']);
    expect(recA.departmentName).toBe('Sự kiện, Truyền thông');

    expect(
      buildNotificationPayload({
        isHiddenTask: true,
        taskTitle: 'Top Secret Budget',
        boardName: 'Board A',
        departmentName: 'Sự kiện',
      }),
    ).toEqual({
      taskTitle: null,
      boardName: 'Board A',
      departmentName: 'Sự kiện',
    });

    const hiddenVi = buildDepartmentAssignedEmail({
      locale: 'vi',
      recipientName: 'Nguyễn A',
      actorName: 'Leader',
      boardName: 'Board <1>',
      departmentNames: ['Sự kiện'],
      taskTitle: 'LEAK_TITLE',
      isHiddenTask: true,
      appUrl: 'https://beam.example.org/',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(hiddenVi.subject).not.toContain('LEAK_TITLE');
    expect(hiddenVi.text).not.toContain('LEAK_TITLE');
    expect(hiddenVi.html).not.toContain('LEAK_TITLE');
    expect(hiddenVi.html).toContain('Board &lt;1&gt;');

    const publicEn = buildDepartmentAssignedEmail({
      locale: 'en',
      recipientName: 'Member B',
      actorName: 'Leader',
      boardName: 'Open Day',
      departmentNames: ['Media'],
      taskTitle: 'Design Poster',
      isHiddenTask: false,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(publicEn.subject).toContain('Design Poster');
    expect(publicEn.text).toContain('Design Poster');
  });

  it('dispatches deduplicated bilingual emails, survives SMTP failure without throwing, and enforces markRead 404/unreadCount', async () => {
    const repo = new InMemoryNotificationsRepo();
    const clock = new FakeClock('2026-11-24T10:00:00.000Z');
    const logs: string[] = [];
    const logger = new StructuredLogger({
      writeOut: (line) => logs.push(line),
      writeErr: (line) => logs.push(line),
    });
    const sentMessages: MailMessage[] = [];
    const flakyMailer: Mailer = {
      send: async (msg) => {
        if (msg.to === 'fail-a@eiu.edu.vn') {
          throw new Error(`SMTP rejected ${msg.to}`);
        }
        sentMessages.push(msg);
      },
    };

    const service = new NotificationsService({
      notificationsRepo: repo,
      transactionRunner: MOCK_TX,
      mailer: flakyMailer,
      clock,
      config: { appUrl: 'http://localhost:3000' },
      logger,
    });

    repo.context = {
      task: { id: TASK_ID, title: 'Confidential Task Title', isHidden: true },
      board: { id: BOARD_ID, name: 'Board Ops' },
      actor: { id: ACTOR_ID, fullName: 'Coordinator' },
      departments: [
        { id: DEPT_EVENT, name: 'Sự kiện' },
        { id: DEPT_MEDIA, name: 'Truyền thông' },
      ],
      members: [
        { userId: ACTOR_ID, email: 'actor@eiu.edu.vn', fullName: 'Coordinator', locale: 'vi', departmentId: DEPT_EVENT },
        { userId: USER_A, email: 'fail-a@eiu.edu.vn', fullName: 'User A', locale: 'vi', departmentId: DEPT_EVENT },
        { userId: USER_A, email: 'fail-a@eiu.edu.vn', fullName: 'User A', locale: 'vi', departmentId: DEPT_MEDIA },
        { userId: USER_B, email: 'user-b@eiu.edu.vn', fullName: 'User B', locale: 'en', departmentId: DEPT_MEDIA },
      ],
    };

    await service.notifyDepartmentAssignment({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      departmentIds: [DEPT_EVENT, DEPT_MEDIA],
      isHiddenTask: true,
      now: clock.now(),
    });

    expect(repo.insertedRows).toHaveLength(2);
    expect(repo.insertedRows.every((r) => r.payload.taskTitle === null && r.isHiddenTask)).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.to).toBe('user-b@eiu.edu.vn');
    expect(sentMessages[0]!.subject).toContain('New hidden task assigned');
    expect(sentMessages[0]!.text).not.toContain('Confidential Task Title');
    expect(logs.join('\n')).not.toContain('fail-a@eiu.edu.vn');
    expect(logs.join('\n')).not.toContain('user-b@eiu.edu.vn');

    const actorSummary = {
      id: ACTOR_ID,
      fullName: 'Coordinator',
      avatarUpdatedAt: null,
      isActive: true,
      leftAt: null,
      departments: [],
    };
    repo.records.push(
      {
        id: NOTIF_1,
        userId: USER_B,
        type: 'task.department_assigned',
        taskId: TASK_ID,
        boardId: BOARD_ID,
        departmentId: DEPT_MEDIA,
        departmentName: 'Truyền thông',
        boardName: 'Board Ops',
        taskTitle: 'Should Be Masked',
        isHiddenTask: true,
        actor: actorSummary,
        readAt: null,
        createdAt: clock.now(),
      },
      {
        id: NOTIF_2,
        userId: USER_B,
        type: 'task.department_assigned',
        taskId: TASK_ID,
        boardId: BOARD_ID,
        departmentId: DEPT_EVENT,
        departmentName: 'Sự kiện',
        boardName: 'Board Ops',
        taskTitle: 'Hidden Gone',
        isHiddenTask: true,
        actor: actorSummary,
        readAt: null,
        createdAt: clock.now(),
        canView: false,
      },
    );

    const dto1 = toNotificationDto(repo.records[0]!);
    expect(dto1.taskTitle).toBeNull();

    const userBActor: AuthActor = { id: USER_B, isActive: true, isAdmin: false, permissions: [] };
    const userAActor: AuthActor = { id: USER_A, isActive: true, isAdmin: false, permissions: [] };
    const inactiveActor: AuthActor = { id: USER_B, isActive: false, isAdmin: false, permissions: [] };

    await expect(service.listForUser(inactiveActor, { limit: 20 })).rejects.toMatchObject({ httpStatus: 401 });
    const list = await service.listForUser(userBActor, { limit: 20 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.taskTitle).toBeNull();
    expect(list.unreadCount).toBe(1);

    await expect(service.markRead(userAActor, NOTIF_1)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.markRead(userBActor, NOTIF_2)).rejects.toMatchObject({ httpStatus: 404 });

    const readRes = await service.markRead(userBActor, NOTIF_1);
    expect(readRes.unreadCount).toBe(0);
    expect(readRes.notification.readAt).toBe(clock.now().toISOString());

    const readAllRes = await service.markAllRead(userBActor);
    expect(readAllRes).toEqual({ updatedCount: 0, unreadCount: 0 });
  });
});
