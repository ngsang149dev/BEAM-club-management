'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { useDepartmentsQuery, type DepartmentDto } from '@/features/departments/hooks/useDepartments';
import { isApiClientError } from '@/features/shared/api/client';
import { Can, usePermissions } from '@/features/shared/permissions/can';
import { describeMemberError } from '../error-mapping';
import {
  useActivateMemberMutation,
  useCreateMemberMutation,
  useDeactivateMemberMutation,
  useMembersInfiniteQuery,
  useUpdateMemberMutation,
  type MemberListItem,
  type MembersFilterState,
  type UpdateMemberRequest,
} from '../hooks/useMembers';
import type { CreateMemberValues } from '../schemas';
import { MemberAdminTable } from './MemberAdminTable';
import { MemberCreateDrawer, MemberEditDrawer } from './MemberFormDrawer';
import { MemberStatusModal } from './MemberStatusModal';
import { MembersToolbar } from './MembersToolbar';

const DEFAULT_ADMIN_FILTERS: MembersFilterState = {
  q: '',
  departmentId: '',
  status: 'all',
  limit: 20,
};

type AdminModalState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; member: MemberListItem }
  | { kind: 'status'; member: MemberListItem; action: 'deactivate' | 'activate' };

function useMemberAdminState(allowed: boolean, canViewList: boolean) {
  const t = useTranslations('memberAdmin');
  const [filters, setFilters] = useState<MembersFilterState>(DEFAULT_ADMIN_FILTERS);
  const [modalState, setModalState] = useState<AdminModalState>({ kind: 'closed' });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const departmentsQuery = useDepartmentsQuery(allowed);
  const membersQuery = useMembersInfiniteQuery(filters, canViewList);
  const createMutation = useCreateMemberMutation();
  const updateMutation = useUpdateMemberMutation();
  const deactivateMutation = useDeactivateMemberMutation();
  const activateMutation = useActivateMemberMutation();

  const closeModal = () => {
    createMutation.reset();
    updateMutation.reset();
    deactivateMutation.reset();
    activateMutation.reset();
    setModalState({ kind: 'closed' });
  };

  const handleSuccess = (message: string) => {
    setToastMessage(message);
    closeModal();
  };

  const submitCreate = (values: CreateMemberValues) => {
    createMutation.mutate(values, {
      onSuccess: (res) => handleSuccess(t('createdToast', { name: res.member.fullName })),
    });
  };

  const submitEdit = (payload: UpdateMemberRequest) => {
    if (modalState.kind !== 'edit') return;
    updateMutation.mutate(
      { id: modalState.member.id, payload },
      { onSuccess: (res) => handleSuccess(t('updatedToast', { name: res.member.fullName })) }
    );
  };

  const confirmStatusChange = () => {
    if (modalState.kind !== 'status') return;
    const isDeactivate = modalState.action === 'deactivate';
    const mutate = isDeactivate ? deactivateMutation.mutate : activateMutation.mutate;
    const toastKey = isDeactivate ? 'deactivatedToast' : 'activatedToast';
    mutate(modalState.member.id, {
      onSuccess: (res) => handleSuccess(t(toastKey, { name: res.member.fullName })),
    });
  };

  return {
    filters, setFilters, modalState, setModalState, toastMessage, departmentsQuery,
    membersQuery, createMutation, updateMutation, deactivateMutation, activateMutation,
    closeModal, submitCreate, submitEdit, confirmStatusChange,
  };
}

function MemberAdminModalHost({
  state,
  canViewDetail,
  departments,
}: {
  state: ReturnType<typeof useMemberAdminState>;
  canViewDetail: boolean;
  departments: DepartmentDto[];
}) {
  if (state.modalState.kind === 'create') {
    return (
      <MemberCreateDrawer
        departments={departments}
        isSubmitting={state.createMutation.isPending}
        error={state.createMutation.error}
        onClose={state.closeModal}
        onSubmit={state.submitCreate}
      />
    );
  }
  if (state.modalState.kind === 'edit') {
    return (
      <MemberEditDrawer
        key={state.modalState.member.id}
        member={state.modalState.member}
        canViewDetail={canViewDetail}
        departments={departments}
        isSubmitting={state.updateMutation.isPending}
        error={state.updateMutation.error}
        onClose={state.closeModal}
        onSubmit={state.submitEdit}
      />
    );
  }
  if (state.modalState.kind === 'status') {
    const isDeactivate = state.modalState.action === 'deactivate';
    return (
      <MemberStatusModal
        member={state.modalState.member}
        action={state.modalState.action}
        isPending={isDeactivate ? state.deactivateMutation.isPending : state.activateMutation.isPending}
        error={isDeactivate ? state.deactivateMutation.error : state.activateMutation.error}
        onClose={state.closeModal}
        onConfirm={state.confirmStatusChange}
      />
    );
  }
  return null;
}

function MemberAdminEmptyCard({ onReset }: { onReset: () => void }) {
  const tDir = useTranslations('members');
  return (
    <div className="admin-card admin-empty-box">
      <h2 className="admin-card-title">{tDir('emptyTitle')}</h2>
      <p className="admin-card-hint">{tDir('emptyDescription')}</p>
      <button type="button" className="ui-btn ghost is-sm" onClick={onReset}>{tDir('resetFilters')}</button>
    </div>
  );
}

function MemberLoadMoreFooter({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const tDir = useTranslations('members');
  if (!hasNextPage) return null;
  return (
    <div className="directory-load-more">
      <button type="button" className="ui-btn ghost" onClick={onLoadMore} disabled={isFetchingNextPage}>
        {isFetchingNextPage ? tDir('loadingMore') : tDir('loadMore')}
      </button>
    </div>
  );
}

function MemberAdminListArea({
  canView,
  canViewDetail,
  state,
}: {
  canView: boolean;
  canViewDetail: boolean;
  state: ReturnType<typeof useMemberAdminState>;
}) {
  const tDir = useTranslations('members');
  const tAdmin = useTranslations('memberAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');

  if (!canView) {
    return (
      <div className="ui-banner" role="status">
        <div className="ui-banner-body">
          <strong className="ui-banner-title">{tAdmin('cannotListWithoutViewTitle')}</strong>
          <span className="ui-banner-text">{tAdmin('cannotListWithoutViewBody')}</span>
        </div>
      </div>
    );
  }
  if (state.membersQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (state.membersQuery.isError) {
    const queryError = state.membersQuery.error;
    const descriptor = describeMemberError(queryError);
    return (
      <ErrorState
        variant="500"
        title={tDir('loadError')}
        description={tErr(descriptor?.key ?? 'unknown')}
        requestId={isApiClientError(queryError) ? queryError.requestId : undefined}
        requestIdLabel={tErr('requestIdLabel')}
        actions={<button type="button" className="ui-btn primary" onClick={() => state.membersQuery.refetch()}>{tCommon('retry')}</button>}
      />
    );
  }

  const members = state.membersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (members.length === 0) {
    return <MemberAdminEmptyCard onReset={() => state.setFilters(DEFAULT_ADMIN_FILTERS)} />;
  }
  return (
    <div className="admin-card directory-list-card">
      <MemberAdminTable
        members={members}
        canViewDetail={canViewDetail}
        onEdit={(member) => { state.updateMutation.reset(); state.setModalState({ kind: 'edit', member }); }}
        onStatusAction={(member, action) => { state.deactivateMutation.reset(); state.activateMutation.reset(); state.setModalState({ kind: 'status', member, action }); }}
      />
      <MemberLoadMoreFooter
        hasNextPage={Boolean(state.membersQuery.hasNextPage)}
        isFetchingNextPage={state.membersQuery.isFetchingNextPage}
        onLoadMore={() => state.membersQuery.fetchNextPage()}
      />
    </div>
  );
}

export function MemberAdminView() {
  const { can, canAny } = usePermissions();
  const allowed = canAny(['member.create', 'member.update', 'member.deactivate']);
  const canView = can('member.view');
  const canViewDetail = can('member.view_detail');
  const t = useTranslations('memberAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const state = useMemberAdminState(allowed, allowed && canView);

  if (!allowed) {
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

  const departments = state.departmentsQuery.data?.items ?? [];
  const openCreate = () => {
    state.createMutation.reset();
    state.setModalState({ kind: 'create' });
  };

  return (
    <div className="admin-page-stack">
      <div className="directory-header-row">
        <p className="page-subtitle">{t('subtitle')}</p>
        {!canView ? <Can permission="member.create"><button type="button" className="ui-btn primary" onClick={openCreate}>{t('addMember')}</button></Can> : null}
      </div>
      {state.toastMessage ? <div className="ui-banner" role="status"><div className="ui-banner-body"><span className="ui-banner-text">{state.toastMessage}</span></div></div> : null}
      {canView ? (
        <MembersToolbar
          filters={state.filters}
          departments={departments}
          onQueryChange={(q) => state.setFilters((prev) => ({ ...prev, q }))}
          onDepartmentChange={(departmentId) => state.setFilters((prev) => ({ ...prev, departmentId }))}
          onStatusChange={(status) => state.setFilters((prev) => ({ ...prev, status }))}
          rightAction={<Can permission="member.create"><button type="button" className="ui-btn primary" onClick={openCreate}>{t('addMember')}</button></Can>}
        />
      ) : null}
      <MemberAdminListArea canView={canView} canViewDetail={canViewDetail} state={state} />
      <MemberAdminModalHost state={state} canViewDetail={canViewDetail} departments={departments} />
    </div>
  );
}
