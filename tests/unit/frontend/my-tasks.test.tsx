import type { ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider } from '@/features/shared/permissions/can';

const tasksHooksMock = vi.hoisted(() => ({
  useMyTasksInfiniteQuery: vi.fn(),
  useTaskDepartmentsQuery: vi.fn(() => ({
    isPending: false,
    isError: false,
    data: {
      items: [
        { id: 'd-comm', name: 'Truyền thông', lead: null, memberCount: 4, boardCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ],
    },
  })),
  useTaskDetailQuery: vi.fn(() => ({ isPending: false, isError: false, error: null, data: undefined, refetch: vi.fn() })),
  useTaskAssigneeMembersQuery: vi.fn(() => ({ isPending: false, isError: false, data: { items: [] } })),
  useUpdateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReplaceTaskAssigneesMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

vi.mock('@/features/tasks/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTasks')>(
    '@/features/tasks/hooks/useTasks'
  );
  return { ...actual, ...tasksHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMeQuery: vi.fn(() => ({ data: { profile: { id: 'u-me' } } })),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { MyTasksView } from '@/features/tasks/components/MyTasksView';
import { describeTaskError } from '@/features/tasks/error-mapping';
import { buildDeleteTaskMutationOptions, TASKS_QUERY_KEYS } from '@/features/tasks/hooks/useTasks';
import {
  formatTaskDateTime,
  getTaskDueUrgency,
  hoChiMinhInputToUtcIso,
  isTaskOverdue,
  utcIsoToHoChiMinhInput,
} from '@/features/tasks/formatters';

type TaskDto = components['schemas']['TaskDto'];

const MY_TASK_1: TaskDto = {
  id: 't-100',
  boardId: 'b-1',
  columnId: 'c-1',
  title: 'Viết kịch bản MC',
  description: null,
  startAt: null,
  dueAt: '2025-02-01T10:00:00Z',
  isCompleted: false,
  completedAt: null,
  priority: 4,
  position: 1,
  isHidden: true,
  version: 1,
  deletedAt: null,
  assignees: [{ id: 'u-me', fullName: 'Nguyen Van A', isActive: true, leftAt: null, departments: [], acceptedAt: null }],
  assignedDepartments: [{ id: 'd-comm', name: 'Truyền thông' }],
  deliverables: [],
  deliverableCount: 0,
  creator: { id: 'u-c', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  commentCount: 3,
  createdAt: '2026-11-20T01:00:00Z',
  updatedAt: '2026-11-20T01:00:00Z',
};

function renderMyTasks(locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      <PermissionsProvider isAdmin={false} permissions={['task.update_assigned']}>
        <MyTasksView />
      </PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('MyTasksView (S06) & task formatters', () => {
  beforeEach(() => {
    tasksHooksMock.useMyTasksInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [MY_TASK_1], meta: { nextCursor: 'cur-next', limit: 20 } }] },
    });
  });

  it('calls /me/tasks with includeDone=false and departmentId="" by default (WQ-03) and renders deadline tier, acceptance, deliverables, and Load more without Priority UI', () => {
    const html = renderMyTasks('vi');
    expect(tasksHooksMock.useMyTasksInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({ includeDone: false, deadlineFilter: '', departmentId: '' }),
      true
    );
    expect(html).toContain('Hiện cả task đã hoàn thành');
    expect(html).toContain('Lọc theo ban');
    expect(html).toContain('Tất cả ban');
    expect(html).toContain('Lọc theo hạn');
    expect(html).toContain('Mọi hạn');
    expect(html).toContain('task-dept-chip');
    expect(html).toContain('Truyền thông');
    expect(html).toContain('Viết kịch bản MC');
    expect(html).toContain('deadline-overdue');
    expect(html).toContain('task-accept-pill');
    expect(html).toContain('0 SP');
    expect(html).not.toContain('prio-p4');
    expect(html).not.toContain('Khẩn');
    expect(html).toContain('Task ẩn');
    expect(html).toContain('Quá hạn');
    expect(html).toContain('Tải thêm task');
  });

  it('renders English copy, empty state with /tasks link, and error state with requestId cleanly', () => {
    expect(renderMyTasks('en')).toContain('Show completed tasks');

    tasksHooksMock.useMyTasksInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 20 } }] },
    });
    const emptyHtml = renderMyTasks('vi');
    expect(emptyHtml).toContain('Bạn chưa có task nào khớp bộ lọc');
    expect(emptyHtml).toContain('href="/tasks"');

    tasksHooksMock.useMyTasksInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({ status: 400, code: 'INVALID_CURSOR', messageKey: 'errors.invalidCursor', details: {}, requestId: 'req-mt-400' }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const errHtml = renderMyTasks('vi');
    expect(errHtml).toContain('Không tải được danh sách task của bạn.');
    expect(errHtml).toContain('req-mt-400');
  });

  it('converts Asia/Ho_Chi_Minh timestamps and maps task API errors accurately', () => {
    expect(formatTaskDateTime('2026-11-23T07:30:00Z', 'vi')).toContain('14:30');
    expect(utcIsoToHoChiMinhInput('2026-11-22T17:00:00Z')).toBe('2026-11-23');
    expect(utcIsoToHoChiMinhInput('2026-11-23T17:00:00Z')).toBe('2026-11-24');
    expect(hoChiMinhInputToUtcIso('2026-11-23')).toBe('2026-11-22T17:00:00.000Z');
    expect(hoChiMinhInputToUtcIso('2026-11-23T14:30')).toBe('2026-11-23T07:30:00.000Z');
    expect(hoChiMinhInputToUtcIso('')).toBeNull();
    expect(isTaskOverdue('2026-11-23T07:00:00Z', Date.parse('2026-11-23T08:00:00Z'))).toBe(true);
    const nowMs = Date.parse('2026-11-24T03:00:00Z'); // 10:00 UTC+7
    expect(getTaskDueUrgency(null, nowMs)).toBe('none');
    expect(getTaskDueUrgency('not-a-date', nowMs)).toBe('none');
    expect(getTaskDueUrgency('2026-11-24T02:00:00Z', nowMs)).toBe('overdue');
    expect(getTaskDueUrgency('2026-11-24T12:00:00Z', nowMs)).toBe('today'); // 19:00 UTC+7 same VN day
    expect(getTaskDueUrgency('2026-11-25T12:00:00Z', nowMs)).toBe('soon'); // within 48h
    expect(getTaskDueUrgency('2026-11-28T12:00:00Z', nowMs)).toBe('upcoming');
    expect(
      describeTaskError(
        new ApiClientError({ status: 400, code: 'INVALID_ASSIGNEE_IDS', messageKey: 'errors.invalidAssigneeIds', details: {}, requestId: 'req-a' })
      )
    ).toEqual({ key: 'invalidAssigneeIds', requestId: 'req-a' });
    expect(
      describeTaskError(
        new ApiClientError({ status: 400, code: 'INVALID_DEPARTMENT_IDS', messageKey: 'errors.invalidDepartmentIds', details: {}, requestId: 'req-d' })
      )
    ).toEqual({ key: 'invalidDepartmentIds', requestId: 'req-d' });
  });

  it('prevents 404 detail refetch when deleting a task via useDeleteTaskMutation cache lifecycle', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(TASKS_QUERY_KEYS.detail(MY_TASK_1.id), { task: MY_TASK_1 });
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    const opts = buildDeleteTaskMutationOptions(queryClient);
    await opts.onMutate(MY_TASK_1.id);
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: TASKS_QUERY_KEYS.detail(MY_TASK_1.id) });

    await opts.onSuccess({ task: MY_TASK_1, eventId: 'ev-del-1' });
    const invalidatedKeys = invalidateSpy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidatedKeys).toContainEqual(['boards']);
    expect(invalidatedKeys).toContainEqual(['boardDetail', MY_TASK_1.boardId]);
    expect(invalidatedKeys).toContainEqual(TASKS_QUERY_KEYS.myTasksRoot);
    expect(invalidatedKeys).not.toContainEqual(TASKS_QUERY_KEYS.detail(MY_TASK_1.id));

    opts.onSettled(undefined, new Error('conflict'), MY_TASK_1.id);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(TASKS_QUERY_KEYS.detail(MY_TASK_1.id))).toBeDefined();

    opts.onSettled({ task: MY_TASK_1, eventId: 'ev-del-1' }, null, MY_TASK_1.id);
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: TASKS_QUERY_KEYS.detail(MY_TASK_1.id), exact: true });
    expect(queryClient.getQueryData(TASKS_QUERY_KEYS.detail(MY_TASK_1.id))).toBeUndefined();
  });
});
