import {
  TASK_DUE_STATUSES,
  TASK_PRIORITIES,
  TASK_SORT_BY_VALUES,
  TASK_SORT_ORDER_VALUES,
  type TaskDueStatus,
  type TaskPriority,
  type TaskSortBy,
  type TaskSortOrder,
} from '@/lib/tasks';
import type { ColumnDto } from './hooks/useBoards';

export interface BoardFiltersState {
  readonly q: string;
  readonly departmentId: string;
  readonly assigneeId: string;
  readonly priority: '' | TaskPriority;
  readonly dueStatus: '' | TaskDueStatus;
  readonly columnId: string;
  readonly sortBy: TaskSortBy;
  readonly sortOrder: TaskSortOrder;
}

export const DEFAULT_BOARD_FILTERS: BoardFiltersState = {
  q: '',
  departmentId: '',
  assigneeId: '',
  priority: '',
  dueStatus: '',
  columnId: '',
  sortBy: 'position',
  sortOrder: 'asc',
};

export interface SearchParamsReader {
  get(name: string): string | null;
}

function parsePriorityParam(raw: string | null): '' | TaskPriority {
  if (!raw) return '';
  const num = Number(raw.trim());
  return (TASK_PRIORITIES as readonly number[]).includes(num) ? (num as TaskPriority) : '';
}

function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  return (allowed as readonly string[]).includes(trimmed) ? (trimmed as T) : fallback;
}

function parseOptionalDueStatus(raw: string | null): '' | TaskDueStatus {
  const trimmed = raw?.trim();
  if (!trimmed) return '';
  return (TASK_DUE_STATUSES as readonly string[]).includes(trimmed)
    ? (trimmed as TaskDueStatus)
    : '';
}

export function parseBoardFiltersFromSearchParams(params: SearchParamsReader): BoardFiltersState {
  return {
    q: params.get('q') ?? '',
    departmentId: params.get('departmentId')?.trim() ?? '',
    assigneeId: params.get('assigneeId')?.trim() ?? '',
    priority: parsePriorityParam(params.get('priority')),
    dueStatus: parseOptionalDueStatus(params.get('dueStatus')),
    columnId: params.get('columnId')?.trim() ?? '',
    sortBy: parseEnumParam(params.get('sortBy'), TASK_SORT_BY_VALUES, 'position'),
    sortOrder: parseEnumParam(params.get('sortOrder'), TASK_SORT_ORDER_VALUES, 'asc'),
  };
}

export function buildBoardFilterSearchParams(
  filters: BoardFiltersState,
  preservedTaskId?: string | null
): URLSearchParams {
  const params = new URLSearchParams();
  const entries: readonly [string, string][] = [
    ['task', preservedTaskId?.trim() ?? ''],
    ['q', filters.q.trim()],
    ['departmentId', filters.departmentId],
    ['assigneeId', filters.assigneeId],
    ['priority', filters.priority === '' ? '' : String(filters.priority)],
    ['dueStatus', filters.dueStatus],
    ['columnId', filters.columnId],
    ['sortBy', filters.sortBy === 'position' ? '' : filters.sortBy],
    ['sortOrder', filters.sortOrder === 'asc' ? '' : filters.sortOrder],
  ];
  for (const [key, value] of entries) {
    if (value) params.set(key, value);
  }
  return params;
}

export function hasActiveBoardFilters(filters: BoardFiltersState): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.departmentId !== '' ||
    filters.assigneeId !== '' ||
    filters.priority !== '' ||
    filters.dueStatus !== '' ||
    filters.columnId !== ''
  );
}

export function isBoardDndPaused(filters: BoardFiltersState): boolean {
  return (
    hasActiveBoardFilters(filters) ||
    filters.sortBy !== 'position' ||
    filters.sortOrder !== 'asc'
  );
}

export function isDoneColumn(
  column: Pick<ColumnDto, 'name' | 'orderIndex'>,
  columns: readonly Pick<ColumnDto, 'orderIndex'>[]
): boolean {
  if (column.name.trim().toLowerCase() === 'done') {
    return true;
  }
  if (columns.length === 0) {
    return false;
  }
  const maxOrderIndex = columns.reduce(
    (max, item) => (item.orderIndex > max ? item.orderIndex : max),
    columns[0]!.orderIndex
  );
  return column.orderIndex === maxOrderIndex;
}
