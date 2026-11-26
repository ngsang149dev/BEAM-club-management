import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const boardsHooksMock = vi.hoisted(() => ({
  useBoardDetailQuery: vi.fn(),
  useCreateColumnMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useRenameColumnMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteColumnMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReorderColumnsMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const tasksHooksMock = vi.hoisted(() => ({
  useBoardFilteredTasksQuery: vi.fn(),
  useTaskDetailQuery: vi.fn(),
  useTaskAssigneeMembersQuery: vi.fn(),
  useTaskDepartmentsQuery: vi.fn(),
  useCreateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
  useMoveTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReplaceTaskAssigneesMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateTaskHiddenMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const commentsHooksMock = vi.hoisted(() => ({
  useTaskCommentsInfiniteQuery: vi.fn(),
  useCreateCommentMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteCommentMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const taskEventsHooksMock = vi.hoisted(() => ({
  useTaskEventsInfiniteQuery: vi.fn(),
  useRevertTaskEventMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null, variables: undefined })),
  useBoardTrashInfiniteQuery: vi.fn(),
  useRestoreBoardTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null, variables: undefined })),
  useUndoTaskActionToast: vi.fn(() => vi.fn()),
}));

const authHooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: navigationMock.replace,
    refresh: vi.fn(),
  }),
  useSearchParams: () => navigationMock.searchParams,
}));

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

vi.mock('@/features/comments/hooks/useComments', async () => {
  const actual = await vi.importActual<typeof import('@/features/comments/hooks/useComments')>(
    '@/features/comments/hooks/useComments'
  );
  return { ...actual, ...commentsHooksMock };
});

vi.mock('@/features/tasks/hooks/useTaskEvents', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTaskEvents')>(
    '@/features/tasks/hooks/useTaskEvents'
  );
  return { ...actual, ...taskEventsHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', () => authHooksMock);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { BoardDetailView } from '@/features/boards/components/BoardDetailView';
import { BoardTaskCardView } from '@/features/boards/components/BoardTaskCard';
import { ColumnDeleteModal } from '@/features/boards/components/ColumnModals';
import { CreateTaskModal, buildCreateTaskRequestPayload } from '@/features/tasks/components/CreateTaskModal';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { buildReplaceTaskAssigneesPayload } from '@/features/tasks/components/TaskDrawerSections';
import { TaskNotificationOptions } from '@/features/tasks/components/TaskNotificationOptions';

type BoardDetailDto = components['schemas']['BoardDetailDto'];
type TaskDto = components['schemas']['TaskDto'];

const COL_TODO = { id: 'c-1', boardId: 'b-1', name: 'Todo', orderIndex: 0, taskCount: 2, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
const COL_DONE = { id: 'c-2', boardId: 'b-1', name: 'Done', orderIndex: 1, taskCount: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };

const TASK_URGENT_HIDDEN: TaskDto = {
  id: 't-1', boardId: 'b-1', columnId: 'c-1', title: 'Chuẩn bị slide giới thiệu',
  description: 'Chi tiết slide', dueAt: '2025-01-10T05:00:00Z', priority: 4, position: 1,
  isHidden: true, version: 3, deletedAt: null,
  assignees: [{ id: 'u-inactive', fullName: 'Vu Quoc F', isActive: false, leftAt: '2026-10-01T00:00:00Z', departments: [] }],
  assignedDepartments: [],
  creator: { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  commentCount: 2, createdAt: '2026-11-20T02:00:00Z', updatedAt: '2026-11-20T02:00:00Z',
};

const TASK_LOW: TaskDto = {
  id: 't-2', boardId: 'b-1', columnId: 'c-1', title: 'Mượn micro', description: null,
  dueAt: null, priority: 1, position: 2, isHidden: false, version: 1, deletedAt: null,
  assignees: [], assignedDepartments: [], creator: { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  commentCount: 0, createdAt: '2026-11-20T03:00:00Z', updatedAt: '2026-11-20T03:00:00Z',
};

const BOARD_DETAIL: BoardDetailDto = {
  id: 'b-1', name: 'Open Day 2026', department: { id: 'd-1', name: 'Sự kiện' }, archivedAt: null,
  createdBy: { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  columns: [COL_DONE, COL_TODO], tasks: [TASK_LOW, TASK_URGENT_HIDDEN],
  visibleTaskCount: 2, overdueTaskCount: 1,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
};

function renderWithIntl(node: ReactNode, options: { permissions?: PermissionCode[]; isAdmin?: boolean; locale?: 'vi' | 'en' } = {}) {
  const locale = options.locale ?? 'vi';
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>{node}</PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('BoardDetailView (S04), ColumnModals & TaskDetailDrawer (S05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMock.searchParams = new URLSearchParams();
    authHooksMock.useMeQuery.mockReturnValue({ data: { profile: { id: 'u-viewer', departments: [] } } });
    boardsHooksMock.useBoardDetailQuery.mockReturnValue({ isPending: false, isError: false, error: null, data: { board: BOARD_DETAIL } });
    tasksHooksMock.useBoardFilteredTasksQuery.mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      data: { items: [], meta: { nextCursor: null, limit: 100 } },
    });
    tasksHooksMock.useTaskAssigneeMembersQuery.mockReturnValue({ isPending: false, isError: false, data: { items: [] } });
    tasksHooksMock.useTaskDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: [
          { id: 'd-1', name: 'Sự kiện', memberCount: 4, boardCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
          { id: 'd-2', name: 'Truyền thông', memberCount: 3, boardCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        ],
      },
    });
    tasksHooksMock.useTaskDetailQuery.mockReturnValue({ isPending: false, isError: false, error: null, refetch: vi.fn(), data: { task: TASK_URGENT_HIDDEN } });
    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 20 } }], pageParams: [undefined] },
    });
    taskEventsHooksMock.useTaskEventsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 15 } }], pageParams: [undefined] },
    });
    taskEventsHooksMock.useBoardTrashInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 10 } }], pageParams: [undefined] },
    });
    taskEventsHooksMock.useUndoTaskActionToast.mockReturnValue(vi.fn());
  });

  it('orders columns by orderIndex, shows priority 1..4, hidden/overdue/left badges, and gates column/task buttons & DnD handles', () => {
    const viewerHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['member.view'] });
    expect(viewerHtml).toContain('board-detail-stack');
    expect(viewerHtml.indexOf('Todo')).toBeLessThan(viewerHtml.indexOf('Done'));
    expect(viewerHtml).toContain('Khẩn');
    expect(viewerHtml).toContain('Thấp');
    expect(viewerHtml).toContain('prio-p4');
    expect(viewerHtml).toContain('is-overdue');
    expect(viewerHtml).toContain('Task ẩn');
    expect(viewerHtml).toContain('Quá hạn');
    expect(viewerHtml).toContain('Vu Quoc F (đã rời)');
    expect(viewerHtml).not.toContain('Thêm cột');
    expect(viewerHtml).not.toContain('Thùng rác');
    expect(viewerHtml).not.toContain('Thêm task');
    expect(viewerHtml).not.toContain('Kéo để sắp xếp cột');
    expect(viewerHtml).not.toContain('Kéo task để di chuyển');
    expect(viewerHtml).not.toContain('Tùy chọn cột');

    const editorHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['board.update', 'task.create', 'task.delete'], locale: 'en' });
    expect(editorHtml).toContain('Add column');
    expect(editorHtml).toContain('Trash');
    expect(editorHtml).toContain('Add task');
    expect(editorHtml).toContain('Urgent');
    expect(editorHtml).toContain('Vu Quoc F (left)');
    expect(editorHtml).toContain('Drag to reorder column');
    expect(editorHtml).toContain('Column options');
    expect(editorHtml).not.toContain('Drag task to move');

    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-inactive' } } });
    const assignedDragHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['task.update_assigned'] });
    const dragHandles = assignedDragHtml.match(/class="kanban-drag-handle"/g) ?? [];
    expect(dragHandles).toHaveLength(1);
    expect(assignedDragHtml).toContain('Kéo task để di chuyển');
    expect(assignedDragHtml).toContain('kanban-card prio-p4 is-overdue is-hidden is-draggable');
    expect(assignedDragHtml).toContain('<article class="kanban-card prio-p1"><div class="kanban-card-top">');
  });

  it('renders 409 COLUMN_NOT_EMPTY banner with requestId in ColumnDeleteModal (WQ-05)', () => {
    const html = renderWithIntl(
      <ColumnDeleteModal
        column={COL_TODO}
        isDeleting={false}
        error={new ApiClientError({ status: 409, code: 'COLUMN_NOT_EMPTY', messageKey: 'errors.columnNotEmpty', details: {}, requestId: 'req-col-409' })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(html).toContain('Không thể xóa cột vì vẫn còn task đang hoạt động trong cột này.');
    expect(html).toContain('Cột này đang hiển thị 2 task');
    expect(html).toContain('req-col-409');
  });

  it('renders TaskDetailDrawer 404 state cleanly and respects edit/assign/delete permissions', () => {
    tasksHooksMock.useTaskDetailQuery.mockReturnValueOnce({
      isPending: false, isError: true, refetch: vi.fn(), data: undefined,
      error: new ApiClientError({ status: 404, code: 'NOT_FOUND', messageKey: 'errors.notFound', details: {}, requestId: 'req-404' }),
    });
    const notFoundHtml = renderWithIntl(<TaskDetailDrawer taskId="t-hidden" onClose={vi.fn()} />);
    expect(notFoundHtml).toContain('404');
    expect(notFoundHtml).toContain('req-404');

    const readOnlyHtml = renderWithIntl(<TaskDetailDrawer taskId="t-1" onClose={vi.fn()} />, { permissions: ['task.update_assigned'] });
    expect(readOnlyHtml).toContain('Bạn chỉ có quyền xem task này.');
    expect(readOnlyHtml).not.toContain('Lưu thay đổi');

    authHooksMock.useMeQuery.mockReturnValueOnce({ data: { profile: { id: 'u-inactive' } } });
    const assignedEditHtml = renderWithIntl(<TaskDetailDrawer taskId="t-1" onClose={vi.fn()} />, { permissions: ['task.update_assigned', 'task.assign', 'task.delete'] });
    expect(assignedEditHtml).toContain('ui-drawer ui-drawer-task');
    expect(assignedEditHtml).toContain('task-drawer-grid');
    expect(assignedEditHtml).toContain('task-drawer-col-main');
    expect(assignedEditHtml).toContain('task-drawer-col-side');
    expect(assignedEditHtml).toContain('task-assigned-summary');
    expect(assignedEditHtml).toContain('rows="6"');
    expect(assignedEditHtml).toContain('Lưu thay đổi');
    expect(assignedEditHtml).toContain('type="date"');
    expect(assignedEditHtml).toContain('Bạn không có quyền xem danh sách thành viên.');
    expect(assignedEditHtml).toContain('Tùy chọn gửi thông báo');
    expect(assignedEditHtml).toContain('Thông báo trên web');
    expect(assignedEditHtml).toContain('Gửi email');
    expect(assignedEditHtml).toContain('Cập nhật giao việc');
    expect(assignedEditHtml).toContain('Xóa task');
    expect(assignedEditHtml).toContain('task-drawer-tabs');
    expect(assignedEditHtml).toContain('role="tablist"');
    expect(assignedEditHtml).toContain('Chi tiết');
    expect(assignedEditHtml).toContain('Bình luận');
    expect(assignedEditHtml).toContain('Lịch sử');
    expect(assignedEditHtml).toContain('task-comments-jump-chip');
    expect(assignedEditHtml).not.toContain('task-comments-section');
    expect(assignedEditHtml).not.toContain('task-history-section');
    expect(assignedEditHtml).not.toContain('task-hidden-section');

    const creatorDrawerHtml = renderWithIntl(<TaskDetailDrawer taskId="t-1" onClose={vi.fn()} />, { isAdmin: true, locale: 'en' });
    expect(creatorDrawerHtml).toContain('task-hidden-section');
    expect(creatorDrawerHtml).toContain('task-drawer-tabs');
    expect(creatorDrawerHtml).toContain('History');
    expect(creatorDrawerHtml).not.toContain('task-comments-section');

    tasksHooksMock.useTaskAssigneeMembersQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      data: { items: [{ id: 'u-active', fullName: 'Nguyen Van A', isActive: true, leftAt: null, departments: [] }] },
    });
    const pickerHtml = renderWithIntl(<TaskDetailDrawer taskId="t-1" onClose={vi.fn()} />, {
      permissions: ['task.assign', 'member.view'],
    });
    expect(pickerHtml).toContain('Nguyen Van A');
    expect(pickerHtml).toContain('Vu Quoc F (đã rời)');
    expect(pickerHtml).toContain('checked=""');
  });

  it('renders 409 TASK_VERSION_CONFLICT reload banner cleanly', () => {
    tasksHooksMock.useUpdateTaskMutation.mockReturnValueOnce({
      mutate: vi.fn(), reset: vi.fn(), isPending: false,
      error: new ApiClientError({ status: 409, code: 'TASK_VERSION_CONFLICT', messageKey: 'errors.taskVersionConflict', details: {}, requestId: 'req-v-409' }),
    });
    const html = renderWithIntl(<TaskDetailDrawer taskId="t-1" onClose={vi.fn()} />, { isAdmin: true });
    expect(html).toContain('Task này vừa được người khác cập nhật.');
    expect(html).toContain('Tải lại dữ liệu mới');
    expect(html).toContain('req-v-409');
  });

  it('renders prominent department chips, department-based DnD/edit access, ?task drawer open, and CreateTaskModal department-first layout', () => {
    const deptTask: TaskDto = {
      ...TASK_LOW,
      assignedDepartments: [{ id: 'd-2', name: 'Truyền thông' }],
    };
    boardsHooksMock.useBoardDetailQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      data: { board: { ...BOARD_DETAIL, tasks: [deptTask] } },
    });
    authHooksMock.useMeQuery.mockReturnValueOnce({
      data: { profile: { id: 'u-dept-member', departments: [{ id: 'd-2', name: 'Truyền thông' }] } },
    });
    const boardHtml = renderWithIntl(
      <BoardDetailView boardId="b-1" initialTaskId="t-1" />,
      { permissions: ['task.update_assigned'] }
    );
    expect(boardHtml).toContain('task-dept-chip');
    expect(boardHtml).toContain('Truyền thông');
    expect(boardHtml).toContain('is-draggable');
    expect(boardHtml).toContain('Chi tiết task');

    tasksHooksMock.useTaskDetailQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { task: deptTask },
    });
    authHooksMock.useMeQuery.mockReturnValueOnce({
      data: { profile: { id: 'u-dept-member', departments: [{ id: 'd-2', name: 'Truyền thông' }] } },
    });
    const deptDrawerHtml = renderWithIntl(
      <TaskDetailDrawer taskId="t-2" onClose={vi.fn()} />,
      { permissions: ['task.update_assigned', 'task.assign'] }
    );
    expect(deptDrawerHtml).toContain('Lưu thay đổi');
    expect(deptDrawerHtml).toContain('task-dept-chip');
    expect(deptDrawerHtml).toContain('Ban được giao');
    expect(deptDrawerHtml).toContain('Giao cho ban');
    expect(deptDrawerHtml).toContain('task-notify-card');
    expect(deptDrawerHtml).toContain('Tùy chọn gửi thông báo');
    expect(deptDrawerHtml).toContain('Thông báo trên web');
    expect(deptDrawerHtml).toContain('Gửi email');
    expect(deptDrawerHtml).not.toContain('Gửi thông báo &amp; email cho thành viên của ban');
    expect(deptDrawerHtml).toContain('class="task-individual-details"');
    expect(deptDrawerHtml).toContain('ui-btn secondary');
    expect(deptDrawerHtml).toContain('Cập nhật giao việc');

    authHooksMock.useMeQuery.mockReturnValueOnce({
      data: { profile: { id: 'u-dept-member', departments: [{ id: 'd-2', name: 'Truyền thông' }] } },
    });
    const deptDrawerEnHtml = renderWithIntl(
      <TaskDetailDrawer taskId="t-2" onClose={vi.fn()} />,
      { permissions: ['task.update_assigned', 'task.assign'], locale: 'en' }
    );
    expect(deptDrawerEnHtml).toContain('Assigned departments');
    expect(deptDrawerEnHtml).toContain('Notification options');
    expect(deptDrawerEnHtml).toContain('Web notification');
    expect(deptDrawerEnHtml).toContain('Send email');
    expect(deptDrawerEnHtml).toContain('Update assignments');

    const createModalVi = renderWithIntl(
      <CreateTaskModal boardId="b-1" columnId="c-1" columnName="Todo" onClose={vi.fn()} />,
      { permissions: ['task.create', 'task.assign'] }
    );
    expect(createModalVi).toContain('ui-modal ui-modal-lg');
    expect(createModalVi).toContain('rows="6"');
    expect(createModalVi.indexOf('Giao cho ban')).toBeLessThan(
      createModalVi.indexOf('Giao thêm cho từng thành viên')
    );
    expect(createModalVi.indexOf('Giao thêm cho từng thành viên')).toBeLessThan(
      createModalVi.indexOf('Tùy chọn gửi thông báo')
    );
    expect(createModalVi).toContain('Thông báo trên web');
    expect(createModalVi).toContain('Gửi email');
    expect(createModalVi.match(/task-notify-option is-checked/g) ?? []).toHaveLength(2);
    expect(createModalVi).toContain('Sự kiện');
    expect(createModalVi).toContain('Truyền thông');
    expect(createModalVi).not.toContain('class="task-individual-details" open');

    const createModalEn = renderWithIntl(
      <CreateTaskModal boardId="b-1" columnId="c-1" columnName="Todo" onClose={vi.fn()} />,
      { permissions: ['task.create', 'task.assign'], locale: 'en' }
    );
    expect(createModalEn).toContain('Assign to departments');
    expect(createModalEn).toContain('Notification options');
    expect(createModalEn).toContain('Web notification');
    expect(createModalEn).toContain('Send email');
    expect(createModalEn).toContain('Assign individual members');

    const notifySplitHtml = renderWithIntl(
      <TaskNotificationOptions
        notifyInApp
        onToggleNotifyInApp={vi.fn()}
        notifyEmail={false}
        onToggleNotifyEmail={vi.fn()}
      />
    );
    expect(notifySplitHtml.match(/task-notify-option is-checked/g) ?? []).toHaveLength(1);

    expect(
      buildCreateTaskRequestPayload({
        boardId: 'b-1',
        columnId: 'c-1',
        values: { title: '  Chuẩn bị poster  ', description: '  Khổ A3  ', dueAtInput: '', priority: 3, isHidden: false },
        canAssign: true,
        assigneeIds: ['u-1'],
        departmentIds: ['d-2'],
        notifyInApp: true,
        notifyEmail: false,
      })
    ).toEqual({
      boardId: 'b-1',
      columnId: 'c-1',
      title: 'Chuẩn bị poster',
      description: 'Khổ A3',
      dueAt: null,
      priority: 3,
      assigneeIds: ['u-1'],
      departmentIds: ['d-2'],
      notifyInApp: true,
      notifyEmail: false,
      notifyDepartmentMembers: true,
      isHidden: false,
    });

    expect(
      buildCreateTaskRequestPayload({
        boardId: 'b-1',
        columnId: 'c-1',
        values: { title: 'Silent', description: '', dueAtInput: '', priority: 2, isHidden: false },
        canAssign: true,
        assigneeIds: ['u-1'],
        departmentIds: [],
        notifyInApp: false,
        notifyEmail: false,
      })
    ).toMatchObject({
      notifyInApp: false,
      notifyEmail: false,
      notifyDepartmentMembers: false,
    });

    expect(
      buildCreateTaskRequestPayload({
        boardId: 'b-1',
        columnId: 'c-1',
        values: { title: 'No Assign Perm', description: '', dueAtInput: '', priority: 2, isHidden: false },
        canAssign: false,
        assigneeIds: ['u-1'],
        departmentIds: ['d-2'],
        notifyInApp: true,
        notifyEmail: true,
      })
    ).toMatchObject({
      assigneeIds: [],
      departmentIds: [],
      notifyInApp: false,
      notifyEmail: false,
      notifyDepartmentMembers: false,
    });

    expect(
      buildReplaceTaskAssigneesPayload({
        assigneeIds: ['u-1'],
        departmentIds: ['d-1', 'd-2'],
        notifyInApp: false,
        notifyEmail: true,
        version: 4,
      })
    ).toEqual({
      assigneeIds: ['u-1'],
      departmentIds: ['d-1', 'd-2'],
      notifyInApp: false,
      notifyEmail: true,
      notifyDepartmentMembers: true,
      version: 4,
    });

    expect(
      buildReplaceTaskAssigneesPayload({
        assigneeIds: ['u-1'],
        departmentIds: ['d-1'],
        canViewMembers: false,
        notifyInApp: false,
        notifyEmail: false,
        version: 5,
      })
    ).toEqual({
      departmentIds: ['d-1'],
      notifyInApp: false,
      notifyEmail: false,
      notifyDepartmentMembers: false,
      version: 5,
    });
  });

  it('renders BoardFilterBar, gates assignee filter by member.view, pauses DnD with banner, and filters columns', () => {
    const noMemberViewHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['task.create'] });
    expect(noMemberViewHtml).toContain('board-filter-bar');
    expect(noMemberViewHtml).toContain('Tìm theo tiêu đề hoặc mô tả...');
    expect(noMemberViewHtml).not.toContain('Lọc theo người được giao');
    expect(tasksHooksMock.useTaskAssigneeMembersQuery).toHaveBeenCalledWith(false);
    expect(noMemberViewHtml).not.toContain('board-dnd-notice');

    tasksHooksMock.useTaskAssigneeMembersQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: [{ id: 'u-1', fullName: 'Nguyen Van A', isActive: true, leftAt: null, departments: [] }],
      },
    });
    navigationMock.searchParams = new URLSearchParams('priority=4&columnId=c-1&sortBy=dueAt&sortOrder=desc');
    tasksHooksMock.useBoardFilteredTasksQuery.mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      data: { items: [TASK_URGENT_HIDDEN], meta: { nextCursor: null, limit: 100 } },
    });

    const filteredHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, {
      permissions: ['member.view', 'task.update_any'],
      locale: 'en',
    });
    expect(tasksHooksMock.useTaskAssigneeMembersQuery).toHaveBeenCalledWith(true);
    expect(tasksHooksMock.useBoardFilteredTasksQuery).toHaveBeenCalledWith(
      'b-1',
      expect.objectContaining({ priority: 4, columnId: 'c-1', sortBy: 'dueAt', sortOrder: 'desc' }),
      true
    );
    expect(filteredHtml).toContain('Filter by assignee');
    expect(filteredHtml).toContain('Nguyen Van A');
    expect(filteredHtml).toContain('board-dnd-notice');
    expect(filteredHtml).toContain('Drag-and-drop is paused while filtering or sorting.');
    expect(filteredHtml).toContain('Reset to default');
    expect(filteredHtml).not.toContain('class="kanban-drag-handle"');
    expect(filteredHtml).toContain('aria-label="Todo"');
    expect(filteredHtml).not.toContain('aria-label="Done"');
    expect(filteredHtml).toContain('1 tasks');
    expect(filteredHtml).toContain('Move to column…');
  });

  it('suppresses overdue warning styling on Done column cards and exposes Move to column… menu per move permission', () => {
    const overdueTaskInDone: TaskDto = {
      ...TASK_URGENT_HIDDEN,
      id: 't-done-overdue',
      columnId: 'c-2',
      title: 'Hoàn tất tổng kết',
      isHidden: false,
    };
    boardsHooksMock.useBoardDetailQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      data: { board: { ...BOARD_DETAIL, tasks: [overdueTaskInDone] } },
    });
    const doneHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['task.update_any'] });
    expect(doneHtml).toContain('Hoàn tất tổng kết');
    expect(doneHtml).toContain('ui-due is-done');
    expect(doneHtml).not.toContain('kanban-card prio-p4 is-overdue');
    expect(doneHtml).not.toContain('ui-due is-overdue');
    expect(doneHtml).not.toContain('Quá hạn ·');
    expect(doneHtml).toContain('Chuyển tới cột…');
    expect(doneHtml).toContain('Tùy chọn task');

    boardsHooksMock.useBoardDetailQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      data: { board: { ...BOARD_DETAIL, tasks: [overdueTaskInDone] } },
    });
    const readOnlyBoardHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['member.view'] });
    expect(readOnlyBoardHtml).not.toContain('Chuyển tới cột…');
    expect(readOnlyBoardHtml).not.toContain('Tùy chọn task');

    const cardHtml = renderWithIntl(
      <BoardTaskCardView
        task={TASK_URGENT_HIDDEN}
        canMove
        canDrag={false}
        columns={[COL_TODO, COL_DONE]}
        onMoveToColumn={vi.fn()}
      />
    );
    expect(cardHtml).toContain('Chuyển tới cột…');
    expect(cardHtml).toContain('Done');
    expect(cardHtml).not.toContain('Todo</button>');
  });
});
