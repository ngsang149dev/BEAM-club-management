'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { useDebouncedValue } from '@/features/shared/hooks/useDebouncedValue';
import { usePermissions } from '@/features/shared/permissions/can';
import type { ArchiveRetentionDays } from '@/lib/archive';
import { describeArchiveError, resolveArchiveErrorMessage } from '../error-mapping';
import {
  getPermittedArchiveTabs,
  useArchiveInfiniteQuery,
  useArchiveRetentionQuery,
  usePurgeArchiveItemMutation,
  useRestoreArchiveMemberMutation,
  useRestoreArchiveTaskMutation,
  useUpdateArchiveRetentionMutation,
  type ArchiveTab,
  type ArchiveTaskItem,
  type MemberListItem,
} from '../hooks/useArchive';
import { ArchiveMembersTable } from './ArchiveMembersTable';
import { ArchivePurgeModal, type ArchivePurgeTarget } from './ArchivePurgeModal';
import { ArchiveRetentionBar } from './ArchiveRetentionBar';
import { ArchiveTasksTable } from './ArchiveTasksTable';

function ArchiveToolbar({
  permittedTabs,
  activeTab,
  searchQuery,
  onSelectTab,
  onSearchChange,
  onResetSearch,
}: {
  readonly permittedTabs: readonly ArchiveTab[];
  readonly activeTab: ArchiveTab;
  readonly searchQuery: string;
  readonly onSelectTab: (tab: ArchiveTab) => void;
  readonly onSearchChange: (q: string) => void;
  readonly onResetSearch: () => void;
}) {
  const t = useTranslations('archive');
  return (
    <div className="directory-toolbar">
      <div className="ui-segmented" role="tablist" aria-label={t('tabsAriaLabel')}>
        {permittedTabs.map((tab) => {
          const isSelected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`archive-tab-${tab}`}
              aria-selected={isSelected}
              aria-controls={`archive-panel-${tab}`}
              className={isSelected ? 'ui-seg-btn is-active' : 'ui-seg-btn'}
              onClick={() => onSelectTab(tab)}
            >
              {t(`tabs.${tab}`)}
            </button>
          );
        })}
      </div>
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
      <button type="button" className="ui-btn ghost is-sm" onClick={onResetSearch} disabled={!searchQuery}>
        {t('resetSearch')}
      </button>
    </div>
  );
}

function ArchiveErrorBanner({ error }: { readonly error: unknown }) {
  const tErr = useTranslations('errors');
  const descriptor = describeArchiveError(error);
  const message = resolveArchiveErrorMessage(error, tErr);
  if (!message) return null;
  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{message}</span>
        {descriptor?.requestId ? <span className="ui-banner-meta">{tErr('requestIdLabel')}: {descriptor.requestId}</span> : null}
      </div>
    </div>
  );
}

function ArchiveQueryErrorState({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeArchiveError(error);
  const is403 = err?.key === 'forbidden';
  return (
    <ErrorState
      variant={is403 ? '403' : '500'}
      code={is403 ? tErr('403.code') : undefined}
      title={is403 ? t('forbiddenTitle') : t('loadErrorTitle')}
      description={is403 ? t('forbiddenDescription') : tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function ArchiveActiveTable({
  activeTab,
  pages,
  isAdmin,
  actions,
}: {
  readonly activeTab: ArchiveTab;
  readonly pages: NonNullable<ReturnType<typeof useArchiveInfiniteQuery>['data']>['pages'];
  readonly isAdmin: boolean;
  readonly actions: ReturnType<typeof useArchiveActions>;
}) {
  if (activeTab === 'tasks') {
    return (
      <ArchiveTasksTable
        items={pages.flatMap((p) => p.tasks)}
        isAdmin={isAdmin}
        restoringId={actions.restoringId}
        isBusy={actions.isBusy}
        onRestore={actions.onRestoreTask}
        onPurge={(item) => actions.openPurge({ entityType: 'tasks', id: item.task.id, label: item.task.title })}
      />
    );
  }
  return (
    <ArchiveMembersTable
      items={pages.flatMap((p) => p.members)}
      isAdmin={isAdmin}
      restoringId={actions.restoringId}
      isBusy={actions.isBusy}
      onRestore={actions.onRestoreMember}
      onPurge={(member) => actions.openPurge({ entityType: 'members', id: member.id, label: member.fullName })}
    />
  );
}

function countTabItems(
  activeTab: ArchiveTab,
  pages: NonNullable<ReturnType<typeof useArchiveInfiniteQuery>['data']>['pages']
): number {
  if (activeTab === 'tasks') return pages.reduce((sum, p) => sum + p.tasks.length, 0);
  if (activeTab === 'members') return pages.reduce((sum, p) => sum + p.members.length, 0);
  return 0;
}

function ArchiveTabPanel({
  activeTab,
  archiveQuery,
  isAdmin,
  hasSearch,
  onResetSearch,
  actions,
}: {
  readonly activeTab: ArchiveTab;
  readonly archiveQuery: ReturnType<typeof useArchiveInfiniteQuery>;
  readonly isAdmin: boolean;
  readonly hasSearch: boolean;
  readonly onResetSearch: () => void;
  readonly actions: ReturnType<typeof useArchiveActions>;
}) {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  if (archiveQuery.isPending) return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  if (archiveQuery.isError) return <ArchiveQueryErrorState error={archiveQuery.error} onRetry={() => void archiveQuery.refetch()} />;
  const pages = archiveQuery.data?.pages ?? [];
  if (countTabItems(activeTab, pages) === 0) {
    return (
      <div className="admin-card admin-empty-box">
        <h2 className="admin-card-title">{t('emptyTitle')}</h2>
        <p className="admin-card-hint">{t('emptyDescription')}</p>
        {hasSearch ? <button type="button" className="ui-btn ghost is-sm" onClick={onResetSearch}>{t('resetSearch')}</button> : null}
      </div>
    );
  }
  return (
    <div id={`archive-panel-${activeTab}`} role="tabpanel" aria-labelledby={`archive-tab-${activeTab}`} className="admin-card directory-list-card">
      <ArchiveActiveTable activeTab={activeTab} pages={pages} isAdmin={isAdmin} actions={actions} />
      {archiveQuery.hasNextPage ? (
        <div className="directory-load-more">
          <button type="button" className="ui-btn ghost" onClick={() => void archiveQuery.fetchNextPage()} disabled={archiveQuery.isFetchingNextPage}>
            {archiveQuery.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function useArchiveActions(isAdmin: boolean) {
  const t = useTranslations('archive');
  const [purgeTarget, setPurgeTarget] = useState<ArchivePurgeTarget | null>(null);
  const retentionMut = useUpdateArchiveRetentionMutation();
  const taskMut = useRestoreArchiveTaskMutation();
  const memberMut = useRestoreArchiveMemberMutation();
  const purgeMut = usePurgeArchiveItemMutation();

  const resetRestoreErrors = () => { taskMut.reset(); memberMut.reset(); };
  const restoringId = taskMut.isPending ? (taskMut.variables ?? null) : memberMut.isPending ? (memberMut.variables ?? null) : null;

  return {
    purgeTarget, retentionMut, purgeMut, restoringId,
    isBusy: Boolean(restoringId) || purgeMut.isPending,
    restoreError: taskMut.error ?? memberMut.error,
    resetRestoreErrors,
    onSaveRetention: (retentionDays: ArchiveRetentionDays) => {
      if (isAdmin) retentionMut.mutate({ retentionDays }, { onSuccess: () => toast.success(t('retentionSavedToast')) });
    },
    onRestoreTask: (item: ArchiveTaskItem) => {
      resetRestoreErrors();
      taskMut.mutate(item.task.id, { onSuccess: () => toast.success(t('taskRestoredToast', { title: item.task.title })) });
    },
    onRestoreMember: (member: MemberListItem) => {
      resetRestoreErrors();
      memberMut.mutate(member.id, { onSuccess: () => toast.success(t('memberRestoredToast', { name: member.fullName })) });
    },
    openPurge: (target: ArchivePurgeTarget) => { if (isAdmin) { purgeMut.reset(); setPurgeTarget(target); } },
    closePurge: () => { purgeMut.reset(); setPurgeTarget(null); },
    confirmPurge: () => {
      if (!isAdmin || !purgeTarget) return;
      const target = purgeTarget;
      purgeMut.mutate({ entityType: target.entityType, id: target.id }, {
        onSuccess: () => { toast.success(t('purgedToast', { entityType: t(`entityTypes.${target.entityType}`), name: target.label })); setPurgeTarget(null); },
      });
    },
  };
}

function ArchiveForbiddenState() {
  const t = useTranslations('archive');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
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

export function ArchiveView() {
  const t = useTranslations('archive');
  const { isAdmin, can } = usePermissions();
  const permittedTabs = getPermittedArchiveTabs(isAdmin, can);
  const hasAccess = permittedTabs.length > 0;
  const [selectedTab, setSelectedTab] = useState<ArchiveTab>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQ = useDebouncedValue(searchQuery, 250);
  const activeTab: ArchiveTab = permittedTabs.includes(selectedTab) ? selectedTab : (permittedTabs[0] ?? 'tasks');

  const archiveQuery = useArchiveInfiniteQuery({ tab: activeTab, q: debouncedQ }, hasAccess);
  const retentionQuery = useArchiveRetentionQuery(hasAccess);
  const actions = useArchiveActions(isAdmin);

  if (!hasAccess) return <ArchiveForbiddenState />;

  return (
    <div className="admin-page-stack">
      <p className="page-subtitle">{t('subtitle')}</p>
      <ArchiveRetentionBar settings={retentionQuery.data?.settings} isLoading={retentionQuery.isPending} isError={retentionQuery.isError} isAdmin={isAdmin} isSaving={actions.retentionMut.isPending} saveError={actions.retentionMut.error} onSave={actions.onSaveRetention} />
      <ArchiveToolbar permittedTabs={permittedTabs} activeTab={activeTab} searchQuery={searchQuery} onSelectTab={(tab) => { actions.resetRestoreErrors(); setSelectedTab(tab); }} onSearchChange={setSearchQuery} onResetSearch={() => setSearchQuery('')} />
      <ArchiveErrorBanner error={actions.restoreError} />
      <ArchiveTabPanel activeTab={activeTab} archiveQuery={archiveQuery} isAdmin={isAdmin} hasSearch={Boolean(searchQuery.trim())} onResetSearch={() => setSearchQuery('')} actions={actions} />
      {isAdmin && actions.purgeTarget ? (
        <ArchivePurgeModal target={actions.purgeTarget} isPurging={actions.purgeMut.isPending} error={actions.purgeMut.error} onClose={actions.closePurge} onConfirm={actions.confirmPurge} />
      ) : null}
    </div>
  );
}
