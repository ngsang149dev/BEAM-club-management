'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { useDepartmentsQuery, type DepartmentDto } from '@/features/departments/hooks/useDepartments';
import { Can, usePermissions } from '@/features/shared/permissions/can';
import { describeBoardError } from '../error-mapping';
import {
  DEFAULT_BOARDS_FILTERS,
  useArchiveBoardMutation,
  useBoardsInfiniteQuery,
  useCreateBoardMutation,
  useUpdateBoardMutation,
  type BoardSummaryDto,
  type BoardsFilterState,
} from '../hooks/useBoards';
import { BoardArchiveModal, BoardUpsertModal } from './BoardModals';
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from './ActionMenu';

type BoardModalState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; board: BoardSummaryDto }
  | { kind: 'archive'; board: BoardSummaryDto };

function BoardsToolbar({
  filters,
  isAdmin,
  departments,
  onFiltersChange,
  onOpenCreate,
}: {
  filters: BoardsFilterState;
  isAdmin: boolean;
  departments: readonly DepartmentDto[];
  onFiltersChange: (updater: (prev: BoardsFilterState) => BoardsFilterState) => void;
  onOpenCreate: () => void;
}) {
  const t = useTranslations('boards');

  return (
    <div className="directory-toolbar">
      <div className="directory-search">
        <input
          className="ui-input"
          type="search"
          value={filters.q}
          onChange={(e) => onFiltersChange((prev) => ({ ...prev, q: e.target.value }))}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
        />
      </div>
      <div className="directory-filter-select">
        <select
          className="ui-select"
          value={filters.departmentId}
          onChange={(e) => onFiltersChange((prev) => ({ ...prev, departmentId: e.target.value }))}
          aria-label={t('departmentFilterLabel')}
        >
          <option value="">{t('allDepartments')}</option>
          {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
        </select>
      </div>
      {isAdmin ? (
        <label className="ui-check-inline">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(e) => onFiltersChange((prev) => ({ ...prev, includeArchived: e.target.checked }))}
          />
          <span>{t('showArchivedLabel')}</span>
        </label>
      ) : null}
      <Can permission="board.create">
        <button type="button" className="ui-btn primary" onClick={onOpenCreate}>{t('newBoard')}</button>
      </Can>
    </div>
  );
}

interface BoardTileCardProps {
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
}: BoardTileCardProps & { readonly isArchived: boolean; readonly canUpdate: boolean; readonly canArchive: boolean }) {
  const t = useTranslations('boards');
  return (
    <ActionMenu label={t('boardActionsMenu')}>
      {canUpdate ? <ActionMenuItem onSelect={() => onEdit(board)}>{t('editBoard')}</ActionMenuItem> : null}
      {canUpdate && isArchived ? <ActionMenuItem onSelect={() => onUnarchive(board)}>{t('unarchiveBoard')}</ActionMenuItem> : null}
      {canUpdate && canArchive ? <ActionMenuSeparator /> : null}
      {canArchive ? <ActionMenuItem variant="danger" onSelect={() => onArchive(board)}>{t('archiveBoard')}</ActionMenuItem> : null}
    </ActionMenu>
  );
}

function BoardTileCard({ board, onEdit, onArchive, onUnarchive }: BoardTileCardProps) {
  const t = useTranslations('boards');
  const { can } = usePermissions();
  const isArchived = board.archivedAt !== null;
  const canUpdate = can('board.update');
  const canArchive = !isArchived && can('board.delete');

  return (
    <article className={isArchived ? 'board-tile is-archived' : 'board-tile'}>
      <div className="board-tile-top">
        <div className="board-tile-badges">
          <span className="ui-chip">{board.department ? board.department.name : t('clubWideLabel')}</span>
          {isArchived ? <span className="status-pill is-inactive">{t('archivedBadge')}</span> : null}
        </div>
        {canUpdate || canArchive ? (
          <BoardTileActionMenu board={board} isArchived={isArchived} canUpdate={canUpdate} canArchive={canArchive} onEdit={onEdit} onArchive={onArchive} onUnarchive={onUnarchive} />
        ) : null}
      </div>
      <Link href={`/boards/${board.id}`} className="board-tile-name">{board.name}</Link>
      <div className="board-tile-actions">
        <Link href={`/boards/${board.id}`} className="ui-btn secondary is-sm">{t('openBoard')}</Link>
      </div>
    </article>
  );
}

function useBoardsListState(isAdmin: boolean) {
  const t = useTranslations('boards');
  const [filters, setFilters] = useState<BoardsFilterState>(DEFAULT_BOARDS_FILTERS);
  const [modal, setModal] = useState<BoardModalState>({ kind: 'closed' });

  const effectiveIncludeArchived = isAdmin && filters.includeArchived;
  const boardsQuery = useBoardsInfiniteQuery({
    departmentId: filters.departmentId,
    includeArchived: effectiveIncludeArchived,
    limit: filters.limit,
  });
  const departmentsQuery = useDepartmentsQuery(true);
  const createMutation = useCreateBoardMutation();
  const updateMutation = useUpdateBoardMutation();
  const archiveMutation = useArchiveBoardMutation();

  const closeModal = () => {
    createMutation.reset(); updateMutation.reset(); archiveMutation.reset();
    setModal({ kind: 'closed' });
  };

  const handleUpsert = (payload: { name: string; departmentId: string | null }) => {
    if (modal.kind === 'create') {
      createMutation.mutate(payload, {
        onSuccess: (res) => { toast.success(t('createdToast', { name: res.board.name })); closeModal(); },
      });
      return;
    }
    if (modal.kind === 'edit') {
      updateMutation.mutate({ id: modal.board.id, payload }, {
        onSuccess: (res) => { toast.success(t('updatedToast', { name: res.board.name })); closeModal(); },
      });
    }
  };

  return {
    filters, setFilters, modal, setModal, boardsQuery, departmentsQuery,
    createMutation, updateMutation, archiveMutation, closeModal, handleUpsert,
    handleArchiveConfirm: () => {
      if (modal.kind !== 'archive') return;
      archiveMutation.mutate(modal.board.id, {
        onSuccess: (res) => { toast.success(t('archivedToast', { name: res.board.name })); closeModal(); },
      });
    },
    handleUnarchive: (board: BoardSummaryDto) => {
      updateMutation.mutate({ id: board.id, payload: { unarchive: true } }, {
        onSuccess: (res) => toast.success(t('unarchivedToast', { name: res.board.name })),
      });
    },
  };
}

function BoardsModalHost({
  state,
  departments,
}: {
  state: ReturnType<typeof useBoardsListState>;
  departments: readonly DepartmentDto[];
}) {
  const { modal } = state;
  if (modal.kind === 'create' || modal.kind === 'edit') {
    return (
      <BoardUpsertModal
        key={modal.kind === 'edit' ? modal.board.id : 'create'}
        mode={modal.kind}
        board={modal.kind === 'edit' ? modal.board : undefined}
        departments={departments}
        isSubmitting={state.createMutation.isPending || state.updateMutation.isPending}
        error={modal.kind === 'create' ? state.createMutation.error : state.updateMutation.error}
        onClose={state.closeModal}
        onSubmit={state.handleUpsert}
      />
    );
  }
  if (modal.kind === 'archive') {
    return (
      <BoardArchiveModal
        board={modal.board}
        isArchiving={state.archiveMutation.isPending}
        error={state.archiveMutation.error}
        onClose={state.closeModal}
        onConfirm={state.handleArchiveConfirm}
      />
    );
  }
  return null;
}

function BoardsQueryErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('boards');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeBoardError(error);

  return (
    <ErrorState
      variant="500"
      title={t('loadError')}
      description={tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function BoardsEmptyState({ onOpenCreate }: { onOpenCreate: () => void }) {
  const t = useTranslations('boards');

  return (
    <div className="admin-card admin-empty-box">
      <h2 className="admin-card-title">{t('emptyTitle')}</h2>
      <p className="admin-card-hint">{t('emptyDescription')}</p>
      <Can permission="board.create">
        <button type="button" className="ui-btn primary is-sm" onClick={onOpenCreate}>{t('newBoard')}</button>
      </Can>
    </div>
  );
}

function BoardsListBody({
  state,
  onOpenCreate,
}: {
  state: ReturnType<typeof useBoardsListState>;
  onOpenCreate: () => void;
}) {
  const t = useTranslations('boards');
  const tCommon = useTranslations('common');

  if (state.boardsQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (state.boardsQuery.isError) {
    return <BoardsQueryErrorState error={state.boardsQuery.error} onRetry={() => state.boardsQuery.refetch()} />;
  }

  const allBoards = state.boardsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const qLower = state.filters.q.trim().toLowerCase();
  const visible = qLower ? allBoards.filter((b) => b.name.toLowerCase().includes(qLower)) : allBoards;

  if (visible.length === 0) {
    return <BoardsEmptyState onOpenCreate={onOpenCreate} />;
  }

  return (
    <div className="admin-sections-stack">
      <div className="board-grid">
        {visible.map((board) => (
          <BoardTileCard
            key={board.id}
            board={board}
            onEdit={(b) => { state.updateMutation.reset(); state.setModal({ kind: 'edit', board: b }); }}
            onArchive={(b) => { state.archiveMutation.reset(); state.setModal({ kind: 'archive', board: b }); }}
            onUnarchive={state.handleUnarchive}
          />
        ))}
      </div>
      {state.boardsQuery.hasNextPage ? (
        <div className="directory-load-more">
          <button type="button" className="ui-btn ghost" onClick={() => state.boardsQuery.fetchNextPage()} disabled={state.boardsQuery.isFetchingNextPage}>
            {state.boardsQuery.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function BoardsListView() {
  const { isAdmin } = usePermissions();
  const t = useTranslations('boards');
  const state = useBoardsListState(isAdmin);
  const departments = state.departmentsQuery.data?.items ?? [];
  const openCreate = () => { state.createMutation.reset(); state.setModal({ kind: 'create' }); };

  return (
    <div className="admin-page-stack">
      <p className="page-subtitle">{t('subtitle')}</p>
      <BoardsToolbar filters={state.filters} isAdmin={isAdmin} departments={departments} onFiltersChange={state.setFilters} onOpenCreate={openCreate} />
      <BoardsListBody state={state} onOpenCreate={openCreate} />
      <BoardsModalHost state={state} departments={departments} />
    </div>
  );
}
