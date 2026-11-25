import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider } from '@/features/shared/permissions/can';

const departmentsHookMock = vi.hoisted(() => ({
  useDepartmentsQuery: vi.fn(),
  useCreateDepartmentMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateDepartmentMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteDepartmentMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

vi.mock('@/features/departments/hooks/useDepartments', () => departmentsHookMock);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { DepartmentsAdminView } from '@/features/departments/components/DepartmentsAdminView';
import { DepartmentDeleteModal, DepartmentUpsertModal } from '@/features/departments/components/DepartmentModals';
import { describeDepartmentError } from '@/features/departments/error-mapping';

type DepartmentDto = components['schemas']['DepartmentDto'];

const IN_USE_DEPT: DepartmentDto = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Truyền thông',
  memberCount: 7,
  boardCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const UNUSED_DEPT: DepartmentDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Hậu cần',
  memberCount: 0,
  boardCount: 0,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

function renderWithIntl(node: ReactNode, locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      {node}
    </NextIntlClientProvider>
  );
}

describe('DepartmentsAdminView & DepartmentModals (S11)', () => {
  beforeEach(() => {
    departmentsHookMock.useDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { items: [IN_USE_DEPT, UNUSED_DEPT] },
    });
  });

  it('renders 403 ErrorState when caller lacks department.manage', () => {
    const html = renderWithIntl(
      <PermissionsProvider permissions={['member.view']}>
        <DepartmentsAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('403');
    expect(departmentsHookMock.useDepartmentsQuery).toHaveBeenCalledWith(false);
    expect(html).not.toContain('Truyền thông');
  });

  it('groups departments into In-use and Unused sections with live counts', () => {
    const html = renderWithIntl(
      <PermissionsProvider permissions={['department.manage']}>
        <DepartmentsAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('Đang sử dụng');
    expect(html).toContain('Chưa có thành viên / board');
    expect(html).toContain('7 thành viên');
    expect(html).toContain('2 board');
    expect(html).toContain('0 thành viên');
  });

  it('renders DepartmentUpsertModal with method=post and 409 DEPARTMENT_NAME_EXISTS error', () => {
    const html = renderWithIntl(
      <DepartmentUpsertModal
        mode="create"
        isSubmitting={false}
        error={new ApiClientError({
          status: 409,
          code: 'DEPARTMENT_NAME_EXISTS',
          messageKey: 'errors.departmentNameExists',
          details: {},
        })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
      'en'
    );
    expect(html).toContain('method="post"');
    expect(html).toContain('A department with this name already exists.');
  });

  it('renders DepartmentDeleteModal citing exact memberCount and boardCount on 409 DEPARTMENT_IN_USE', () => {
    const html = renderWithIntl(
      <DepartmentDeleteModal
        department={IN_USE_DEPT}
        isDeleting={false}
        error={new ApiClientError({
          status: 409,
          code: 'DEPARTMENT_IN_USE',
          messageKey: 'errors.departmentInUse',
          details: { memberCount: 7, boardCount: 2 },
        })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(html).toContain('Ban này đang có 7 thành viên và 2 board nên chưa thể xóa.');
    expect(html).toContain('Không thể xóa ban vì vẫn còn 7 thành viên và 2 board liên quan.');
  });

  it('renders requestId and 401 unauthorized copy when departments query fails', () => {
    departmentsHookMock.useDepartmentsQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        status: 401,
        code: 'SESSION_EXPIRED',
        messageKey: 'errors.unauthorized',
        details: {},
        requestId: 'req-dept-401',
      }),
      refetch: vi.fn(),
      data: undefined,
    });

    const html = renderWithIntl(
      <PermissionsProvider permissions={['department.manage']}>
        <DepartmentsAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('Không tải được danh sách ban.');
    expect(html).toContain('Vui lòng đăng nhập để tiếp tục.');
    expect(html).toContain('req-dept-401');
    expect(
      describeDepartmentError(
        new ApiClientError({ status: 401, code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized', details: {} })
      )
    ).toEqual({ key: 'unauthorized' });
  });
});
