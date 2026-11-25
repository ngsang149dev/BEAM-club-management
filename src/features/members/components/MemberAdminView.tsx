'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { ClubLogoModal } from '@/features/branding/components/ClubLogoModal';
import type { DepartmentDto } from '@/features/departments/hooks/useDepartments';
import { isApiClientError } from '@/features/shared/api/client';
import { Can, usePermissions } from '@/features/shared/permissions/can';
import { describeMemberError } from '../error-mapping';
import {
  DEFAULT_ADMIN_FILTERS,
  useMemberAdminState,
} from '../hooks/useMemberAdminState';
import { MemberAdminTable } from './MemberAdminTable';
import { MemberCreateDrawer, MemberEditDrawer } from './MemberFormDrawer';
import { MemberStatusModal } from './MemberStatusModal';
import { MembersToolbar } from './MembersToolbar';
import { ResetPasswordModal } from './ResetPasswordModal';

interface MemberAdminModalHostProps {
  state: ReturnType<typeof useMemberAdminState>;
  canViewDetail: boolean;
  departments: DepartmentDto[];
}

function renderEditModal(state: ReturnType<typeof useMemberAdminState>, canViewDetail: boolean, departments: DepartmentDto[]) {
  if (state.modalState.kind !== 'edit') return null;
  const avatarBusy = state.updateAvatarMutation.isPending || state.removeAvatarMutation.isPending;
  const avatarError = state.updateAvatarMutation.error ?? state.removeAvatarMutation.error;
  return (
    <MemberEditDrawer
      key={state.modalState.member.id}
      member={state.modalState.member}
      canViewDetail={canViewDetail}
      departments={departments}
      isSubmitting={state.updateMutation.isPending}
      error={state.updateMutation.error}
      avatarBusy={avatarBusy}
      avatarError={avatarError}
      onUploadAvatar={state.submitUploadAvatar}
      onRemoveAvatar={state.submitRemoveAvatar}
      onClearAvatarError={state.clearAvatarErrors}
      onClose={state.closeModal}
      onSubmit={state.submitEdit}
    />
  );
}

function MemberAdminModalHost({ state, canViewDetail, departments }: MemberAdminModalHostProps) {
  const modal = state.modalState;
  if (modal.kind === 'create') {
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
  if (modal.kind === 'edit') {
    return renderEditModal(state, canViewDetail, departments);
  }
  if (modal.kind === 'resetPassword') {
    return (
      <ResetPasswordModal
        key={modal.member.id}
        member={modal.member}
        isPending={state.resetPasswordMutation.isPending}
        error={state.resetPasswordMutation.error}
        onClose={state.closeModal}
        onSubmit={state.submitResetPassword}
      />
    );
  }
  if (modal.kind === 'status') {
    const isDeactivate = modal.action === 'deactivate';
    return (
      <MemberStatusModal
        member={modal.member}
        action={modal.action}
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

interface MemberAdminListAreaProps {
  canView: boolean;
  canViewDetail: boolean;
  state: ReturnType<typeof useMemberAdminState>;
}

function MemberAdminListArea({ canView, canViewDetail, state }: MemberAdminListAreaProps) {
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
        onResetPassword={(member) => { state.resetPasswordMutation.reset(); state.setModalState({ kind: 'resetPassword', member }); }}
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

function MemberAdminTopActions({
  isAdmin,
  canView,
  onOpenLogo,
  onOpenCreate,
}: {
  isAdmin: boolean;
  canView: boolean;
  onOpenLogo: () => void;
  onOpenCreate: () => void;
}) {
  const t = useTranslations('memberAdmin');
  if (!isAdmin && canView) {
    return null;
  }

  return (
    <div className="directory-header-row is-end">
      <div className="admin-header-actions">
        <Can adminOnly>
          <button type="button" className="ui-btn secondary" onClick={onOpenLogo}>
            {t('clubLogoButton')}
          </button>
        </Can>
        {!canView ? (
          <Can permission="member.create">
            <button type="button" className="ui-btn primary" onClick={onOpenCreate}>{t('addMember')}</button>
          </Can>
        ) : null}
      </div>
    </div>
  );
}

export function MemberAdminView() {
  const { isAdmin, can, canAny } = usePermissions();
  const allowed = canAny(['member.create', 'member.update', 'member.deactivate']);
  const canView = can('member.view');
  const canViewDetail = can('member.view_detail');
  const t = useTranslations('memberAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const state = useMemberAdminState(allowed, allowed && canView);
  const [logoModalOpen, setLogoModalOpen] = useState(false);

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
      <MemberAdminTopActions
        isAdmin={isAdmin}
        canView={canView}
        onOpenLogo={() => setLogoModalOpen(true)}
        onOpenCreate={openCreate}
      />
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
      {isAdmin && logoModalOpen ? <ClubLogoModal onClose={() => setLogoModalOpen(false)} /> : null}
    </div>
  );
}
