'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { describeTaskError } from '../error-mapping';
import { formatShortVnDate, formatTaskDateTime } from '../formatters';
import type { TaskDto } from '../hooks/useTasks';
import {
  MemberInlineName,
  TaskDeadlineBadge,
  TaskDepartmentChips,
} from './TaskPriorityBadge';

export type DrawerTab = 'details' | 'comments' | 'history';
export type ModalSubTab = 'comments' | 'history';

export function formatModalDateRange(startAt: string | null, dueAt: string | null): string | null {
  const start = formatShortVnDate(startAt);
  const due = formatShortVnDate(dueAt);
  if (start && due) return `${start} → ${due}`;
  if (start) return start;
  if (due) return due;
  return null;
}

export function TaskModalHeader({
  titleId,
  task,
  onClose,
}: {
  readonly titleId: string;
  readonly task: TaskDto | null;
  readonly onClose: () => void;
}) {
  const locale = useLocale();
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const rangeText = task ? formatModalDateRange(task.startAt, task.dueAt) : null;

  return (
    <div className="task-modal-header">
      <div className="task-modal-header-main">
        {task ? (
          <div className="task-modal-header-badges">
            <TaskDepartmentChips departments={task.assignedDepartments} />
            <TaskDeadlineBadge dueAt={task.dueAt} isCompleted={task.isCompleted} />
            {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
            {rangeText ? <span className="task-modal-range mono">{rangeText}</span> : null}
            <span className="task-modal-creator">
              <MemberInlineName member={task.creator} /> · {formatTaskDateTime(task.createdAt, locale)}
            </span>
          </div>
        ) : null}
        <h2 id={titleId} className="task-modal-title">
          {task ? task.title : tTasks('drawerTitle')}
        </h2>
      </div>
      <button type="button" className="ui-btn ghost is-sm" aria-label={tCommon('close')} onClick={onClose}>
        {tCommon('close')} ✕
      </button>
    </div>
  );
}

export function TaskModalSubTabs({
  subTab,
  commentCount,
  onSelect,
}: {
  readonly subTab: ModalSubTab;
  readonly commentCount: number;
  readonly onSelect: (tab: ModalSubTab) => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-subtabs" role="tablist" aria-label={tTasks('tabsAriaLabel')}>
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'comments'}
        className={`task-subtab-btn${subTab === 'comments' ? ' is-active' : ''}`}
        onClick={() => onSelect('comments')}
      >
        <span>{tTasks('tabComments')}</span>
        <span className="task-drawer-tab-count">{commentCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'history'}
        className={`task-subtab-btn${subTab === 'history' ? ' is-active' : ''}`}
        onClick={() => onSelect('history')}
      >
        <span>{tTasks('tabHistory')}</span>
      </button>
    </div>
  );
}

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
      <DrawerTabButton id={detailsTabId} panelId={detailsPanelId} active={activeTab === 'details'} label={tTasks('tabDetails')} onSelect={() => onSelect('details')} />
      <DrawerTabButton id={commentsTabId} panelId={commentsPanelId} active={activeTab === 'comments'} label={tTasks('tabComments')} count={commentCount} onSelect={() => onSelect('comments')} />
      <DrawerTabButton id={historyTabId} panelId={historyPanelId} active={activeTab === 'history'} label={tTasks('tabHistory')} onSelect={() => onSelect('history')} />
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
    <div className="task-modal-body">
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
