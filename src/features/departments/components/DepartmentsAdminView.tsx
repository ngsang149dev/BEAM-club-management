'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { isApiClientError } from '@/features/shared/api/client';
import { usePermissions } from '@/features/shared/permissions/can';
import { describeDepartmentError } from '../error-mapping';
import {
  useCreateDepartmentMutation,
  useDeleteDepartmentMutation,
  useDepartmentLeadCandidatesQuery,
  useDepartmentsQuery,
  useUpdateDepartmentMutation,
  type DepartmentDto,
  type DepartmentUpsertRequest,
} from '../hooks/useDepartments';
import { DepartmentsLoadedList } from './DepartmentsList';
import { DepartmentDeleteModal, DepartmentUpsertModal } from './DepartmentModals';

type ModalState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'rename'; department: DepartmentDto }
  | { kind: 'delete'; department: DepartmentDto };

function useDepartmentsAdminState(canManage: boolean, canViewMembers: boolean) {
  const t = useTranslations('departmentsAdmin');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalState, setModalState] = useState<ModalState>({ kind: 'closed' });

  const departmentsQuery = useDepartmentsQuery(canManage);
  const leadCandidatesQuery = useDepartmentLeadCandidatesQuery(canManage && canViewMembers);
  const createMutation = useCreateDepartmentMutation();
  const updateMutation = useUpdateDepartmentMutation();
  const deleteMutation = useDeleteDepartmentMutation();

  const closeModal = () => {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    setModalState({ kind: 'closed' });
  };

  const handleUpsertSubmit = (values: DepartmentUpsertRequest) => {
    if (modalState.kind === 'create') {
      createMutation.mutate(values, {
        onSuccess: (result) => {
          toast.success(t('createdToast', { name: result.department.name }));
          closeModal();
        },
      });
      return;
    }
    if (modalState.kind === 'rename') {
      updateMutation.mutate(
        { id: modalState.department.id, payload: values },
        {
          onSuccess: (result) => {
            toast.success(t('renamedToast', { name: result.department.name }));
            closeModal();
          },
        }
      );
    }
  };

  const handleDeleteConfirm = () => {
    if (modalState.kind !== 'delete') return;
    deleteMutation.mutate(modalState.department.id, {
      onSuccess: () => {
        toast.success(t('deletedToast'));
        closeModal();
      },
    });
  };

  return {
    canViewMembers,
    searchQuery, setSearchQuery, modalState, setModalState,
    departmentsQuery, leadCandidatesQuery, createMutation, updateMutation, deleteMutation,
    closeModal, handleUpsertSubmit, handleDeleteConfirm,
  };
}

function DepartmentsModalHost({ state }: { state: ReturnType<typeof useDepartmentsAdminState> }) {
  const { modalState, createMutation, updateMutation, deleteMutation, closeModal } = state;

  if (modalState.kind === 'create' || modalState.kind === 'rename') {
    return (
      <DepartmentUpsertModal
        key={modalState.kind === 'rename' ? modalState.department.id : 'create'}
        mode={modalState.kind}
        department={modalState.kind === 'rename' ? modalState.department : undefined}
        leadCandidates={state.leadCandidatesQuery.data?.items ?? []}
        showLeadSelector={state.canViewMembers}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        error={modalState.kind === 'create' ? createMutation.error : updateMutation.error}
        onClose={closeModal}
        onSubmit={state.handleUpsertSubmit}
      />
    );
  }
  if (modalState.kind === 'delete') {
    return (
      <DepartmentDeleteModal
        department={modalState.department}
        isDeleting={deleteMutation.isPending}
        error={deleteMutation.error}
        onClose={closeModal}
        onConfirm={state.handleDeleteConfirm}
      />
    );
  }
  return null;
}

function DepartmentsToolbar({
  searchQuery,
  onSearchChange,
  onOpenCreate,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenCreate: () => void;
}) {
  const t = useTranslations('departmentsAdmin');

  return (
    <div className="directory-toolbar">
      <div className="directory-search">
        <input
          className="ui-input"
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
        />
      </div>
      <button type="button" className="ui-btn primary" onClick={onOpenCreate}>
        {t('addDepartment')}
      </button>
    </div>
  );
}

function DepartmentsBody({ state }: { state: ReturnType<typeof useDepartmentsAdminState> }) {
  const t = useTranslations('departmentsAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');

  if (state.departmentsQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (state.departmentsQuery.isError) {
    const queryError = state.departmentsQuery.error;
    const descriptor = describeDepartmentError(queryError);
    return (
      <ErrorState
        variant="500"
        title={t('loadError')}
        description={tErr(descriptor?.key ?? 'unknown')}
        requestId={isApiClientError(queryError) ? queryError.requestId : undefined}
        requestIdLabel={tErr('requestIdLabel')}
        actions={<button type="button" className="ui-btn primary" onClick={() => state.departmentsQuery.refetch()}>{tCommon('retry')}</button>}
      />
    );
  }

  const normalizedSearch = state.searchQuery.trim().toLowerCase();
  const allDepartments = state.departmentsQuery.data?.items ?? [];
  const filtered = normalizedSearch
    ? allDepartments.filter((d) => d.name.toLowerCase().includes(normalizedSearch))
    : allDepartments;

  return (
    <>
      <DepartmentsToolbar
        searchQuery={state.searchQuery}
        onSearchChange={state.setSearchQuery}
        onOpenCreate={() => { state.createMutation.reset(); state.setModalState({ kind: 'create' }); }}
      />
      <DepartmentsLoadedList
        departments={filtered}
        onRename={(department) => { state.updateMutation.reset(); state.setModalState({ kind: 'rename', department }); }}
        onDelete={(department) => { state.deleteMutation.reset(); state.setModalState({ kind: 'delete', department }); }}
      />
      <DepartmentsModalHost state={state} />
    </>
  );
}

export function DepartmentsAdminView() {
  const { can } = usePermissions();
  const canManage = can('department.manage');
  const canViewMembers = can('member.view');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const state = useDepartmentsAdminState(canManage, canViewMembers);

  if (!canManage) {
    return (
      <ErrorState
        variant="403"
        code={tErr('403.code')}
        title={tErr('403.title')}
        description={tErr('403.description')}
        actions={<Link href="/" className="ui-btn primary">{tCommon('goHome')}</Link>}
      />
    );
  }

  return (
    <div className="admin-page-stack">
      <DepartmentsBody state={state} />
    </div>
  );
}
