import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';

const hooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
  useSessionQuery: vi.fn(),
  useLogoutMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLocaleMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isError: false })),
}));

vi.mock('@/features/auth/hooks/useAuth', () => hooksMock);

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
  }),
}));

import { ProfileContent, ProfileView } from '@/features/auth/components/ProfileView';

type MemberDetail = components['schemas']['MemberDetail'];

const BASE_PROFILE: MemberDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Nguyen Van A',
  isActive: true,
  leftAt: null,
  departments: [
    { id: 'd-1', name: 'Truyền thông' },
    { id: 'd-2', name: 'Sự kiện' },
  ],
  studentId: '21010001',
  email: 'nguyenvana@eiu.edu.vn',
  locale: 'vi',
  isAdmin: false,
};

describe('ProfileContent & ProfileView (S08)', () => {
  beforeEach(() => {
    hooksMock.useSessionQuery.mockReturnValue({ data: null });
    hooksMock.useLogoutMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hooksMock.useUpdateLocaleMutation.mockReturnValue({ mutateAsync: vi.fn(), isError: false });
  });

  it('renders own MSSV, email, privacy note, department chips, permission labels, and no change-password control', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={BASE_PROFILE}
          permissions={['member.view', 'task.update_assigned', 'comment.create']}
          session={{ rememberMe: false, expiresAt: '2026-11-24T08:30:00.000Z' }}
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(html).toContain('21010001');
    expect(html).toContain('nguyenvana@eiu.edu.vn');
    expect(html).toContain('Chỉ bạn và admin thấy');
    expect(html).toContain('Truyền thông');
    expect(html).toContain('Sự kiện');
    expect(html).toContain('member.view');
    expect(html).toContain('Xem danh sách thành viên, họ tên và ban');
    expect(html).toContain('task.update_assigned');
    expect(html).toContain('comment.create');
    expect(html).toContain('Tắt (phiên 24 giờ)');
    expect(html).toContain('15:30');
    expect(html).not.toContain('Đổi mật khẩu');
    expect(html).not.toContain('Change password');
    expect(html).not.toContain('type="password"');
  });

  it('renders admin all-permissions state, remember-on state, and locale error alert', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, isAdmin: true, locale: 'en' }}
          permissions={[]}
          session={{ rememberMe: true, expiresAt: '2026-12-24T01:15:00.000Z' }}
          localeError
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(html).toContain('Only you and admins');
    expect(html).toContain('Administrator account: holds all permissions across the club workspace.');
    expect(html).toContain('On (30 days)');
    expect(html).toContain('Sign out');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not save language preference');
    expect(html).not.toContain('Change password');
    expect(html).not.toContain('Đổi mật khẩu');
  });

  it('renders loading instead of 500 ErrorState when meQuery returns 401, and renders ErrorState on non-401 errors', () => {
    hooksMock.useMeQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError({ status: 401, code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized', details: {} }),
      refetch: vi.fn(),
    });

    const html401 = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileView />
      </NextIntlClientProvider>
    );
    expect(html401).toContain('Đang tải...');
    expect(html401).not.toContain('Không tải được hồ sơ');

    hooksMock.useMeQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError({
        status: 500,
        code: 'INTERNAL_ERROR',
        messageKey: 'errors.internal',
        details: {},
        requestId: 'REQ-PROF-500',
      }),
      refetch: vi.fn(),
    });

    const html500 = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileView />
      </NextIntlClientProvider>
    );
    expect(html500).toContain('Không tải được hồ sơ');
    expect(html500).toContain('REQ-PROF-500');
  });
});
