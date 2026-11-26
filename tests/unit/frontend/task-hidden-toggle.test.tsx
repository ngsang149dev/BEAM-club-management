import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const tasksHooksMock = vi.hoisted(() => ({
  useUpdateTaskHiddenMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
}));

const taskEventsHooksMock = vi.hoisted(() => ({
  useUndoTaskActionToast: vi.fn(() => vi.fn()),
}));

const authHooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
}));

vi.mock('@/features/tasks/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTasks')>(
    '@/features/tasks/hooks/useTasks'
  );
  return { ...actual, ...tasksHooksMock };
});

vi.mock('@/features/tasks/hooks/useTaskEvents', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTaskEvents')>(
    '@/features/tasks/hooks/useTaskEvents'
  );
  return { ...actual, ...taskEventsHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', () => authHooksMock);

import {
  canToggleTaskHidden,
  TaskHiddenSection,
} from '@/features/tasks/components/TaskHiddenSection';

type TaskDto = components['schemas']['TaskDto'];

const BASE_TASK: TaskDto = {
  id: 't-1',
  boardId: 'b-1',
  columnId: 'c-1',
  title: 'Chuẩn bị tài liệu nội bộ',
  description: null,
  startAt: null,
  dueAt: null,
  isCompleted: false,
  completedAt: null,
  priority: 2,
  position: 1,
  isHidden: false,
  version: 2,
  deletedAt: null,
  assignees: [],
  assignedDepartments: [],
  deliverables: [],
  deliverableCount: 0,
  creator: { id: 'u-creator', fullName: 'Lê Văn C', isActive: true, leftAt: null, avatarUrl: null, departments: [] },
  commentCount: 0,
  createdAt: '2026-11-20T02:00:00Z',
  updatedAt: '2026-11-20T02:00:00Z',
};

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

describe('TaskHiddenSection (E7-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskEventsHooksMock.useUndoTaskActionToast.mockReturnValue(vi.fn());
    authHooksMock.useMeQuery.mockReturnValue({ data: { profile: { id: 'u-other', departments: [] } } });
    tasksHooksMock.useUpdateTaskHiddenMutation.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
  });

  it('renders ONLY for task creator or admin, never for assignee or task.update_any non-creator', () => {
    expect(canToggleTaskHidden({ isAdmin: false, creatorId: 'u-creator', currentUserId: 'u-creator' })).toBe(true);
    expect(canToggleTaskHidden({ isAdmin: true, creatorId: 'u-creator', currentUserId: 'u-admin' })).toBe(true);
    expect(canToggleTaskHidden({ isAdmin: false, creatorId: 'u-creator', currentUserId: 'u-assignee' })).toBe(false);

    const assignedTask: TaskDto = {
      ...BASE_TASK,
      assignees: [{ id: 'u-assignee', fullName: 'Nguyễn Văn A', isActive: true, leftAt: null, avatarUrl: null, departments: [], acceptedAt: null }],
    };

    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-assignee', departments: [] } } });
    const assigneeHtml = renderWithIntl(<TaskHiddenSection task={assignedTask} onReload={vi.fn()} />, {
      permissions: ['task.update_assigned', 'task.update_any'],
    });
    expect(assigneeHtml).toBe('');

    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-creator', departments: [] } } });
    const creatorHtml = renderWithIntl(<TaskHiddenSection task={assignedTask} onReload={vi.fn()} />);
    expect(creatorHtml).toContain('task-hidden-section');
    expect(creatorHtml).toContain('Công khai');
    expect(creatorHtml).toContain('Ẩn task');
    expect(creatorHtml).toContain('aria-checked="false"');

    const adminHiddenHtml = renderWithIntl(
      <TaskHiddenSection task={{ ...assignedTask, isHidden: true }} onReload={vi.fn()} />,
      { isAdmin: true, locale: 'en' }
    );
    expect(adminHiddenHtml).toContain('Hidden task');
    expect(adminHiddenHtml).toContain('Make public');
    expect(adminHiddenHtml).toContain('aria-checked="true"');
  });

  it('displays WQ-27 warning when task has no assignees or departments, and omits when assigned', () => {
    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-creator', departments: [] } } });
    const unassignedHtml = renderWithIntl(<TaskHiddenSection task={BASE_TASK} onReload={vi.fn()} />);
    expect(unassignedHtml).toContain('Chưa có người hoặc ban được giao');
    expect(unassignedHtml).toContain('chỉ bạn (người tạo) và admin mới xem được task này');

    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-creator', departments: [] } } });
    const deptAssignedHtml = renderWithIntl(
      <TaskHiddenSection
        task={{ ...BASE_TASK, assignedDepartments: [{ id: 'd-1', name: 'Truyền thông' }] }}
        onReload={vi.fn()}
      />
    );
    expect(deptAssignedHtml).not.toContain('Chưa có người hoặc ban được giao');
  });

  it('renders 409 TASK_VERSION_CONFLICT inline error and reload trigger cleanly', () => {
    tasksHooksMock.useUpdateTaskHiddenMutation.mockReturnValueOnce({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: new ApiClientError({
        status: 409,
        code: 'TASK_VERSION_CONFLICT',
        messageKey: 'errors.taskVersionConflict',
        details: {},
        requestId: 'req-hide-409',
      }),
    });
    const html = renderWithIntl(<TaskHiddenSection task={BASE_TASK} onReload={vi.fn()} />, { isAdmin: true });
    expect(html).toContain('Task này vừa được người khác cập nhật.');
    expect(html).toContain('Tải lại dữ liệu mới');
    expect(html).toContain('req-hide-409');
  });
});
