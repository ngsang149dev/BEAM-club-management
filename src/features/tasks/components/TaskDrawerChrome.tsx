'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { describeTaskError } from '../error-mapping';
import type { TaskDto } from '../hooks/useTasks';

export type DrawerTab = 'details' | 'comments';

export function TaskDrawerReadOnlyBody({ task }: { task: TaskDto }) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-readonly-box">
      <div className="ui-banner" role="status">
        <div className="ui-banner-body"><span className="ui-banner-text">{tTasks('readOnlyNotice')}</span></div>
      </div>
      <h3 className="task-detail-title">{task.title}</h3>
      <p className="task-detail-desc">{task.description || '—'}</p>
    </div>
  );
}

export function TaskDrawerHiddenBanner({ isHidden }: { isHidden: boolean }) {
  const tTasks = useTranslations('tasks');
  if (!isHidden) return null;

  return (
    <div className="ui-banner is-warn" role="status">
      <div className="ui-banner-body">
        <span className="ui-banner-title">{tTasks('hiddenBannerTitle')}</span>
        <span className="ui-banner-text">{tTasks('hiddenBannerBody')}</span>
      </div>
    </div>
  );
}

export function TaskDrawerTabBar({
  activeTab,
  commentCount,
  detailsTabId,
  commentsTabId,
  detailsPanelId,
  commentsPanelId,
  onSelect,
}: {
  activeTab: DrawerTab;
  commentCount: number;
  detailsTabId: string;
  commentsTabId: string;
  detailsPanelId: string;
  commentsPanelId: string;
  onSelect: (tab: DrawerTab) => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-drawer-tabs" role="tablist" aria-label={tTasks('tabsAriaLabel')}>
      <button
        id={detailsTabId}
        type="button"
        role="tab"
        aria-selected={activeTab === 'details'}
        aria-controls={detailsPanelId}
        className={activeTab === 'details' ? 'task-drawer-tab is-active' : 'task-drawer-tab'}
        onClick={() => onSelect('details')}
      >
        <span>{tTasks('tabDetails')}</span>
      </button>
      <button
        id={commentsTabId}
        type="button"
        role="tab"
        aria-selected={activeTab === 'comments'}
        aria-controls={commentsPanelId}
        className={activeTab === 'comments' ? 'task-drawer-tab is-active' : 'task-drawer-tab'}
        onClick={() => onSelect('comments')}
      >
        <span>{tTasks('tabComments')}</span>
        <span className="task-drawer-tab-count">{commentCount}</span>
      </button>
    </div>
  );
}

export function TaskDrawerErrorBody({
  error,
  onClose,
  onRetry,
}: {
  error: unknown;
  onClose: () => void;
  onRetry: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeTaskError(error);
  const isNotFound = err?.key === 'notFound';

  return (
    <div className="ui-drawer-body">
      <ErrorState
        variant={isNotFound ? '404' : '500'}
        code={isNotFound ? tErr('404.code') : undefined}
        title={isNotFound ? tErr('404.title') : tTasks('loadError')}
        description={isNotFound ? tErr('404.description') : tErr(err?.key ?? 'unknown')}
        requestId={err?.requestId}
        requestIdLabel={tErr('requestIdLabel')}
        actions={
          <button type="button" className="ui-btn primary" onClick={() => (isNotFound ? onClose() : onRetry())}>
            {isNotFound ? tCommon('close') : tCommon('retry')}
          </button>
        }
      />
    </div>
  );
}
