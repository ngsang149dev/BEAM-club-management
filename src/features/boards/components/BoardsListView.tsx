'use client';

import { useEffect, useState } from 'react';
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
import { BoardTileCard } from './BoardTileCard';

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
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
        </select>
      </div>
      {isAdmin ? (
        <label className="ui-check-inline">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(e) =>
              onFiltersChange((prev) => ({ ...prev, includeArchived: e.target.checked }))
            }
          />
          <span>{t('showArchivedLabel')}</span>
        </label>
      ) : null}
      <Can permission="board.create">
        <button type="button" className="ui-btn primary" onClick={onOpenCreate}>
          {t('newBoard')}
        </button>
      </Can>
    </div>
  );
}

function useDebouncedBoardSearch(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value.trim());

  useEffect(() => {
    const trimmed = value.trim();
    const timer = setTimeout(() => {
      setDebounced(trimmed);
    }, trimmed === '' ? 0 : delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function useBoardCrudHandlers(
  modal: BoardModalState,
  closeModal: () => void
) {
  const t = useTranslations('boards');
  const createMutation = useCreateBoardMutation();
  const updateMutation = useUpdateBoardMutation();
  const archiveMutation = useArchiveBoardMutation();

  const resetAll = () => {
    createMutation.reset();
    updateMutation.reset();
    archiveMutation.reset();
    closeModal();
  };

  const handleUpsert = (payload: { name: string; departmentId: string | null }) => {
    if (modal.kind === 'create') {
      createMutation.mutate(payload, {
        onSuccess: (res) => { toast.success(t('createdToast', { name: res.board.name })); resetAll(); },
      });
      return;
    }
    if (modal.kind === 'edit') {
      updateMutation.mutate(
        { id: modal.board.id, payload },
        { onSuccess: (res) => { toast.success(t('updatedToast', { name: res.board.name })); resetAll(); } }
      );
    }
  };

  const handleArchiveConfirm = () => {
    if (modal.kind !== 'archive') return;
    archiveMutation.mutate(modal.board.id, {
      onSuccess: (res) => { toast.success(t('archivedToast', { name: res.board.name })); resetAll(); },
    });
  };

  const handleUnarchive = (board: BoardSummaryDto) => {
    updateMutation.mutate(
      { id: board.id, payload: { unarchive: true } },
      { onSuccess: (res) => toast.success(t('unarchivedToast', { name: res.board.name })) }
    );
  };

  return { createMutation, updateMutation, archiveMutation, closeModal: resetAll, handleUpsert, handleArchiveConfirm, handleUnarchive };
}

function useBoardsListState(isAdmin: boolean) {
  const [filters, setFilters] = useState<BoardsFilterState>(DEFAULT_BOARDS_FILTERS);
  const [modal, setModal] = useState<BoardModalState>({ kind: 'closed' });
  const debouncedQ = useDebouncedBoardSearch(filters.q);

  const boardsQuery = useBoardsInfiniteQuery({
    q: debouncedQ,
    departmentId: filters.departmentId,
    includeArchived: isAdmin && filters.includeArchived,
    limit: filters.limit,
  });
  const departmentsQuery = useDepartmentsQuery(true);
  const crud = useBoardCrudHandlers(modal, () => setModal({ kind: 'closed' }));

  return { filters, setFilters, modal, setModal, boardsQuery, departmentsQuery, ...crud };
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

  const visible = state.boardsQuery.data?.pages.flatMap((page) => page.items) ?? [];
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
          <button
            type="button"
            className="ui-btn ghost"
            onClick={() => state.boardsQuery.fetchNextPage()}
            disabled={state.boardsQuery.isFetchingNextPage}
          >
            {state.boardsQuery.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function BoardsListView() {
  const { isAdmin } = usePermissions();
  const state = useBoardsListState(isAdmin);
  const departments = state.departmentsQuery.data?.items ?? [];
  const openCreate = () => { state.createMutation.reset(); state.setModal({ kind: 'create' }); };

  return (
    <div className="admin-page-stack">
      <BoardsToolbar
        filters={state.filters}
        isAdmin={isAdmin}
        departments={departments}
        onFiltersChange={state.setFilters}
        onOpenCreate={openCreate}
      />
      <BoardsListBody state={state} onOpenCreate={openCreate} />
      <BoardsModalHost state={state} departments={departments} />
    </div>
  );
}
