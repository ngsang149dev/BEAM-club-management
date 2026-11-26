import { QueryClient } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const archiveHooksMock = vi.hoisted(() => ({
  useArchiveInfiniteQuery: vi.fn(),
  useArchiveRetentionQuery: vi.fn(),
  useUpdateArchiveRetentionMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
  useRestoreArchiveTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown, variables: undefined as string | undefined })),
  useRestoreArchiveMemberMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown, variables: undefined as string | undefined })),
  useRestoreArchiveBoardMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown, variables: undefined as string | undefined })),
  usePurgeArchiveItemMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
}));

vi.mock('@/features/archive/hooks/useArchive', async () => {
  const actual = await vi.importActual<typeof import('@/features/archive/hooks/useArchive')>(
    '@/features/archive/hooks/useArchive'
  );
  return { ...actual, ...archiveHooksMock };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import {
  ArchiveBoardsTable,
  ArchiveMembersTable,
  ArchivePurgeModal,
  ArchiveRetentionBar,
  ArchiveTasksTable,
  ArchiveView,
  describeArchiveError,
  getPermittedArchiveTabs,
  invalidateAfterArchiveMutation,
  resolveArchiveErrorMessage,
} from '@/features/archive';

type ArchiveTaskItem = components['schemas']['ArchiveTaskItem'];
type ArchiveBoardItem = components['schemas']['ArchiveBoardItem'];
type MemberDetail = components['schemas']['MemberDetail'];
type MemberPublicSummary = components['schemas']['MemberPublicSummary'];

const ARCHIVED_TASK_ARCHIVED_BOARD: ArchiveTaskItem = {
  task: {
    id: '50000000-0000-4000-8000-000000000001',
    boardId: '40000000-0000-4000-8000-000000000001',
    columnId: null,
    title: 'Dọn kho thiết bị âm thanh',
    description: null,
    startAt: null,
    dueAt: null,
    isCompleted: false,
    completedAt: null,
    priority: 4,
    position: 1000,
    isHidden: true,
    version: 3,
    deletedAt: '2026-11-23T07:32:08Z',
    assignees: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        fullName: 'Nguyen Van A',
        isActive: true,
        leftAt: null,
        departments: [],
        acceptedAt: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        fullName: 'Tran Cuu Thanh Vien',
        isActive: false,
        leftAt: '2026-10-01T00:00:00Z',
        departments: [],
        acceptedAt: null,
      },
    ],
    assignedDepartments: [],
    deliverables: [],
    deliverableCount: 0,
    creator: {
      id: '00000000-0000-4000-8000-000000000002',
      fullName: 'Nguyen Van A',
      isActive: true,
      leftAt: null,
      departments: [],
    },
    commentCount: 2,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-23T07:32:08Z',
  },
  boardName: 'Board Sự kiện cũ',
  boardArchived: true,
  columnName: null,
};

const PUBLIC_ARCHIVED_MEMBER: MemberPublicSummary = {
  id: '00000000-0000-4000-8000-000000000010',
  fullName: 'Le Thi Cuu',
  isActive: false,
  leftAt: '2026-11-20T05:15:00Z',
  departments: [{ id: 'dept-1', name: 'Truyền thông' }],
};

const DETAIL_ARCHIVED_MEMBER: MemberDetail = {
  ...PUBLIC_ARCHIVED_MEMBER,
  id: '00000000-0000-4000-8000-000000000011',
  fullName: 'Pham Minh Hieu',
  studentId: '21110088',
  email: 'hieu.pham@eiu.edu.vn',
  locale: 'vi',
  isAdmin: false,
  mustChangePassword: false,
};

const ARCHIVED_BOARD_ITEM: ArchiveBoardItem = {
  board: {
    id: '40000000-0000-4000-8000-000000000099',
    name: 'Kế hoạch Gala 2025',
    department: null,
    archivedAt: '2026-11-18T03:00:00Z',
    createdBy: {
      id: '00000000-0000-4000-8000-000000000002',
      fullName: 'Nguyen Van A',
      isActive: true,
      leftAt: null,
      departments: [],
    },
    visibleTaskCount: 0,
    overdueTaskCount: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-11-18T03:00:00Z',
  },
  taskCount: 7,
};

function renderWithIntl(node: ReactNode, locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'vi' ? viMessages : enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>
  );
}

function renderArchiveView(options: {
  permissions?: PermissionCode[];
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
}) {
  return renderWithIntl(
    <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>
      <ArchiveView />
    </PermissionsProvider>,
    options.locale ?? 'vi'
  );
}

describe('ArchiveView & Unified Archive Center (CR-04-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archiveHooksMock.useUpdateArchiveRetentionMutation.mockReturnValue({
      mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null,
    });
    archiveHooksMock.useRestoreArchiveTaskMutation.mockReturnValue({
      mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null, variables: undefined,
    });
    archiveHooksMock.useRestoreArchiveMemberMutation.mockReturnValue({
      mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null, variables: undefined,
    });
    archiveHooksMock.useRestoreArchiveBoardMutation.mockReturnValue({
      mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null, variables: undefined,
    });
    archiveHooksMock.usePurgeArchiveItemMutation.mockReturnValue({
      mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null,
    });
    archiveHooksMock.useArchiveRetentionQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { settings: { retentionDays: 30, updatedAt: '2026-11-22T01:00:00Z', updatedBy: null } },
    });
    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{
          tab: 'tasks',
          tasks: [ARCHIVED_TASK_ARCHIVED_BOARD],
          members: [],
          boards: [],
          meta: { nextCursor: 'cur-2', limit: 20 },
        }],
      },
    });
  });

  it('renders 403 ErrorState and disables all queries when user lacks every archive permission', () => {
    const html = renderArchiveView({ permissions: ['member.view', 'task.update_any'] });
    expect(html).toContain('403');
    expect(html).toContain('Bạn không có quyền xem Lưu trữ');
    expect(archiveHooksMock.useArchiveInfiniteQuery).toHaveBeenCalledWith(expect.any(Object), false);
    expect(archiveHooksMock.useArchiveRetentionQuery).toHaveBeenCalledWith(false);
    expect(getPermittedArchiveTabs(false, () => false)).toEqual([]);
  });

  it('computes RBAC tabs and defaults to first permitted tab per role', () => {
    const taskOnlyHtml = renderArchiveView({ permissions: ['task.delete'] });
    expect(taskOnlyHtml).toContain('role="tablist"');
    expect(taskOnlyHtml).toContain('Task đã xóa');
    expect(taskOnlyHtml).not.toContain('Thành viên đã rời');
    expect(taskOnlyHtml).not.toContain('Board lưu trữ');
    expect(archiveHooksMock.useArchiveInfiniteQuery).toHaveBeenCalledWith({ tab: 'tasks', q: '' }, true);

    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ tab: 'members', tasks: [], members: [PUBLIC_ARCHIVED_MEMBER], boards: [], meta: { nextCursor: null, limit: 20 } }] },
    });
    const memberOnlyHtml = renderArchiveView({ permissions: ['member.deactivate'] });
    expect(memberOnlyHtml).toContain('Thành viên đã rời');
    expect(memberOnlyHtml).not.toContain('Task đã xóa');
    expect(memberOnlyHtml).not.toContain('Board lưu trữ');
    expect(archiveHooksMock.useArchiveInfiniteQuery).toHaveBeenLastCalledWith({ tab: 'members', q: '' }, true);

    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ tab: 'boards', tasks: [], members: [], boards: [ARCHIVED_BOARD_ITEM], meta: { nextCursor: null, limit: 20 } }] },
    });
    const boardOnlyHtml = renderArchiveView({ permissions: ['board.delete'], locale: 'en' });
    expect(boardOnlyHtml).toContain('Archived boards');
    expect(boardOnlyHtml).not.toContain('Deleted tasks');
    expect(archiveHooksMock.useArchiveInfiniteQuery).toHaveBeenLastCalledWith({ tab: 'boards', q: '' }, true);

    expect(
      getPermittedArchiveTabs(false, (perm) => perm === 'task.delete' || perm === 'board.delete')
    ).toEqual(['tasks', 'boards']);
    expect(getPermittedArchiveTabs(true, () => false)).toEqual(['tasks', 'members', 'boards']);
  });

  it('renders Tasks tab with priority, hidden badge, archived board badge, deleted column fallback, Asia/Ho_Chi_Minh time, and Admin-only purge button', () => {
    const nonAdminHtml = renderArchiveView({ permissions: ['task.delete'] });
    expect(nonAdminHtml).toContain('Dọn kho thiết bị âm thanh');
    expect(nonAdminHtml).toContain('Khẩn');
    expect(nonAdminHtml).toContain('Task ẩn');
    expect(nonAdminHtml).toContain('Board Sự kiện cũ');
    expect(nonAdminHtml).toContain('Board đã lưu trữ');
    expect(nonAdminHtml).toContain('Cột cũ đã xóa (sẽ khôi phục vào cột đầu)');
    expect(nonAdminHtml).toContain('Nguyen Van A');
    expect(nonAdminHtml).toContain('Tran Cuu Thanh Vien');
    expect(nonAdminHtml).toContain('(đã rời)');
    expect(nonAdminHtml).toContain('14:32');
    expect(nonAdminHtml).toContain('Khôi phục');
    expect(nonAdminHtml).toContain('Tải thêm');
    expect(nonAdminHtml).not.toContain('Xóa vĩnh viễn');

    const adminHtml = renderArchiveView({ isAdmin: true });
    expect(adminHtml).toContain('Task đã xóa');
    expect(adminHtml).toContain('Thành viên đã rời');
    expect(adminHtml).toContain('Board lưu trữ');
    expect(adminHtml).toContain('Xóa vĩnh viễn');

    const restoringHtml = renderWithIntl(
      <ArchiveTasksTable
        items={[ARCHIVED_TASK_ARCHIVED_BOARD]}
        isAdmin={false}
        restoringId={ARCHIVED_TASK_ARCHIVED_BOARD.task.id}
        isBusy
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />,
      'en'
    );
    expect(restoringHtml).toContain('Restoring...');
    expect(restoringHtml).toContain('Original column deleted (restores to first column)');
    expect(restoringHtml).not.toContain('Delete permanently');
  });

  it('masks studentId and email in Members tab without member.view_detail and renders them when permitted', () => {
    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: {
        pages: [{
          tab: 'members',
          tasks: [],
          // Even if a record had PII shape in memory, lacking member.view_detail must never render it.
          members: [DETAIL_ARCHIVED_MEMBER],
          boards: [],
          meta: { nextCursor: null, limit: 20 },
        }],
      },
    });

    const maskedHtml = renderArchiveView({ permissions: ['member.deactivate'] });
    expect(maskedHtml).toContain('Pham Minh Hieu');
    expect(maskedHtml).toContain('(đã rời)');
    expect(maskedHtml).toContain('Truyền thông');
    expect(maskedHtml).toContain('12:15');
    expect(maskedHtml).not.toContain('21110088');
    expect(maskedHtml).not.toContain('hieu.pham@eiu.edu.vn');
    expect(maskedHtml).not.toContain('<th>MSSV</th>');

    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: {
        pages: [{
          tab: 'members',
          tasks: [],
          members: [DETAIL_ARCHIVED_MEMBER],
          boards: [],
          meta: { nextCursor: null, limit: 20 },
        }],
      },
    });
    const detailHtml = renderArchiveView({ permissions: ['member.deactivate', 'member.view_detail'] });
    expect(detailHtml).toContain('<th>MSSV</th>');
    expect(detailHtml).toContain('<th>Email</th>');
    expect(detailHtml).toContain('21110088');
    expect(detailHtml).toContain('hieu.pham@eiu.edu.vn');

    const publicOnlyHtml = renderWithIntl(
      <PermissionsProvider permissions={['member.deactivate', 'member.view_detail']}>
        <ArchiveMembersTable
          items={[PUBLIC_ARCHIVED_MEMBER]}
          isAdmin={false}
          restoringId={null}
          isBusy={false}
          onRestore={vi.fn()}
          onPurge={vi.fn()}
        />
      </PermissionsProvider>
    );
    expect(publicOnlyHtml).toContain('Le Thi Cuu');
    expect(publicOnlyHtml).not.toContain('<th>MSSV</th>');
  });

  it('renders Boards tab with club-wide badge, task count, archivedAt, and creator avatar', () => {
    const html = renderWithIntl(
      <ArchiveBoardsTable
        items={[ARCHIVED_BOARD_ITEM]}
        isAdmin
        restoringId={null}
        isBusy={false}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />
    );
    expect(html).toContain('Kế hoạch Gala 2025');
    expect(html).toContain('Chung CLB');
    expect(html).toContain('7 task');
    expect(html).toContain('10:00');
    expect(html).toContain('Nguyen Van A');
    expect(html).toContain('Khôi phục');
    expect(html).toContain('Xóa vĩnh viễn');
  });

  it('renders Admin retention selector vs non-admin read-only policy view across retention values', () => {
    const nonAdminHtml = renderWithIntl(
      <ArchiveRetentionBar
        settings={{ retentionDays: null, updatedAt: null, updatedBy: null }}
        isLoading={false}
        isError={false}
        isAdmin={false}
        isSaving={false}
        saveError={null}
        onSave={vi.fn()}
      />
    );
    expect(nonAdminHtml).toContain('Không tự xóa');
    expect(nonAdminHtml).toContain('Chỉ admin mới được thay đổi.');
    expect(nonAdminHtml).not.toContain('<select');
    expect(nonAdminHtml).not.toContain('Lưu chính sách');

    const adminHtml = renderWithIntl(
      <ArchiveRetentionBar
        settings={{
          retentionDays: 90,
          updatedAt: '2026-11-22T01:00:00Z',
          updatedBy: { id: 'u-1', fullName: 'Tran Admin', isActive: true, leftAt: null, departments: [] },
        }}
        isLoading={false}
        isError={false}
        isAdmin
        isSaving={false}
        saveError={null}
        onSave={vi.fn()}
      />
    );
    expect(adminHtml).toContain('<select');
    expect(adminHtml).toContain('Không tự xóa');
    expect(adminHtml).toContain('1 tuần (7 ngày)');
    expect(adminHtml).toContain('1 tháng (30 ngày)');
    expect(adminHtml).toContain('3 tháng (90 ngày)');
    expect(adminHtml).toContain('Lưu chính sách');
    expect(adminHtml).toContain('Tran Admin');
    expect(adminHtml).toContain('08:00');
  });

  it('renders Admin Purge confirmation modal with PII/history note and maps 409 BOARD_ARCHIVED and all archive error codes', () => {
    const purgeModalEnHtml = renderWithIntl(
      <ArchivePurgeModal
        target={{ entityType: 'members', id: DETAIL_ARCHIVED_MEMBER.id, label: DETAIL_ARCHIVED_MEMBER.fullName }}
        isPurging={false}
        error={new ApiClientError({
          status: 409,
          code: 'ENTITY_NOT_ARCHIVED',
          messageKey: 'errors.entityNotArchived',
          details: {},
          requestId: 'req-purge-409',
        })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
      'en'
    );
    expect(purgeModalEnHtml).toContain('role="dialog"');
    expect(purgeModalEnHtml).toContain('Confirm permanent purge');
    expect(purgeModalEnHtml).toContain('Pham Minh Hieu');
    expect(purgeModalEnHtml).toContain('Personal details are removed or anonymized while activity history is preserved.');
    expect(purgeModalEnHtml).toContain('Only items currently in the Archive can be permanently purged.');
    expect(purgeModalEnHtml).toContain('req-purge-409');

    const purgePendingViHtml = renderWithIntl(
      <ArchivePurgeModal
        target={{ entityType: 'boards', id: ARCHIVED_BOARD_ITEM.board.id, label: ARCHIVED_BOARD_ITEM.board.name }}
        isPurging
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(purgePendingViHtml).toContain('Đang xóa...');
    expect(purgePendingViHtml).toContain('Kế hoạch Gala 2025');

    archiveHooksMock.useRestoreArchiveTaskMutation.mockReturnValueOnce({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      variables: undefined,
      error: new ApiClientError({
        status: 409,
        code: 'BOARD_ARCHIVED',
        messageKey: 'errors.boardArchived',
        details: {},
        requestId: 'req-board-arch-409',
      }),
    });
    const boardArchivedErrHtml = renderArchiveView({ permissions: ['task.delete'] });
    expect(boardArchivedErrHtml).toContain('Board cha của task này hiện đang bị lưu trữ.');
    expect(boardArchivedErrHtml).toContain('req-board-arch-409');

    const errorPairs = [
      ['BOARD_ARCHIVED', 409, 'boardArchived'],
      ['BOARD_HAS_NO_COLUMNS', 409, 'boardHasNoColumns'],
      ['TASK_NOT_DELETED', 409, 'taskNotDeleted'],
      ['MEMBER_ALREADY_ACTIVE', 409, 'memberAlreadyActive'],
      ['BOARD_NOT_ARCHIVED', 409, 'boardNotArchived'],
      ['ENTITY_NOT_ARCHIVED', 409, 'entityNotArchived'],
    ] as const;
    for (const [code, status, expectedKey] of errorPairs) {
      const err = new ApiClientError({ status, code, messageKey: `errors.${expectedKey}`, details: {} });
      expect(describeArchiveError(err)?.key).toBe(expectedKey);
      expect(resolveArchiveErrorMessage(err, (k) => enMessages.errors[k])).toBe(enMessages.errors[expectedKey]);
    }
    expect(describeArchiveError(new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {} }))?.key).toBe('forbidden');
    expect(describeArchiveError(new ApiClientError({ status: 404, code: 'NOT_FOUND', messageKey: 'errors.notFound', details: {} }))?.key).toBe('notFound');
    expect(describeArchiveError(new ApiClientError({ status: 401, code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized', details: {} }))?.key).toBe('unauthorized');
  });

  it('renders loading, empty state with search reset, and query error state with requestId cleanly', () => {
    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: true,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    expect(renderArchiveView({ isAdmin: true })).toContain('Đang tải...');

    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ tab: 'tasks', tasks: [], members: [], boards: [], meta: { nextCursor: null, limit: 20 } }],
      },
    });
    expect(renderArchiveView({ isAdmin: true })).toContain('Chưa có mục nào trong Lưu trữ');

    archiveHooksMock.useArchiveInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        status: 500,
        code: 'INTERNAL_ERROR',
        messageKey: 'errors.internal',
        details: {},
        requestId: 'req-arch-500',
      }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const errHtml = renderArchiveView({ isAdmin: true, locale: 'en' });
    expect(errHtml).toContain('Could not load Archive items');
    expect(errHtml).toContain('req-arch-500');
  });

  it('invalidates archive, boards, boardDetail, myTasks, taskDetail, members, departments, auditLogs, and permissions queries', async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await invalidateAfterArchiveMutation(queryClient);
    const invalidatedRoots = spy.mock.calls.map(([arg]) => (arg as { queryKey: readonly string[] }).queryKey[0]);
    expect(invalidatedRoots).toEqual(
      expect.arrayContaining([
        'archive',
        'boards',
        'boardDetail',
        'myTasks',
        'taskDetail',
        'members',
        'departments',
        'auditLogs',
        'permissions',
      ])
    );
  });
});
