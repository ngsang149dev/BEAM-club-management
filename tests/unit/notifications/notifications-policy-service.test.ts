import { describe, expect, it } from 'vitest';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { Mailer, MailMessage } from '@/server/shared/mailer';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  buildDepartmentAssignedEmail,
  buildLeadActivityEmail,
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
  selectLeadAndCreatorRecipients,
  type TaskActivityNotificationContextRecord,
  toNotificationDto,
} from '@/server/modules/notifications';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const USER_A = '10000000-0000-4000-8000-000000000002';
const USER_B = '10000000-0000-4000-8000-000000000003';
const USER_DIRECT = '10000000-0000-4000-8000-000000000004';
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
  activityContext: TaskActivityNotificationContextRecord | null = null;
  loadCalls = 0;
  insertedRows: CreateNotificationRowInput[] = [];
  records: Array<NotificationRecord & { userId: string; canView?: boolean }> = [];

  async loadDepartmentAssignmentContext(): Promise<DepartmentAssignmentContextRecord | null> {
    this.loadCalls += 1;
    return this.context;
  }

  async loadTaskActivityContext(): Promise<TaskActivityNotificationContextRecord | null> {
    this.loadCalls += 1;
    return this.activityContext;
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
      directAssignees: [
        { userId: ACTOR_ID, email: 'actor@eiu.edu.vn', fullName: 'Actor', locale: 'vi' },
        { userId: USER_B, email: 'b@eiu.edu.vn', fullName: 'User B', locale: 'en' },
        { userId: USER_DIRECT, email: 'direct@eiu.edu.vn', fullName: 'Direct User', locale: 'vi' },
      ],
      actorId: ACTOR_ID,
    });
    expect(deduped).toHaveLength(3);
    const recA = deduped.find((r) => r.userId === USER_A)!;
    expect(recA.type).toBe('task.department_assigned');
    expect(recA.representativeDepartmentId).toBe(DEPT_EVENT);
    expect(recA.departmentNames).toEqual(['Sự kiện', 'Truyền thông']);
    expect(recA.departmentName).toBe('Sự kiện, Truyền thông');

    // USER_B is in BOTH DEPT_MEDIA and directAssignees -> 1 entry of task.department_assigned
    const recB = deduped.find((r) => r.userId === USER_B)!;
    expect(recB).toEqual({
      userId: USER_B,
      email: 'b@eiu.edu.vn',
      fullName: 'User B',
      locale: 'en',
      type: 'task.department_assigned',
      representativeDepartmentId: DEPT_MEDIA,
      departmentNames: ['Truyền thông'],
      departmentName: 'Truyền thông',
    });

    // USER_DIRECT is ONLY in directAssignees -> 1 entry of task.assigned
    const recDirect = deduped.find((r) => r.userId === USER_DIRECT)!;
    expect(recDirect).toEqual({
      userId: USER_DIRECT,
      email: 'direct@eiu.edu.vn',
      fullName: 'Direct User',
      locale: 'vi',
      type: 'task.assigned',
      representativeDepartmentId: null,
      departmentNames: [],
      departmentName: null,
    });

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
    expect(publicEn.text).toContain('Leader assigned a task to department Media.');

    // Direct assignment copy (departmentNames: []) in vi & en (public + WQ-27 hidden)
    const directHiddenVi = buildDepartmentAssignedEmail({
      locale: 'vi',
      recipientName: 'Trần C',
      actorName: 'Leader',
      boardName: 'Board Ops',
      departmentNames: [],
      taskTitle: 'SECRET_DIRECT_VI',
      isHiddenTask: true,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(directHiddenVi.subject).toBe('[BEAM] Công việc ẩn mới được giao cho bạn');
    expect(directHiddenVi.text).toContain('Leader đã giao một công việc cho bạn.');
    expect(directHiddenVi.text).not.toContain('ban BEAM');
    expect(directHiddenVi.subject).not.toContain('SECRET_DIRECT_VI');
    expect(directHiddenVi.text).not.toContain('SECRET_DIRECT_VI');
    expect(directHiddenVi.html).not.toContain('SECRET_DIRECT_VI');

    const directPublicVi = buildDepartmentAssignedEmail({
      locale: 'vi',
      recipientName: 'Trần C',
      actorName: 'Leader',
      boardName: 'Board Ops',
      departmentNames: [],
      taskTitle: 'Chuẩn bị slide',
      isHiddenTask: false,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(directPublicVi.subject).toBe('[BEAM] Công việc mới được giao cho bạn: Chuẩn bị slide');
    expect(directPublicVi.text).toContain('Leader đã giao một công việc cho bạn.');
    expect(directPublicVi.text).not.toContain('ban BEAM');

    const directHiddenEn = buildDepartmentAssignedEmail({
      locale: 'en',
      recipientName: 'Alex',
      actorName: 'Leader',
      boardName: 'Board Ops',
      departmentNames: [],
      taskTitle: 'SECRET_DIRECT_EN',
      isHiddenTask: true,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(directHiddenEn.subject).toBe('[BEAM] New hidden task assigned to you');
    expect(directHiddenEn.text).toContain('Leader assigned a task to you.');
    expect(directHiddenEn.text).not.toContain('department BEAM');
    expect(directHiddenEn.subject).not.toContain('SECRET_DIRECT_EN');
    expect(directHiddenEn.text).not.toContain('SECRET_DIRECT_EN');
    expect(directHiddenEn.html).not.toContain('SECRET_DIRECT_EN');

    const directPublicEn = buildDepartmentAssignedEmail({
      locale: 'en',
      recipientName: 'Alex',
      actorName: 'Leader',
      boardName: 'Board Ops',
      departmentNames: [],
      taskTitle: 'Prepare slides',
      isHiddenTask: false,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(directPublicEn.subject).toBe('[BEAM] New task assigned to you: Prepare slides');
    expect(directPublicEn.text).toContain('Leader assigned a task to you.');
    expect(directPublicEn.text).not.toContain('department BEAM');
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

  it('respects independent notifyInApp / notifyEmail toggles, direct task.assigned rows, and AggregateError PII scrubbing', async () => {
    const repo = new InMemoryNotificationsRepo();
    const clock = new FakeClock('2026-11-24T12:00:00.000Z');
    const logs: string[] = [];
    const logger = new StructuredLogger({
      writeOut: (line) => logs.push(line),
      writeErr: (line) => logs.push(line),
    });
    const sentMessages: MailMessage[] = [];
    const mailer: Mailer = {
      send: async (msg) => {
        if (msg.to === 'agg-fail@eiu.edu.vn') {
          throw new AggregateError(
            [new Error('connect ECONNREFUSED 127.0.0.1:25 for agg-fail@eiu.edu.vn')],
            '',
          );
        }
        sentMessages.push(msg);
      },
    };

    const service = new NotificationsService({
      notificationsRepo: repo,
      transactionRunner: MOCK_TX,
      mailer,
      clock,
      config: { appUrl: 'http://localhost:3000' },
      logger,
    });

    repo.context = {
      task: { id: TASK_ID, title: 'Direct + Dept Task', isHidden: false },
      board: { id: BOARD_ID, name: 'Board Ops' },
      actor: { id: ACTOR_ID, fullName: 'Coordinator' },
      departments: [{ id: DEPT_MEDIA, name: 'Truyền thông' }],
      members: [
        { userId: USER_A, email: 'a@eiu.edu.vn', fullName: 'User A', locale: 'vi', departmentId: DEPT_MEDIA },
      ],
      directAssignees: [
        { userId: USER_A, email: 'a@eiu.edu.vn', fullName: 'User A', locale: 'vi' },
        { userId: USER_DIRECT, email: 'agg-fail@eiu.edu.vn', fullName: 'Direct User', locale: 'en' },
      ],
    };

    // 1. Both false -> returns early without loading context, inserting, or sending email
    await service.notifyDepartmentAssignment({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      departmentIds: [DEPT_MEDIA],
      assigneeIds: [USER_DIRECT],
      notifyInApp: false,
      notifyEmail: false,
      isHiddenTask: false,
      now: clock.now(),
    });
    expect(repo.loadCalls).toBe(0);
    expect(repo.insertedRows).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);

    // 2. notifyInApp=true, notifyEmail=false -> inserts deduplicated rows (task.department_assigned + task.assigned), sends 0 emails
    await service.notifyDepartmentAssignment({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      departmentIds: [DEPT_MEDIA],
      assigneeIds: [USER_DIRECT],
      notifyInApp: true,
      notifyEmail: false,
      isHiddenTask: false,
      now: clock.now(),
    });
    expect(repo.insertedRows).toHaveLength(2);
    expect(repo.insertedRows.find((r) => r.userId === USER_A)?.type).toBe('task.department_assigned');
    expect(repo.insertedRows.find((r) => r.userId === USER_DIRECT)).toMatchObject({
      userId: USER_DIRECT,
      type: 'task.assigned',
      departmentId: null,
      payload: {
        taskTitle: 'Direct + Dept Task',
        boardName: 'Board Ops',
        departmentName: null,
      },
    });
    expect(sentMessages).toHaveLength(0);

    // 3. notifyInApp=false, notifyEmail=true -> inserts 0 new rows, sends email, logs notificationId=null + scrubbed AggregateError
    repo.insertedRows = [];
    await service.notifyDepartmentAssignment({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      departmentIds: [DEPT_MEDIA],
      assigneeIds: [USER_DIRECT],
      notifyInApp: false,
      notifyEmail: true,
      isHiddenTask: false,
      now: clock.now(),
    });
    expect(repo.insertedRows).toHaveLength(0);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.to).toBe('a@eiu.edu.vn');
    const joinedLogs = logs.join('\n');
    expect(joinedLogs).toContain('"notificationId":null');
    expect(joinedLogs).toContain('ECONNREFUSED');
    expect(joinedLogs).not.toContain('agg-fail@eiu.edu.vn');
    expect(joinedLogs).not.toContain('a@eiu.edu.vn');
  });

  it('selects Lead + Creator recipients enforcing canViewTask and WQ-27 redaction on task.accepted and task.deliverable_submitted', async () => {
    const CREATOR_ONLY = '10000000-0000-4000-8000-000000000010';
    const LEAD_VISIBLE = '10000000-0000-4000-8000-000000000011';
    const LEAD_ADMIN = '10000000-0000-4000-8000-000000000012';
    const LEAD_OUTSIDER = '10000000-0000-4000-8000-000000000013';

    const hiddenContext: TaskActivityNotificationContextRecord = {
      task: {
        id: TASK_ID,
        title: 'SECRET_HIDDEN_TASK_TITLE',
        isHidden: true,
        createdBy: CREATOR_ONLY,
        assigneeIds: [ACTOR_ID],
        assignedDepartmentIds: [DEPT_MEDIA],
      },
      board: { id: BOARD_ID, name: 'Board Ops' },
      actor: { id: ACTOR_ID, fullName: 'Assignee Actor' },
      assignedDepartments: [{ id: DEPT_MEDIA, name: 'Media' }],
      deliverable: {
        id: '60000000-0000-4000-8000-000000000001',
        title: 'SECRET_DELIVERABLE_TITLE',
        url: 'https://secret.example.com/private-file',
      },
      candidates: [
        // Actor is creator + lead too -> must be excluded (actor never notifies self)
        {
          userId: ACTOR_ID, email: 'actor@eiu.edu.vn', fullName: 'Assignee Actor', locale: 'vi',
          isAdmin: true, memberDepartmentIds: [DEPT_MEDIA], leadDepartmentIds: [DEPT_MEDIA], isCreator: false,
        },
        // Creator is non-admin, not in dept -> sees hidden task as creator
        {
          userId: CREATOR_ONLY, email: 'creator@eiu.edu.vn', fullName: 'Creator One', locale: 'en',
          isAdmin: false, memberDepartmentIds: [], leadDepartmentIds: [], isCreator: true,
        },
        // Lead who is a member of DEPT_MEDIA -> sees hidden task via department membership
        {
          userId: LEAD_VISIBLE, email: 'lead-ok@eiu.edu.vn', fullName: 'Lead Member', locale: 'vi',
          isAdmin: false, memberDepartmentIds: [DEPT_MEDIA], leadDepartmentIds: [DEPT_MEDIA], isCreator: false,
        },
        // Admin lead -> sees hidden task as admin
        {
          userId: LEAD_ADMIN, email: 'lead-admin@eiu.edu.vn', fullName: 'Lead Admin', locale: 'en',
          isAdmin: true, memberDepartmentIds: [], leadDepartmentIds: [DEPT_MEDIA], isCreator: false,
        },
        // Lead of DEPT_MEDIA who is neither admin, creator, assignee, nor member of DEPT_MEDIA -> CANNOT view hidden task!
        {
          userId: LEAD_OUTSIDER, email: 'lead-blocked@eiu.edu.vn', fullName: 'Lead Outsider', locale: 'vi',
          isAdmin: false, memberDepartmentIds: [], leadDepartmentIds: [DEPT_MEDIA], isCreator: false,
        },
      ],
    };

    const recipients = selectLeadAndCreatorRecipients({ context: hiddenContext, actorId: ACTOR_ID });
    expect(recipients.map((r) => r.userId)).toEqual([CREATOR_ONLY, LEAD_VISIBLE, LEAD_ADMIN]);
    expect(recipients.find((r) => r.userId === LEAD_OUTSIDER)).toBeUndefined();

    // WQ-27 email redaction on hidden deliverable omits BOTH task title and deliverable title/URL
    const redactedEmail = buildLeadActivityEmail({
      kind: 'task.deliverable_submitted',
      locale: 'en',
      recipientName: 'Creator One',
      actorName: 'Assignee Actor',
      boardName: 'Board Ops',
      departmentNames: [],
      taskTitle: 'SECRET_HIDDEN_TASK_TITLE',
      deliverableTitle: 'SECRET_DELIVERABLE_TITLE',
      deliverableUrl: 'https://secret.example.com/private-file',
      isHiddenTask: true,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(redactedEmail.subject).not.toContain('SECRET_HIDDEN_TASK_TITLE');
    expect(redactedEmail.text).not.toContain('SECRET_DELIVERABLE_TITLE');
    expect(redactedEmail.text).not.toContain('secret.example.com');
    expect(redactedEmail.html).not.toContain('SECRET_DELIVERABLE_TITLE');
    expect(redactedEmail.html).not.toContain('secret.example.com');

    // Public deliverable email includes both task title and deliverable link
    const publicEmail = buildLeadActivityEmail({
      kind: 'task.deliverable_submitted',
      locale: 'vi',
      recipientName: 'Lead Member',
      actorName: 'Assignee Actor',
      boardName: 'Board Ops',
      departmentNames: ['Media'],
      taskTitle: 'Design Poster',
      deliverableTitle: 'Final PDF',
      deliverableUrl: 'https://drive.google.com/file/1',
      isHiddenTask: false,
      appUrl: 'https://beam.example.org',
      boardId: BOARD_ID,
      taskId: TASK_ID,
    });
    expect(publicEmail.subject).toContain('Design Poster');
    expect(publicEmail.text).toContain('Final PDF');
    expect(publicEmail.text).toContain('https://drive.google.com/file/1');

    // End-to-end service calls with in-memory repo & failing SMTP check
    const repo = new InMemoryNotificationsRepo();
    repo.activityContext = hiddenContext;
    const sentMessages: MailMessage[] = [];
    const logs: string[] = [];
    const clock = new FakeClock('2026-11-26T00:00:00.000Z');
    const logger = new StructuredLogger({ writeOut: (l) => logs.push(l), writeErr: (l) => logs.push(l) });
    const mailer: Mailer = {
      send: async (msg) => {
        if (msg.to === 'lead-admin@eiu.edu.vn') {
          throw Object.assign(new Error(''), { name: 'AggregateError', errors: [new Error('SMTP connect timeout')] });
        }
        sentMessages.push(msg);
      },
    };
    const service = new NotificationsService({
      notificationsRepo: repo, mailer, transactionRunner: MOCK_TX, config: { appUrl: 'https://beam.example.org' }, clock, logger,
    });

    await service.notifyTaskAccepted({
      taskId: TASK_ID, boardId: BOARD_ID, actorId: ACTOR_ID, isHiddenTask: true, now: clock.now(),
    });
    expect(repo.insertedRows).toHaveLength(3);
    expect(repo.insertedRows.every((r) => r.type === 'task.accepted' && r.isHiddenTask)).toBe(true);
    expect(repo.insertedRows.every((r) => !JSON.stringify(r.payload).includes('SECRET_HIDDEN_TASK_TITLE'))).toBe(true);
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages.every((m) => !m.text.includes('SECRET_HIDDEN_TASK_TITLE'))).toBe(true);

    repo.insertedRows = [];
    sentMessages.length = 0;
    await service.notifyDeliverableSubmitted({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      deliverableId: '60000000-0000-4000-8000-000000000001',
      isHiddenTask: true,
      now: clock.now(),
    });
    expect(repo.insertedRows).toHaveLength(3);
    expect(repo.insertedRows.every((r) => r.type === 'task.deliverable_submitted')).toBe(true);
    expect(sentMessages.every((m) => !m.text.includes('secret.example.com'))).toBe(true);
    expect(logs.join('\n')).toContain('SMTP connect timeout');
    expect(logs.join('\n')).not.toContain('lead-admin@eiu.edu.vn');
  });
});
