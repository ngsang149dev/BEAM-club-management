'use client';

import { useTranslations } from 'next-intl';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import type { NotificationDto } from '../hooks/useNotifications';

type NotificationTranslator = ReturnType<typeof useTranslations<'notifications'>>;

function resolveHiddenNotificationMessage(
  item: NotificationDto,
  t: NotificationTranslator
): string {
  switch (item.type) {
    case 'task.department_assigned':
      return item.departmentName
        ? t('hiddenTaskDepartmentAssigned', { departmentName: item.departmentName })
        : t('hiddenTaskDepartmentAssignedNoDept');
    case 'task.accepted':
      return t('hiddenTaskAccepted');
    case 'task.deliverable_submitted':
      return t('hiddenTaskDeliverableSubmitted');
    case 'task.assigned':
    default:
      return t('hiddenTaskAssigned');
  }
}

function resolveVisibleNotificationMessage(
  item: NotificationDto,
  taskTitle: string,
  t: NotificationTranslator
): string {
  const actorName = item.actor.fullName;
  switch (item.type) {
    case 'task.department_assigned':
      return item.departmentName
        ? t('taskDepartmentAssigned', {
            actorName,
            taskTitle,
            departmentName: item.departmentName,
          })
        : t('taskDepartmentAssignedNoDept', { actorName, taskTitle });
    case 'task.accepted':
      return t('taskAccepted', { actorName, taskTitle });
    case 'task.deliverable_submitted':
      return t('taskDeliverableSubmitted', { actorName, taskTitle });
    case 'task.assigned':
    default:
      return t('taskAssigned', { actorName, taskTitle });
  }
}

export function resolveNotificationMessage(
  item: NotificationDto,
  t: NotificationTranslator
): string {
  if (item.isHiddenTask || item.taskTitle === null) {
    return resolveHiddenNotificationMessage(item, t);
  }
  return resolveVisibleNotificationMessage(item, item.taskTitle, t);
}

function NotificationItemRow({
  item,
  locale,
  onSelect,
}: {
  readonly item: NotificationDto;
  readonly locale: string;
  readonly onSelect: (item: NotificationDto) => void;
}) {
  const t = useTranslations('notifications');
  const isUnread = item.readAt === null;
  const message = resolveNotificationMessage(item, t);

  return (
    <li>
      <button
        type="button"
        className={isUnread ? 'notif-item is-unread' : 'notif-item'}
        title={t('openTaskHint', { boardName: item.boardName })}
        onClick={() => onSelect(item)}
      >
        <span
          className={isUnread ? 'notif-unread-dot' : 'notif-read-spacer'}
          aria-label={isUnread ? t('unreadDotLabel') : undefined}
          aria-hidden={isUnread ? undefined : true}
        />
        <span className="notif-item-body">
          <span className="notif-item-msg">{message}</span>
          <span className="notif-item-meta">
            <span>{item.boardName}</span>
            <span aria-hidden="true">·</span>
            <time className="mono" dateTime={item.createdAt}>
              {formatTaskDateTime(item.createdAt, locale)}
            </time>
          </span>
        </span>
      </button>
    </li>
  );
}

function NotificationPopoverBody({
  isPending,
  isError,
  items,
  locale,
  onRetry,
  onSelectItem,
}: {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly items: readonly NotificationDto[];
  readonly locale: string;
  readonly onRetry: () => void;
  readonly onSelectItem: (item: NotificationDto) => void;
}) {
  const t = useTranslations('notifications');
  const tCommon = useTranslations('common');

  if (isPending && items.length === 0) {
    return <p className="notif-state-msg" role="status">{t('loading')}</p>;
  }
  if (isError && items.length === 0) {
    return (
      <div className="notif-empty">
        <p className="notif-error-text">{t('loadError')}</p>
        <button type="button" className="ui-btn ghost is-sm" onClick={onRetry}>
          {tCommon('retry')}
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="notif-empty">
        <b>{t('emptyTitle')}</b>
        <p>{t('emptyDescription')}</p>
      </div>
    );
  }

  return (
    <ul className="notif-list">
      {items.map((item) => (
        <NotificationItemRow
          key={item.id}
          item={item}
          locale={locale}
          onSelect={onSelectItem}
        />
      ))}
    </ul>
  );
}

export function NotificationPopoverPanel({
  unreadCount,
  isPending,
  isError,
  items,
  locale,
  markAllPending,
  onMarkAllRead,
  onRetry,
  onSelectItem,
}: {
  readonly unreadCount: number;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly items: readonly NotificationDto[];
  readonly locale: string;
  readonly markAllPending: boolean;
  readonly onMarkAllRead: () => void;
  readonly onRetry: () => void;
  readonly onSelectItem: (item: NotificationDto) => void;
}) {
  const t = useTranslations('notifications');

  return (
    <div className="notif-popover" role="dialog" aria-label={t('popoverAriaLabel')}>
      <div className="notif-popover-head">
        <div className="notif-popover-title-wrap">
          <h3>{t('heading')}</h3>
          {unreadCount > 0 ? (
            <span className="ui-chip notif-unread-pill">
              {t('unreadCountLabel', { count: unreadCount })}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="ui-btn ghost is-sm"
          disabled={unreadCount === 0 || markAllPending}
          onClick={onMarkAllRead}
        >
          {markAllPending ? t('markingAllRead') : t('markAllRead')}
        </button>
      </div>
      <div className="notif-popover-body">
        <NotificationPopoverBody
          isPending={isPending}
          isError={isError}
          items={items}
          locale={locale}
          onRetry={onRetry}
          onSelectItem={onSelectItem}
        />
      </div>
    </div>
  );
}
