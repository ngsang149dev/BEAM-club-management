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
  useDepartmentLeadCandidatesQuery: vi.fn(),
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
import {
  buildDepartmentUpsertPayload,
  buildLeadSelectOptions,
  DepartmentDeleteModal,
  DepartmentUpsertModal,
} from '@/features/departments/components/DepartmentModals';
import { describeDepartmentError } from '@/features/departments/error-mapping';

type DepartmentDto = components['schemas']['DepartmentDto'];
type MemberPublicSummary = components['schemas']['MemberPublicSummary'];

const ACTIVE_LEAD: MemberPublicSummary = {
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'Nguyễn Văn A',
  isActive: true,
  leftAt: null,
  departments: [],
};

const INACTIVE_LEAD: MemberPublicSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  fullName: 'Vũ Quốc F',
  isActive: false,
  leftAt: '2026-01-01T00:00:00Z',
  departments: [],
};

const IN_USE_DEPT: DepartmentDto = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Truyền thông',
  lead: ACTIVE_LEAD,
  memberCount: 7,
  boardCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const UNUSED_DEPT: DepartmentDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Hậu cần',
  lead: null,
  memberCount: 0,
  boardCount: 0,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const INACTIVE_LEAD_DEPT: DepartmentDto = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Đối ngoại',
  lead: INACTIVE_LEAD,
  memberCount: 2,
  boardCount: 1,
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
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
    vi.clearAllMocks();
    departmentsHookMock.useDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { items: [IN_USE_DEPT, UNUSED_DEPT] },
    });
    departmentsHookMock.useDepartmentLeadCandidatesQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [ACTIVE_LEAD], meta: { nextCursor: null, limit: 100 } },
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
    expect(departmentsHookMock.useDepartmentLeadCandidatesQuery).toHaveBeenCalledWith(false);
    expect(html).not.toContain('Truyền thông');
  });

  it('groups departments into In-use and Unused sections, displays Lead badges, and gates /members fetch on member.view', () => {
    const html = renderWithIntl(
      <PermissionsProvider permissions={['department.manage']}>
        <DepartmentsAdminView />
      </PermissionsProvider>
    );
    expect(departmentsHookMock.useDepartmentLeadCandidatesQuery).toHaveBeenCalledWith(false);
    expect(html).toContain('Đang sử dụng');
    expect(html).toContain('Chưa có thành viên / board');
    expect(html).toContain('Trưởng ban: Nguyễn Văn A');
    expect(html).toContain('Chưa có trưởng ban');
    expect(html).toContain('7 thành viên');
    expect(html).toContain('2 board');
    expect(html).toContain('0 thành viên');

    departmentsHookMock.useDepartmentsQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { items: [INACTIVE_LEAD_DEPT, UNUSED_DEPT] },
    });
    const withMembersHtml = renderWithIntl(
      <PermissionsProvider permissions={['department.manage', 'member.view']}>
        <DepartmentsAdminView />
      </PermissionsProvider>,
      'en'
    );
    expect(departmentsHookMock.useDepartmentLeadCandidatesQuery).toHaveBeenLastCalledWith(true);
    expect(withMembersHtml).toContain('Lead: Vũ Quốc F');
    expect(withMembersHtml).toContain('(left)');
    expect(withMembersHtml).toContain('No lead assigned');
  });

  it('renders Lead selector in create/edit modals, preserves inactive lead fallback, maps empty to null, and handles INVALID_DEPARTMENT_LEAD', () => {
    const hiddenSelectorHtml = renderWithIntl(
      <DepartmentUpsertModal
        mode="rename"
        department={IN_USE_DEPT}
        showLeadSelector={false}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(hiddenSelectorHtml).not.toContain('<select');
    expect(buildDepartmentUpsertPayload({ name: '  Truyền thông  ', leadUserId: '' }, false)).toEqual({
      name: 'Truyền thông',
    });

    const editInactiveLeadHtml = renderWithIntl(
      <DepartmentUpsertModal
        mode="rename"
        department={INACTIVE_LEAD_DEPT}
        leadCandidates={[ACTIVE_LEAD]}
        showLeadSelector
        isSubmitting={false}
        error={new ApiClientError({
          status: 400,
          code: 'INVALID_DEPARTMENT_LEAD',
          messageKey: 'errors.invalidDepartmentLead',
          details: {},
        })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(editInactiveLeadHtml).toContain('class="ui-select"');
    expect(editInactiveLeadHtml).toContain('<option value="">Chưa gán</option>');
    expect(editInactiveLeadHtml).toContain(`value="${INACTIVE_LEAD.id}" selected=""`);
    expect(editInactiveLeadHtml).toContain('Vũ Quốc F (đã rời)');
    expect(editInactiveLeadHtml).toContain('Trưởng ban được chọn không tồn tại hoặc không còn hoạt động.');

    expect(buildLeadSelectOptions([ACTIVE_LEAD], INACTIVE_LEAD, '(left)')).toEqual([
      { id: INACTIVE_LEAD.id, label: 'Vũ Quốc F (left)' },
      { id: ACTIVE_LEAD.id, label: 'Nguyễn Văn A' },
    ]);
    expect(buildDepartmentUpsertPayload({ name: '  Hậu cần  ', leadUserId: '' }, true)).toEqual({
      name: 'Hậu cần',
      leadUserId: null,
    });
    expect(buildDepartmentUpsertPayload({ name: 'Truyền thông', leadUserId: ACTIVE_LEAD.id }, true)).toEqual({
      name: 'Truyền thông',
      leadUserId: ACTIVE_LEAD.id,
    });
    expect(
      describeDepartmentError(
        new ApiClientError({ status: 400, code: 'INVALID_DEPARTMENT_LEAD', messageKey: 'errors.invalidDepartmentLead', details: {} })
      )
    ).toEqual({ key: 'invalidDepartmentLead' });
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
