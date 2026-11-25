'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { usePermissions } from '@/features/shared/permissions/can';
import { describeTaskError } from '@/features/tasks/error-mapping';
import {
  useBoardFilteredTasksQuery,
  useMoveTaskMutation,
  useTaskAssigneeMembersQuery,
  useTaskDepartmentsQuery,
  type TaskDto,
} from '@/features/tasks/hooks/useTasks';
import type { UpdateColumnRequestInput } from '@/lib/boards';
import type { BoardDetailModalState } from '../components/BoardDetailParts';
import { useBoardFilters } from './useBoardFilters';
import {
  useBoardDetailQuery,
  useCreateColumnMutation,
  useDeleteColumnMutation,
  useRenameColumnMutation,
  useReorderColumnsMutation,
  type ColumnDto,
} from './useBoards';

function swapColumnOrder(columns: readonly ColumnDto[], fromIndex: number, toIndex: number): string[] {
  const next = [...columns];
  const current = next[fromIndex];
  const target = next[toIndex];
  if (!current || !target) return next.map((c) => c.id);
  next[fromIndex] = target;
  next[toIndex] = current;
  return next.map((c) => c.id);
}

function useBoardColumnActions(
  boardId: string,
  modal: BoardDetailModalState,
  closeModal: () => void
) {
  const t = useTranslations('boards');
  const createColMutation = useCreateColumnMutation(boardId);
  const renameColMutation = useRenameColumnMutation(boardId);
  const deleteColMutation = useDeleteColumnMutation(boardId);
  const reorderMutation = useReorderColumnsMutation(boardId);

  const resetMutations = () => {
    createColMutation.reset();
    renameColMutation.reset();
    deleteColMutation.reset();
  };

  const handleColumnUpsert = (values: UpdateColumnRequestInput) => {
    if (modal.kind === 'createColumn') {
      createColMutation.mutate(values, {
        onSuccess: (res) => { toast.success(t('columnCreatedToast', { name: res.column.name })); closeModal(); },
      });
      return;
    }
    if (modal.kind === 'renameColumn') {
      renameColMutation.mutate({ columnId: modal.column.id, payload: values }, {
        onSuccess: (res) => { toast.success(t('columnRenamedToast', { name: res.column.name })); closeModal(); },
      });
    }
  };

  const handleColumnDelete = () => {
    if (modal.kind !== 'deleteColumn') return;
    deleteColMutation.mutate(modal.column.id, {
      onSuccess: () => { toast.success(t('columnDeletedToast')); closeModal(); },
    });
  };

  const handleMoveColumn = (columns: readonly ColumnDto[], fromIdx: number, toIdx: number) => {
    reorderMutation.reset();
    reorderMutation.mutate(
      { columnIds: swapColumnOrder(columns, fromIdx, toIdx) },
      { onSuccess: () => toast.success(t('columnReorderedToast')) }
    );
  };

  return {
    createColMutation,
    renameColMutation,
    deleteColMutation,
    reorderMutation,
    resetMutations,
    handleColumnUpsert,
    handleColumnDelete,
    handleMoveColumn,
  };
}

export function useBoardDetailController(boardId: string, initialTaskId: string | null) {
  const tTasks = useTranslations('tasks');
  const tErr = useTranslations('errors');
  const { isAdmin, can } = usePermissions();
  const canViewMembers = isAdmin || can('member.view');

  const [modal, setModal] = useState<BoardDetailModalState>({ kind: 'closed' });
  const [prevInitialTaskId, setPrevInitialTaskId] = useState<string | null>(initialTaskId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);

  if (initialTaskId !== prevInitialTaskId) {
    setPrevInitialTaskId(initialTaskId);
    if (initialTaskId) setSelectedTaskId(initialTaskId);
  }

  const filterState = useBoardFilters(boardId);
  const boardQuery = useBoardDetailQuery(boardId);
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const membersQuery = useTaskAssigneeMembersQuery(canViewMembers);
  const filteredTasksQuery = useBoardFilteredTasksQuery(
    boardId,
    filterState.queryFilters,
    filterState.queryDndPaused
  );
  const moveTaskMutation = useMoveTaskMutation(boardId);
  const closeModal = () => setModal({ kind: 'closed' });
  const colActions = useBoardColumnActions(boardId, modal, closeModal);

  return {
    modal,
    setModal,
    selectedTaskId,
    setSelectedTaskId,
    canViewMembers,
    filterState,
    boardQuery,
    departmentsQuery,
    membersQuery,
    filteredTasksQuery,
    moveTaskMutation,
    closeModal: () => { colActions.resetMutations(); closeModal(); },
    closeTaskDrawer: () => { setSelectedTaskId(null); filterState.clearTaskParam(); },
    handleMoveTaskToColumn: (task: TaskDto, targetColumn: ColumnDto) => {
      moveTaskMutation.reset();
      moveTaskMutation.mutate(
        { id: task.id, payload: { columnId: targetColumn.id, version: task.version } },
        {
          onSuccess: () => toast.success(tTasks('movedToColumnToast', { column: targetColumn.name })),
          onError: (err) => toast.error(tErr(describeTaskError(err)?.key ?? 'unknown')),
        }
      );
    },
    ...colActions,
  };
}
