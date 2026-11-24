'use client';

import { useLocale, useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import type { ArchiveBoardItem } from '../hooks/useArchive';

export interface ArchiveBoardsTableProps {
  readonly items: readonly ArchiveBoardItem[];
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly onRestore: (item: ArchiveBoardItem) => void;
  readonly onPurge: (item: ArchiveBoardItem) => void;
}

function BoardCreatorCell({ item }: { readonly item: ArchiveBoardItem }) {
  const tMember = useTranslations('member');
  const creator = item.board.createdBy;
  return (
    <div className="member-name-cell">
      <MemberAvatar
        memberId={creator.id}
        fullName={creator.fullName}
        avatarUrl={creator.avatarUrl}
        isActive={creator.isActive}
        size="sm"
      />
      <span className="member-name-text">
        <span>{creator.fullName}</span>
        {!creator.isActive ? (
          <span className="member-left-badge">{tMember('leftBadge')}</span>
        ) : null}
      </span>
    </div>
  );
}

function BoardRowActions({
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

function ArchiveBoardDesktopRow({
  item,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly item: ArchiveBoardItem;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const t = useTranslations('archive');
  const tBoards = useTranslations('boards');
  const deptName = item.board.department ? item.board.department.name : tBoards('clubWideLabel');

  return (
    <tr>
      <td>
        <span className="archive-primary-title">{item.board.name}</span>
      </td>
      <td>
        <span className="ui-chip">{deptName}</span>
      </td>
      <td className="mono">{t('boardTaskCount', { count: item.taskCount })}</td>
      <td className="mono">{formatTaskDateTime(item.board.archivedAt, locale)}</td>
      <td>
        <BoardCreatorCell item={item} />
      </td>
      <td className="ui-col-right">
        <BoardRowActions
          isAdmin={isAdmin}
          isRestoringThis={restoringId === item.board.id}
          isBusy={isBusy}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      </td>
    </tr>
  );
}

function ArchiveBoardMobileCard({
  item,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly item: ArchiveBoardItem;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const t = useTranslations('archive');
  const tBoards = useTranslations('boards');
  const deptName = item.board.department ? item.board.department.name : tBoards('clubWideLabel');

  return (
    <li className="directory-mobile-card">
      <div className="directory-mobile-head">
        <span className="archive-primary-title">{item.board.name}</span>
        <span className="ui-chip">{deptName}</span>
      </div>
      <div className="archive-inline-badges">
        <span className="mono">{t('boardTaskCount', { count: item.taskCount })}</span>
        <BoardCreatorCell item={item} />
      </div>
      <div className="directory-mobile-meta">
        <span className="mono archive-mobile-time">
          {t('colArchivedAt')}: {formatTaskDateTime(item.board.archivedAt, locale)}
        </span>
        <BoardRowActions
          isAdmin={isAdmin}
          isRestoringThis={restoringId === item.board.id}
          isBusy={isBusy}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      </div>
    </li>
  );
}

export function ArchiveBoardsTable({
  items,
  isAdmin,
  restoringId,
  isBusy,
  onRestore,
  onPurge,
}: ArchiveBoardsTableProps) {
  const locale = useLocale();
  const t = useTranslations('archive');

  return (
    <>
      <div className="directory-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>{t('colBoard')}</th>
              <th>{t('colDepartment')}</th>
              <th>{t('colTaskCount')}</th>
              <th>{t('colArchivedAt')}</th>
              <th>{t('colCreatedBy')}</th>
              <th className="ui-col-right">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ArchiveBoardDesktopRow
                key={item.board.id}
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
          <ArchiveBoardMobileCard
            key={item.board.id}
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
