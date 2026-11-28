import { describe, expect, it } from 'vitest';
import {
  createBoardRequestSchema,
  createColumnRequestSchema,
  DEFAULT_BOARD_COLUMN_NAMES,
  listBoardsQuerySchema,
  reorderColumnsRequestSchema,
  updateBoardRequestSchema,
  updateColumnRequestSchema,
} from '@/lib/boards';
import {
  listNotificationsQuerySchema,
  NOTIFICATION_TYPES,
} from '@/lib/notifications';
import {
  createTaskDeliverableRequestSchema,
  createTaskRequestSchema,
  dedupeSortedUuids,
  deliverableUrlSchema,
  listMyTasksQuerySchema,
  listTasksQuerySchema,
  moveTaskRequestSchema,
  replaceTaskAssigneesRequestSchema,
  resolveTaskNotificationChannels,
  TASK_DEADLINE_STATUSES,
  TASK_PRIORITIES,
  updateTaskAcceptanceRequestSchema,
  updateTaskRequestSchema,
} from '@/lib/tasks';

const UUID_1 = '10000000-0000-4000-8000-000000000001';
const UUID_2 = '10000000-0000-4000-8000-000000000002';
const UUID_3 = '10000000-0000-4000-8000-000000000003';

describe('boards & tasks shared contracts', () => {
  it('enforces board & column schemas cleanly', () => {
    expect(DEFAULT_BOARD_COLUMN_NAMES).toEqual(['Todo', 'Doing', 'Review', 'Done']);
    expect(
      createBoardRequestSchema.parse({ name: '  Board Ops  ', departmentId: null }),
    ).toEqual({ name: 'Board Ops', departmentId: null });
    expect(
      createBoardRequestSchema.safeParse({ name: '   ' }).success,
    ).toBe(false);
    expect(
      createBoardRequestSchema.safeParse({ name: 'Ok', extra: true }).success,
    ).toBe(false);
    expect(
      updateBoardRequestSchema.safeParse({ unarchive: true }).success,
    ).toBe(true);

    const parsedQuery = listBoardsQuerySchema.parse({
      departmentId: '',
      includeArchived: 'true',
      limit: '50',
    });
    expect(parsedQuery).toEqual({ includeArchived: true, limit: 50 });
    expect(
      listBoardsQuerySchema.safeParse({ includeArchived: 'maybe' }).success,
    ).toBe(false);

    expect(
      createColumnRequestSchema.safeParse({ name: 'QA', orderIndex: 2 }).success,
    ).toBe(true);
    expect(
      updateColumnRequestSchema.safeParse({ name: '' }).success,
    ).toBe(false);
    expect(
      reorderColumnsRequestSchema.safeParse({ columnIds: [] }).success,
    ).toBe(false);
    expect(
      reorderColumnsRequestSchema.safeParse({ columnIds: [UUID_1, UUID_2] }).success,
    ).toBe(true);
  });

  it('enforces task creation, update, assignees, queries, and UUID canonical sorting', () => {
    expect(TASK_PRIORITIES).toEqual([1, 2, 3, 4]);

    const created = createTaskRequestSchema.parse({
      boardId: UUID_1,
      columnId: UUID_2,
      title: '  Draft kickoff  ',
      startAt: '2026-12-01T00:00:00+07:00',
      dueAt: '2026-12-01T10:00:00+07:00',
    });
    expect(created.title).toBe('Draft kickoff');
    expect(created.priority).toBe(2);
    expect(created.startAt).toBeInstanceOf(Date);
    expect(created.dueAt).toBeInstanceOf(Date);
    expect(created.assigneeIds).toEqual([]);
    expect(created.departmentIds).toEqual([]);
    expect(created.notifyDepartmentMembers).toBe(true);
    expect(created.isHidden).toBe(false);

    expect(
      createTaskRequestSchema.safeParse({
        boardId: UUID_1,
        columnId: UUID_2,
        title: 'Missing dates',
      }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: 'Null dates',
        startAt: null,
        dueAt: null,
      }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: 'Inverted range',
        startAt: '2026-12-05T00:00:00+07:00',
        dueAt: '2026-12-01T00:00:00+07:00',
      }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        boardId: UUID_1,
        columnId: UUID_2,
        title: 'Bad priority',
        startAt: '2026-12-01T00:00:00+07:00',
        dueAt: '2026-12-01T10:00:00+07:00',
        priority: 5,
      }).success,
    ).toBe(false);

    expect(
      updateTaskRequestSchema.safeParse({ title: 'Updated' }).success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({ startAt: null, version: 1 }).success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({ dueAt: null, version: 1 }).success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({
        startAt: '2026-12-05T00:00:00+07:00',
        dueAt: '2026-12-01T00:00:00+07:00',
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({ title: 'Updated', version: 1 }).success,
    ).toBe(true);

    expect(
      moveTaskRequestSchema.parse({
        columnId: UUID_1,
        beforeId: UUID_2,
        afterId: UUID_3,
        version: 2,
      }),
    ).toEqual({
      columnId: UUID_1,
      beforeId: UUID_2,
      afterId: UUID_3,
      version: 2,
    });
    expect(
      moveTaskRequestSchema.parse({
        columnId: UUID_1,
        beforeId: null,
        afterId: null,
        version: 1,
      }),
    ).toEqual({
      columnId: UUID_1,
      beforeId: null,
      afterId: null,
      version: 1,
    });
    expect(
      moveTaskRequestSchema.parse({ columnId: UUID_1, version: 1 }),
    ).toEqual({ columnId: UUID_1, version: 1 });
    expect(
      moveTaskRequestSchema.safeParse({ columnId: 'bad-id', version: 1 }).success,
    ).toBe(false);
    expect(
      moveTaskRequestSchema.safeParse({ columnId: UUID_1, version: 0 }).success,
    ).toBe(false);
    expect(
      moveTaskRequestSchema.safeParse({ columnId: UUID_1, version: 1, extra: true }).success,
    ).toBe(false);

    expect(
      replaceTaskAssigneesRequestSchema.safeParse({ assigneeIds: [UUID_3] }).success,
    ).toBe(true);
    expect(
      replaceTaskAssigneesRequestSchema.safeParse({ departmentIds: [UUID_1] }).success,
    ).toBe(true);
    expect(
      replaceTaskAssigneesRequestSchema.safeParse({ version: 1 }).success,
    ).toBe(false);
    expect(
      replaceTaskAssigneesRequestSchema.safeParse({
        notifyInApp: false,
        notifyEmail: false,
      }).success,
    ).toBe(false);
    expect(
      replaceTaskAssigneesRequestSchema.parse({
        assigneeIds: [UUID_3],
        notifyInApp: true,
        notifyEmail: false,
      }),
    ).toEqual({
      assigneeIds: [UUID_3],
      notifyDepartmentMembers: true,
      notifyInApp: true,
      notifyEmail: false,
    });
    expect(
      createTaskRequestSchema.parse({
        boardId: UUID_1,
        columnId: UUID_2,
        title: 'Channel overrides',
        startAt: '2026-12-01T00:00:00+07:00',
        dueAt: '2026-12-01T10:00:00+07:00',
        notifyDepartmentMembers: false,
        notifyInApp: true,
      }),
    ).toMatchObject({
      notifyDepartmentMembers: false,
      notifyInApp: true,
    });
    expect(
      createTaskRequestSchema.safeParse({
        boardId: UUID_1,
        columnId: UUID_2,
        title: 'Invalid notifyEmail',
        startAt: '2026-12-01T00:00:00+07:00',
        dueAt: '2026-12-01T10:00:00+07:00',
        notifyEmail: 'no',
      }).success,
    ).toBe(false);

    expect(resolveTaskNotificationChannels({})).toEqual({
      notifyInApp: true,
      notifyEmail: true,
    });
    expect(
      resolveTaskNotificationChannels({ notifyDepartmentMembers: false }),
    ).toEqual({
      notifyInApp: false,
      notifyEmail: false,
    });
    expect(
      resolveTaskNotificationChannels({
        notifyDepartmentMembers: true,
        notifyInApp: true,
        notifyEmail: false,
      }),
    ).toEqual({
      notifyInApp: true,
      notifyEmail: false,
    });
    expect(
      resolveTaskNotificationChannels({
        notifyDepartmentMembers: false,
        notifyInApp: false,
        notifyEmail: true,
      }),
    ).toEqual({
      notifyInApp: false,
      notifyEmail: true,
    });

    expect(NOTIFICATION_TYPES).toEqual([
      'task.department_assigned',
      'task.assigned',
      'task.accepted',
      'task.deliverable_submitted',
    ]);
    expect(TASK_DEADLINE_STATUSES).toEqual(['overdue', 'urgent', 'soon', 'safe', 'done']);
    expect(
      listNotificationsQuerySchema.parse({ unreadOnly: 'true', limit: '10' }),
    ).toEqual({ unreadOnly: true, limit: 10 });
    expect(
      listNotificationsQuerySchema.safeParse({ unreadOnly: 'invalid' }).success,
    ).toBe(false);
    expect(
      listNotificationsQuerySchema.safeParse({ limit: '51' }).success,
    ).toBe(false);

    const tasksQuery = listTasksQuerySchema.parse({
      priority: '4',
      dueStatus: 'overdue',
      deadlineStatus: 'urgent',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.000Z',
      q: '  poster  ',
      limit: '200',
    });
    expect(tasksQuery).toEqual({
      priority: 4,
      dueStatus: 'overdue',
      deadlineStatus: 'urgent',
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-30T23:59:59.000Z'),
      q: 'poster',
      sortBy: 'position',
      sortOrder: 'asc',
      limit: 200,
    });
    expect(listTasksQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(
      listTasksQuerySchema.safeParse({
        from: '2026-12-02T00:00:00.000Z',
        to: '2026-12-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      listTasksQuerySchema.safeParse({ priority: '0' }).success,
    ).toBe(false);

    // CR-09 + CR-14 task create/update/acceptance/deliverable contracts
    expect(
      createTaskRequestSchema.safeParse({
        title: 'Boardless Task',
        startAt: '2026-12-01T00:00:00.000Z',
        dueAt: '2026-12-02T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      createTaskRequestSchema.safeParse({ title: 'Bad Pair', boardId: UUID_1 }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: 'Bad Dates',
        startAt: '2026-12-05T00:00:00.000Z',
        dueAt: '2026-12-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(updateTaskAcceptanceRequestSchema.parse({ accepted: true })).toEqual({ accepted: true });
    expect(deliverableUrlSchema.safeParse('https://drive.google.com/file/1').success).toBe(true);
    expect(deliverableUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(deliverableUrlSchema.safeParse('ftp://files.local/a.zip').success).toBe(false);
    expect(deliverableUrlSchema.safeParse('https://bad url.com').success).toBe(false);
    expect(
      createTaskDeliverableRequestSchema.parse({
        title: '  Slide deck  ',
        url: ' https://docs.google.com/presentation/d/1 ',
      }),
    ).toEqual({ title: 'Slide deck', url: 'https://docs.google.com/presentation/d/1' });

    const myTasksQuery = listMyTasksQuerySchema.parse({
      includeDone: 'true',
      priority: '',
    });
    expect(myTasksQuery).toEqual({
      includeDone: true,
      limit: 20,
    });

    expect(dedupeSortedUuids([UUID_3, UUID_1, UUID_3, UUID_2])).toEqual([
      UUID_1,
      UUID_2,
      UUID_3,
    ]);
  });
});
