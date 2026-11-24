import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const auditHooksMock = vi.hoisted(() => ({
  useAuditLogsInfiniteQuery: vi.fn(),
  useAuditMembersFilterQuery: vi.fn(),
}));

vi.mock('@/features/audit/hooks/useAuditLogs', async () => {
  const actual = await vi.importActual<typeof import('@/features/audit/hooks/useAuditLogs')>(
    '@/features/audit/hooks/useAuditLogs'
  );
  return {
    ...actual,
    ...auditHooksMock,
  };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { AuditLogsView } from '@/features/audit/components/AuditLogsView';
import { describeAuditError } from '@/features/audit/error-mapping';
import { computeAuditFromIso, formatAuditTimestamp } from '@/features/audit/formatters';

type AuditLogDto = components['schemas']['AuditLogDto'];

const ENTRY_PERM: AuditLogDto = {
  id: '90000000-0000-4000-8000-000000000001',
  actor: {
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'Tran Thi B',
    isActive: true,
    leftAt: null,
    departments: [],
  },
  targetUser: {
    id: '00000000-0000-4000-8000-000000000003',
    fullName: 'Vu Quoc F',
    isActive: false,
    leftAt: '2026-10-01T00:00:00Z',
    departments: [],
  },
  action: 'permissions.updated',
  detail: {
    added: ['task.assign'],
    removed: ['board.create'],
  },
  createdAt: '2026-11-23T07:32:08Z',
};

function renderAudit(options: {
  permissions?: PermissionCode[];
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
}) {
  const locale = options.locale ?? 'vi';
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>
        <AuditLogsView />
      </PermissionsProvider>
    </NextIntlClientProvider>
  );
}

describe('AuditLogsView & S13 helpers', () => {
  beforeEach(() => {
    auditHooksMock.useAuditMembersFilterQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            fullName: 'Tran Thi B',
            isActive: true,
            leftAt: null,
            departments: [],
          },
        ],
      },
    });
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [ENTRY_PERM], meta: { nextCursor: 'cur-2', limit: 20 } }],
      },
    });
  });

  it('renders 403 ErrorState and disables audit & member queries when missing audit.view', () => {
    const html = renderAudit({ permissions: ['member.view'] });
    expect(html).toContain('403');
    expect(html).toContain('Bạn không xem được nhật ký');
    expect(auditHooksMock.useAuditLogsInfiniteQuery).toHaveBeenCalledWith(expect.any(Object), false);
    expect(auditHooksMock.useAuditMembersFilterQuery).toHaveBeenCalledWith(false);
  });

  it('allows audit.view without member.view without querying /members, shows Asia/Ho_Chi_Minh time, and has zero edit/delete controls', () => {
    const html = renderAudit({ permissions: ['audit.view'], isAdmin: false });
    expect(auditHooksMock.useAuditLogsInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange: '30d' }),
      true
    );
    expect(auditHooksMock.useAuditMembersFilterQuery).toHaveBeenCalledWith(false);
    expect(html).toContain('Tran Thi B');
    expect(html).toContain('Vu Quoc F');
    expect(html).toContain('(đã rời)');
    expect(html).toContain('14:32');
    expect(html).toContain('task.assign');
    expect(html).toContain('board.create');
    expect(html).toContain('Tải thêm');
    expect(html).toContain('Bản ghi không chứa MSSV hay email');
    expect(html).not.toContain('Lọc theo người thực hiện');
    expect(html).not.toContain('>Sửa<');
    expect(html).not.toContain('>Xóa<');
  });

  it('enables member actor/target selects when user has audit.view + member.view, and remains read-only for admins', () => {
    const html = renderAudit({ isAdmin: true, locale: 'en' });
    expect(auditHooksMock.useAuditMembersFilterQuery).toHaveBeenCalledWith(true);
    expect(html).toContain('Filter by actor');
    expect(html).toContain('Filter by target');
    expect(html).toContain('Load more');
    expect(html).toContain('Records hold no student ID or email');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('>Delete<');
  });

  it('renders empty state with Clear filters button and formats UTC->UTC+7 timestamps', () => {
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 20 } }] },
    });

    const html = renderAudit({ permissions: ['audit.view'] });
    expect(html).toContain('Không có bản ghi nào');
    expect(html).toContain('Xóa lọc');
    expect(formatAuditTimestamp('2026-11-23T07:32:08Z', 'vi', true)).toContain('14:32:08');
    expect(computeAuditFromIso('all')).toBeUndefined();
    expect(computeAuditFromIso('30d', Date.UTC(2026, 10, 24))).toBe('2026-10-25T00:00:00.000Z');
  });

  it('renders ErrorState with requestId and maps INVALID_DATE_RANGE / 403 / INVALID_CURSOR cleanly', () => {
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        status: 403,
        code: 'FORBIDDEN',
        messageKey: 'errors.forbidden',
        details: {},
        requestId: 'req-audit-403',
      }),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: undefined,
    });

    const html = renderAudit({ permissions: ['audit.view'] });
    expect(html).toContain('403');
    expect(html).toContain('req-audit-403');

    expect(
      describeAuditError(
        new ApiClientError({ status: 400, code: 'INVALID_DATE_RANGE', messageKey: 'errors.invalidDateRange', details: {}, requestId: 'req-d' })
      )
    ).toEqual({ key: 'invalidDateRange', requestId: 'req-d' });
    expect(
      describeAuditError(
        new ApiClientError({ status: 400, code: 'INVALID_CURSOR', messageKey: 'errors.invalidCursor', details: {} })
      )
    ).toEqual({ key: 'invalidCursor', requestId: undefined });
  });
});
