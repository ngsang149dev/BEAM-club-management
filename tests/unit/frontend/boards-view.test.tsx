import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const boardsHooksMock = vi.hoisted(() => ({
  useBoardsInfiniteQuery: vi.fn(),
  useCreateBoardMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateBoardMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useArchiveBoardMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const departmentsHookMock = vi.hoisted(() => ({
  useDepartmentsQuery: vi.fn(),
}));

vi.mock('@/features/boards/hooks/useBoards', async () => {
  const actual = await vi.importActual<typeof import('@/features/boards/hooks/useBoards')>(
    '@/features/boards/hooks/useBoards'
  );
  return { ...actual, ...boardsHooksMock };
});

vi.mock('@/features/departments/hooks/useDepartments', () => departmentsHookMock);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { BoardsListView } from '@/features/boards/components/BoardsListView';
import { describeBoardError } from '@/features/boards/error-mapping';

type BoardSummaryDto = components['schemas']['BoardSummaryDto'];

const ACTIVE_BOARD: BoardSummaryDto = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Sự kiện Open Day 2026',
  department: { id: 'dept-1', name: 'Sự kiện' },
  archivedAt: null,
  createdBy: { id: 'u-1', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-20T00:00:00Z',
};

const ARCHIVED_CLUB_BOARD: BoardSummaryDto = {
  id: '40000000-0000-4000-8000-000000000002',
  name: 'Vận hành CLB cũ',
  department: null,
  archivedAt: '2026-10-15T00:00:00Z',
  createdBy: { id: 'u-2', fullName: 'Tran Thi B', isActive: true, leftAt: null, departments: [] },
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
};

function renderBoards(options: {
  permissions?: PermissionCode[];
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
}) {
  const locale = options.locale ?? 'vi';
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>
        <BoardsListView />
      </PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('BoardsListView (S03)', () => {
  beforeEach(() => {
    departmentsHookMock.useDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [{ id: 'dept-1', name: 'Sự kiện', memberCount: 5, boardCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] },
      error: null,
    });
    boardsHooksMock.useBoardsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [ACTIVE_BOARD], meta: { nextCursor: 'cur-2', limit: 20 } }] },
    });
  });

  it('hides admin archived toggle and board mutation buttons for standard members', () => {
    const html = renderBoards({ permissions: ['member.view'] });
    expect(html).toContain('Sự kiện Open Day 2026');
    expect(html).toContain('Sự kiện');
    expect(html).toContain('Tải thêm board');
    expect(html).not.toContain('Hiện board đã lưu trữ');
    expect(html).not.toContain('Tùy chọn board');
    expect(html).not.toContain('>Tạo board<');
    expect(html).not.toContain('>Sửa board<');
    expect(html).not.toContain('>Lưu trữ board<');
  });

  it('renders create, edit, and archive actions inside consolidated menu strictly by permission', () => {
    const html = renderBoards({ permissions: ['board.create', 'board.update', 'board.delete'] });
    expect(html).toContain('Tùy chọn board');
    expect(html).toContain('>Tạo board<');
    expect(html).toContain('>Sửa board<');
    expect(html).toContain('>Lưu trữ board<');
    expect(html).not.toContain('Hiện board đã lưu trữ');
  });

  it('renders Show archived toggle and Restore action for admins and club-wide label when department is null', () => {
    boardsHooksMock.useBoardsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [ACTIVE_BOARD, ARCHIVED_CLUB_BOARD], meta: { nextCursor: null, limit: 20 } }] },
    });

    const html = renderBoards({ isAdmin: true, locale: 'en' });
    expect(html).toContain('Show archived boards');
    expect(html).toContain('Club-wide');
    expect(html).toContain('Archived');
    expect(html).toContain('Board options');
    expect(html).toContain('Restore board');
    expect(html).toContain('New board');
  });

  it('renders empty state and error state with requestId cleanly', () => {
    boardsHooksMock.useBoardsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 20 } }] },
    });
    expect(renderBoards({ permissions: ['board.create'] })).toContain('Chưa có board nào');

    boardsHooksMock.useBoardsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({ status: 403, code: 'FORBIDDEN', messageKey: 'errors.forbidden', details: {}, requestId: 'req-b-403' }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });
    const errHtml = renderBoards({ permissions: [] });
    expect(errHtml).toContain('Không tải được danh sách board.');
    expect(errHtml).toContain('req-b-403');
    expect(describeBoardError(new ApiClientError({ status: 409, code: 'COLUMN_NOT_EMPTY', messageKey: 'errors.columnNotEmpty', details: {}, requestId: 'r-1' }))).toEqual({
      key: 'columnNotEmpty',
      requestId: 'r-1',
    });
  });
});
