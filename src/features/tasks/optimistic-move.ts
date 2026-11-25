import type { components } from '@/features/shared/api/client';

type TaskDto = components['schemas']['TaskDto'];
type MoveTaskRequest = components['schemas']['MoveTaskRequest'];
type BoardDetailResponse = components['schemas']['BoardDetailResponse'];

function compareBoardTaskPositions(a: TaskDto, b: TaskDto): number {
  const diff = Number(a.position) - Number(b.position);
  return Number.isFinite(diff) && diff !== 0 ? diff : a.createdAt.localeCompare(b.createdAt);
}

function computeOptimisticMovePosition(
  siblings: readonly TaskDto[],
  beforeId: string | null | undefined,
  afterId: string | null | undefined
): number {
  if (siblings.length === 0) return 1000;
  const beforeIdx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  if (beforeIdx >= 0) {
    const beforePos = Number(siblings[beforeIdx]!.position);
    const nextPos =
      beforeIdx + 1 < siblings.length ? Number(siblings[beforeIdx + 1]!.position) : beforePos + 2000;
    return (beforePos + nextPos) / 2;
  }
  const afterIdx = afterId ? siblings.findIndex((s) => s.id === afterId) : -1;
  if (afterIdx >= 0) {
    const afterPos = Number(siblings[afterIdx]!.position);
    const prevPos = afterIdx > 0 ? Number(siblings[afterIdx - 1]!.position) : afterPos - 2000;
    return (prevPos + afterPos) / 2;
  }
  return Number(siblings[siblings.length - 1]!.position) + 1000;
}

function updateColumnCountsOnMove(
  columns: BoardDetailResponse['board']['columns'],
  fromColumnId: string | null,
  toColumnId: string
): BoardDetailResponse['board']['columns'] {
  if (fromColumnId === toColumnId) return [...columns];
  return columns.map((col) => {
    if (col.id === fromColumnId) return { ...col, taskCount: Math.max(0, col.taskCount - 1) };
    if (col.id === toColumnId) return { ...col, taskCount: col.taskCount + 1 };
    return col;
  });
}

export function updateCachedBoardDetailOnTaskMove(
  cached: BoardDetailResponse | undefined,
  taskId: string,
  payload: MoveTaskRequest
): BoardDetailResponse | undefined {
  if (!cached) return cached;
  const moving = cached.board.tasks.find((t) => t.id === taskId);
  if (!moving) return cached;
  const siblings = cached.board.tasks
    .filter((t) => t.id !== taskId && t.columnId === payload.columnId)
    .sort(compareBoardTaskPositions);
  const nextPosition = computeOptimisticMovePosition(siblings, payload.beforeId, payload.afterId);
  const nextTasks = cached.board.tasks.map((t) =>
    t.id === taskId ? { ...t, columnId: payload.columnId, position: nextPosition } : t
  );
  const nextColumns = updateColumnCountsOnMove(cached.board.columns, moving.columnId, payload.columnId);
  return { board: { ...cached.board, columns: nextColumns, tasks: nextTasks } };
}
