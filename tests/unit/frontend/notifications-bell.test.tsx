import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import type { components } from '@/features/shared/api/client';

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

const notifHooksMock = vi.hoisted(() => ({
  useNotificationsQuery: vi.fn(),
  useMarkNotificationReadMutation: vi.fn(),
  useMarkAllNotificationsReadMutation: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navMock,
}));

vi.mock('@/features/notifications/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/features/notifications/hooks/useNotifications')>(
    '@/features/notifications/hooks/useNotifications'
  );
  return { ...actual, ...notifHooksMock };
});

import {
  NotificationBell,
  resolveNotificationMessage,
  selectNotificationItem,
} from '@/features/notifications/components/NotificationBell';
import {
  NOTIFICATIONS_QUERY_KEYS,
  buildMarkAllNotificationsReadMutationOptions,
  buildMarkNotificationReadMutationOptions,
} from '@/features/notifications/hooks/useNotifications';

type NotificationDto = components['schemas']['NotificationDto'];
type NotificationPageResponse = components['schemas']['NotificationPageResponse'];

const ACTOR = {
  id: 'u-lead',
  fullName: 'Tran Thi Lead',
  isActive: true,
  leftAt: null,
  departments: [],
};

const PUBLIC_DEPT_NOTIF: NotificationDto = {
  id: 'n-1',
  type: 'task.department_assigned',
  taskId: 't-public',
  boardId: 'b-media',
  departmentId: 'd-comm',
  departmentName: 'Truyền thông',
  boardName: 'Kế hoạch Q4',
  taskTitle: 'Thiết kế banner sự kiện',
  isHiddenTask: false,
  actor: ACTOR,
  readAt: null,
  createdAt: '2026-11-24T07:30:00Z',
};

const HIDDEN_DEPT_NOTIF: NotificationDto = {
  id: 'n-2',
  type: 'task.department_assigned',
  taskId: 't-hidden',
  boardId: 'b-media',
  departmentId: 'd-comm',
  departmentName: 'Truyền thông',
  boardName: 'Ban điều hành',
  taskTitle: null,
  isHiddenTask: true,
  actor: ACTOR,
  readAt: '2026-11-24T08:00:00Z',
  createdAt: '2026-11-24T07:45:00Z',
};

const DIRECT_ASSIGNED_NOTIF: NotificationDto = {
  id: 'n-3',
  type: 'task.assigned',
  taskId: 't-direct',
  boardId: 'b-ops',
  departmentId: null,
  departmentName: null,
  boardName: 'Hậu cần',
  taskTitle: 'Kiểm tra âm thanh',
  isHiddenTask: false,
  actor: ACTOR,
  readAt: null,
  createdAt: '2026-11-24T09:00:00Z',
};

function renderBell(
  node: ReactNode,
  options: { locale?: 'vi' | 'en'; withQueryClient?: boolean } = {}
) {
  const locale = options.locale ?? 'vi';
  const messages = locale === 'vi' ? viMessages : enMessages;
  const wrapped =
    options.withQueryClient === false ? (
      node
    ) : (
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    );
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
      {wrapped}
    </NextIntlClientProvider>
  );
}

describe('NotificationBell (CR-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifHooksMock.useMarkNotificationReadMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    notifHooksMock.useMarkAllNotificationsReadMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    notifHooksMock.useNotificationsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        items: [PUBLIC_DEPT_NOTIF, HIDDEN_DEPT_NOTIF, DIRECT_ASSIGNED_NOTIF],
        unreadCount: 2,
        meta: { nextCursor: null, limit: 20 },
      } satisfies NotificationPageResponse,
    });
  });

  it('renders bell unread badge (including 99+ cap) and omits badge when unreadCount is 0', () => {
    const withBadge = renderBell(<NotificationBell />);
    expect(withBadge).toContain('notif-bell-btn');
    expect(withBadge).toContain('<span class="notif-badge" aria-hidden="true">2</span>');
    expect(withBadge).toContain('2 thông báo chưa đọc');

    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: { items: [], unreadCount: 120, meta: { nextCursor: null, limit: 20 } },
    });
    expect(renderBell(<NotificationBell />)).toContain('>99+<');

    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: { items: [], unreadCount: 0, meta: { nextCursor: null, limit: 20 } },
    });
    const zeroHtml = renderBell(<NotificationBell />);
    expect(zeroHtml).not.toContain('notif-badge');
  });

  it('opens popover, formats Asia/Ho_Chi_Minh timestamps, and enforces WQ-27 hidden task redaction', () => {
    const htmlVi = renderBell(<NotificationBell defaultOpen />, { locale: 'vi' });
    expect(htmlVi).toContain('role="dialog"');
    expect(htmlVi).toContain('Đánh dấu đã đọc tất cả');
    expect(htmlVi).toContain('Tran Thi Lead đã giao &quot;Thiết kế banner sự kiện&quot; cho ban Truyền thông');
    expect(htmlVi).toContain('Một công việc ẩn đã được giao cho ban Truyền thông');
    expect(htmlVi).toContain('Tran Thi Lead đã giao &quot;Kiểm tra âm thanh&quot; cho bạn');
    expect(htmlVi).toContain('14:30');
    expect(htmlVi).toContain('notif-item is-unread');
    expect(htmlVi).not.toContain('@eiu.edu.vn');
    expect(htmlVi).not.toContain('studentId');

    // Even if a stale/malformed item has a non-null taskTitle alongside isHiddenTask=true, WQ-27 suppresses it
    const leakedGuardItem: NotificationDto = {
      ...HIDDEN_DEPT_NOTIF,
      id: 'n-secret',
      taskTitle: 'SECRET_EXECUTIVE_PLAN',
      isHiddenTask: true,
    };
    const directHiddenItem: NotificationDto = {
      ...DIRECT_ASSIGNED_NOTIF,
      id: 'n-direct-secret',
      taskTitle: 'SECRET_DIRECT_TASK',
      isHiddenTask: true,
    };
    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        items: [leakedGuardItem, DIRECT_ASSIGNED_NOTIF, directHiddenItem],
        unreadCount: 2,
        meta: { nextCursor: null, limit: 20 },
      },
    });
    const htmlEn = renderBell(<NotificationBell defaultOpen />, { locale: 'en' });
    expect(htmlEn).toContain('A hidden task was assigned to Truyền thông');
    expect(htmlEn).toContain('Tran Thi Lead assigned &quot;Kiểm tra âm thanh&quot; to you');
    expect(htmlEn).toContain('A hidden task was assigned to you');
    expect(htmlEn).not.toContain('SECRET_EXECUTIVE_PLAN');
    expect(htmlEn).not.toContain('SECRET_DIRECT_TASK');
    expect(htmlEn).toContain('Mark all read');

    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        items: [DIRECT_ASSIGNED_NOTIF, directHiddenItem],
        unreadCount: 2,
        meta: { nextCursor: null, limit: 20 },
      },
    });
    const directViHtml = renderBell(<NotificationBell defaultOpen />, { locale: 'vi' });
    expect(directViHtml).toContain('Tran Thi Lead đã giao &quot;Kiểm tra âm thanh&quot; cho bạn');
    expect(directViHtml).toContain('Một công việc ẩn đã được giao cho bạn');
    expect(directViHtml).not.toContain('SECRET_DIRECT_TASK');

    const fakeT = ((key: string) => key) as unknown as Parameters<typeof resolveNotificationMessage>[1];
    expect(resolveNotificationMessage(leakedGuardItem, fakeT)).toBe('hiddenTaskDepartmentAssigned');
    expect(resolveNotificationMessage({ ...leakedGuardItem, type: 'task.assigned' }, fakeT)).toBe('hiddenTaskAssigned');
  });

  it('renders loading, error retry, and empty popover states cleanly', () => {
    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: true,
      isError: false,
      refetch: vi.fn(),
      data: undefined,
    });
    expect(renderBell(<NotificationBell defaultOpen />)).toContain('Đang tải thông báo...');

    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: false,
      isError: true,
      refetch: vi.fn(),
      data: undefined,
    });
    const errorHtml = renderBell(<NotificationBell defaultOpen />);
    expect(errorHtml).toContain('Không tải được danh sách thông báo.');
    expect(errorHtml).toContain('Thử lại');

    notifHooksMock.useNotificationsQuery.mockReturnValueOnce({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: { items: [], unreadCount: 0, meta: { nextCursor: null, limit: 20 } },
    });
    const emptyHtml = renderBell(<NotificationBell defaultOpen />);
    expect(emptyHtml).toContain('Chưa có thông báo nào');
    expect(emptyHtml).toContain('disabled=""');
  });

  it('marks unread item as read on click, skips markRead for read item, and navigates to /boards/[id]?task=[id]', () => {
    const closePopover = vi.fn();
    const markRead = vi.fn();
    const navigate = vi.fn();

    selectNotificationItem({ item: PUBLIC_DEPT_NOTIF, closePopover, markRead, navigate });
    expect(closePopover).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith('n-1');
    expect(navigate).toHaveBeenCalledWith('/boards/b-media?task=t-public');

    closePopover.mockClear();
    markRead.mockClear();
    navigate.mockClear();

    selectNotificationItem({ item: HIDDEN_DEPT_NOTIF, closePopover, markRead, navigate });
    expect(closePopover).toHaveBeenCalledTimes(1);
    expect(markRead).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/boards/b-media?task=t-hidden');
  });

  it('updates QueryClient cache for mark-read and mark-all-read mutations', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<NotificationPageResponse>(NOTIFICATIONS_QUERY_KEYS.list(), {
      items: [PUBLIC_DEPT_NOTIF, HIDDEN_DEPT_NOTIF, DIRECT_ASSIGNED_NOTIF],
      unreadCount: 2,
      meta: { nextCursor: null, limit: 20 },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const markOneOpts = buildMarkNotificationReadMutationOptions(queryClient);
    await markOneOpts.onSuccess({
      notification: { ...PUBLIC_DEPT_NOTIF, readAt: '2026-11-24T10:00:00Z' },
      unreadCount: 1,
    });
    const afterOne = queryClient.getQueryData<NotificationPageResponse>(NOTIFICATIONS_QUERY_KEYS.list());
    expect(afterOne?.unreadCount).toBe(1);
    expect(afterOne?.items.find((i) => i.id === 'n-1')?.readAt).toBe('2026-11-24T10:00:00Z');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_KEYS.root });

    const markAllOpts = buildMarkAllNotificationsReadMutationOptions(queryClient);
    await markAllOpts.onSuccess({ updatedCount: 1, unreadCount: 0 });
    const afterAll = queryClient.getQueryData<NotificationPageResponse>(NOTIFICATIONS_QUERY_KEYS.list());
    expect(afterAll?.unreadCount).toBe(0);
    expect(afterAll?.items.every((i) => i.readAt !== null)).toBe(true);
  });
});
