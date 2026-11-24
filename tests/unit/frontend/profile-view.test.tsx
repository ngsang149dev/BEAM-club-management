import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { changeMyPasswordFormSchema } from '@/lib/auth';

const hooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
  useSessionQuery: vi.fn(),
  useLogoutMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLocaleMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isError: false })),
  useChangeMyPasswordMutation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as ApiClientError | null,
  })),
  useUpdateMyAvatarMutation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as ApiClientError | null,
  })),
  useRemoveMyAvatarMutation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as ApiClientError | null,
  })),
}));

const navMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth', () => hooksMock);

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: navMock.refresh,
    replace: navMock.replace,
    push: navMock.push,
  }),
  useSearchParams: () => navMock.searchParams,
}));

import { ChangePasswordCard, resolveChangePasswordErrorKey } from '@/features/auth/components/ChangePasswordCard';
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
  mustChangePassword: false,
};

describe('ProfileContent, ProfileView & ChangePasswordCard (S08)', () => {
  beforeEach(() => {
    navMock.searchParams = new URLSearchParams();
    hooksMock.useSessionQuery.mockReturnValue({ data: null });
    hooksMock.useLogoutMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hooksMock.useUpdateLocaleMutation.mockReturnValue({ mutateAsync: vi.fn(), isError: false });
    hooksMock.useChangeMyPasswordMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    hooksMock.useUpdateMyAvatarMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    hooksMock.useRemoveMyAvatarMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
  });

  it('renders own MSSV, email, privacy note, department chips, permission labels, and ChangePasswordCard', () => {
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
    expect(html).toContain('Đổi mật khẩu');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Cần đổi mật khẩu ngay');
  });

  it('renders admin all-permissions state, remember-on state, locale error, and English ChangePasswordCard', () => {
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
    expect(html).toContain('Change password');
    expect(html).not.toContain('Password change required');
  });

  it('renders forced password-change banner when mustChangePassword is true or changePassword=1 query param is set', () => {
    const forcedProfileHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, mustChangePassword: true }}
          permissions={[]}
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(forcedProfileHtml).toContain('Cần đổi mật khẩu ngay');
    expect(forcedProfileHtml).toContain('is-highlighted');

    navMock.searchParams = new URLSearchParams('changePassword=1');
    hooksMock.useMeQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        profile: BASE_PROFILE,
        permissions: ['member.view'],
      },
      error: null,
      refetch: vi.fn(),
    });

    const queryHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileView />
      </NextIntlClientProvider>
    );
    expect(queryHtml).toContain('Password change required');
  });

  it('keeps ChangePasswordCard in one stable JSX slot and preserves .ui-banner.is-success when mustChangePassword flips true -> false', () => {
    const forcedBeforeSubmitHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, mustChangePassword: true }}
          permissions={['member.view']}
          forceChangePasswordPrompt
          passwordChanged={false}
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(forcedBeforeSubmitHtml).toContain('profile-main is-password-priority');
    expect(forcedBeforeSubmitHtml).toContain('ui-banner is-warn');
    expect(forcedBeforeSubmitHtml).not.toContain('ui-banner is-success');
    const contactIdxBefore = forcedBeforeSubmitHtml.indexOf('Thông tin liên hệ');
    const changePwIdxBefore = forcedBeforeSubmitHtml.indexOf('id="change-password"');
    expect(contactIdxBefore).toBeGreaterThan(-1);
    expect(changePwIdxBefore).toBeGreaterThan(contactIdxBefore);

    const postSubmitHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, mustChangePassword: false }}
          permissions={['member.view']}
          forceChangePasswordPrompt={false}
          passwordChanged
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(postSubmitHtml).toContain('profile-main is-password-priority');
    expect(postSubmitHtml).not.toContain('ui-banner is-warn');
    expect(postSubmitHtml).toContain('ui-banner is-success');
    expect(postSubmitHtml).toContain('Mật khẩu của bạn đã được cập nhật và các phiên đăng nhập khác đã bị thu hồi.');

    const contactIdxAfter = postSubmitHtml.indexOf('Thông tin liên hệ');
    const changePwIdxAfter = postSubmitHtml.indexOf('id="change-password"');
    expect(contactIdxAfter).toBeGreaterThan(-1);
    expect(changePwIdxAfter).toBeGreaterThan(contactIdxAfter);

    const changeCardSlice = postSubmitHtml.slice(changePwIdxAfter);
    expect(changeCardSlice).toContain('ui-banner is-success');

    const enPostSubmitHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, mustChangePassword: false }}
          permissions={['member.view']}
          forceChangePasswordPrompt={false}
          passwordChanged
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(enPostSubmitHtml).toContain('ui-banner is-success');
    expect(enPostSubmitHtml).toContain('Your password has been updated and other active sessions have been signed out.');
    expect(enPostSubmitHtml).not.toContain('ui-banner is-warn');
  });

  it('maps INVALID_CURRENT_PASSWORD cleanly and validates changeMyPasswordFormSchema', () => {
    const invalidCurrentErr = new ApiClientError({
      status: 400,
      code: 'INVALID_CURRENT_PASSWORD',
      messageKey: 'errors.invalidCurrentPassword',
      details: {},
    });
    expect(resolveChangePasswordErrorKey(invalidCurrentErr)).toBe('invalidCurrentPassword');
    expect(
      resolveChangePasswordErrorKey(
        new ApiClientError({ status: 0, code: 'NETWORK_ERROR', messageKey: 'errors.network', details: {} })
      )
    ).toBe('network');

    hooksMock.useChangeMyPasswordMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: invalidCurrentErr,
    });

    const viErrorHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ChangePasswordCard />
      </NextIntlClientProvider>
    );
    expect(viErrorHtml).toContain('Mật khẩu hiện tại không đúng.');

    const enErrorHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <ChangePasswordCard />
      </NextIntlClientProvider>
    );
    expect(enErrorHtml).toContain('Current password is incorrect.');

    expect(
      changeMyPasswordFormSchema.safeParse({
        currentPassword: 'oldPassword1!',
        newPassword: 'newPassword1!',
        confirmPassword: 'newPassword1!',
      }).success
    ).toBe(true);
    expect(
      changeMyPasswordFormSchema.safeParse({
        currentPassword: 'oldPassword1!',
        newPassword: 'short',
        confirmPassword: 'short',
      }).success
    ).toBe(false);
    expect(
      changeMyPasswordFormSchema.safeParse({
        currentPassword: 'oldPassword1!',
        newPassword: '        ',
        confirmPassword: '        ',
      }).success
    ).toBe(false);
    expect(
      changeMyPasswordFormSchema.safeParse({
        currentPassword: 'oldPassword1!',
        newPassword: 'newPassword1!',
        confirmPassword: 'differentPassword1!',
      }).success
    ).toBe(false);
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

  it('renders avatar upload/remove controls and image error alerts on S08 Profile', () => {
    const noAvatarHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, avatarUrl: null }}
          permissions={['member.view']}
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(noAvatarHtml).toContain('Tải ảnh lên');
    expect(noAvatarHtml).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(noAvatarHtml).not.toContain('Xóa ảnh');
    expect(noAvatarHtml).toContain('NA');

    const withAvatarHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <ProfileContent
          profile={{ ...BASE_PROFILE, avatarUrl: '/api/v1/members/u-1/avatar?v=99' }}
          permissions={['member.view']}
          avatarError={new ApiClientError({
            status: 400,
            code: 'INVALID_IMAGE_FORMAT',
            messageKey: 'errors.invalidImageFormat',
            details: {},
          })}
          onSignOut={vi.fn()}
          onLocaleChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(withAvatarHtml).toContain('src="/api/v1/members/u-1/avatar?v=99"');
    expect(withAvatarHtml).toContain('Change photo');
    expect(withAvatarHtml).toContain('Remove photo');
    expect(withAvatarHtml).toContain('Only PNG, JPEG, or WEBP images are allowed');
  });
});
