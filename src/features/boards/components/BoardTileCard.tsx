'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/features/shared/permissions/can';
import type { BoardSummaryDto } from '../hooks/useBoards';
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from './ActionMenu';

export interface BoardTileCardProps {
  readonly board: BoardSummaryDto;
  readonly onEdit: (b: BoardSummaryDto) => void;
  readonly onArchive: (b: BoardSummaryDto) => void;
  readonly onUnarchive: (b: BoardSummaryDto) => void;
}

function BoardTileActionMenu({
  board,
  isArchived,
  canUpdate,
  canArchive,
  onEdit,
  onArchive,
  onUnarchive,
}: BoardTileCardProps & {
  readonly isArchived: boolean;
  readonly canUpdate: boolean;
  readonly canArchive: boolean;
}) {
  const t = useTranslations('boards');
  return (
    <ActionMenu label={t('boardActionsMenu')}>
      {canUpdate ? <ActionMenuItem onSelect={() => onEdit(board)}>{t('editBoard')}</ActionMenuItem> : null}
      {canUpdate && isArchived ? (
        <ActionMenuItem onSelect={() => onUnarchive(board)}>{t('unarchiveBoard')}</ActionMenuItem>
      ) : null}
      {canUpdate && canArchive ? <ActionMenuSeparator /> : null}
      {canArchive ? (
        <ActionMenuItem variant="danger" onSelect={() => onArchive(board)}>
          {t('archiveBoard')}
        </ActionMenuItem>
      ) : null}
    </ActionMenu>
  );
}

function BoardTileCounts({
  visibleTaskCount,
  overdueTaskCount,
}: {
  readonly visibleTaskCount: number;
  readonly overdueTaskCount: number;
}) {
  const t = useTranslations('boards');

  return (
    <div className="board-tile-counts">
      <span className="board-tile-count-total">
        {t('visibleTaskCount', { count: visibleTaskCount })}
      </span>
      {overdueTaskCount > 0 ? (
        <span className="board-tile-overdue-pill">
          {t('overdueTaskCount', { count: overdueTaskCount })}
        </span>
      ) : (
        <span className="board-tile-no-overdue">{t('noOverdueTasks')}</span>
      )}
    </div>
  );
}

export function BoardTileCard({ board, onEdit, onArchive, onUnarchive }: BoardTileCardProps) {
  const t = useTranslations('boards');
  const { can } = usePermissions();
  const isArchived = board.archivedAt !== null;
  const canUpdate = can('board.update');
  const canArchive = !isArchived && can('board.delete');

  return (
    <article className={isArchived ? 'board-tile is-archived' : 'board-tile'}>
      <div className="board-tile-top">
        <div className="board-tile-badges">
          <span className="ui-chip">
            {board.department ? board.department.name : t('clubWideLabel')}
          </span>
          {isArchived ? <span className="status-pill is-inactive">{t('archivedBadge')}</span> : null}
        </div>
        {canUpdate || canArchive ? (
          <BoardTileActionMenu
            board={board}
            isArchived={isArchived}
            canUpdate={canUpdate}
            canArchive={canArchive}
            onEdit={onEdit}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
          />
        ) : null}
      </div>
      <div className="board-tile-main">
        <Link href={`/boards/${board.id}`} className="board-tile-name">
          {board.name}
        </Link>
        <BoardTileCounts
          visibleTaskCount={board.visibleTaskCount}
          overdueTaskCount={board.overdueTaskCount}
        />
      </div>
      <div className="board-tile-actions">
        <Link href={`/boards/${board.id}`} className="ui-btn secondary is-sm">
          {t('openBoard')}
        </Link>
      </div>
    </article>
  );
}
