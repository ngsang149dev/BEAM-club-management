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
  useTaskDetailQuery: vi.fn(),
  useTaskAssigneeMembersQuery: vi.fn(),
  useCreateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
  useMoveTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReplaceTaskAssigneesMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const authHooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
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

vi.mock('@/features/auth/hooks/useAuth', () => authHooksMock);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { BoardDetailView } from '@/features/boards/components/BoardDetailView';
import { ColumnDeleteModal } from '@/features/boards/components/ColumnModals';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';

type BoardDetailDto = components['schemas']['BoardDetailDto'];
type TaskDto = components['schemas']['TaskDto'];

const COL_TODO = { id: 'c-1', boardId: 'b-1', name: 'Todo', orderIndex: 0, taskCount: 2, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
const COL_DONE = { id: 'c-2', boardId: 'b-1', name: 'Done', orderIndex: 1, taskCount: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };

const TASK_URGENT_HIDDEN: TaskDto = {
  id: 't-1', boardId: 'b-1', columnId: 'c-1', title: 'Chuẩn bị slide giới thiệu',
  description: 'Chi tiết slide', dueAt: '2025-01-10T05:00:00Z', priority: 4, position: 1,
  isHidden: true, version: 3, deletedAt: null,
  assignees: [{ id: 'u-inactive', fullName: 'Vu Quoc F', isActive: false, leftAt: '2026-10-01T00:00:00Z', departments: [] }],
  creator: { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  commentCount: 2, createdAt: '2026-11-20T02:00:00Z', updatedAt: '2026-11-20T02:00:00Z',
};

const TASK_LOW: TaskDto = {
  id: 't-2', boardId: 'b-1', columnId: 'c-1', title: 'Mượn micro', description: null,
  dueAt: null, priority: 1, position: 2, isHidden: false, version: 1, deletedAt: null,
  assignees: [], creator: { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  commentCount: 0, createdAt: '2026-11-20T03:00:00Z', updatedAt: '2026-11-20T03:00:00Z',
};

const BOARD_DETAIL: BoardDetailDto = {
  id: 'b-1', name: 'Open Day 2026', department: { id: 'd-1', name: 'Sự kiện' }, archivedAt: null,
  createdBy: { id: 'u-creator', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  columns: [COL_DONE, COL_TODO], tasks: [TASK_LOW, TASK_URGENT_HIDDEN],
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
    authHooksMock.useMeQuery.mockReturnValue({ data: { profile: { id: 'u-viewer' } } });
    boardsHooksMock.useBoardDetailQuery.mockReturnValue({ isPending: false, isError: false, error: null, data: { board: BOARD_DETAIL } });
    tasksHooksMock.useTaskAssigneeMembersQuery.mockReturnValue({ isPending: false, isError: false, data: { items: [] } });
    tasksHooksMock.useTaskDetailQuery.mockReturnValue({ isPending: false, isError: false, error: null, refetch: vi.fn(), data: { task: TASK_URGENT_HIDDEN } });
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
    expect(viewerHtml).not.toContain('Thêm task');
    expect(viewerHtml).not.toContain('Kéo để sắp xếp cột');
    expect(viewerHtml).not.toContain('Kéo task để di chuyển');
    expect(viewerHtml).not.toContain('Tùy chọn cột');

    const editorHtml = renderWithIntl(<BoardDetailView boardId="b-1" />, { permissions: ['board.update', 'task.create'], locale: 'en' });
    expect(editorHtml).toContain('Add column');
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
    expect(assignedEditHtml).toContain('Lưu thay đổi');
    expect(assignedEditHtml).toContain('type="date"');
    expect(assignedEditHtml).toContain('Cần quyền member.view để chọn danh sách thành viên.');
    expect(assignedEditHtml).toContain('Xóa task');

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
});
