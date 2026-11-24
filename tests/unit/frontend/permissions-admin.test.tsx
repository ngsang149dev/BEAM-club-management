import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider } from '@/features/shared/permissions/can';
import { PERMISSIONS, PERMISSION_PRESETS } from '@/lib/permissions';

const permHooksMock = vi.hoisted(() => ({
  usePermissionCatalogQuery: vi.fn(),
  usePermissionPresetsQuery: vi.fn(),
  usePermissionMembersQuery: vi.fn(),
  useMemberPermissionsQuery: vi.fn(),
  useReplaceMemberPermissionsMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useApplyPermissionPresetMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateAdminFlagMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

vi.mock('@/features/permissions/hooks/usePermissionsAdmin', () => permHooksMock);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { AdminFlagPanel } from '@/features/permissions/components/AdminFlagPanel';
import { PermissionPresetModal } from '@/features/permissions/components/PermissionPresetModal';
import { PermissionsAdminView } from '@/features/permissions/components/PermissionsAdminView';
import { describePermissionsError } from '@/features/permissions/error-mapping';

type MemberDetail = components['schemas']['MemberDetail'];

const ACTIVE_MEMBER: MemberDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Nguyen Van A',
  isActive: true,
  leftAt: null,
  departments: [{ id: 'd-1', name: 'Truyền thông' }],
  studentId: '21110001',
  email: 'nva@eiu.edu.vn',
  locale: 'vi',
  isAdmin: false,
  mustChangePassword: false,
};

const INACTIVE_ADMIN: MemberDetail = {
  id: '00000000-0000-4000-8000-000000000002',
  fullName: 'Tran Thi B',
  isActive: false,
  leftAt: '2026-10-01T00:00:00Z',
  departments: [],
  studentId: '21110002',
  email: 'ttb@eiu.edu.vn',
  locale: 'vi',
  isAdmin: true,
  mustChangePassword: false,
};

function renderWithIntl(node: ReactNode, locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      {node}
    </NextIntlClientProvider>
  );
}

describe('PermissionsAdminView & S10 components', () => {
  beforeEach(() => {
    permHooksMock.usePermissionCatalogQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: PERMISSIONS.map((perm) => ({
          code: perm.code,
          groupName: perm.group,
          description: perm.descriptionKey,
          scopable: false,
        })),
      },
    });
    permHooksMock.usePermissionPresetsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: PERMISSION_PRESETS.map((preset, index) => ({
          id: `30000000-0000-4000-8000-00000000000${index + 1}`,
          code: preset.code,
          name: preset.code,
          description: null,
          permissionCodes: [...preset.permissions],
        })),
      },
    });
    permHooksMock.usePermissionMembersQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [ACTIVE_MEMBER, INACTIVE_ADMIN], meta: { nextCursor: null, limit: 50 } }] },
    });
    permHooksMock.useMemberPermissionsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: {
        userId: ACTIVE_MEMBER.id,
        isAdmin: false,
        permissionCodes: ['member.view', 'task.update_assigned', 'comment.create'],
      },
    });
  });

  it('renders 403 ErrorState and fires zero admin API calls for non-admins even with member.update (AC-08)', () => {
    const html = renderWithIntl(
      <PermissionsProvider isAdmin={false} permissions={['member.view', 'member.update']}>
        <PermissionsAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('403');
    expect(html).toContain('Chỉ admin xem được phân quyền');
    expect(permHooksMock.usePermissionCatalogQuery).toHaveBeenCalledWith(false);
    expect(permHooksMock.usePermissionPresetsQuery).toHaveBeenCalledWith(false);
    expect(permHooksMock.usePermissionMembersQuery).toHaveBeenCalledWith('', false);
    expect(permHooksMock.useMemberPermissionsQuery).toHaveBeenCalledWith(null, false);
    expect(html).not.toContain('member.view_detail');
  });

  it('renders all 6 permission groups, 18 codes, effective summary bar, presets, and no MSSV/email', () => {
    const html = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <PermissionsAdminView />
      </PermissionsProvider>
    );
    for (const perm of PERMISSIONS) {
      expect(html).toContain(perm.code);
    }
    expect(html).toContain('Thành viên');
    expect(html).toContain('Hệ thống');
    expect(html).toContain('3 quyền đang bật');
    expect(html).toContain('member.view · task.update_assigned · comment.create');
    expect(html).toContain('Lưu thay đổi');
    expect(html).toContain('(đã rời)');
    expect(html).not.toContain('21110001');
    expect(html).not.toContain('nva@eiu.edu.vn');
  });

  it('renders localized groups and presets cleanly in English locale', () => {
    const html = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <PermissionsAdminView />
      </PermissionsProvider>,
      'en'
    );
    expect(html).toContain('Basic member');
    expect(html).toContain('Department lead');
    expect(html).toContain('People manager');
    expect(html).toContain('3 permissions on');
    expect(html).toContain('Departments');
    expect(html).toContain('System');
  });

  it('renders PermissionPresetModal with exact +added and -removed counts (WQ-06)', () => {
    const leadPreset = PERMISSION_PRESETS.find((p) => p.code === 'department_lead');
    expect(leadPreset).toBeDefined();
    if (!leadPreset) return;

    const html = renderWithIntl(
      <PermissionPresetModal
        preset={{ code: leadPreset.code, permissionCodes: leadPreset.permissions }}
        currentPermissions={['member.view', 'task.update_assigned', 'comment.create', 'department.manage']}
        isApplying={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(html).toContain('Thay bằng mẫu “Trưởng ban”?');
    expect(html).toContain('+6');
    expect(html).toContain('-1');
  });

  it('renders 409 LAST_ACTIVE_ADMIN banner with requestId in AdminFlagPanel (AC-09 / WQ-07)', () => {
    const error = new ApiClientError({
      status: 409,
      code: 'LAST_ACTIVE_ADMIN',
      messageKey: 'errors.lastActiveAdmin',
      details: {},
      requestId: 'req-admin-409',
    });
    const html = renderWithIntl(
      <AdminFlagPanel
        memberName="Tran Thi B"
        isAdmin
        isUpdating={false}
        error={error}
        onToggleAdmin={vi.fn()}
      />
    );
    expect(html).toContain('Không thể gỡ quyền admin cuối cùng');
    expect(html).toContain('Không thể vô hiệu hóa hoặc gỡ quyền admin hoạt động cuối cùng.');
    expect(html).toContain('req-admin-409');
    expect(describePermissionsError(error)).toEqual({ key: 'lastActiveAdmin', requestId: 'req-admin-409' });
  });

  it('surfaces requestId on API 403 error from query', () => {
    permHooksMock.usePermissionMembersQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        status: 403,
        code: 'FORBIDDEN',
        messageKey: 'errors.forbidden',
        details: {},
        requestId: 'req-perm-403',
      }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });

    const html = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <PermissionsAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('403');
    expect(html).toContain('req-perm-403');
  });
});
