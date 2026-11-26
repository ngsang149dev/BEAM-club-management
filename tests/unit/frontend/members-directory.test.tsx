import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const membersHookMock = vi.hoisted(() => ({
  useMembersInfiniteQuery: vi.fn(),
}));

const departmentsHookMock = vi.hoisted(() => ({
  useDepartmentsQuery: vi.fn(),
}));

vi.mock('@/features/members/hooks/useMembers', async () => {
  const actual = await vi.importActual<typeof import('@/features/members/hooks/useMembers')>(
    '@/features/members/hooks/useMembers'
  );
  return {
    ...actual,
    useMembersInfiniteQuery: membersHookMock.useMembersInfiniteQuery,
  };
});

vi.mock('@/features/departments/hooks/useDepartments', () => departmentsHookMock);

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { MembersDirectoryView } from '@/features/members/components/MembersDirectoryView';

type MemberDetail = components['schemas']['MemberDetail'];
type MemberPublicSummary = components['schemas']['MemberPublicSummary'];

const DETAIL_MEMBER: MemberDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Nguyen Minh Anh',
  isActive: true,
  leftAt: null,
  departments: [{ id: 'dept-1', name: 'Truyền thông' }],
  isAdmin: true,
  studentId: '21110001',
  email: 'anh.nguyen@eiu.edu.vn',
  locale: 'vi',
  mustChangePassword: false,
};

const INACTIVE_PUBLIC_MEMBER: MemberPublicSummary = {
  id: '00000000-0000-4000-8000-000000000002',
  fullName: 'Tran Quoc Bao',
  isActive: false,
  leftAt: '2026-10-01T00:00:00Z',
  departments: [],
};

function renderDirectory(options: {
  permissions: PermissionCode[];
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
}) {
  const locale = options.locale ?? 'vi';
  const messages = locale === 'vi' ? viMessages : enMessages;

  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
      <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions}>
        <MembersDirectoryView />
      </PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('MembersDirectoryView (S07)', () => {
  beforeEach(() => {
    departmentsHookMock.useDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: [
          {
            id: 'dept-1',
            name: 'Truyền thông',
            lead: null,
            memberCount: 3,
            boardCount: 1,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
      error: null,
    });
    membersHookMock.useMembersInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [DETAIL_MEMBER, INACTIVE_PUBLIC_MEMBER], meta: { nextCursor: null, limit: 20 } }],
      },
    });
  });

  it('renders 403 ErrorState without calling query enabled when user lacks member.view', () => {
    const html = renderDirectory({ permissions: ['task.update_assigned'] });
    expect(html).toContain('403');
    expect(html).toContain('Bạn không có quyền xem trang này');
    expect(membersHookMock.useMembersInfiniteQuery).toHaveBeenCalledWith(expect.any(Object), false);
    expect(html).not.toContain('Nguyen Minh Anh');
  });

  it('omits studentId and email columns and values completely without member.view_detail', () => {
    const html = renderDirectory({ permissions: ['member.view'] });
    expect(html).toContain('Nguyen Minh Anh');
    expect(html).toContain('Tran Quoc Bao');
    expect(html).toContain('(đã rời)');
    expect(html).not.toContain('21110001');
    expect(html).not.toContain('anh.nguyen@eiu.edu.vn');
    expect(html).not.toContain('<th>MSSV</th>');
    expect(html).not.toContain('<th>Email</th>');
    expect(html).not.toContain('/admin/members');
  });

  it('renders studentId, email, admin link, and left badge when user has member.view_detail and member admin permissions', () => {
    const html = renderDirectory({
      permissions: ['member.view', 'member.view_detail', 'member.create'],
      locale: 'en',
    });
    expect(html).toContain('21110001');
    expect(html).toContain('anh.nguyen@eiu.edu.vn');
    expect(html).toContain('(left)');
    expect(html).toContain('/admin/members');
  });

  it('renders load more button when hasNextPage is true and empty reset state when list is empty', () => {
    membersHookMock.useMembersInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [DETAIL_MEMBER], meta: { nextCursor: 'cursor-2', limit: 20 } }],
      },
    });

    const withMoreHtml = renderDirectory({ permissions: ['member.view', 'member.view_detail'] });
    expect(withMoreHtml).toContain('Tải thêm');

    membersHookMock.useMembersInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 20 } }] },
    });

    const emptyHtml = renderDirectory({ permissions: ['member.view'] });
    expect(emptyHtml).toContain('Chưa có thành viên nào khớp bộ lọc');
    expect(emptyHtml).toContain('Đặt lại bộ lọc');
  });

  it('renders retry ErrorState when directory query fails', () => {
    membersHookMock.useMembersInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        status: 400,
        code: 'INVALID_CURSOR',
        messageKey: 'errors.invalidCursor',
        details: {},
        requestId: 'req-dir-123',
      }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });

    const html = renderDirectory({ permissions: ['member.view'] });
    expect(html).toContain('Không tải được danh bạ thành viên.');
    expect(html).toContain('Con trỏ phân trang không hợp lệ');
    expect(html).toContain('req-dir-123');
    expect(html).toContain('Thử lại');
  });
});
