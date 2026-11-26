'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { describeTaskError } from '../error-mapping';
import type { TaskDto } from '../hooks/useTasks';

export type DrawerTab = 'details' | 'comments' | 'history';

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

function DrawerTabButton({
  id,
  panelId,
  active,
  label,
  count,
  onSelect,
}: {
  readonly id: string;
  readonly panelId: string;
  readonly active: boolean;
  readonly label: string;
  readonly count?: number;
  readonly onSelect: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      className={active ? 'task-drawer-tab is-active' : 'task-drawer-tab'}
      onClick={onSelect}
    >
      <span>{label}</span>
      {count !== undefined ? <span className="task-drawer-tab-count">{count}</span> : null}
    </button>
  );
}

export function TaskDrawerTabBar({
  activeTab,
  commentCount,
  detailsTabId,
  commentsTabId,
  historyTabId,
  detailsPanelId,
  commentsPanelId,
  historyPanelId,
  onSelect,
}: {
  activeTab: DrawerTab;
  commentCount: number;
  detailsTabId: string;
  commentsTabId: string;
  historyTabId: string;
  detailsPanelId: string;
  commentsPanelId: string;
  historyPanelId: string;
  onSelect: (tab: DrawerTab) => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-drawer-tabs" role="tablist" aria-label={tTasks('tabsAriaLabel')}>
      <DrawerTabButton
        id={detailsTabId}
        panelId={detailsPanelId}
        active={activeTab === 'details'}
        label={tTasks('tabDetails')}
        onSelect={() => onSelect('details')}
      />
      <DrawerTabButton
        id={commentsTabId}
        panelId={commentsPanelId}
        active={activeTab === 'comments'}
        label={tTasks('tabComments')}
        count={commentCount}
        onSelect={() => onSelect('comments')}
      />
      <DrawerTabButton
        id={historyTabId}
        panelId={historyPanelId}
        active={activeTab === 'history'}
        label={tTasks('tabHistory')}
        onSelect={() => onSelect('history')}
      />
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
