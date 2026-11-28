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
import {
  AUDIT_FILTER_ACTION_OPTIONS,
  computeAuditFromIso,
  formatAuditDetailPreview,
  formatAuditTimestamp,
  resolveAuditActionKey,
} from '@/features/audit/formatters';

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

  it('allows audit.view without member.view without querying /members, defaults to all dates, shows Asia/Ho_Chi_Minh time, and has zero edit/delete controls', () => {
    const html = renderAudit({ permissions: ['audit.view'], isAdmin: false });
    expect(auditHooksMock.useAuditLogsInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange: 'all' }),
      true
    );
    expect(auditHooksMock.useAuditMembersFilterQuery).toHaveBeenCalledWith(false);
    expect(html).not.toContain('page-subtitle');
    expect(html).toContain('Tran Thi B');
    expect(html).toContain('Vu Quoc F');
    expect(html).toContain('(đã rời)');
    expect(html).toContain('14:32');
    expect(html).toContain('task.assign');
    expect(html).toContain('board.create');
    expect(html).toContain('Tải thêm');
    expect(html).toContain('Nhật ký không lưu MSSV hay email.');
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
    expect(html).toContain('Logs never store student IDs or emails.');
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
    expect(resolveAuditActionKey('board.created')).toBe('boardCreated');
    expect(resolveAuditActionKey('board.updated')).toBe('boardUpdated');
    expect(resolveAuditActionKey('board.archived')).toBe('boardArchived');
    expect(resolveAuditActionKey('member.password_reset')).toBe('memberPasswordReset');
    expect(resolveAuditActionKey('member.avatar_updated')).toBe('memberAvatarUpdated');
    expect(resolveAuditActionKey('member.avatar_removed')).toBe('memberAvatarRemoved');
    expect(resolveAuditActionKey('branding.logo_updated')).toBe('brandingLogoUpdated');
    expect(resolveAuditActionKey('branding.logo_removed')).toBe('brandingLogoRemoved');
    expect(resolveAuditActionKey('branding.wordmark_updated')).toBe('brandingWordmarkUpdated');
    expect(resolveAuditActionKey('branding.wordmark_removed')).toBe('brandingWordmarkRemoved');

    const pwResetEntry: AuditLogDto = {
      ...ENTRY_PERM,
      action: 'member.password_reset',
      detail: { mustChangePassword: true },
    };
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [pwResetEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const pwResetViHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(pwResetViHtml).toContain('Đặt lại mật khẩu');
    expect(pwResetViHtml).not.toContain('BeamDev');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [pwResetEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    expect(renderAudit({ permissions: ['audit.view'], locale: 'en' })).toContain('Reset member password');

    const boardEntry: AuditLogDto = { ...ENTRY_PERM, action: 'board.archived', targetUser: null, detail: { name: 'Board X' } };
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [boardEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    expect(renderAudit({ permissions: ['audit.view'], locale: 'vi' })).toContain('Lưu trữ board');
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [boardEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    expect(renderAudit({ permissions: ['audit.view'], locale: 'en' })).toContain('Archived board');

    const brandingEntry: AuditLogDto = {
      ...ENTRY_PERM,
      actor: { ...ENTRY_PERM.actor, avatarUrl: '/api/v1/members/u-actor/avatar?v=5' },
      targetUser: null,
      action: 'branding.logo_updated',
      detail: {
        assetKey: 'club_logo',
        mimeType: 'image/webp',
        byteLength: 4096,
      },
    };
    const avatarEntry: AuditLogDto = {
      ...ENTRY_PERM,
      action: 'member.avatar_removed',
      detail: {
        removed: true,
      },
    };
    const pwDetailEntry: AuditLogDto = {
      ...ENTRY_PERM,
      action: 'member.password_reset',
      detail: {
        forceChangeOnLogin: true,
        sessionsRevoked: true,
      },
    };
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [brandingEntry, avatarEntry, pwDetailEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const mediaAuditVi = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(mediaAuditVi).toContain('Cập nhật logo CLB');
    expect(mediaAuditVi).toContain('Xóa ảnh đại diện');
    expect(mediaAuditVi).toContain('src="/api/v1/members/u-actor/avatar?v=5"');
    expect(mediaAuditVi).toContain('Khóa tài nguyên');
    expect(mediaAuditVi).toContain('club_logo');
    expect(mediaAuditVi).toContain('Định dạng ảnh');
    expect(mediaAuditVi).toContain('image/webp');
    expect(mediaAuditVi).toContain('Dung lượng');
    expect(mediaAuditVi).toContain('4.0 KB');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [avatarEntry, pwDetailEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const avatarRemovedEn = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(avatarRemovedEn).toContain('Removed member avatar');
    expect(avatarRemovedEn).toContain('Removed');
    expect(avatarRemovedEn).toContain('Yes');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [pwDetailEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const pwResetDetailEn = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(pwResetDetailEn).toContain('Force password change on sign-in');
    expect(pwResetDetailEn).toContain('Sessions revoked');
    expect(pwResetDetailEn).toContain('Yes');
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

  it('formats archive restore, purge, and retention audit actions and safe metadata in vi and en', () => {
    expect(resolveAuditActionKey('archive.member_restored')).toBe('archiveMemberRestored');
    expect(resolveAuditActionKey('archive.board_restored')).toBe('archiveBoardRestored');
    expect(resolveAuditActionKey('archive.task_purged')).toBe('archiveTaskPurged');
    expect(resolveAuditActionKey('archive.board_purged')).toBe('archiveBoardPurged');
    expect(resolveAuditActionKey('archive.member_purged')).toBe('archiveMemberPurged');
    expect(resolveAuditActionKey('settings.archive_retention_updated')).toBe('archiveRetentionUpdated');

    const retentionEntry: AuditLogDto = {
      ...ENTRY_PERM,
      targetUser: null,
      action: 'settings.archive_retention_updated',
      detail: {
        retentionDays: 30,
        previousRetentionDays: null,
      },
    };
    const boardPurgeEntry: AuditLogDto = {
      ...ENTRY_PERM,
      targetUser: null,
      action: 'archive.board_purged',
      detail: {
        purgeMode: 'marked_purged',
        cascadedTasks: 4,
        boardId: 'board-123',
      },
    };
    const memberPurgeEntry: AuditLogDto = {
      ...ENTRY_PERM,
      targetUser: null,
      action: 'archive.member_purged',
      detail: {
        purgeMode: 'anonymized',
        purgedMemberId: 'member-456',
      },
    };
    const taskPurgeEntry: AuditLogDto = {
      ...ENTRY_PERM,
      targetUser: null,
      action: 'archive.task_purged',
      detail: {
        purgeMode: 'marked_purged',
        taskId: 'task-789',
      },
    };

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [retentionEntry, boardPurgeEntry, memberPurgeEntry, taskPurgeEntry], meta: { nextCursor: null, limit: 20 } }],
      },
    });
    const viHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(viHtml).toContain('Cập nhật thời hạn tự xóa Lưu trữ');
    expect(viHtml).toContain('Xóa vĩnh viễn board');
    expect(viHtml).toContain('Xóa vĩnh viễn thành viên');
    expect(viHtml).toContain('Xóa vĩnh viễn task');
    expect(viHtml).toContain('30 ngày');
    expect(viHtml).toContain('Không tự xóa');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: {
        pages: [{ items: [boardPurgeEntry, retentionEntry, memberPurgeEntry], meta: { nextCursor: null, limit: 20 } }],
      },
    });
    const enHtml = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(enHtml).toContain('Permanently purged board');
    expect(enHtml).toContain('Marked purged');
    expect(enHtml).toContain('Cascaded tasks');
    expect(enHtml).toContain('board-123');
    expect(enHtml).toContain('4');
  });

  it('formats login gallery branding audit actions in vi and en', () => {
    expect(resolveAuditActionKey('branding.gallery_item_created')).toBe('brandingGalleryCreated');
    expect(resolveAuditActionKey('branding.gallery_item_updated')).toBe('brandingGalleryUpdated');
    expect(resolveAuditActionKey('branding.gallery_item_deleted')).toBe('brandingGalleryDeleted');
    expect(resolveAuditActionKey('branding.gallery_reordered')).toBe('brandingGalleryReordered');

    const galleryEntries: AuditLogDto[] = [
      { ...ENTRY_PERM, targetUser: null, action: 'branding.gallery_item_created', detail: { mimeType: 'image/webp' } },
      { ...ENTRY_PERM, targetUser: null, action: 'branding.gallery_item_updated', detail: { updatedFields: ['title', 'caption'] } },
      { ...ENTRY_PERM, targetUser: null, action: 'branding.gallery_item_deleted', detail: { itemId: 'item-1' } },
      { ...ENTRY_PERM, targetUser: null, action: 'branding.gallery_reordered', detail: { itemIds: ['a', 'b'] } },
    ];

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: galleryEntries, meta: { nextCursor: null, limit: 20 } }] },
    });
    const viHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(viHtml).toContain('Thêm ảnh trang đăng nhập');
    expect(viHtml).toContain('Cập nhật ảnh trang đăng nhập');
    expect(viHtml).toContain('Xóa ảnh trang đăng nhập');
    expect(viHtml).toContain('Sắp xếp lại ảnh trang đăng nhập');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: galleryEntries, meta: { nextCursor: null, limit: 20 } }] },
    });
    const enHtml = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(enHtml).toContain('Added login gallery photo');
    expect(enHtml).toContain('Updated login gallery photo');
    expect(enHtml).toContain('Deleted login gallery photo');
    expect(enHtml).toContain('Reordered login gallery');

    const wordmarkEntries: AuditLogDto[] = [
      { ...ENTRY_PERM, targetUser: null, action: 'branding.wordmark_updated', detail: { assetKey: 'club_wordmark', mimeType: 'image/webp', byteLength: 2048 } },
      { ...ENTRY_PERM, targetUser: null, action: 'branding.wordmark_removed', detail: { assetKey: 'club_wordmark', removed: true } },
    ];
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: wordmarkEntries, meta: { nextCursor: null, limit: 20 } }] },
    });
    const wordmarkViHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(wordmarkViHtml).toContain('Cập nhật ảnh chữ CLB');
    expect(wordmarkViHtml).toContain('Khôi phục chữ CLB mặc định');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: wordmarkEntries, meta: { nextCursor: null, limit: 20 } }] },
    });
    const wordmarkEnHtml = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(wordmarkEnHtml).toContain('Updated club wordmark');
    expect(wordmarkEnHtml).toContain('Restored default club wordmark');
  });

  it('supports settings.reminders_updated filter, empty/non-empty daysBefore preview, and remindOverdue detail pane in vi/en', () => {
    expect(AUDIT_FILTER_ACTION_OPTIONS).toContainEqual({
      value: 'settings.reminders_updated',
      key: 'remindersUpdated',
    });
    expect(resolveAuditActionKey('settings.reminders_updated')).toBe('remindersUpdated');
    expect(resolveAuditActionKey('reminders.updated')).toBe('remindersUpdated');

    expect(formatAuditDetailPreview({ daysBefore: [2, 1], remindOverdue: true })).toBe(
      '[2, 1] · overdue=yes'
    );
    expect(formatAuditDetailPreview({ daysBefore: [], remindOverdue: false })).toBe(
      '[] · overdue=no'
    );

    const remindersOnEntry: AuditLogDto = {
      ...ENTRY_PERM,
      targetUser: null,
      action: 'settings.reminders_updated',
      detail: { daysBefore: [2, 1], remindOverdue: true },
    };
    const remindersOffEntry: AuditLogDto = {
      ...ENTRY_PERM,
      id: '90000000-0000-4000-8000-000000000099',
      targetUser: null,
      action: 'settings.reminders_updated',
      detail: { daysBefore: [], remindOverdue: false },
    };

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [remindersOffEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const viOffHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(viOffHtml).toContain('value="settings.reminders_updated"');
    expect(viOffHtml).toContain('Cập nhật nhắc deadline');
    expect(viOffHtml).toContain('[] · overdue=no');
    expect(viOffHtml).toContain('Mốc nhắc');
    expect(viOffHtml).toContain('Không có ([])');
    expect(viOffHtml).toContain('Nhắc task quá hạn');
    expect(viOffHtml).toContain('>Không<');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [remindersOnEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const enOnHtml = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(enOnHtml).toContain('Updated reminders');
    expect(enOnHtml).toContain('[2, 1] · overdue=yes');
    expect(enOnHtml).toContain('Reminder schedule');
    expect(enOnHtml).toContain('2, 1');
    expect(enOnHtml).toContain('Remind overdue tasks');
    expect(enOnHtml).toContain('>Yes<');
  });

  it('localizes member.bootstrap_admin action and filter option in vi and en', () => {
    expect(resolveAuditActionKey('member.bootstrap_admin')).toBe('memberBootstrapAdmin');
    expect(AUDIT_FILTER_ACTION_OPTIONS).toContainEqual({
      value: 'member.bootstrap_admin',
      key: 'memberBootstrapAdmin',
    });

    const bootstrapEntry: AuditLogDto = {
      ...ENTRY_PERM,
      action: 'member.bootstrap_admin',
      detail: { isAdmin: true },
    };

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [bootstrapEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const viHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(viHtml).toContain('value="member.bootstrap_admin"');
    expect(viHtml).toContain('Khởi tạo Admin hệ thống');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [bootstrapEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const enHtml = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(enHtml).toContain('value="member.bootstrap_admin"');
    expect(enHtml).toContain('Bootstrapped system admin');
  });

  it('formats department leadUserId metadata in preview and detail pane without leaking raw UUID or PII', () => {
    const leadUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(formatAuditDetailPreview({ departmentId: 'd-1', name: 'Truyền thông', leadUserId: leadUuid })).toBe(
      'Truyền thông · lead=assigned'
    );
    expect(formatAuditDetailPreview({ departmentId: 'd-1', name: 'Truyền thông', leadUserId: null })).toBe(
      'Truyền thông · lead=cleared'
    );
    expect(formatAuditDetailPreview({ leadUserId: leadUuid })).toBe('lead=assigned');

    const deptLeadAssigned: AuditLogDto = {
      ...ENTRY_PERM,
      targetUser: null,
      action: 'department.updated',
      detail: { departmentId: 'd-1', name: 'Truyền thông', leadUserId: leadUuid },
    };
    const deptLeadCleared: AuditLogDto = {
      ...ENTRY_PERM,
      id: '90000000-0000-4000-8000-000000000088',
      targetUser: null,
      action: 'department.updated',
      detail: { departmentId: 'd-1', name: 'Truyền thông', leadUserId: null },
    };

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [deptLeadAssigned, deptLeadCleared], meta: { nextCursor: null, limit: 20 } }] },
    });
    const viHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(viHtml).toContain('Cập nhật ban');
    expect(viHtml).toContain('Đã gán Trưởng ban');
    expect(viHtml).not.toContain(leadUuid);

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(),
      data: { pages: [{ items: [deptLeadCleared], meta: { nextCursor: null, limit: 20 } }] },
    });
    const enHtml = renderAudit({ permissions: ['audit.view'], locale: 'en' });
    expect(enHtml).toContain('Updated department');
    expect(enHtml).toContain('Unassigned');
    expect(enHtml).not.toContain(leadUuid);
  });

  it('supports all 12 CR-14 task audit actions, redacts hidden task titles, and renders member metadata rows', () => {
    const actions = [
      'task.created',
      'task.updated',
      'task.completed',
      'task.reopened',
      'task.assignees_changed',
      'task.accepted',
      'task.deliverable_added',
      'task.deliverable_removed',
      'task.hidden_changed',
      'task.deleted',
      'task.restored',
      'task.reverted',
    ] as const;

    for (const action of actions) {
      expect(resolveAuditActionKey(action)).toBeTruthy();
    }

    expect(
      formatAuditDetailPreview(
        { taskId: 't-1', taskTitle: 'Chốt banner sự kiện', isHidden: false },
        '(Công việc ẩn)'
      )
    ).toBe('Chốt banner sự kiện');
    expect(
      formatAuditDetailPreview(
        { taskId: 't-2', taskTitle: null, isHidden: true },
        '(Công việc ẩn)'
      )
    ).toBe('(Công việc ẩn)');
    expect(
      formatAuditDetailPreview(
        { taskId: 't-2', taskTitle: 'SECRET_SHOULD_NOT_SHOW', isHidden: true },
        '(Hidden task)'
      )
    ).toBe('(Hidden task)');
    expect(
      formatAuditDetailPreview({ grantedPermissions: ['member.view', 'task.create'] })
    ).toContain('member.view, task.create');

    const hiddenTaskEntry: AuditLogDto = {
      ...ENTRY_PERM,
      action: 'task.created',
      targetUser: null,
      detail: { taskId: 't-hid', taskTitle: null, isHidden: true, assigneeCount: 2, departmentCount: 1 },
    };
    const memberCreatedEntry: AuditLogDto = {
      ...ENTRY_PERM,
      id: '90000000-0000-4000-8000-000000000089',
      action: 'member.created',
      detail: { grantedPermissions: ['member.view', 'task.update_assigned'] },
    };
    const revertedTaskEntry: AuditLogDto = {
      ...ENTRY_PERM,
      id: '90000000-0000-4000-8000-000000000090',
      action: 'task.reverted',
      targetUser: null,
      detail: {
        taskId: 't-rev',
        taskTitle: 'Chốt banner sự kiện',
        isHidden: false,
        revertedType: 'task.updated',
        departmentCount: 1,
        departmentIds: ['d-1'],
      },
    };
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [hiddenTaskEntry, memberCreatedEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const viHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(viHtml).toContain('value="task.created"');
    expect(viHtml).toContain('value="task.deliverable_added"');
    expect(viHtml).toContain('Tạo công việc');
    expect(viHtml).toContain('(Công việc ẩn)');
    expect(viHtml).toContain('member.view, task.update_assigned');

    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [memberCreatedEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const memberViHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(memberViHtml).toContain('Quyền được cấp');
    expect(memberViHtml).toContain('member.view, task.update_assigned');

    expect(formatAuditDetailPreview({ revertedType: 'task.moved' })).toBe('task.moved');
    expect(formatAuditDetailPreview({ revertedEventType: 'task.updated' })).toBe('task.updated');
    auditHooksMock.useAuditLogsInfiniteQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [revertedTaskEntry], meta: { nextCursor: null, limit: 20 } }] },
    });
    const revertedViHtml = renderAudit({ permissions: ['audit.view'], locale: 'vi' });
    expect(revertedViHtml).toContain('Loại sự kiện đã hoàn tác');
    expect(revertedViHtml).toContain('task.updated');
    expect(revertedViHtml).toContain('Số ban được giao');
    expect(revertedViHtml).not.toContain('<span>Số ban</span>');
  });
});
