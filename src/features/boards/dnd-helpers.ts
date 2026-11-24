import type { PermissionCode } from '@/features/shared/permissions/can';
import type { MoveTaskRequest, TaskDto } from '@/features/tasks/hooks/useTasks';
import type { BoardDetailDto } from './hooks/useBoards';
import { applyOptimisticColumnReorder } from './hooks/useBoards';

export { applyOptimisticColumnReorder };

export type DragEntityKind = 'column' | 'task' | 'lane';

export interface ParsedDragId {
  readonly kind: DragEntityKind;
  readonly id: string;
}

const COLUMN_PREFIX = 'col:';
const TASK_PREFIX = 'task:';
const LANE_PREFIX = 'lane:';

export function toColumnDragId(id: string): string {
  return `${COLUMN_PREFIX}${id}`;
}

export function toTaskDragId(id: string): string {
  return `${TASK_PREFIX}${id}`;
}

export function toLaneDropId(id: string): string {
  return `${LANE_PREFIX}${id}`;
}

export function parseDragId(raw: string | number): ParsedDragId | null {
  const value = String(raw);
  if (value.startsWith(COLUMN_PREFIX)) {
    return { kind: 'column', id: value.slice(COLUMN_PREFIX.length) };
  }
  if (value.startsWith(TASK_PREFIX)) {
    return { kind: 'task', id: value.slice(TASK_PREFIX.length) };
  }
  if (value.startsWith(LANE_PREFIX)) {
    return { kind: 'lane', id: value.slice(LANE_PREFIX.length) };
  }
  return null;
}

export function compareTasksByPosition(a: TaskDto, b: TaskDto): number {
  const numA = Number(a.position);
  const numB = Number(b.position);
  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
    return numA - numB;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export function canDragTask({
  task,
  isAdmin,
  can,
  currentUserId,
}: {
  readonly task: TaskDto;
  readonly isAdmin: boolean;
  readonly can: (permission: PermissionCode) => boolean;
  readonly currentUserId: string | null | undefined;
}): boolean {
  if (isAdmin || can('task.update_any')) return true;
  if (!can('task.update_assigned') || !currentUserId) return false;
  return task.assignees.some((assignee) => assignee.id === currentUserId);
}

export function reorderIdsWithArrayMove(
  ids: readonly string[],
  activeId: string,
  overId: string
): string[] | null {
  const fromIndex = ids.indexOf(activeId);
  const toIndex = ids.indexOf(overId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return null;
  }
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return null;
  next.splice(toIndex, 0, moved);
  return next;
}

function buildSameColumnSimulatedOrder(
  columnTasks: readonly TaskDto[],
  activeTaskId: string,
  overTaskId: string | null
): string[] | null {
  const ids = columnTasks.map((t) => t.id);
  const fromIndex = ids.indexOf(activeTaskId);
  if (fromIndex === -1) return null;
  const toIndex = overTaskId ? ids.indexOf(overTaskId) : ids.length - 1;
  if (toIndex === -1 || toIndex === fromIndex) return null;
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return null;
  next.splice(toIndex, 0, moved);
  return next;
}

function buildCrossColumnSimulatedOrder(
  destTasks: readonly TaskDto[],
  activeTaskId: string,
  overTaskId: string | null
): string[] {
  const siblingIds = destTasks.filter((t) => t.id !== activeTaskId).map((t) => t.id);
  if (!overTaskId) {
    return [...siblingIds, activeTaskId];
  }
  const overIndex = siblingIds.indexOf(overTaskId);
  if (overIndex === -1) {
    return [...siblingIds, activeTaskId];
  }
  const next = [...siblingIds];
  next.splice(overIndex, 0, activeTaskId);
  return next;
}

export function computeTaskMovePayload({
  tasks,
  activeTaskId,
  destinationColumnId,
  overTaskId,
}: {
  readonly tasks: readonly TaskDto[];
  readonly activeTaskId: string;
  readonly destinationColumnId: string;
  readonly overTaskId: string | null;
}): MoveTaskRequest | null {
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  if (!activeTask) return null;

  const destTasks = tasks
    .filter((t) => t.columnId === destinationColumnId)
    .sort(compareTasksByPosition);

  const simulatedIds =
    activeTask.columnId === destinationColumnId
      ? buildSameColumnSimulatedOrder(destTasks, activeTaskId, overTaskId)
      : buildCrossColumnSimulatedOrder(destTasks, activeTaskId, overTaskId);

  if (!simulatedIds) return null;

  const targetIndex = simulatedIds.indexOf(activeTaskId);
  if (targetIndex === -1) return null;

  return {
    columnId: destinationColumnId,
    beforeId: targetIndex > 0 ? simulatedIds[targetIndex - 1]! : null,
    afterId: targetIndex < simulatedIds.length - 1 ? simulatedIds[targetIndex + 1]! : null,
    version: activeTask.version,
  };
}

export function findColumnIdForBoardTasks(board: BoardDetailDto, taskId: string): string | null {
  const found = board.tasks.find((t) => t.id === taskId);
  return found?.columnId ?? null;
}
