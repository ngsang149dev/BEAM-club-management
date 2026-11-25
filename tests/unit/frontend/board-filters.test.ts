import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD_FILTERS,
  buildBoardFilterSearchParams,
  hasActiveBoardFilters,
  isBoardDndPaused,
  isDoneColumn,
  parseBoardFiltersFromSearchParams,
  type BoardFiltersState,
} from '@/features/boards/filters';
import { buildBoardTasksQueryParams, TASKS_QUERY_KEYS } from '@/features/tasks/hooks/useTasks';

describe('board filters & Done column policy (E6-02)', () => {
  it('parses URL search params with safe defaults and fallbacks', () => {
    expect(parseBoardFiltersFromSearchParams(new URLSearchParams())).toEqual(DEFAULT_BOARD_FILTERS);

    const parsed = parseBoardFiltersFromSearchParams(
      new URLSearchParams(
        'q=sponsor&departmentId=dept-1&assigneeId=user-2&priority=4&dueStatus=overdue&columnId=col-1&sortBy=dueAt&sortOrder=desc'
      )
    );
    expect(parsed).toEqual({
      q: 'sponsor',
      departmentId: 'dept-1',
      assigneeId: 'user-2',
      priority: 4,
      dueStatus: 'overdue',
      columnId: 'col-1',
      sortBy: 'dueAt',
      sortOrder: 'desc',
    });

    const invalidFallback = parseBoardFiltersFromSearchParams(
      new URLSearchParams('priority=9&dueStatus=bogus&sortBy=title&sortOrder=sideways')
    );
    expect(invalidFallback).toEqual(DEFAULT_BOARD_FILTERS);
  });

  it('serializes non-default filters and preserves task param across updates', () => {
    const defaultParams = buildBoardFilterSearchParams(DEFAULT_BOARD_FILTERS, 'task-99');
    expect(defaultParams.toString()).toBe('task=task-99');

    const active: BoardFiltersState = {
      q: '  poster ',
      departmentId: 'd-1',
      assigneeId: '',
      priority: 3,
      dueStatus: 'upcoming',
      columnId: 'c-2',
      sortBy: 'priority',
      sortOrder: 'desc',
    };
    const serialized = buildBoardFilterSearchParams(active, 'task-99');
    expect(serialized.get('task')).toBe('task-99');
    expect(serialized.get('q')).toBe('poster');
    expect(serialized.get('departmentId')).toBe('d-1');
    expect(serialized.has('assigneeId')).toBe(false);
    expect(serialized.get('priority')).toBe('3');
    expect(serialized.get('dueStatus')).toBe('upcoming');
    expect(serialized.get('columnId')).toBe('c-2');
    expect(serialized.get('sortBy')).toBe('priority');
    expect(serialized.get('sortOrder')).toBe('desc');

    const withoutTask = buildBoardFilterSearchParams(active, null);
    expect(withoutTask.has('task')).toBe(false);
    expect(withoutTask.get('priority')).toBe('3');
  });

  it('pauses DnD whenever any filter is active or sort differs from position asc', () => {
    expect(hasActiveBoardFilters(DEFAULT_BOARD_FILTERS)).toBe(false);
    expect(isBoardDndPaused(DEFAULT_BOARD_FILTERS)).toBe(false);

    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, q: '   ' })).toBe(false);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, q: 'standee' })).toBe(true);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, priority: 2 })).toBe(true);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, dueStatus: 'overdue' })).toBe(true);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, departmentId: 'd-1' })).toBe(true);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, assigneeId: 'u-1' })).toBe(true);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, columnId: 'c-1' })).toBe(true);

    expect(hasActiveBoardFilters({ ...DEFAULT_BOARD_FILTERS, sortBy: 'dueAt' })).toBe(false);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, sortBy: 'dueAt' })).toBe(true);
    expect(isBoardDndPaused({ ...DEFAULT_BOARD_FILTERS, sortOrder: 'desc' })).toBe(true);
  });

  it('identifies Done column by name (case/whitespace insensitive) or highest orderIndex', () => {
    const columns = [
      { name: 'Todo', orderIndex: 0 },
      { name: 'Doing', orderIndex: 1 },
      { name: 'Review', orderIndex: 2 },
      { name: ' Done ', orderIndex: 3 },
    ];
    expect(isDoneColumn(columns[0]!, columns)).toBe(false);
    expect(isDoneColumn(columns[2]!, columns)).toBe(false);
    expect(isDoneColumn(columns[3]!, columns)).toBe(true);

    const renamedFinal = [
      { name: 'Cần làm', orderIndex: 0 },
      { name: 'Hoàn thành', orderIndex: 2 },
    ];
    expect(isDoneColumn(renamedFinal[0]!, renamedFinal)).toBe(false);
    expect(isDoneColumn(renamedFinal[1]!, renamedFinal)).toBe(true);

    expect(isDoneColumn({ name: 'done', orderIndex: 0 }, [])).toBe(true);
    expect(isDoneColumn({ name: 'Todo', orderIndex: 0 }, [])).toBe(false);
  });

  it('builds GET /tasks query params and boardList query key cleanly', () => {
    const filters: BoardFiltersState = {
      q: '  slide ',
      departmentId: 'dept-1',
      assigneeId: 'user-1',
      priority: 4,
      dueStatus: 'overdue',
      columnId: 'col-2',
      sortBy: 'priority',
      sortOrder: 'desc',
    };
    expect(buildBoardTasksQueryParams('board-1', filters)).toEqual({
      boardId: 'board-1',
      q: 'slide',
      columnId: 'col-2',
      assigneeId: 'user-1',
      departmentId: 'dept-1',
      priority: 4,
      dueStatus: 'overdue',
      sortBy: 'priority',
      sortOrder: 'desc',
      limit: 100,
    });
    expect(TASKS_QUERY_KEYS.boardList('board-1', filters)[0]).toBe('tasks');
    expect(TASKS_QUERY_KEYS.boardList('board-1', filters)[1]).toBe('boardList');
  });
});
