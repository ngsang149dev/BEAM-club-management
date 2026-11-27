'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
  type NotificationDto,
} from '../hooks/useNotifications';
import {
  NotificationPopoverPanel,
  resolveNotificationMessage,
} from './NotificationPopover';

export { resolveNotificationMessage };

function BellIcon() {
  return (
    <svg className="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.6 5.5 1.6 5.5H4.4S6 13 6 9z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function selectNotificationItem({
  item,
  closePopover,
  markRead,
  navigate,
}: {
  readonly item: NotificationDto;
  readonly closePopover: () => void;
  readonly markRead: (id: string) => void;
  readonly navigate: (href: string) => void;
}): void {
  closePopover();
  if (item.readAt === null) {
    markRead(item.id);
  }
  navigate(`/tasks?task=${item.taskId}`);
}

function useClosePopoverOnOutside(
  isOpen: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void
) {
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, containerRef, onClose]);
}

function NotificationBellButton({
  isOpen,
  unreadCount,
  onToggle,
}: {
  readonly isOpen: boolean;
  readonly unreadCount: number;
  readonly onToggle: () => void;
}) {
  const t = useTranslations('notifications');
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
  const buttonTitle =
    unreadCount > 0 ? t('unreadBadgeTitle', { count: unreadCount }) : t('bellAriaLabel');

  return (
    <button
      type="button"
      className="ui-icon-btn notif-bell-btn"
      aria-label={t('bellAriaLabel')}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      title={buttonTitle}
      onClick={onToggle}
    >
      <BellIcon />
      {unreadCount > 0 ? (
        <>
          <span className="notif-badge" aria-hidden="true">{badgeText}</span>
          <span className="sr-only">{t('unreadBadgeTitle', { count: unreadCount })}</span>
        </>
      ) : null}
    </button>
  );
}

export function NotificationBell({ defaultOpen = false }: { readonly defaultOpen?: boolean } = {}) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const notificationsQuery = useNotificationsQuery(true);
  const markReadMutation = useMarkNotificationReadMutation();
  const markAllMutation = useMarkAllNotificationsReadMutation();

  useClosePopoverOnOutside(isOpen, containerRef, () => setIsOpen(false));

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const items = notificationsQuery.data?.items ?? [];

  const handleSelectItem = (item: NotificationDto) =>
    selectNotificationItem({
      item,
      closePopover: () => setIsOpen(false),
      markRead: (id) =>
        markReadMutation.mutate(id, { onError: () => toast.error(t('markReadError')) }),
      navigate: (href) => router.push(href),
    });

  const handleMarkAllRead = () => {
    markAllMutation.mutate(undefined, { onError: () => toast.error(t('markReadError')) });
  };

  return (
    <div ref={containerRef} className="notif-bell-wrap">
      <NotificationBellButton
        isOpen={isOpen}
        unreadCount={unreadCount}
        onToggle={() => setIsOpen((prev) => !prev)}
      />
      {isOpen ? (
        <NotificationPopoverPanel
          unreadCount={unreadCount}
          isPending={notificationsQuery.isPending}
          isError={notificationsQuery.isError}
          items={items}
          locale={locale}
          markAllPending={markAllMutation.isPending}
          onMarkAllRead={handleMarkAllRead}
          onRetry={() => void notificationsQuery.refetch()}
          onSelectItem={handleSelectItem}
        />
      ) : null}
    </div>
  );
}
