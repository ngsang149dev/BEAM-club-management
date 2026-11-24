'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  TaskAssigneeChips,
  TaskPriorityBadge,
} from '@/features/tasks/components/TaskPriorityBadge';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import type { ArchiveTaskItem } from '../hooks/useArchive';

export interface ArchiveTasksTableProps {
  readonly items: readonly ArchiveTaskItem[];
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly onRestore: (item: ArchiveTaskItem) => void;
  readonly onPurge: (item: ArchiveTaskItem) => void;
}

function TaskBoardColumnCell({ item }: { readonly item: ArchiveTaskItem }) {
  const t = useTranslations('archive');
  return (
    <div className="archive-board-col-cell">
      <div className="archive-board-row">
        <span className="archive-board-name">{item.boardName}</span>
        {item.boardArchived ? (
          <span className="status-pill is-inactive">{t('boardArchivedBadge')}</span>
        ) : null}
      </div>
      <span className={item.columnName ? 'archive-col-name' : 'archive-fallback-note'}>
        {item.columnName ?? t('deletedColumnFallback')}
      </span>
    </div>
  );
}

function TaskTitleCell({ item }: { readonly item: ArchiveTaskItem }) {
  const tTasks = useTranslations('tasks');
  return (
    <div className="archive-task-title-cell">
      <span className="archive-primary-title">{item.task.title}</span>
      <div className="archive-inline-badges">
        <TaskPriorityBadge priority={item.task.priority} />
        {item.task.isHidden ? (
          <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span>
        ) : null}
      </div>
    </div>
  );
}

function ArchiveRowActions({
  isAdmin,
  isRestoringThis,
  isBusy,
  onRestore,
  onPurge,
}: {
  readonly isAdmin: boolean;
  readonly isRestoringThis: boolean;
  readonly isBusy: boolean;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const t = useTranslations('archive');
  return (
    <div className="archive-row-actions">
      <button
        type="button"
        className="ui-btn secondary is-sm"
        disabled={isBusy}
        onClick={onRestore}
      >
        {isRestoringThis ? t('restoringButton') : t('restoreButton')}
      </button>
      {isAdmin ? (
        <button
          type="button"
          className="ui-btn danger is-sm"
          disabled={isBusy}
          onClick={onPurge}
        >
          {t('purgeButton')}
        </button>
      ) : null}
    </div>
  );
}

function ArchiveTaskDesktopRow({
  item,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly item: ArchiveTaskItem;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  return (
    <tr>
      <td>
        <TaskTitleCell item={item} />
      </td>
      <td>
        <TaskBoardColumnCell item={item} />
      </td>
      <td>
        <TaskAssigneeChips assignees={item.task.assignees} />
      </td>
      <td className="mono">{formatTaskDateTime(item.task.deletedAt, locale)}</td>
      <td className="ui-col-right">
        <ArchiveRowActions
          isAdmin={isAdmin}
          isRestoringThis={restoringId === item.task.id}
          isBusy={isBusy}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      </td>
    </tr>
  );
}

function ArchiveTaskMobileCard({
  item,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly item: ArchiveTaskItem;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const t = useTranslations('archive');
  return (
    <li className="directory-mobile-card">
      <TaskTitleCell item={item} />
      <TaskBoardColumnCell item={item} />
      <TaskAssigneeChips assignees={item.task.assignees} />
      <div className="directory-mobile-meta">
        <span className="mono archive-mobile-time">
          {t('colDeletedAt')}: {formatTaskDateTime(item.task.deletedAt, locale)}
        </span>
        <ArchiveRowActions
          isAdmin={isAdmin}
          isRestoringThis={restoringId === item.task.id}
          isBusy={isBusy}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      </div>
    </li>
  );
}

export function ArchiveTasksTable({
  items,
  isAdmin,
  restoringId,
  isBusy,
  onRestore,
  onPurge,
}: ArchiveTasksTableProps) {
  const locale = useLocale();
  const t = useTranslations('archive');

  return (
    <>
      <div className="directory-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>{t('colTask')}</th>
              <th>{t('colBoardColumn')}</th>
              <th>{t('colAssignees')}</th>
              <th>{t('colDeletedAt')}</th>
              <th className="ui-col-right">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ArchiveTaskDesktopRow
                key={item.task.id}
                item={item}
                isAdmin={isAdmin}
                restoringId={restoringId}
                isBusy={isBusy}
                locale={locale}
                onRestore={() => onRestore(item)}
                onPurge={() => onPurge(item)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="directory-mobile-list">
        {items.map((item) => (
          <ArchiveTaskMobileCard
            key={item.task.id}
            item={item}
            isAdmin={isAdmin}
            restoringId={restoringId}
            isBusy={isBusy}
            locale={locale}
            onRestore={() => onRestore(item)}
            onPurge={() => onPurge(item)}
          />
        ))}
      </ul>
    </>
  );
}
