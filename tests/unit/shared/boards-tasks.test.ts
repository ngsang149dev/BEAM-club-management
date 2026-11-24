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
  createTaskRequestSchema,
  dedupeSortedUuids,
  listMyTasksQuerySchema,
  listTasksQuerySchema,
  moveTaskRequestSchema,
  replaceTaskAssigneesRequestSchema,
  TASK_PRIORITIES,
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
      dueAt: '2026-12-01T10:00:00+07:00',
    });
    expect(created.title).toBe('Draft kickoff');
    expect(created.priority).toBe(2);
    expect(created.dueAt).toBeInstanceOf(Date);
    expect(created.assigneeIds).toEqual([]);
    expect(created.isHidden).toBe(false);

    expect(
      createTaskRequestSchema.safeParse({
        boardId: UUID_1,
        columnId: UUID_2,
        title: 'Bad priority',
        priority: 5,
      }).success,
    ).toBe(false);

    expect(
      updateTaskRequestSchema.safeParse({ title: 'Updated' }).success,
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

    const tasksQuery = listTasksQuerySchema.parse({
      priority: '4',
      dueStatus: 'overdue',
      q: '  poster  ',
      limit: '15',
    });
    expect(tasksQuery).toEqual({
      priority: 4,
      dueStatus: 'overdue',
      q: 'poster',
      sortBy: 'position',
      sortOrder: 'asc',
      limit: 15,
    });
    expect(
      listTasksQuerySchema.safeParse({ priority: '0' }).success,
    ).toBe(false);

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
