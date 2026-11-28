'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { MemberAvatar } from '@/components/MemberAvatar';
import { usePermissions } from '@/features/shared/permissions/can';
import { describeAuditError } from '../error-mapping';
import {
  formatAuditDetailPreview,
  formatAuditTimestamp,
  resolveAuditActionKey,
} from '../formatters';
import {
  DEFAULT_AUDIT_FILTERS,
  useAuditLogsInfiniteQuery,
  useAuditMembersFilterQuery,
  type AuditFiltersState,
  type AuditLogDto,
} from '../hooks/useAuditLogs';
import { AuditDetailPane } from './AuditDetailPane';
import { AuditToolbar } from './AuditToolbar';

function AuditMemberCell({
  member,
  showAvatar = false,
}: {
  member: AuditLogDto['targetUser'];
  showAvatar?: boolean;
}) {
  const t = useTranslations('auditLogs');
  const tBadge = useTranslations('member');

  if (!member) {
    return <span className="muted-dash">{t('noTargetDash')}</span>;
  }

  return (
    <span className={showAvatar ? 'audit-actor' : undefined}>
      {showAvatar ? (
        <MemberAvatar
          memberId={member.id}
          fullName={member.fullName}
          avatarUrl={member.avatarUrl}
          isActive={member.isActive}
        />
      ) : null}
      <span>
        {member.fullName}
        {!member.isActive ? <span className="member-left-badge"> {tBadge('leftBadge')}</span> : null}
      </span>
    </span>
  );
}

function AuditTableRow({
  entry,
  isSelected,
  locale,
  onSelect,
}: {
  entry: AuditLogDto;
  isSelected: boolean;
  locale: string;
  onSelect: () => void;
}) {
  const t = useTranslations('auditLogs');
  const actionKey = resolveAuditActionKey(entry.action);
  const actionLabel = actionKey ? t(`actions.${actionKey}`) : entry.action;

  return (
    <tr
      className={isSelected ? 'audit-row is-active' : 'audit-row'}
      aria-selected={isSelected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <td className="mono">{formatAuditTimestamp(entry.createdAt, locale)}</td>
      <td><AuditMemberCell member={entry.actor} showAvatar /></td>
      <td>{actionLabel}</td>
      <td><AuditMemberCell member={entry.targetUser} /></td>
      <td className="mono">{formatAuditDetailPreview(entry.detail, t('hiddenTaskLabel'))}</td>
    </tr>
  );
}

function AuditLogsTable({
  items,
  selectedId,
  hasNextPage,
  isFetchingNextPage,
  onSelect,
  onLoadMore,
}: {
  items: readonly AuditLogDto[];
  selectedId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations('auditLogs');

  return (
    <div className="admin-card directory-list-card">
      <div className="audit-table-wrap">
        <table className="ui-table audit-table">
          <thead>
            <tr>
              <th>{t('colTime')}</th>
              <th>{t('colActor')}</th>
              <th>{t('colAction')}</th>
              <th>{t('colTarget')}</th>
              <th>{t('colDetail')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <AuditTableRow
                key={entry.id}
                entry={entry}
                isSelected={entry.id === selectedId}
                locale={locale}
                onSelect={() => onSelect(entry.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
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

function AuditQueryErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslations('auditLogs');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeAuditError(error);
  const isForbidden = err?.key === 'forbidden';

  return (
    <ErrorState
      variant={isForbidden ? '403' : '500'}
      code={isForbidden ? tErr('403.code') : undefined}
      title={isForbidden ? t('forbiddenTitle') : t('loadErrorTitle')}
      description={isForbidden ? t('forbiddenDescription') : tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function AuditLoadedLayout({
  items,
  selectedId,
  hasNextPage,
  isFetchingNextPage,
  onSelectId,
  onLoadMore,
}: {
  items: AuditLogDto[];
  selectedId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onSelectId: (id: string) => void;
  onLoadMore: () => void;
}) {
  const activeEntry = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  return (
    <div className="audit-layout">
      <div className="audit-main">
        <AuditLogsTable
          items={items}
          selectedId={activeEntry?.id ?? null}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onSelect={onSelectId}
          onLoadMore={onLoadMore}
        />
      </div>
      <AuditDetailPane entry={activeEntry} />
    </div>
  );
}

function AuditLogsContent({
  auditQuery,
  selectedId,
  onSelectId,
  onClearFilters,
}: {
  auditQuery: ReturnType<typeof useAuditLogsInfiniteQuery>;
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onClearFilters: () => void;
}) {
  const t = useTranslations('auditLogs');
  const tCommon = useTranslations('common');

  if (auditQuery.isPending) {
    return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  }
  if (auditQuery.isError) {
    return <AuditQueryErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} />;
  }

  const items = auditQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (items.length === 0) {
    return (
      <div className="admin-card admin-empty-box">
        <h2 className="admin-card-title">{t('emptyTitle')}</h2>
        <p className="admin-card-hint">{t('emptyDescription')}</p>
        <button type="button" className="ui-btn ghost is-sm" onClick={onClearFilters}>{t('clearFilters')}</button>
      </div>
    );
  }

  return (
    <AuditLoadedLayout
      items={items}
      selectedId={selectedId}
      hasNextPage={Boolean(auditQuery.hasNextPage)}
      isFetchingNextPage={auditQuery.isFetchingNextPage}
      onSelectId={onSelectId}
      onLoadMore={() => auditQuery.fetchNextPage()}
    />
  );
}

export function AuditLogsView() {
  const { can } = usePermissions();
  const canViewAudit = can('audit.view');
  const canFilterMembers = canViewAudit && can('member.view');
  const t = useTranslations('auditLogs');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');

  const [filters, setFilters] = useState<AuditFiltersState>(DEFAULT_AUDIT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const auditQuery = useAuditLogsInfiniteQuery(filters, canViewAudit);
  const membersQuery = useAuditMembersFilterQuery(canFilterMembers);

  if (!canViewAudit) {
    return (
      <ErrorState
        variant="403"
        code={tErr('403.code')}
        title={t('forbiddenTitle')}
        description={t('forbiddenDescription')}
        actions={<Link href="/" className="ui-btn primary">{tCommon('goHome')}</Link>}
      />
    );
  }

  return (
    <div className="admin-page-stack">
      <AuditToolbar
        filters={filters}
        members={membersQuery.data?.items ?? []}
        canFilterMembers={canFilterMembers}
        onActionChange={(action) => { setSelectedId(null); setFilters((p) => ({ ...p, action })); }}
        onDateRangeChange={(dateRange) => { setSelectedId(null); setFilters((p) => ({ ...p, dateRange })); }}
        onActorChange={(actorId) => { setSelectedId(null); setFilters((p) => ({ ...p, actorId })); }}
        onTargetChange={(targetUserId) => { setSelectedId(null); setFilters((p) => ({ ...p, targetUserId })); }}
        onClearFilters={() => { setSelectedId(null); setFilters(DEFAULT_AUDIT_FILTERS); }}
      />
      <AuditLogsContent
        auditQuery={auditQuery}
        selectedId={selectedId}
        onSelectId={setSelectedId}
        onClearFilters={() => { setSelectedId(null); setFilters(DEFAULT_AUDIT_FILTERS); }}
      />
    </div>
  );
}
