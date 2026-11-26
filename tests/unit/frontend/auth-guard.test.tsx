import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import viMessages from '../../../messages/vi.json';
import { ApiClientError } from '@/features/shared/api/client';
import { Can } from '@/features/shared/permissions/can';

const hooksMock = vi.hoisted(() => ({
  useLoggedOutState: vi.fn(() => false),
  useSessionQuery: vi.fn(),
  useMeQuery: vi.fn(),
  useLogoutMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLocaleMutation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isError: false,
  })),
}));

vi.mock('@/features/auth/hooks/useAuth', () => hooksMock);

vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

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

import { AuthGuard } from '@/features/auth/components/AuthGuard';

function renderGuard(children: ReactNode = <div>protected-child</div>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
      <AuthGuard activeNav="profile" title="Hồ sơ của tôi">
        {children}
      </AuthGuard>
    </NextIntlClientProvider>
  );
}

describe('AuthGuard', () => {
  beforeEach(() => {
    hooksMock.useLoggedOutState.mockReturnValue(false);
    hooksMock.useMeQuery.mockReturnValue({ data: undefined, error: null, isPending: false, isError: false });
    hooksMock.useLogoutMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hooksMock.useUpdateLocaleMutation.mockReturnValue({ mutateAsync: vi.fn(), isError: false });
  });

  it('renders loading placeholder and hides children while session is pending', () => {
    hooksMock.useSessionQuery.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderGuard();
    expect(html).toContain('Đang tải...');
    expect(html).not.toContain('protected-child');
    expect(html).not.toContain('notif-bell-btn');
  });

  it('treats 401 session or 401 meQuery errors as unauthorized without rendering children or 500 error', () => {
    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError({ status: 401, code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized', details: {} }),
      refetch: vi.fn(),
    });

    const session401Html = renderGuard();
    expect(session401Html).toContain('Đang tải...');
    expect(session401Html).not.toContain('protected-child');
    expect(session401Html).not.toContain('Đã có lỗi xảy ra');

    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        authenticated: true,
        userId: 'u-1',
        isAdmin: false,
        permissions: ['member.view'],
        rememberMe: false,
        expiresAt: '2026-11-25T00:00:00.000Z',
      },
      error: null,
      refetch: vi.fn(),
    });
    hooksMock.useMeQuery.mockReturnValue({
      data: undefined,
      error: new ApiClientError({ status: 401, code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized', details: {} }),
      isPending: false,
      isError: true,
    });

    const me401Html = renderGuard();
    expect(me401Html).toContain('Đang tải...');
    expect(me401Html).not.toContain('protected-child');

    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError({
        status: 401,
        code: 'SESSION_EXPIRED',
        messageKey: 'errors.sessionExpired',
        details: {},
      }),
      refetch: vi.fn(),
    });
    const sessionExpiredHtml = renderGuard();
    expect(sessionExpiredHtml).toContain('Đang tải...');
    expect(sessionExpiredHtml).not.toContain('protected-child');
    expect(sessionExpiredHtml).not.toContain('Đã có lỗi xảy ra');
  });

  it('renders loading state when loggedOut flag is set after explicit sign-out', () => {
    hooksMock.useLoggedOutState.mockReturnValue(true);
    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderGuard();
    expect(html).toContain('Đang tải...');
    expect(html).not.toContain('protected-child');
    expect(html).not.toContain('Đã có lỗi xảy ra');
  });

  it('renders offline or 500 ErrorState on non-401 session failure', () => {
    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError({
        status: 500,
        code: 'INTERNAL_ERROR',
        messageKey: 'errors.internal',
        details: {},
        requestId: 'REQ-AUTH-500',
      }),
      refetch: vi.fn(),
    });

    const html500 = renderGuard();
    expect(html500).toContain('Đã có lỗi xảy ra');
    expect(html500).toContain('REQ-AUTH-500');
    expect(html500).not.toContain('protected-child');

    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError({ status: 0, code: 'NETWORK_ERROR', messageKey: 'errors.network', details: {} }),
      refetch: vi.fn(),
    });

    const htmlOffline = renderGuard();
    expect(htmlOffline).toContain('Không có kết nối');
  });

  it('populates PermissionsProvider, AppShell user, and surfaces locale persistence error banner', () => {
    hooksMock.useSessionQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        authenticated: true,
        userId: 'u-1',
        isAdmin: false,
        permissions: ['member.view', 'department.manage'],
        rememberMe: false,
        expiresAt: '2026-11-25T00:00:00.000Z',
      },
      error: null,
      refetch: vi.fn(),
    });
    hooksMock.useMeQuery.mockReturnValue({
      data: {
        profile: {
          id: 'u-1',
          fullName: 'Tran Thi B',
          isActive: true,
          leftAt: null,
          departments: [],
          studentId: '21010002',
          email: 'b@eiu.edu.vn',
          locale: 'vi',
          isAdmin: false,
          mustChangePassword: false,
        },
        permissions: ['member.view', 'department.manage'],
      },
      error: null,
      isPending: false,
      isError: false,
    });
    hooksMock.useUpdateLocaleMutation.mockReturnValue({ mutateAsync: vi.fn(), isError: true });

    const html = renderGuard(
      <Can permission="department.manage" fallback={<span>no-dept</span>}>
        <span>can-manage-dept</span>
      </Can>
    );

    expect(html).toContain('Tran Thi B');
    expect(html).toContain('notif-bell-btn');
    expect(html).toContain('href="/members"');
    expect(html).toContain('href="/admin/departments"');
    expect(html).not.toContain('href="/admin/permissions"');
    expect(html).toContain('can-manage-dept');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Không lưu được tùy chọn ngôn ngữ');
  });
});
