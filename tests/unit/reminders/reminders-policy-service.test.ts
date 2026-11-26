import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMIND_OVERDUE,
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_SEND_HOUR_VN,
  normalizeDaysBefore,
  REMINDERS_APP_SETTING_KEY,
  updateReminderSettingsSchema,
} from '@/lib/reminders';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  buildReminderDigestEmail,
  buildReminderDispatchPlan,
  computeVnDiffDays,
  matchTaskReminderMilestone,
  parseStoredReminderSettings,
  type RecordReminderSentInput,
  REMINDER_EMAIL_STRATEGIES,
  type ReminderCandidateTaskRecord,
  type ReminderSentKeyRecord,
  type ReminderSettingsRecord,
  type RemindersRepository,
  RemindersService,
  toVnDateParts,
  type UpsertReminderSettingsParams,
  type UpsertReminderSettingsResult,
} from '@/server/modules/reminders';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { Mailer, MailMessage } from '@/server/shared/mailer';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const CONFIG_USER_ID = '10000000-0000-4000-8000-000000000002';
const USER_VI_ID = '10000000-0000-4000-8000-000000000003';
const USER_EN_ID = '10000000-0000-4000-8000-000000000004';
const INACTIVE_USER_ID = '10000000-0000-4000-8000-000000000005';
const OUTSIDER_ID = '10000000-0000-4000-8000-000000000006';
const DEPT_A = '20000000-0000-4000-8000-000000000001';
const BOARD_ID = '30000000-0000-4000-8000-000000000001';
const TASK_OVERDUE = '40000000-0000-4000-8000-000000000001';
const TASK_TODAY = '40000000-0000-4000-8000-000000000002';
const TASK_HIDDEN = '40000000-0000-4000-8000-000000000003';
const TASK_UPCOMING = '40000000-0000-4000-8000-000000000004';

const NOW = new Date('2026-11-26T00:00:00.000Z'); // 2026-11-26 07:00 UTC+7

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

class InMemoryAuditWriter implements AuditLogWriter {
  entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class InMemoryRemindersRepo implements RemindersRepository {
  settings: ReminderSettingsRecord = {
    daysBefore: [...DEFAULT_REMINDER_DAYS_BEFORE],
    remindOverdue: DEFAULT_REMIND_OVERDUE,
    sendHourVn: DEFAULT_SEND_HOUR_VN,
    updatedAt: null,
    updatedBy: null,
  };
  candidates: ReminderCandidateTaskRecord[] = [];
  sentRows: RecordReminderSentInput[] = [];

  async getSettings(): Promise<ReminderSettingsRecord> {
    return this.settings;
  }

  async upsertSettings(input: UpsertReminderSettingsParams): Promise<UpsertReminderSettingsResult> {
    const previousDaysBefore = [...this.settings.daysBefore];
    const previousRemindOverdue = this.settings.remindOverdue;
    this.settings = {
      daysBefore: [...input.daysBefore],
      remindOverdue: input.remindOverdue,
      sendHourVn: input.sendHourVn,
      updatedAt: input.now,
      updatedBy: {
        id: input.actorId,
        fullName: 'Config Manager',
        avatarUpdatedAt: null,
        isActive: true,
        leftAt: null,
        departments: [],
      },
    };
    return {
      previousDaysBefore,
      previousRemindOverdue,
      current: this.settings,
    };
  }

  async findCandidateTasks(): Promise<ReminderCandidateTaskRecord[]> {
    return this.candidates;
  }

  async findSentReminderKeys(taskIds: readonly string[]): Promise<ReminderSentKeyRecord[]> {
    const set = new Set(taskIds);
    return this.sentRows
      .filter((row) => set.has(row.taskId))
      .map((row) => ({ taskId: row.taskId, userId: row.userId, kind: row.kind }));
  }

  async insertSentReminders(rows: readonly RecordReminderSentInput[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      const exists = this.sentRows.some(
        (existing) =>
          existing.taskId === row.taskId &&
          existing.userId === row.userId &&
          existing.kind === row.kind,
      );
      if (exists) continue;
      this.sentRows.push(row);
      inserted += 1;
    }
    return inserted;
  }
}

function makeActor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    id: CONFIG_USER_ID,
    isActive: true,
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

describe('reminders schema, policy, email template & RemindersService', () => {
  it('validates updateReminderSettingsSchema, normalizes daysBefore, and parses stored app_settings with fallbacks', () => {
    expect(REMINDERS_APP_SETTING_KEY).toBe('reminders');
    expect(normalizeDaysBefore([1, 2, 1, 7, 0, 7])).toEqual([7, 2, 1, 0]);
    expect(normalizeDaysBefore([])).toEqual([]);

    expect(
      updateReminderSettingsSchema.parse({ daysBefore: [1, 3], remindOverdue: false }),
    ).toEqual({ daysBefore: [1, 3], remindOverdue: false });
    expect(
      updateReminderSettingsSchema.parse({ daysBefore: [], remindOverdue: true }),
    ).toEqual({ daysBefore: [], remindOverdue: true });

    expect(() =>
      updateReminderSettingsSchema.parse({ daysBefore: [-1], remindOverdue: true }),
    ).toThrow();
    expect(() =>
      updateReminderSettingsSchema.parse({ daysBefore: [366], remindOverdue: true }),
    ).toThrow();
    expect(() =>
      updateReminderSettingsSchema.parse({
        daysBefore: Array.from({ length: 31 }, (_, i) => i),
        remindOverdue: true,
      }),
    ).toThrow();
    expect(() =>
      updateReminderSettingsSchema.parse({
        daysBefore: [1],
        remindOverdue: true,
        sendHourVn: 9,
      }),
    ).toThrow();

    expect(parseStoredReminderSettings(null)).toEqual({
      daysBefore: [2, 1],
      remindOverdue: true,
      sendHourVn: 7,
    });
    expect(parseStoredReminderSettings({ daysBefore: 'invalid' })).toEqual({
      daysBefore: [2, 1],
      remindOverdue: true,
      sendHourVn: 7,
    });
    expect(
      parseStoredReminderSettings({
        daysBefore: [1, 5, 1],
        remindOverdue: false,
        sendHourVn: 7,
      }),
    ).toEqual({
      daysBefore: [5, 1],
      remindOverdue: false,
      sendHourVn: 7,
    });
  });

  it('computes VN (Asia/Ho_Chi_Minh) calendar day boundaries and matches milestones accurately', () => {
    // 2026-11-25T17:00:00Z is 2026-11-26 00:00:00 VN
    const vnMidnight = new Date('2026-11-25T17:00:00.000Z');
    // 2026-11-25T16:59:59Z is 2026-11-25 23:59:59 VN
    const prevVnNight = new Date('2026-11-25T16:59:59.000Z');
    expect(toVnDateParts(vnMidnight)).toMatchObject({ year: 2026, month: 11, day: 26, hour: 0 });
    expect(toVnDateParts(prevVnNight)).toMatchObject({ year: 2026, month: 11, day: 25, hour: 23 });

    expect(computeVnDiffDays(NOW, prevVnNight)).toBe(-1);
    expect(computeVnDiffDays(NOW, vnMidnight)).toBe(0);
    expect(computeVnDiffDays(NOW, new Date('2026-11-26T17:00:00.000Z'))).toBe(1);
    expect(computeVnDiffDays(NOW, new Date('2026-11-27T17:00:00.000Z'))).toBe(2);

    const settings = { daysBefore: [2, 1, 0], remindOverdue: true };
    expect(
      matchTaskReminderMilestone(new Date('2026-11-27T17:00:00.000Z'), settings, NOW),
    ).toEqual({ kind: 'd2', diffDays: 2 });
    expect(
      matchTaskReminderMilestone(vnMidnight, settings, NOW),
    ).toEqual({ kind: 'd0', diffDays: 0 });
    expect(
      matchTaskReminderMilestone(prevVnNight, settings, NOW),
    ).toEqual({ kind: 'overdue', diffDays: -1 });
    expect(
      matchTaskReminderMilestone(prevVnNight, { daysBefore: [2, 1], remindOverdue: false }, NOW),
    ).toBeNull();
  });

  it('builds deduplicated digests, enforces canViewTask on hidden tasks, masks hidden titles, buckets & sorts by priority DESC, dueAt ASC, title ASC', () => {
    const viUser = {
      userId: USER_VI_ID,
      email: 'vi@eiu.edu.vn',
      fullName: 'Nguyen Van Vi',
      locale: 'vi' as const,
      isActive: true,
      isAdmin: false,
      departmentIds: [DEPT_A],
    };
    const enUser = {
      userId: USER_EN_ID,
      email: 'en@eiu.edu.vn',
      fullName: 'Tran Thi En',
      locale: 'en' as const,
      isActive: true,
      isAdmin: false,
      departmentIds: [DEPT_A],
    };
    const inactiveUser = {
      userId: INACTIVE_USER_ID,
      email: 'inactive@eiu.edu.vn',
      fullName: 'Former Member',
      locale: 'vi' as const,
      isActive: false,
      isAdmin: false,
      departmentIds: [DEPT_A],
    };
    const outsider = {
      userId: OUTSIDER_ID,
      email: 'outsider@eiu.edu.vn',
      fullName: 'Outsider',
      locale: 'vi' as const,
      isActive: true,
      isAdmin: false,
      departmentIds: [],
    };

    const plan = buildReminderDispatchPlan({
      settings: { daysBefore: [2, 1, 0], remindOverdue: true },
      existingSentKeys: [{ taskId: TASK_OVERDUE, userId: USER_EN_ID, kind: 'overdue' }],
      now: NOW,
      tasks: [
        {
          id: TASK_OVERDUE,
          boardId: BOARD_ID,
          boardName: 'Club Ops',
          columnId: 'col-1',
          columnName: 'Doing',
          title: 'Overdue poster',
          dueAt: new Date('2026-11-25T10:00:00.000Z'),
          priority: 4,
          isHidden: false,
          createdBy: ADMIN_ID,
          assigneeIds: [USER_VI_ID, INACTIVE_USER_ID],
          assignedDepartmentIds: [DEPT_A],
          recipients: [viUser, viUser, enUser, inactiveUser],
        },
        {
          id: TASK_TODAY,
          boardId: BOARD_ID,
          boardName: 'Club Ops',
          columnId: 'col-2',
          columnName: 'Todo',
          title: 'MC script',
          dueAt: new Date('2026-11-26T10:00:00.000Z'),
          priority: 3,
          isHidden: false,
          createdBy: ADMIN_ID,
          assigneeIds: [],
          assignedDepartmentIds: [DEPT_A],
          recipients: [viUser, enUser],
        },
        {
          id: TASK_HIDDEN,
          boardId: BOARD_ID,
          boardName: 'Club Ops',
          columnId: 'col-2',
          columnName: 'Review',
          title: 'CONFIDENTIAL_SALARY_PLAN',
          dueAt: new Date('2026-11-27T10:00:00.000Z'),
          priority: 2,
          isHidden: true,
          createdBy: ADMIN_ID,
          assigneeIds: [USER_VI_ID],
          assignedDepartmentIds: [],
          // outsider injected intentionally to verify policy-layer FR-26 guard
          recipients: [viUser, outsider],
        },
        {
          id: TASK_UPCOMING,
          boardId: BOARD_ID,
          boardName: 'Club Ops',
          columnId: 'col-2',
          columnName: 'Todo',
          title: 'Alpha task',
          dueAt: new Date('2026-11-27T10:00:00.000Z'),
          priority: 4,
          isHidden: false,
          createdBy: ADMIN_ID,
          assigneeIds: [USER_VI_ID],
          assignedDepartmentIds: [],
          recipients: [viUser],
        },
      ],
    });

    expect(plan.processedTasks).toBe(4);
    expect(plan.skippedAlreadySent).toBe(1);
    expect(plan.digests.map((d) => d.userId)).toEqual([USER_VI_ID, USER_EN_ID]);

    const viDigest = plan.digests[0]!;
    expect(viDigest.buckets.overdue.map((t) => t.taskId)).toEqual([TASK_OVERDUE]);
    expect(viDigest.buckets.dueToday.map((t) => t.taskId)).toEqual([TASK_TODAY]);
    expect(viDigest.buckets.comingUp.map((t) => t.taskId)).toEqual([
      TASK_UPCOMING, // priority 4 before priority 2
      TASK_HIDDEN,
    ]);
    expect(viDigest.buckets.comingUp[1]!.title).toBeNull();

    const enDigest = plan.digests[1]!;
    expect(enDigest.buckets.overdue).toHaveLength(0);
    expect(enDigest.buckets.dueToday.map((t) => t.taskId)).toEqual([TASK_TODAY]);
  });

  it('renders bilingual E01 emails via strategy map, omits empty buckets, masks hidden titles, escapes HTML, and omits PII', () => {
    expect(Object.keys(REMINDER_EMAIL_STRATEGIES).sort()).toEqual(['en', 'vi']);

    const viEmail = buildReminderDigestEmail({
      locale: 'vi',
      recipientName: 'Nguyen Van Vi',
      sentAt: NOW,
      appUrl: 'https://beam.example.org/',
      buckets: {
        overdue: [
          {
            taskId: TASK_OVERDUE,
            kind: 'overdue',
            boardName: 'Board <One>',
            columnName: 'Doing',
            title: 'Overdue Task <script>',
            dueAt: new Date('2026-11-25T10:00:00.000Z'),
            diffDays: -1,
            priority: 4,
            isHidden: false,
          },
        ],
        dueToday: [],
        comingUp: [
          {
            taskId: TASK_HIDDEN,
            kind: 'd1',
            boardName: 'Board <One>',
            columnName: 'Review',
            title: 'LEAKED_SECRET_TITLE',
            dueAt: new Date('2026-11-27T10:00:00.000Z'),
            diffDays: 1,
            priority: 2,
            isHidden: true,
          },
        ],
      },
    });

    expect(viEmail.subject).toContain('Nhắc deadline');
    expect(viEmail.text).toContain('Quá hạn');
    expect(viEmail.text).not.toContain('Đến hạn hôm nay');
    expect(viEmail.text).toContain('Sắp tới');
    expect(viEmail.text).toContain('(Công việc ẩn — đăng nhập để xem chi tiết)');
    expect(viEmail.text).not.toContain('LEAKED_SECRET_TITLE');
    expect(viEmail.html).not.toContain('LEAKED_SECRET_TITLE');
    expect(viEmail.html).not.toContain('<script>');
    expect(viEmail.html).toContain('&lt;script&gt;');
    expect(viEmail.text).toContain('https://beam.example.org/my-tasks');
    expect(viEmail.html).toContain('href="https://beam.example.org/my-tasks"');

    const enEmail = buildReminderDigestEmail({
      locale: 'en',
      recipientName: 'Tran Thi En',
      sentAt: NOW,
      appUrl: 'https://beam.example.org',
      buckets: {
        overdue: [],
        dueToday: [
          {
            taskId: TASK_TODAY,
            kind: 'd0',
            boardName: 'Board One',
            columnName: null,
            title: 'SECRET_HIDDEN_EN',
            dueAt: new Date('2026-11-26T10:00:00.000Z'),
            diffDays: 0,
            priority: 3,
            isHidden: true,
          },
        ],
        comingUp: [],
      },
    });

    expect(enEmail.subject).toContain('Deadline reminder');
    expect(enEmail.text).toContain('Due today');
    expect(enEmail.text).not.toContain('Overdue');
    expect(enEmail.text).not.toContain('Coming up');
    expect(enEmail.text).toContain('(Hidden task — sign in to view details)');
    expect(enEmail.text).not.toContain('SECRET_HIDDEN_EN');
    expect(enEmail.html).not.toContain('SECRET_HIDDEN_EN');
    expect(enEmail.text).toContain('https://beam.example.org/my-tasks');
  });

  it('enforces reminder.configure authorization, writes audit log on update, and only persists reminders after mailer.send succeeds', async () => {
    const repo = new InMemoryRemindersRepo();
    const auditWriter = new InMemoryAuditWriter();
    const clock = new FakeClock(NOW);
    const logs: string[] = [];
    const sentMessages: MailMessage[] = [];
    let failRecipientEmail: string | null = 'vi@eiu.edu.vn';

    const mailer: Mailer = {
      send: async (message) => {
        if (failRecipientEmail && message.to === failRecipientEmail) {
          throw new Error(`SMTP 550 bounce for ${message.to} MSSV-SECRET-99`);
        }
        sentMessages.push(message);
      },
    };

    const service = new RemindersService({
      remindersRepo: repo,
      auditWriter,
      transactionRunner: MOCK_TX_RUNNER,
      mailer,
      clock,
      config: { cronSecret: 'super-cron-secret', appUrl: 'http://localhost:3000' },
      logger: new StructuredLogger({
        writeOut: (l) => logs.push(l),
        writeErr: (l) => logs.push(l),
      }),
    });

    await expect(service.getSettings(makeActor({ isActive: false }))).rejects.toMatchObject({
      httpStatus: 401,
      code: 'ACCOUNT_INACTIVE',
    });
    await expect(service.getSettings(makeActor({ permissions: ['member.view'] }))).rejects.toMatchObject({
      httpStatus: 403,
    });
    await expect(
      service.updateSettings(makeActor({ permissions: ['member.view'] }), {
        daysBefore: [1],
        remindOverdue: true,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 });

    const defaultGet = await service.getSettings(makeActor({ permissions: ['reminder.configure'] }));
    expect(defaultGet.settings).toEqual({
      daysBefore: [2, 1],
      remindOverdue: true,
      sendHourVn: 7,
      updatedAt: null,
      updatedBy: null,
    });

    const updated = await service.updateSettings(makeActor({ isAdmin: true, id: ADMIN_ID }), {
      daysBefore: [1, 3, 1],
      remindOverdue: false,
    });
    expect(updated.settings.daysBefore).toEqual([3, 1]);
    expect(updated.settings.remindOverdue).toBe(false);
    expect(updated.settings.sendHourVn).toBe(7);
    expect(updated.settings.updatedBy).toMatchObject({ id: ADMIN_ID, fullName: 'Config Manager' });
    expect('studentId' in (updated.settings.updatedBy ?? {})).toBe(false);
    expect('email' in (updated.settings.updatedBy ?? {})).toBe(false);

    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]).toMatchObject({
      actorId: ADMIN_ID,
      action: 'settings.reminders_updated',
      detail: {
        previousDaysBefore: [2, 1],
        previousRemindOverdue: true,
        daysBefore: [3, 1],
        remindOverdue: false,
      },
    });

    await expect(service.runRemindersCron(null)).rejects.toMatchObject({
      httpStatus: 401,
      code: 'UNAUTHORIZED',
    });
    await expect(service.runRemindersCron('Bearer wrong')).rejects.toMatchObject({
      httpStatus: 401,
      code: 'UNAUTHORIZED',
    });

    // Disabled config returns zeros without querying/sending
    await service.updateSettings(makeActor({ isAdmin: true, id: ADMIN_ID }), {
      daysBefore: [],
      remindOverdue: false,
    });
    expect(await service.runRemindersCron('Bearer super-cron-secret')).toEqual({
      processedTasks: 0,
      emailsSent: 0,
      remindersRecorded: 0,
      skippedAlreadySent: 0,
    });

    // Enable milestones and test partial mailer failure -> no reminder row saved for failing recipient
    await service.updateSettings(makeActor({ isAdmin: true, id: ADMIN_ID }), {
      daysBefore: [1],
      remindOverdue: true,
    });
    repo.candidates = [
      {
        id: TASK_TODAY,
        boardId: BOARD_ID,
        boardName: 'Ops',
        columnId: 'c1',
        columnName: 'Doing',
        title: 'Task D1',
        dueAt: new Date('2026-11-26T17:00:00.000Z'), // diffDays = 1
        priority: 3,
        isHidden: false,
        createdBy: ADMIN_ID,
        assigneeIds: [USER_VI_ID, USER_EN_ID],
        assignedDepartmentIds: [],
        recipients: [
          {
            userId: USER_VI_ID,
            email: 'vi@eiu.edu.vn',
            fullName: 'Vi User',
            locale: 'vi',
            isActive: true,
            isAdmin: false,
            departmentIds: [],
          },
          {
            userId: USER_EN_ID,
            email: 'en@eiu.edu.vn',
            fullName: 'En User',
            locale: 'en',
            isActive: true,
            isAdmin: false,
            departmentIds: [],
          },
        ],
      },
    ];

    const firstRun = await service.runRemindersCron('Bearer super-cron-secret');
    expect(firstRun).toEqual({
      processedTasks: 1,
      emailsSent: 1,
      remindersRecorded: 1,
      skippedAlreadySent: 0,
    });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.to).toBe('en@eiu.edu.vn');
    expect(repo.sentRows).toHaveLength(1);
    expect(repo.sentRows[0]!.userId).toBe(USER_EN_ID);

    // Retry after mail recovers -> only VI user receives email; EN user skipped!
    failRecipientEmail = null;
    const secondRun = await service.runRemindersCron('Bearer super-cron-secret');
    expect(secondRun).toEqual({
      processedTasks: 1,
      emailsSent: 1,
      remindersRecorded: 1,
      skippedAlreadySent: 1,
    });
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1]!.to).toBe('vi@eiu.edu.vn');

    const joinedLogs = logs.join('\n');
    expect(joinedLogs).not.toContain('vi@eiu.edu.vn');
    expect(joinedLogs).not.toContain('en@eiu.edu.vn');
    expect(joinedLogs).toContain('[REDACTED_EMAIL]');
  });
});
