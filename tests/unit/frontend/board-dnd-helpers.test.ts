import { describe, expect, it } from 'vitest';
import type { PermissionCode } from '@/features/shared/permissions/can';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import { updateCachedBoardDetailOnTaskMove } from '@/features/tasks/hooks/useTasks';
import type { BoardDetailDto, ColumnDto } from '@/features/boards/hooks/useBoards';
import {
  applyOptimisticColumnReorder,
  canDragTask,
  computeTaskMovePayload,
  parseDragId,
  reorderIdsWithArrayMove,
  toColumnDragId,
  toLaneDropId,
  toTaskDragId,
} from '@/features/boards/dnd-helpers';

const CREATOR = { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] };

function makeColumn(id: string, name: string, orderIndex: number, taskCount = 0): ColumnDto {
  return {
    id,
    boardId: 'b-1',
    name,
    orderIndex,
    taskCount,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

function makeTask(
  id: string,
  columnId: string,
  position: number,
  options: { version?: number; assigneeIds?: string[] } = {}
): TaskDto {
  return {
    id,
    boardId: 'b-1',
    columnId,
    title: `Task ${id}`,
    description: null,
    startAt: null,
    dueAt: null,
    isCompleted: false,
    completedAt: null,
    priority: 2,
    position,
    isHidden: false,
    version: options.version ?? 1,
    deletedAt: null,
    assignees: (options.assigneeIds ?? []).map((uid) => ({
      id: uid,
      fullName: `User ${uid}`,
      isActive: true,
      leftAt: null,
      departments: [],
      acceptedAt: null,
    })),
    assignedDepartments: [],
    deliverables: [],
    deliverableCount: 0,
    creator: CREATOR,
    commentCount: 0,
    createdAt: '2026-11-20T00:00:00Z',
    updatedAt: '2026-11-20T00:00:00Z',
  };
}

describe('board-dnd-helpers', () => {
  it('encodes and parses column, task, and lane DnD identifiers', () => {
    expect(parseDragId(toColumnDragId('c-1'))).toEqual({ kind: 'column', id: 'c-1' });
    expect(parseDragId(toTaskDragId('t-1'))).toEqual({ kind: 'task', id: 't-1' });
    expect(parseDragId(toLaneDropId('c-2'))).toEqual({ kind: 'lane', id: 'c-2' });
    expect(parseDragId('raw-id')).toBeNull();
  });

  it('enforces permission, assignee, and department rules in canDragTask', () => {
    const task = makeTask('t-1', 'c-1', 1000, { assigneeIds: ['u-alice'] });
    const deptTask: TaskDto = {
      ...makeTask('t-2', 'c-1', 2000),
      assignedDepartments: [{ id: 'd-media', name: 'Truyền thông' }],
    };
    const allowNone = () => false;
    const allowPerm = (target: PermissionCode) => (perm: PermissionCode) => perm === target;

    expect(canDragTask({ task, isAdmin: true, can: allowNone, currentUserId: null })).toBe(true);
    expect(canDragTask({ task, isAdmin: false, can: allowPerm('task.update_any'), currentUserId: 'u-bob' })).toBe(true);
    expect(canDragTask({ task, isAdmin: false, can: allowPerm('task.update_assigned'), currentUserId: 'u-alice' })).toBe(true);
    expect(canDragTask({ task, isAdmin: false, can: allowPerm('task.update_assigned'), currentUserId: 'u-bob' })).toBe(false);
    expect(canDragTask({ task, isAdmin: false, can: allowPerm('member.view'), currentUserId: 'u-alice' })).toBe(false);
    expect(
      canDragTask({
        task: deptTask,
        isAdmin: false,
        can: allowPerm('task.update_assigned'),
        currentUserId: 'u-bob',
        currentDepartmentIds: ['d-media'],
      })
    ).toBe(true);
    expect(
      canDragTask({
        task: deptTask,
        isAdmin: false,
        can: allowPerm('task.update_assigned'),
        currentUserId: 'u-bob',
        currentDepartmentIds: ['d-other'],
      })
    ).toBe(false);
  });

  it('computes beforeId/afterId payloads across empty, top, middle, bottom, and same-column moves', () => {
    const t1 = makeTask('t-1', 'c-1', 1000, { version: 4 });
    const t2 = makeTask('t-2', 'c-1', 2000, { version: 2 });
    const t3 = makeTask('t-3', 'c-1', 3000, { version: 5 });
    const d1 = makeTask('d-1', 'c-2', 1000, { version: 1 });
    const d2 = makeTask('d-2', 'c-2', 2000, { version: 1 });
    const tasks = [t1, t2, t3, d1, d2];

    // Cross-column into empty c-3
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-1', destinationColumnId: 'c-3', overTaskId: null })
    ).toEqual({ columnId: 'c-3', beforeId: null, afterId: null, version: 4 });

    // Cross-column to top of c-2 (dropped on d-1)
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-1', destinationColumnId: 'c-2', overTaskId: 'd-1' })
    ).toEqual({ columnId: 'c-2', beforeId: null, afterId: 'd-1', version: 4 });

    // Cross-column to middle of c-2 (dropped on d-2)
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-1', destinationColumnId: 'c-2', overTaskId: 'd-2' })
    ).toEqual({ columnId: 'c-2', beforeId: 'd-1', afterId: 'd-2', version: 4 });

    // Cross-column to bottom of c-2 via lane drop container
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-1', destinationColumnId: 'c-2', overTaskId: null })
    ).toEqual({ columnId: 'c-2', beforeId: 'd-2', afterId: null, version: 4 });

    // Same-column move UP: t-3 -> t-1 slot
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-3', destinationColumnId: 'c-1', overTaskId: 't-1' })
    ).toEqual({ columnId: 'c-1', beforeId: null, afterId: 't-1', version: 5 });

    // Same-column move DOWN: t-1 -> t-3 slot
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-1', destinationColumnId: 'c-1', overTaskId: 't-3' })
    ).toEqual({ columnId: 'c-1', beforeId: 't-3', afterId: null, version: 4 });

    // Same-column no-ops
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-2', destinationColumnId: 'c-1', overTaskId: 't-2' })
    ).toBeNull();
    expect(
      computeTaskMovePayload({ tasks, activeTaskId: 't-3', destinationColumnId: 'c-1', overTaskId: null })
    ).toBeNull();
  });

  it('optimistically reorders columns and handles no-ops cleanly', () => {
    const board: BoardDetailDto = {
      id: 'b-1',
      name: 'Board 1',
      department: null,
      archivedAt: null,
      createdBy: CREATOR,
      columns: [makeColumn('c-1', 'Todo', 0), makeColumn('c-2', 'Doing', 1), makeColumn('c-3', 'Done', 2)],
      tasks: [],
      visibleTaskCount: 0,
      overdueTaskCount: 0,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };

    const reorderedIds = reorderIdsWithArrayMove(['c-1', 'c-2', 'c-3'], 'c-1', 'c-3');
    expect(reorderedIds).toEqual(['c-2', 'c-3', 'c-1']);
    expect(reorderIdsWithArrayMove(['c-1', 'c-2', 'c-3'], 'c-2', 'c-2')).toBeNull();

    const updated = applyOptimisticColumnReorder(board, reorderedIds!);
    expect(updated.columns.map((c) => `${c.id}:${c.orderIndex}`)).toEqual(['c-2:0', 'c-3:1', 'c-1:2']);
    expect(board.columns.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
  });

  it('optimistically updates cached board detail when moving a task', () => {
    const t1 = makeTask('t-1', 'c-1', 1000, { version: 2 });
    const d1 = makeTask('d-1', 'c-2', 1000);
    const d2 = makeTask('d-2', 'c-2', 2000);
    const cached = {
      board: {
        id: 'b-1',
        name: 'Board 1',
        department: null,
        archivedAt: null,
        createdBy: CREATOR,
        columns: [makeColumn('c-1', 'Todo', 0, 1), makeColumn('c-2', 'Done', 1, 2)],
        tasks: [t1, d1, d2],
        visibleTaskCount: 3,
        overdueTaskCount: 0,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    };

    const next = updateCachedBoardDetailOnTaskMove(cached, 't-1', {
      columnId: 'c-2',
      beforeId: 'd-1',
      afterId: 'd-2',
      version: 2,
    });
    expect(next?.board.columns.find((c) => c.id === 'c-1')?.taskCount).toBe(0);
    expect(next?.board.columns.find((c) => c.id === 'c-2')?.taskCount).toBe(3);
    const moved = next?.board.tasks.find((t) => t.id === 't-1');
    expect(moved?.columnId).toBe('c-2');
    expect(Number(moved?.position)).toBe(1500);
  });
});
