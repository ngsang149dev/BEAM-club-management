'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { useDepartmentsQuery } from '@/features/departments/hooks/useDepartments';
import { isApiClientError } from '@/features/shared/api/client';
import { useDebouncedValue } from '@/features/shared/hooks/useDebouncedValue';
import { Can, usePermissions } from '@/features/shared/permissions/can';
import { describeMemberError } from '../error-mapping';
import {
  isMemberDetail,
  useMembersInfiniteQuery,
  type MemberDetail,
  type MemberListItem,
  type MembersFilterState,
} from '../hooks/useMembers';
import {
  MemberDepartmentsCell,
  MemberIdentityCell,
  MemberStatusPill,
} from './MemberAdminTable';
import { MembersToolbar } from './MembersToolbar';

const DEFAULT_FILTERS: MembersFilterState = {
  q: '',
  departmentId: '',
  status: 'active',
  limit: 20,
};

function MemberRoleBadge({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('members');
  return (
    <span className={isAdmin ? 'role-badge is-admin' : 'role-badge'}>
      {isAdmin ? t('roleAdmin') : t('roleMember')}
    </span>
  );
}

function MemberDetailContactCells({
  canViewDetail,
  detail,
}: {
  canViewDetail: boolean;
  detail: MemberDetail | null;
}) {
  if (!canViewDetail) return null;
  return (
    <>
      <td className="mono">{detail?.studentId ?? ''}</td>
      <td>{detail?.email ?? ''}</td>
    </>
  );
}

function MemberDirectoryDesktopRow({
  member,
  canViewDetail,
}: {
  member: MemberListItem;
  canViewDetail: boolean;
}) {
  const detail = canViewDetail && isMemberDetail(member) ? member : null;

  return (
    <tr className={member.isActive ? undefined : 'is-inactive'}>
      <td><MemberIdentityCell member={member} /></td>
      <MemberDetailContactCells canViewDetail={canViewDetail} detail={detail} />
      <td><MemberDepartmentsCell member={member} /></td>
      {canViewDetail ? <td>{detail ? <MemberRoleBadge isAdmin={detail.isAdmin} /> : null}</td> : null}
      <td><MemberStatusPill isActive={member.isActive} /></td>
    </tr>
  );
}

function MembersDesktopTable({
  members,
  canViewDetail,
}: {
  members: MemberListItem[];
  canViewDetail: boolean;
}) {
  const t = useTranslations('members');

  return (
    <div className="directory-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            <th>{t('colMember')}</th>
            {canViewDetail ? <th>{t('colStudentId')}</th> : null}
            {canViewDetail ? <th>{t('colEmail')}</th> : null}
            <th>{t('colDepartments')}</th>
            {canViewDetail ? <th>{t('colRole')}</th> : null}
            <th>{t('colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <MemberDirectoryDesktopRow
              key={member.id}
              member={member}
              canViewDetail={canViewDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberDirectoryMobileCard({
  member,
  canViewDetail,
}: {
  member: MemberListItem;
  canViewDetail: boolean;
}) {
  const detail = canViewDetail && isMemberDetail(member) ? member : null;

  return (
    <li className="directory-mobile-card">
      <div className="directory-mobile-head">
        <MemberIdentityCell member={member} />
        {detail ? <MemberRoleBadge isAdmin={detail.isAdmin} /> : null}
      </div>
      {detail ? (
        <div className="directory-mobile-pii">
          <span className="mono">{detail.studentId}</span>
          <span>{detail.email}</span>
        </div>
      ) : null}
      <div className="directory-mobile-meta">
        <MemberDepartmentsCell member={member} />
        <MemberStatusPill isActive={member.isActive} />
      </div>
    </li>
  );
}

function MembersDirectoryContent({
  members,
  canViewDetail,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onResetFilters,
}: {
  members: MemberListItem[];
  canViewDetail: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onResetFilters: () => void;
}) {
  const t = useTranslations('members');

  if (members.length === 0) {
    return (
      <div className="admin-card admin-empty-box">
        <h2 className="admin-card-title">{t('emptyTitle')}</h2>
        <p className="admin-card-hint">{t('emptyDescription')}</p>
        <button type="button" className="ui-btn ghost is-sm" onClick={onResetFilters}>
          {t('resetFilters')}
        </button>
      </div>
    );
  }

  return (
    <div className="admin-card directory-list-card">
      <MembersDesktopTable members={members} canViewDetail={canViewDetail} />
      <ul className="directory-mobile-list">
        {members.map((member) => (
          <MemberDirectoryMobileCard key={member.id} member={member} canViewDetail={canViewDetail} />
        ))}
      </ul>
      {hasNextPage ? (
        <div className="directory-load-more">
          <button type="button" className="ui-btn ghost" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MembersDirectoryBody({
  membersQuery,
  canViewDetail,
  onResetFilters,
}: {
  membersQuery: ReturnType<typeof useMembersInfiniteQuery>;
  canViewDetail: boolean;
  onResetFilters: () => void;
}) {
  const t = useTranslations('members');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');

  if (membersQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (membersQuery.isError) {
    const queryError = membersQuery.error;
    const descriptor = describeMemberError(queryError);
    return (
      <ErrorState
        variant="500"
        title={t('loadError')}
        description={tErr(descriptor?.key ?? 'unknown')}
        requestId={isApiClientError(queryError) ? queryError.requestId : undefined}
        requestIdLabel={tErr('requestIdLabel')}
        actions={<button type="button" className="ui-btn primary" onClick={() => membersQuery.refetch()}>{tCommon('retry')}</button>}
      />
    );
  }
  const members = membersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <MembersDirectoryContent
      members={members}
      canViewDetail={canViewDetail}
      hasNextPage={Boolean(membersQuery.hasNextPage)}
      isFetchingNextPage={membersQuery.isFetchingNextPage}
      onLoadMore={() => membersQuery.fetchNextPage()}
      onResetFilters={onResetFilters}
    />
  );
}

export function MembersDirectoryView() {
  const { can } = usePermissions();
  const canView = can('member.view');
  const canViewDetail = can('member.view_detail');
  const t = useTranslations('members');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const [filters, setFilters] = useState<MembersFilterState>(DEFAULT_FILTERS);
  const debouncedQ = useDebouncedValue(filters.q, 250);
  const departmentsQuery = useDepartmentsQuery(canView);
  const membersQuery = useMembersInfiniteQuery({ ...filters, q: debouncedQ }, canView);

  if (!canView) {
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

  const members = membersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const departments = departmentsQuery.data?.items ?? [];

  return (
    <div className="admin-page-stack">
      <div className="directory-header-row">
        <div>
          {!canViewDetail ? <p className="directory-privacy-note">{t('privacyHint')}</p> : null}
        </div>
        <span className="ui-chip">{t('summaryCount', { count: members.length })}</span>
      </div>
      <MembersToolbar
        filters={filters}
        departments={departments}
        onQueryChange={(q) => setFilters((prev) => ({ ...prev, q }))}
        onDepartmentChange={(departmentId) => setFilters((prev) => ({ ...prev, departmentId }))}
        onStatusChange={(status) => setFilters((prev) => ({ ...prev, status }))}
        rightAction={
          <Can anyOf={['member.create', 'member.update', 'member.deactivate']}>
            <Link href="/admin/members" className="ui-btn ghost">{t('openAdmin')}</Link>
          </Can>
        }
      />
      <MembersDirectoryBody
        membersQuery={membersQuery}
        canViewDetail={canViewDetail}
        onResetFilters={() => setFilters(DEFAULT_FILTERS)}
      />
    </div>
  );
}
