import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';
import { newPasswordSchema } from '@/lib/auth';

const membersHookMock = vi.hoisted(() => ({
  useMembersInfiniteQuery: vi.fn(),
  useCreateMemberMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateMemberMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeactivateMemberMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useActivateMemberMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useResetMemberPasswordMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateMemberAvatarMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useRemoveMemberAvatarMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

const departmentsHookMock = vi.hoisted(() => ({
  useDepartmentsQuery: vi.fn(),
}));

const brandingHookMock = vi.hoisted(() => ({
  useBrandingQuery: vi.fn(() => ({
    isPending: false,
    isError: false,
    data: { logoUrl: null as string | null, updatedAt: null as string | null },
  })),
  useUpdateClubLogoMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
  useRemoveClubLogoMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown })),
}));

vi.mock('@/features/members/hooks/useMembers', async () => {
  const actual = await vi.importActual<typeof import('@/features/members/hooks/useMembers')>(
    '@/features/members/hooks/useMembers'
  );
  return { ...actual, ...membersHookMock };
});

vi.mock('@/features/branding/hooks/useBranding', async () => {
  const actual = await vi.importActual<typeof import('@/features/branding/hooks/useBranding')>(
    '@/features/branding/hooks/useBranding'
  );
  return { ...actual, ...brandingHookMock };
});

vi.mock('@/features/departments/hooks/useDepartments', () => departmentsHookMock);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ClubLogoModal } from '@/features/branding/components/ClubLogoModal';
import { canViewerResetMemberPassword } from '@/features/members/components/MemberAdminTable';
import { MemberAdminView } from '@/features/members/components/MemberAdminView';
import { MemberCreateDrawer, MemberEditDrawer } from '@/features/members/components/MemberFormDrawer';
import { MemberStatusModal } from '@/features/members/components/MemberStatusModal';
import { ResetPasswordModal } from '@/features/members/components/ResetPasswordModal';
import {
  buildValidatedUpdatePayload,
  createMemberWithDomainSchema,
  generateCompliantPassword,
  resetMemberPasswordFormSchema,
} from '@/features/members/schemas';
import { describeMemberError } from '@/features/members/error-mapping';

type DepartmentDto = components['schemas']['DepartmentDto'];
type MemberDetail = components['schemas']['MemberDetail'];
type MemberPublicSummary = components['schemas']['MemberPublicSummary'];

const DEPT_MEDIA: DepartmentDto = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Truyền thông',
  memberCount: 4,
  boardCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const DEPT_TECH: DepartmentDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Kỹ thuật',
  memberCount: 2,
  boardCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SAMPLE_DEPARTMENTS: DepartmentDto[] = [DEPT_MEDIA, DEPT_TECH];

const DETAIL_MEMBER: MemberDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Nguyen Minh Anh',
  isActive: true,
  leftAt: null,
  departments: [{ id: DEPT_MEDIA.id, name: DEPT_MEDIA.name }],
  isAdmin: false,
  studentId: '21110001',
  email: 'anh.nguyen@eiu.edu.vn',
  locale: 'vi',
  mustChangePassword: false,
};

const ADMIN_DETAIL_MEMBER: MemberDetail = {
  id: '00000000-0000-4000-8000-000000000003',
  fullName: 'Tran Club Admin',
  isActive: true,
  leftAt: null,
  departments: [{ id: DEPT_TECH.id, name: DEPT_TECH.name }],
  isAdmin: true,
  studentId: '21110099',
  email: 'admin.tran@eiu.edu.vn',
  locale: 'vi',
  mustChangePassword: false,
};

const PUBLIC_MEMBER: MemberPublicSummary = {
  id: '00000000-0000-4000-8000-000000000002',
  fullName: 'Le Thi Hoa',
  isActive: false,
  leftAt: '2026-10-01T00:00:00Z',
  departments: [],
};

function renderWithIntl(node: ReactNode, locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      {node}
    </NextIntlClientProvider>
  );
}

describe('MemberAdminView & Member Forms (S09)', () => {
  beforeEach(() => {
    departmentsHookMock.useDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: SAMPLE_DEPARTMENTS },
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
      data: { pages: [{ items: [DETAIL_MEMBER, PUBLIC_MEMBER], meta: { nextCursor: null, limit: 20 } }] },
    });
  });

  it('renders 403 ErrorState when caller lacks member.create, member.update, and member.deactivate', () => {
    const html = renderWithIntl(
      <PermissionsProvider permissions={['member.view']}>
        <MemberAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('403');
    expect(membersHookMock.useMembersInfiniteQuery).toHaveBeenCalledWith(expect.any(Object), false);
    expect(departmentsHookMock.useDepartmentsQuery).toHaveBeenCalledWith(false);
  });

  it('supports member.create without member.view cleanly without calling GET /members', () => {
    const html = renderWithIntl(
      <PermissionsProvider permissions={['member.create']}>
        <MemberAdminView />
      </PermissionsProvider>
    );
    expect(membersHookMock.useMembersInfiniteQuery).toHaveBeenCalledWith(expect.any(Object), false);
    expect(departmentsHookMock.useDepartmentsQuery).toHaveBeenCalledWith(true);
    expect(html).toContain('Bạn chưa có quyền xem danh sách thành viên');
    expect(html).toContain('Thêm thành viên');
  });

  it('renders consolidated ActionMenu per row strictly by permission, hides Reset Password and Club Logo for non-admins, and masks PII without member.view_detail', () => {
    const permissions: PermissionCode[] = ['member.view', 'member.update'];
    const html = renderWithIntl(
      <PermissionsProvider permissions={permissions}>
        <MemberAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('aria-label="Thao tác thành viên"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('>Sửa<');
    expect(html).not.toContain('>Đặt lại mật khẩu<');
    expect(html).not.toContain('>Logo CLB<');
    expect(html).not.toContain('>Thêm thành viên<');
    expect(html).not.toContain('>Khóa tài khoản<');
    expect(html).not.toContain('>Mở lại tài khoản<');
    expect(html).not.toContain('21110001');
    expect(html).not.toContain('anh.nguyen@eiu.edu.vn');

    const createOnlyHtml = renderWithIntl(
      <PermissionsProvider permissions={['member.view', 'member.create']}>
        <MemberAdminView />
      </PermissionsProvider>
    );
    expect(createOnlyHtml).toContain('>Thêm thành viên<');
    expect(createOnlyHtml).not.toContain('aria-label="Thao tác thành viên"');
  });

  it('enforces strict Admin-only Reset Password and Club Logo visibility rules (CR-01 / CR-02)', () => {
    expect(
      canViewerResetMemberPassword({ viewerIsAdmin: false, canUpdateMember: false, member: DETAIL_MEMBER })
    ).toBe(false);
    expect(
      canViewerResetMemberPassword({ viewerIsAdmin: false, canUpdateMember: true, member: DETAIL_MEMBER })
    ).toBe(false);
    expect(
      canViewerResetMemberPassword({ viewerIsAdmin: false, canUpdateMember: true, member: ADMIN_DETAIL_MEMBER })
    ).toBe(false);
    expect(
      canViewerResetMemberPassword({ viewerIsAdmin: false, canUpdateMember: true, member: PUBLIC_MEMBER })
    ).toBe(false);
    expect(
      canViewerResetMemberPassword({ viewerIsAdmin: true, canUpdateMember: false, member: ADMIN_DETAIL_MEMBER })
    ).toBe(true);

    membersHookMock.useMembersInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [DETAIL_MEMBER, ADMIN_DETAIL_MEMBER, PUBLIC_MEMBER], meta: { nextCursor: null, limit: 20 } }],
      },
    });

    const nonAdminViewerHtml = renderWithIntl(
      <PermissionsProvider
        isAdmin={false}
        permissions={['member.view', 'member.view_detail', 'member.create', 'member.update', 'member.deactivate']}
      >
        <MemberAdminView />
      </PermissionsProvider>
    );
    expect(nonAdminViewerHtml).toContain('Nguyen Minh Anh');
    expect(nonAdminViewerHtml).toContain('Tran Club Admin');
    expect(nonAdminViewerHtml).toContain('>Sửa<');
    expect(nonAdminViewerHtml).not.toContain('>Đặt lại mật khẩu<');
    expect(nonAdminViewerHtml).not.toContain('>Logo CLB<');

    membersHookMock.useMembersInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [DETAIL_MEMBER, ADMIN_DETAIL_MEMBER], meta: { nextCursor: null, limit: 20 } }] },
    });

    const adminViewerHtml = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <MemberAdminView />
      </PermissionsProvider>
    );
    expect(adminViewerHtml).toContain('Tran Club Admin');
    expect(adminViewerHtml).toContain('aria-label="Thao tác thành viên"');
    expect(adminViewerHtml).toContain('>Đặt lại mật khẩu<');
    expect(adminViewerHtml).toContain('>Logo CLB<');

    membersHookMock.useMembersInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [DETAIL_MEMBER], meta: { nextCursor: null, limit: 20 } }] },
    });

    const adminEnHtml = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <MemberAdminView />
      </PermissionsProvider>,
      'en'
    );
    expect(adminEnHtml).toContain('aria-label="Member actions"');
    expect(adminEnHtml).toContain('>Reset password<');
    expect(adminEnHtml).toContain('>Club logo<');
  });

  it('renders MemberCreateDrawer with initialPassword, generate button, first-login hint, and validates schema', () => {
    const html = renderWithIntl(
      <MemberCreateDrawer
        departments={SAMPLE_DEPARTMENTS}
        isSubmitting={false}
        error={new ApiClientError({
          status: 400,
          code: 'INVALID_EMAIL_DOMAIN',
          messageKey: 'errors.invalidEmailDomain',
          details: { allowedDomain: 'eiu.edu.vn' },
        })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(html).toContain('method="post"');
    expect(html).toContain('MSSV không thể thay đổi sau khi tạo tài khoản.');
    expect(html).toContain('Email phải thuộc tên miền @eiu.edu.vn.');
    expect(html).toContain('Mật khẩu ban đầu');
    expect(html).toContain('Tạo mật khẩu');
    expect(html).toContain('type="password"');
    expect(html).toContain('đổi mật khẩu này ngay khi đăng nhập lần đầu');

    const generated = generateCompliantPassword();
    expect(generated.length).toBeGreaterThanOrEqual(12);
    expect(newPasswordSchema.safeParse(generated).success).toBe(true);
    expect(/[A-Z]/.test(generated)).toBe(true);
    expect(/[a-z]/.test(generated)).toBe(true);
    expect(/[0-9]/.test(generated)).toBe(true);
    expect(/[!@#$%^&*]/.test(generated)).toBe(true);

    expect(
      createMemberWithDomainSchema.safeParse({
        studentId: '21110009',
        email: 'user@gmail.com',
        fullName: 'Bad Domain',
        departmentIds: [],
        locale: 'vi',
        initialPassword: 'ValidPass@2026',
      }).success
    ).toBe(false);

    expect(
      createMemberWithDomainSchema.safeParse({
        studentId: '21110009',
        email: 'user@eiu.edu.vn',
        fullName: 'Short Pass',
        departmentIds: [],
        locale: 'vi',
        initialPassword: 'short',
      }).success
    ).toBe(false);

    expect(
      createMemberWithDomainSchema.safeParse({
        studentId: '21110009',
        email: 'USER@EIU.EDU.VN',
        fullName: 'Good Domain',
        departmentIds: [DEPT_MEDIA.id],
        locale: 'vi',
        initialPassword: 'ValidPass@2026',
      }).success
    ).toBe(true);
  });

  it('renders MemberEditDrawer without initialPassword field, with read-only MSSV and omitted studentId in PATCH', () => {
    const detailHtml = renderWithIntl(
      <MemberEditDrawer
        member={DETAIL_MEMBER}
        canViewDetail
        departments={SAMPLE_DEPARTMENTS}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(detailHtml).toContain('value="21110001"');
    expect(detailHtml).toContain('disabled=""');
    expect(detailHtml).toContain('readOnly=""');
    expect(detailHtml).not.toContain('Mật khẩu ban đầu');
    expect(detailHtml).not.toContain('type="password"');

    const maskedHtml = renderWithIntl(
      <MemberEditDrawer
        member={PUBLIC_MEMBER}
        canViewDetail={false}
        departments={SAMPLE_DEPARTMENTS}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(maskedHtml).toContain('MSSV được ẩn theo quyền tài khoản hiện tại.');
    expect(maskedHtml).toContain('Giữ nguyên ngôn ngữ hiện tại');
    expect(maskedHtml).toContain('@eiu.edu.vn');

    const maskedEnHtml = renderWithIntl(
      <MemberEditDrawer
        member={PUBLIC_MEMBER}
        canViewDetail={false}
        departments={SAMPLE_DEPARTMENTS}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
      'en'
    );
    expect(maskedEnHtml).toContain('Keep current email (or enter a new @eiu.edu.vn email to replace it)');
    expect(maskedEnHtml).toContain('Keep current language');

    const patchWithoutEmail = buildValidatedUpdatePayload(
      { fullName: 'Le Thi Hoa', email: '', departmentIds: [DEPT_TECH.id], locale: '' },
      false
    );
    expect(patchWithoutEmail.ok).toBe(true);
    if (patchWithoutEmail.ok) {
      expect(patchWithoutEmail.payload).toEqual({
        fullName: 'Le Thi Hoa',
        departmentIds: [DEPT_TECH.id],
      });
      expect('studentId' in patchWithoutEmail.payload).toBe(false);
    }
  });

  it('renders ResetPasswordModal with session notice, 403 FORBIDDEN alert, and schema validation', () => {
    const viHtml = renderWithIntl(
      <ResetPasswordModal
        member={DETAIL_MEMBER}
        isPending={false}
        error={new ApiClientError({
          status: 403,
          code: 'FORBIDDEN',
          messageKey: 'errors.forbidden',
          details: {},
        })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(viHtml).toContain('Đặt lại mật khẩu thành viên');
    expect(viHtml).toContain('Nguyen Minh Anh');
    expect(viHtml).toContain('Mọi phiên đăng nhập đang hoạt động của thành viên sẽ bị đăng xuất ngay lập tức');
    expect(viHtml).toContain('buộc đổi mật khẩu');
    expect(viHtml).toContain('Tạo mật khẩu');
    expect(viHtml).toContain('Bạn không có quyền thực hiện thao tác này.');

    const enHtml = renderWithIntl(
      <ResetPasswordModal
        member={DETAIL_MEMBER}
        isPending={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
      'en'
    );
    expect(enHtml).toContain('Reset member password');
    expect(enHtml).toContain('All active sessions for this member will be terminated immediately');
    expect(enHtml).toContain('Generate password');

    expect(
      resetMemberPasswordFormSchema.safeParse({ newPassword: 'NewPass@2026', confirmPassword: 'NewPass@2026' }).success
    ).toBe(true);
    expect(
      resetMemberPasswordFormSchema.safeParse({ newPassword: 'NewPass@2026', confirmPassword: 'Different@2026' }).success
    ).toBe(false);
    expect(
      resetMemberPasswordFormSchema.safeParse({ newPassword: 'short', confirmPassword: 'short' }).success
    ).toBe(false);
  });

  it('renders MemberStatusModal preserving history notice and LAST_ACTIVE_ADMIN error', () => {
    const html = renderWithIntl(
      <MemberStatusModal
        member={DETAIL_MEMBER}
        action="deactivate"
        isPending={false}
        error={new ApiClientError({
          status: 409,
          code: 'LAST_ACTIVE_ADMIN',
          messageKey: 'errors.lastActiveAdmin',
          details: {},
        })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(html).toContain('Toàn bộ task, bình luận và lịch sử thao tác vẫn được giữ nguyên.');
    expect(html).toContain('Không thể vô hiệu hóa hoặc gỡ quyền admin hoạt động cuối cùng.');
    expect(
      describeMemberError(
        new ApiClientError({ status: 409, code: 'STUDENT_ID_EXISTS', messageKey: 'errors.studentIdExists', details: {} })
      )
    ).toEqual({ key: 'studentIdExists' });
    expect(
      describeMemberError(
        new ApiClientError({ status: 400, code: 'INITIAL_PASSWORD_REQUIRED', messageKey: 'errors.initialPasswordRequired', details: {} })
      )
    ).toEqual({ key: 'initialPasswordRequired' });
    expect(
      describeMemberError(
        new ApiClientError({ status: 401, code: 'ACCOUNT_INACTIVE', messageKey: 'errors.unauthorized', details: {} })
      )
    ).toEqual({ key: 'unauthorized' });
    expect(
      describeMemberError(
        new ApiClientError({ status: 400, code: 'INVALID_IMAGE_FORMAT', messageKey: 'errors.invalidImageFormat', details: {} })
      )
    ).toEqual({ key: 'invalidImageFormat' });
    expect(
      describeMemberError(
        new ApiClientError({ status: 400, code: 'IMAGE_TOO_LARGE', messageKey: 'errors.imageTooLarge', details: {} })
      )
    ).toEqual({ key: 'imageTooLarge' });
  });

  it('renders AvatarUploadControl in Edit drawer only when permitted and renders ClubLogoModal cleanly', () => {
    const createHtml = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <MemberCreateDrawer
          departments={SAMPLE_DEPARTMENTS}
          isSubmitting={false}
          error={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </PermissionsProvider>
    );
    expect(createHtml).not.toContain('Ảnh đại diện thành viên');
    expect(createHtml).not.toContain('accept="image/png,image/jpeg,image/webp"');

    const editPermittedHtml = renderWithIntl(
      <PermissionsProvider permissions={['member.update']}>
        <MemberEditDrawer
          member={{ ...DETAIL_MEMBER, avatarUrl: '/api/v1/members/m-1/avatar?v=55' }}
          canViewDetail
          departments={SAMPLE_DEPARTMENTS}
          isSubmitting={false}
          error={null}
          onUploadAvatar={vi.fn()}
          onRemoveAvatar={vi.fn()}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </PermissionsProvider>
    );
    expect(editPermittedHtml).toContain('Ảnh đại diện thành viên');
    expect(editPermittedHtml).toContain('src="/api/v1/members/m-1/avatar?v=55"');
    expect(editPermittedHtml).toContain('Đổi ảnh');
    expect(editPermittedHtml).toContain('Xóa ảnh');

    const editForbiddenHtml = renderWithIntl(
      <PermissionsProvider permissions={['member.view']}>
        <MemberEditDrawer
          member={DETAIL_MEMBER}
          canViewDetail={false}
          departments={SAMPLE_DEPARTMENTS}
          isSubmitting={false}
          error={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </PermissionsProvider>
    );
    expect(editForbiddenHtml).not.toContain('Ảnh đại diện thành viên');

    brandingHookMock.useBrandingQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      data: { logoUrl: null, updatedAt: null },
    });
    const defaultLogoModalHtml = renderWithIntl(<ClubLogoModal onClose={vi.fn()} />);
    expect(defaultLogoModalHtml).toContain('Logo CLB BEAM');
    expect(defaultLogoModalHtml).toContain('Đang dùng huy hiệu BEAM mặc định');
    expect(defaultLogoModalHtml).toContain('Tải logo mới');
    expect(defaultLogoModalHtml).toContain('class="ui-logo is-lg"');

    brandingHookMock.useBrandingQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      data: { logoUrl: '/api/v1/branding/logo?v=123', updatedAt: '2026-11-24T00:00:00Z' },
    });
    brandingHookMock.useUpdateClubLogoMutation.mockReturnValueOnce({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: new ApiClientError({
        status: 400,
        code: 'IMAGE_TOO_LARGE',
        messageKey: 'errors.imageTooLarge',
        details: {},
      }),
    });
    const customLogoModalHtml = renderWithIntl(<ClubLogoModal onClose={vi.fn()} />, 'en');
    expect(customLogoModalHtml).toContain('Custom club logo active');
    expect(customLogoModalHtml).toContain('src="/api/v1/branding/logo?v=123"');
    expect(customLogoModalHtml).toContain('Replace logo');
    expect(customLogoModalHtml).toContain('Restore default');
    expect(customLogoModalHtml).toContain('Image still exceeds 256 KB after compression');
  });
});
