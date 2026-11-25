import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const apiFetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const boardsHooksMock = vi.hoisted(() => ({
  useBoardDetailQuery: vi.fn(),
}));

const tasksHooksMock = vi.hoisted(() => ({
  useTaskAssigneeMembersQuery: vi.fn(),
  useTaskDepartmentsQuery: vi.fn(),
}));

const authHooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
}));

const taskEventsHooksMock = vi.hoisted(() => ({
  useTaskEventsInfiniteQuery: vi.fn(),
  useRevertTaskEventMutation: vi.fn(),
  useBoardTrashInfiniteQuery: vi.fn(),
  useRestoreBoardTaskMutation: vi.fn(),
  useUndoTaskActionToast: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/features/shared/api/client')>(
    '@/features/shared/api/client'
  );
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/features/boards/hooks/useBoards', async () => {
  const actual = await vi.importActual<typeof import('@/features/boards/hooks/useBoards')>(
    '@/features/boards/hooks/useBoards'
  );
  return { ...actual, ...boardsHooksMock };
});

vi.mock('@/features/tasks/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTasks')>(
    '@/features/tasks/hooks/useTasks'
  );
  return { ...actual, ...tasksHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', () => authHooksMock);

vi.mock('@/features/tasks/hooks/useTaskEvents', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTaskEvents')>(
    '@/features/tasks/hooks/useTaskEvents'
  );
  return { ...actual, ...taskEventsHooksMock };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { BoardTrashModal } from '@/features/boards/components/BoardTrashModal';
import { TaskHistorySection } from '@/features/tasks/components/TaskHistorySection';
import { TaskRevertConflictModal } from '@/features/tasks/components/TaskRevertConflictModal';
import {
  canActorRevertEvent,
  formatTaskEventSummary,
  type TaskHistoryLookup,
} from '@/features/tasks/event-formatters';
import {
  BOARD_TRASH_PAGE_SIZE,
  executeQuickUndo,
  extractRevertConflictFields,
  TASK_EVENTS_PAGE_SIZE,
  UNDO_TOAST_DURATION_MS,
  useUndoTaskActionToast,
} from '@/features/tasks/hooks/useTaskEvents';
import { TASKS_QUERY_KEYS } from '@/features/tasks/hooks/useTasks';

type TaskDto = components['schemas']['TaskDto'];
type TaskEventDto = components['schemas']['TaskEventDto'];

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const SAMPLE_TASK: TaskDto = {
  id: '11111111-1111-4111-8111-111111111111',
  boardId: '22222222-2222-4222-8222-222222222222',
  columnId: '33333333-3333-4333-8333-333333333333',
  title: 'Chuẩn bị slide Open Day',
  description: '8 trang giới thiệu CLB',
  dueAt: '2026-11-28T17:00:00Z',
  priority: 4,
  position: 1,
  isHidden: false,
  version: 4,
  deletedAt: null,
  assignees: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      fullName: 'Nguyễn Văn A',
      isActive: true,
      leftAt: null,
      avatarUrl: null,
      departments: [],
    },
  ],
  assignedDepartments: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Truyền thông' }],
  creator: {
    id: '66666666-6666-4666-8666-666666666666',
    fullName: 'Lê Văn C',
    isActive: true,
    leftAt: null,
    avatarUrl: null,
    departments: [],
  },
  commentCount: 1,
  createdAt: '2026-11-20T02:00:00Z',
  updatedAt: '2026-11-23T07:30:00Z',
};

const LOOKUP: TaskHistoryLookup = {
  columnsById: new Map([
    ['33333333-3333-4333-8333-333333333333', 'Cần làm'],
    ['77777777-7777-4777-8777-777777777777', 'Đang làm'],
  ]),
  departmentsById: new Map([
    ['55555555-5555-4555-8555-555555555555', 'Truyền thông'],
    ['88888888-8888-4888-8888-888888888888', 'Sự kiện'],
  ]),
  membersById: new Map([
    ['44444444-4444-4444-8444-444444444444', 'Nguyễn Văn A'],
    ['66666666-6666-4666-8666-666666666666', 'Lê Văn C'],
  ]),
};

function makeEvent(overrides: Partial<TaskEventDto>): TaskEventDto {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    taskId: SAMPLE_TASK.id,
    boardId: SAMPLE_TASK.boardId,
    actor: {
      id: '99999999-9999-4999-8999-999999999999',
      fullName: 'Vũ Quốc F',
      isActive: false,
      leftAt: '2026-11-01T00:00:00Z',
      avatarUrl: null,
      departments: [],
    },
    type: 'task.updated',
    changes: { priority: { from: 2, to: 4 } },
    revertsEventId: null,
    forced: false,
    revertable: true,
    createdAt: '2026-11-23T07:30:00Z',
    ...overrides,
  };
}

function renderWithIntl(
  node: ReactNode,
  options: { permissions?: PermissionCode[]; isAdmin?: boolean; locale?: 'vi' | 'en' } = {}
) {
  const locale = options.locale ?? 'vi';
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'vi' ? viMessages : enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>
        {node}
      </PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('E7A-02 Task History, Quick Undo & Board Trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authHooksMock.useMeQuery.mockReturnValue({ data: { profile: { id: 'u-viewer', departments: [] } } });
    boardsHooksMock.useBoardDetailQuery.mockReturnValue({
      data: {
        board: {
          id: SAMPLE_TASK.boardId,
          name: 'Open Day 2026',
          columns: [
            { id: '33333333-3333-4333-8333-333333333333', name: 'Cần làm', orderIndex: 0 },
            { id: '77777777-7777-4777-8777-777777777777', name: 'Đang làm', orderIndex: 1 },
          ],
        },
      },
    });
    tasksHooksMock.useTaskDepartmentsQuery.mockReturnValue({
      data: {
        items: [
          { id: '55555555-5555-4555-8555-555555555555', name: 'Truyền thông' },
          { id: '88888888-8888-4888-8888-888888888888', name: 'Sự kiện' },
        ],
      },
    });
    tasksHooksMock.useTaskAssigneeMembersQuery.mockReturnValue({ data: { items: [] } });
    taskEventsHooksMock.useRevertTaskEventMutation.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
      variables: undefined,
    });
    taskEventsHooksMock.useRestoreBoardTaskMutation.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
      variables: undefined,
    });
    taskEventsHooksMock.useUndoTaskActionToast.mockReturnValue(vi.fn());
  });

  it('formats all 9 event types cleanly in vi & en without leaking raw UUIDs or PII', () => {
    const tHistoryVi = createTranslator({ locale: 'vi', messages: viMessages, namespace: 'taskHistory' });
    const tPrioVi = createTranslator({ locale: 'vi', messages: viMessages, namespace: 'priority' });
    const tHistoryEn = createTranslator({ locale: 'en', messages: enMessages, namespace: 'taskHistory' });
    const tPrioEn = createTranslator({ locale: 'en', messages: enMessages, namespace: 'priority' });

    const cases: Array<{ event: TaskEventDto; vi: string; en: string }> = [
      {
        event: makeEvent({ type: 'task.created', changes: { column_id: '33333333-3333-4333-8333-333333333333' }, revertable: false }),
        vi: 'đã tạo task trong cột “Cần làm”',
        en: 'created the task in “Cần làm”',
      },
      {
        event: makeEvent({
          type: 'task.updated',
          changes: {
            priority: { from: 2, to: 4 },
            due_at: { from: null, to: '2026-11-28T17:00:00Z' },
          },
        }),
        vi: 'đã đổi priority từ Trung bình sang Khẩn',
        en: 'changed priority from Medium to Urgent',
      },
      {
        event: makeEvent({
          type: 'task.moved',
          changes: {
            column_id: { from: '33333333-3333-4333-8333-333333333333', to: '77777777-7777-4777-8777-777777777777' },
          },
        }),
        vi: 'đã chuyển task từ Cần làm sang Đang làm',
        en: 'moved the task from Cần làm to Đang làm',
      },
      {
        event: makeEvent({
          type: 'task.moved',
          changes: {
            column_id: { from: '77777777-7777-4777-8777-777777777777', to: '77777777-7777-4777-8777-777777777777' },
          },
        }),
        vi: 'đã sắp xếp lại vị trí trong cột Đang làm',
        en: 'reordered position in Đang làm',
      },
      {
        event: makeEvent({
          type: 'task.assignees_changed',
          changes: {
            assignee_ids: { from: [], to: ['44444444-4444-4444-8444-444444444444'] },
            department_ids: { from: ['55555555-5555-4555-8555-555555555555'], to: ['88888888-8888-4888-8888-888888888888'] },
          },
        }),
        vi: 'đã giao task cho Nguyễn Văn A',
        en: 'assigned the task to Nguyễn Văn A',
      },
      {
        event: makeEvent({ type: 'task.hidden_changed', changes: { is_hidden: { from: false, to: true } } }),
        vi: 'đã bật cờ ẩn',
        en: 'turned on the hidden flag',
      },
      {
        event: makeEvent({ type: 'task.deleted', changes: { deleted_at: { from: null, to: '2026-11-23T08:00:00Z' } } }),
        vi: 'đã chuyển task vào Thùng rác',
        en: 'moved the task to Trash',
      },
      {
        event: makeEvent({
          type: 'task.restored',
          changes: {
            deleted_at: { from: '2026-11-23T08:00:00Z', to: null },
            column_id: { from: null, to: '77777777-7777-4777-8777-777777777777' },
          },
        }),
        vi: 'đã khôi phục task về cột Đang làm',
        en: 'restored the task to Đang làm',
      },
      {
        event: makeEvent({ type: 'comment.added', changes: { comment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, revertable: false }),
        vi: 'đã bình luận',
        en: 'commented',
      },
      {
        event: makeEvent({ type: 'comment.deleted', changes: { comment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, revertable: false }),
        vi: 'đã xóa một bình luận',
        en: 'deleted a comment',
      },
    ];

    const emptyLookup: TaskHistoryLookup = {
      columnsById: new Map(),
      departmentsById: new Map(),
      membersById: new Map(),
    };

    for (const c of cases) {
      const viText = formatTaskEventSummary({
        event: c.event,
        locale: 'vi',
        lookup: LOOKUP,
        tHistory: tHistoryVi as never,
        tPrio: tPrioVi as never,
      });
      const enText = formatTaskEventSummary({
        event: c.event,
        locale: 'en',
        lookup: LOOKUP,
        tHistory: tHistoryEn as never,
        tPrio: tPrioEn as never,
      });
      expect(viText).toContain(c.vi);
      expect(enText).toContain(c.en);
      expect(viText).not.toMatch(UUID_REGEX);
      expect(enText).not.toMatch(UUID_REGEX);

      const fallbackVi = formatTaskEventSummary({
        event: c.event,
        locale: 'vi',
        lookup: emptyLookup,
        tHistory: tHistoryVi as never,
        tPrio: tPrioVi as never,
      });
      expect(fallbackVi).not.toMatch(UUID_REGEX);
    }
  });

  it('enforces AC-19 revert permission matrix in canActorRevertEvent', () => {
    const noneCan = () => false;
    const only = (...allowed: PermissionCode[]) => (perm: PermissionCode) => allowed.includes(perm);

    // Non-revertable types always false even for admin
    for (const type of ['task.created', 'comment.added', 'comment.deleted']) {
      expect(
        canActorRevertEvent({
          event: { type, revertable: false },
          isAdmin: true,
          can: () => true,
          currentUserId: SAMPLE_TASK.creator.id,
          task: SAMPLE_TASK,
        })
      ).toBe(false);
    }

    // Admin allowed on all revertable types
    for (const type of ['task.updated', 'task.moved', 'task.assignees_changed', 'task.hidden_changed', 'task.deleted', 'task.restored']) {
      expect(
        canActorRevertEvent({
          event: { type, revertable: true },
          isAdmin: true,
          can: noneCan,
          currentUserId: 'u-admin',
          task: SAMPLE_TASK,
        })
      ).toBe(true);
    }

    // task.updated & task.moved
    for (const type of ['task.updated', 'task.moved']) {
      expect(canActorRevertEvent({ event: { type, revertable: true }, isAdmin: false, can: only('task.update_any'), currentUserId: 'u-other', task: SAMPLE_TASK })).toBe(true);
      expect(canActorRevertEvent({ event: { type, revertable: true }, isAdmin: false, can: only('task.update_assigned'), currentUserId: SAMPLE_TASK.assignees[0]!.id, task: SAMPLE_TASK })).toBe(true);
      expect(canActorRevertEvent({ event: { type, revertable: true }, isAdmin: false, can: only('task.update_assigned'), currentUserId: 'u-dept', currentDepartmentIds: [SAMPLE_TASK.assignedDepartments[0]!.id], task: SAMPLE_TASK })).toBe(true);
      expect(canActorRevertEvent({ event: { type, revertable: true }, isAdmin: false, can: only('task.update_assigned'), currentUserId: 'u-stranger', currentDepartmentIds: [], task: SAMPLE_TASK })).toBe(false);
    }

    // task.assignees_changed
    expect(canActorRevertEvent({ event: { type: 'task.assignees_changed', revertable: true }, isAdmin: false, can: only('task.assign'), currentUserId: 'u-other', task: SAMPLE_TASK })).toBe(true);
    expect(canActorRevertEvent({ event: { type: 'task.assignees_changed', revertable: true }, isAdmin: false, can: only('task.update_any'), currentUserId: 'u-other', task: SAMPLE_TASK })).toBe(false);

    // task.hidden_changed -> creator only (or admin)
    expect(canActorRevertEvent({ event: { type: 'task.hidden_changed', revertable: true }, isAdmin: false, can: noneCan, currentUserId: SAMPLE_TASK.creator.id, task: SAMPLE_TASK })).toBe(true);
    expect(canActorRevertEvent({ event: { type: 'task.hidden_changed', revertable: true }, isAdmin: false, can: only('task.update_any'), currentUserId: 'u-other', task: SAMPLE_TASK })).toBe(false);

    // task.deleted & task.restored -> task.delete
    for (const type of ['task.deleted', 'task.restored']) {
      expect(canActorRevertEvent({ event: { type, revertable: true }, isAdmin: false, can: only('task.delete'), currentUserId: 'u-other', task: SAMPLE_TASK })).toBe(true);
      expect(canActorRevertEvent({ event: { type, revertable: true }, isAdmin: false, can: only('task.update_any'), currentUserId: 'u-other', task: SAMPLE_TASK })).toBe(false);
    }
  });

  it('executes quick undo with captured queryClient, invalidates all keys, and handles 409/403/404 errors', async () => {
    expect(TASK_EVENTS_PAGE_SIZE).toBe(15);
    expect(BOARD_TRASH_PAGE_SIZE).toBe(10);
    expect(UNDO_TOAST_DURATION_MS).toBe(10_000);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const messages = {
      success: 'Đã hoàn tác thao tác vừa rồi.',
      conflict: 'Xung đột hoàn tác.',
      errorForKey: (key: string) => `ERR:${key}`,
    };

    apiFetchMock.mockResolvedValueOnce({
      task: SAMPLE_TASK,
      eventId: 'ev-new',
      revertedEventId: 'ev-1',
    });

    await executeQuickUndo({
      queryClient,
      taskId: SAMPLE_TASK.id,
      boardId: SAMPLE_TASK.boardId,
      eventId: 'ev-1',
      messages,
    });

    expect(apiFetchMock).toHaveBeenCalledWith('/tasks/{id}/events/{eventId}/revert', {
      method: 'post',
      params: { id: SAMPLE_TASK.id, eventId: 'ev-1' },
      body: { force: false },
    });
    const keys = invalidateSpy.mock.calls.map(([arg]) => arg?.queryKey);
    expect(keys).toContainEqual(['taskEvents', SAMPLE_TASK.id]);
    expect(keys).toContainEqual(TASKS_QUERY_KEYS.detail(SAMPLE_TASK.id));
    expect(keys).toContainEqual(['boards']);
    expect(keys).toContainEqual(['boardDetail', SAMPLE_TASK.boardId]);
    expect(keys).toContainEqual(TASKS_QUERY_KEYS.boardListRoot);
    expect(keys).toContainEqual(TASKS_QUERY_KEYS.myTasksRoot);
    expect(keys).toContainEqual(['boardTrash', SAMPLE_TASK.boardId]);
    expect(keys).toContainEqual(['archive']);
    expect(keys).toContainEqual(['notifications']);
    expect(toastMock.success).toHaveBeenCalledWith(messages.success);

    const conflictErr = new ApiClientError({
      status: 409,
      code: 'REVERT_CONFLICT',
      messageKey: 'errors.revertConflict',
      details: { conflictingFields: ['priority', 'title'] },
    });
    expect(extractRevertConflictFields(conflictErr)).toEqual(['priority', 'title']);
    apiFetchMock.mockRejectedValueOnce(conflictErr);
    await executeQuickUndo({ queryClient, taskId: SAMPLE_TASK.id, boardId: SAMPLE_TASK.boardId, eventId: 'ev-2', messages });
    expect(toastMock.error).toHaveBeenLastCalledWith(messages.conflict);

    apiFetchMock.mockRejectedValueOnce(
      new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {} })
    );
    await executeQuickUndo({ queryClient, taskId: SAMPLE_TASK.id, boardId: SAMPLE_TASK.boardId, eventId: 'ev-3', messages });
    expect(toastMock.error).toHaveBeenLastCalledWith('ERR:forbidden');

    apiFetchMock.mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: 'TASK_DELETED', messageKey: 'errors.taskDeletedConflict', details: {} })
    );
    await executeQuickUndo({ queryClient, taskId: SAMPLE_TASK.id, boardId: SAMPLE_TASK.boardId, eventId: 'ev-4', messages });
    expect(toastMock.error).toHaveBeenLastCalledWith('ERR:taskDeletedConflict');
  });

  it('useUndoTaskActionToast emits plain toast when eventId is null and 10s Undo action toast when eventId exists', async () => {
    const queryClient = new QueryClient();
    const { useUndoTaskActionToast: realUseUndoToast } = await vi.importActual<
      typeof import('@/features/tasks/hooks/useTaskEvents')
    >('@/features/tasks/hooks/useTaskEvents');
    let capturedShow: ReturnType<typeof useUndoTaskActionToast> | undefined;

    function Probe() {
      capturedShow = realUseUndoToast();
      return null;
    }

    renderWithIntl(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
    expect(capturedShow).toBeTypeOf('function');

    capturedShow!({ message: 'No-op saved', taskId: SAMPLE_TASK.id, boardId: SAMPLE_TASK.boardId, eventId: null });
    expect(toastMock.success).toHaveBeenLastCalledWith('No-op saved');

    apiFetchMock.mockResolvedValueOnce({ task: SAMPLE_TASK, eventId: 'ev-undo-new', revertedEventId: 'ev-9' });
    capturedShow!({ message: 'Đã cập nhật task.', taskId: SAMPLE_TASK.id, boardId: SAMPLE_TASK.boardId, eventId: 'ev-9' });
    const lastCall = toastMock.success.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('Đã cập nhật task.');
    const opts = lastCall?.[1] as { duration: number; action: { label: string; onClick: () => void } };
    expect(opts.duration).toBe(10_000);
    expect(opts.action.label).toBe('Hoàn tác');

    // Triggering twice only invokes one revert request
    opts.action.onClick();
    opts.action.onClick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith('/tasks/{id}/events/{eventId}/revert', {
      method: 'post',
      params: { id: SAMPLE_TASK.id, eventId: 'ev-9' },
      body: { force: false },
    });
  });

  it('renders TaskHistorySection states, inactive actor badge, revert badges, permission gating & pagination without UUID/PII leaks', () => {
    taskEventsHooksMock.useTaskEventsInfiniteQuery.mockReturnValueOnce({
      isPending: true,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const loadingHtml = renderWithIntl(<TaskHistorySection task={SAMPLE_TASK} onTaskDeleted={vi.fn()} />);
    expect(loadingHtml).toContain('Đang tải lịch sử...');

    taskEventsHooksMock.useTaskEventsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({ status: 404, code: 'NOT_FOUND', messageKey: 'errors.notFound', details: {}, requestId: 'req-hist-404' }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const errHtml = renderWithIntl(<TaskHistorySection task={SAMPLE_TASK} onTaskDeleted={vi.fn()} />);
    expect(errHtml).toContain('req-hist-404');

    const revertedForcedEvent = makeEvent({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      type: 'task.updated',
      changes: { priority: { from: 2, to: 4 } },
      revertsEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      forced: true,
      revertable: true,
    });
    const commentEvent = makeEvent({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      type: 'comment.added',
      changes: { comment_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      revertable: false,
    });

    taskEventsHooksMock.useTaskEventsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [revertedForcedEvent, commentEvent], meta: { nextCursor: 'cur-2', limit: 15 } }], pageParams: [undefined] },
    });

    const viewerHtml = renderWithIntl(<TaskHistorySection task={SAMPLE_TASK} onTaskDeleted={vi.fn()} />, {
      permissions: [],
    });
    expect(boardsHooksMock.useBoardDetailQuery).toHaveBeenCalledWith(SAMPLE_TASK.boardId, true);
    expect(tasksHooksMock.useTaskAssigneeMembersQuery).toHaveBeenCalledWith(false);
    expect(viewerHtml).toContain('Vũ Quốc F');
    expect(viewerHtml).toContain('(đã rời)');
    expect(viewerHtml).toContain('14:30');
    expect(viewerHtml).toContain('Hoàn tác');
    expect(viewerHtml).toContain('Ghi đè xung đột');
    expect(viewerHtml).toContain('Xem thêm lịch sử cũ hơn');
    expect(viewerHtml).toContain('Lịch sử chỉ ghi thêm. Không ai sửa hoặc xóa, kể cả admin.');
    expect(viewerHtml).not.toContain('Khôi phục giá trị này');
    expect(viewerHtml).not.toMatch(UUID_REGEX);
    expect(viewerHtml).not.toContain('@eiu.edu.vn');

    const editorHtml = renderWithIntl(<TaskHistorySection task={SAMPLE_TASK} onTaskDeleted={vi.fn()} />, {
      permissions: ['member.view', 'task.update_any'],
      locale: 'en',
    });
    expect(tasksHooksMock.useTaskAssigneeMembersQuery).toHaveBeenCalledWith(true);
    expect(editorHtml).toContain('(left)');
    expect(editorHtml).toContain('Restore this value');
    expect(editorHtml).toContain('Reverted');
    expect(editorHtml).toContain('Forced');
    expect(editorHtml).not.toMatch(UUID_REGEX);
  });

  it('renders TaskRevertConflictModal with all 10 conflict field labels and force confirm button', () => {
    const allFields = [
      'title',
      'description',
      'priority',
      'due_at',
      'column_id',
      'position',
      'assignee_ids',
      'department_ids',
      'is_hidden',
      'deleted_at',
    ];
    const htmlVi = renderWithIntl(
      <TaskRevertConflictModal
        conflict={{ event: makeEvent({}), conflictingFields: allFields }}
        isPending={false}
        error={new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {}, requestId: 'req-force-403' })}
        onClose={vi.fn()}
        onConfirmForce={vi.fn()}
      />
    );
    expect(htmlVi).toContain('Giá trị đã bị thay đổi');
    expect(htmlVi).toContain('Vẫn khôi phục');
    expect(htmlVi).toContain('req-force-403');
    expect(htmlVi).toContain('Tiêu đề');
    expect(htmlVi).toContain('Ban được giao');
    expect(htmlVi).toContain('Trạng thái xóa');

    const htmlEn = renderWithIntl(
      <TaskRevertConflictModal
        conflict={{ event: makeEvent({}), conflictingFields: allFields }}
        isPending={false}
        error={null}
        onClose={vi.fn()}
        onConfirmForce={vi.fn()}
      />,
      { locale: 'en' }
    );
    expect(htmlEn).toContain('Restore anyway');
    expect(htmlEn).toContain('Due date');
    expect(htmlEn).toContain('Deletion status');
  });

  it('renders BoardTrashModal states, column fallback, restore CTA, and /archive footer link', () => {
    taskEventsHooksMock.useBoardTrashInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {}, requestId: 'req-trash-403' }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const forbiddenHtml = renderWithIntl(
      <BoardTrashModal boardId={SAMPLE_TASK.boardId} boardName="Open Day 2026" onClose={vi.fn()} />
    );
    expect(forbiddenHtml).toContain('403');
    expect(forbiddenHtml).toContain('req-trash-403');

    taskEventsHooksMock.useBoardTrashInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [
          {
            items: [
              { ...SAMPLE_TASK, deletedAt: '2026-11-23T07:30:00Z', isHidden: true },
              { ...SAMPLE_TASK, id: 'f1111111-1111-4111-8111-111111111111', title: 'Task mất cột', columnId: null, deletedAt: '2026-11-22T02:00:00Z' },
            ],
            meta: { nextCursor: 'cur-trash-2', limit: 10 },
          },
        ],
        pageParams: [undefined],
      },
    });

    const loadedHtml = renderWithIntl(
      <BoardTrashModal
        boardId={SAMPLE_TASK.boardId}
        boardName="Open Day 2026"
        columns={[{ id: '33333333-3333-4333-8333-333333333333', boardId: SAMPLE_TASK.boardId, name: 'Cần làm', orderIndex: 0, taskCount: 0, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }]}
        onClose={vi.fn()}
      />
    );
    expect(loadedHtml).toContain('Thùng rác · Open Day 2026');
    expect(loadedHtml).toContain('Chuẩn bị slide Open Day');
    expect(loadedHtml).toContain('Task ẩn');
    expect(loadedHtml).toContain('Cột cũ: Cần làm');
    expect(loadedHtml).toContain('Cột cũ đã xóa (sẽ khôi phục vào cột đầu)');
    expect(loadedHtml).toContain('14:30');
    expect(loadedHtml).toContain('Khôi phục');
    expect(loadedHtml).toContain('Tải thêm task đã xóa');
    expect(loadedHtml).toContain('href="/archive"');
    expect(loadedHtml).not.toMatch(UUID_REGEX);
  });
});
