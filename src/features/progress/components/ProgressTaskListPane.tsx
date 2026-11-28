'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { MemberAvatar } from '@/components/MemberAvatar';
import { describeTaskError } from '@/features/tasks/error-mapping';
import { formatVnMonthDayTime } from '@/features/tasks/formatters';
import type { TaskDto } from '@/features/tasks/hooks/useTasks';
import type { ResolvedMemberBannerIdentity } from '../member-helpers';
import {
  computeDeadlineBarMetrics,
  findMemberAssignee,
  type ProgressMode,
  type ProgressTaskFilter,
} from '../progress-helpers';

const MINE_FILTER_TABS: readonly { readonly key: ProgressTaskFilter; readonly labelKey: string }[] = [
  { key: 'open', labelKey: 'filterOpen' },
  { key: 'overdue', labelKey: 'filterOverdue' },
  { key: 'unaccepted', labelKey: 'filterUnaccepted' },
  { key: 'department', labelKey: 'filterDepartment' },
  { key: 'done', labelKey: 'filterDone' },
  { key: 'all', labelKey: 'filterAll' },
];

const TEAM_FILTER_TABS = MINE_FILTER_TABS.filter((tab) => tab.key !== 'department');

function MemberIdentityBanner({ identity }: { readonly identity: ResolvedMemberBannerIdentity }) {
  const t = useTranslations('progress');
  const tMember = useTranslations('member');
  const tProfile = useTranslations('profile');
  const depts = identity.departments.map((d) => d.name).join(' · ') || t('noDepartments');

  return (
    <div className="prog-member-banner">
      <MemberAvatar memberId={identity.id} fullName={identity.fullName} avatarUrl={identity.avatarUrl} isActive={identity.isActive} size="md" />
      <div className="prog-member-meta">
        <div className="prog-member-name-row">
          <h2 className="prog-member-name">
            {identity.fullName}{!identity.isActive ? ` ${tMember('leftBadge')}` : ''}
          </h2>
          <span className={`role-badge${identity.isAdmin ? ' is-admin' : ''}`}>
            {identity.isAdmin ? tProfile('roleAdmin') : tProfile('roleMember')}
          </span>
        </div>
        <div className="prog-member-sub">
          <span>{depts}</span>
          {identity.studentId && identity.email ? (
            <> · <span className="mono">{identity.studentId}</span> · <span>{identity.email}</span></>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TaskListFiltersBar({
  mode,
  filter,
  searchQuery,
  onFilterChange,
  onSearchChange,
}: {
  readonly mode: ProgressMode;
  readonly filter: ProgressTaskFilter;
  readonly searchQuery: string;
  readonly onFilterChange: (next: ProgressTaskFilter) => void;
  readonly onSearchChange: (q: string) => void;
}) {
  const t = useTranslations('progress');
  const tabs = mode === 'mine' ? MINE_FILTER_TABS : TEAM_FILTER_TABS;
  return (
    <div className="prog-list-toolbar">
      <div className="prog-filter-tabs" role="tablist" aria-label={t('filterTabsAria')}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filter === tab.key}
            className={`prog-filter-tab${filter === tab.key ? ' is-active' : ''}`}
            onClick={() => onFilterChange(tab.key)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="ui-input prog-task-search"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t('taskSearchPlaceholder')}
        aria-label={t('taskSearchLabel')}
      />
    </div>
  );
}

function ProgressTaskRowBadges({
  task,
  metrics,
  isDeptPendingAccept,
}: {
  readonly task: TaskDto;
  readonly metrics: ReturnType<typeof computeDeadlineBarMetrics>;
  readonly isDeptPendingAccept: boolean;
}) {
  const t = useTranslations('progress');
  const tTasks = useTranslations('tasks');

  return (
    <>
      <span className={`prog-dot is-${metrics.tier}`} aria-hidden="true" />
      <span className={`prog-row-title${task.isCompleted ? ' is-done' : ''}`}>{task.title}</span>
      {task.isHidden ? <span className="ui-chip task-hidden-chip prog-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
      {isDeptPendingAccept ? <span className="ui-chip prog-dept-pill">{t('deptAssignedPill')}</span> : null}
    </>
  );
}

function ProgressTaskRow({
  task,
  targetMemberId,
  selected,
  locale,
  onSelect,
}: {
  readonly task: TaskDto;
  readonly targetMemberId: string;
  readonly selected: boolean;
  readonly locale: string;
  readonly onSelect: () => void;
}) {
  const t = useTranslations('progress');
  const tCalendar = useTranslations('calendar');
  const metrics = computeDeadlineBarMetrics(task);
  const directAssignee = findMemberAssignee(task, targetMemberId);
  const accepted = Boolean(directAssignee?.acceptedAt);
  const isDeptPendingAccept = !directAssignee && task.assignedDepartments.length > 0;
  const deptLabel = task.assignedDepartments.map((d) => d.name).join(' · ') || tCalendar('clubWideDept');

  return (
    <li className={`prog-row${selected ? ' is-selected' : ''}`}>
      <div className="prog-row-task">
        <button type="button" className="prog-row-btn" aria-pressed={selected} onClick={onSelect}>
          <ProgressTaskRowBadges task={task} metrics={metrics} isDeptPendingAccept={isDeptPendingAccept} />
        </button>
        <div className="prog-row-dept">{deptLabel}</div>
      </div>
      <div className="prog-row-status">
        <span className={`prog-accept-chip ${accepted ? 'is-accepted' : 'is-pending'}`}>
          {accepted ? t('acceptedShort') : t('unacceptedShort')}
        </span>
      </div>
      <div className="prog-row-due">
        <span className={`prog-due-text mono is-${metrics.tier}`}>{formatVnMonthDayTime(task.dueAt, locale)}</span>
        <div className="prog-mini-track" aria-hidden="true">
          <div className="prog-mini-fill" style={{ width: `${metrics.barPct}%`, backgroundColor: metrics.fillHex }} />
        </div>
      </div>
    </li>
  );
}

function ProgressTaskListError({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeTaskError(error);
  return (
    <div className="prog-list-state">
      <ErrorState
        variant="500"
        title={t('loadTasksError')}
        description={tErr(err?.key ?? 'unknown')}
        requestId={err?.requestId}
        requestIdLabel={tErr('requestIdLabel')}
        actions={<button type="button" className="ui-btn primary is-sm" onClick={onRetry}>{tCommon('retry')}</button>}
      />
    </div>
  );
}

function ProgressTaskListBody(props: {
  readonly tasks: readonly TaskDto[];
  readonly targetMemberId: string;
  readonly selectedTaskId: string | null;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly onSelectTask: (taskId: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');

  if (props.isPending) return <div className="prog-list-state"><p className="auth-loading" role="status">{tCommon('loading')}</p></div>;
  if (props.isError) return <ProgressTaskListError error={props.error} onRetry={props.onRetry} />;
  if (props.tasks.length === 0) return <p className="prog-list-empty">{t('emptyTasks')}</p>;

  return (
    <ul className="prog-list">
      {props.tasks.map((task) => (
        <ProgressTaskRow
          key={task.id}
          task={task}
          targetMemberId={props.targetMemberId}
          selected={task.id === props.selectedTaskId}
          locale={locale}
          onSelect={() => props.onSelectTask(task.id)}
        />
      ))}
    </ul>
  );
}

export function ProgressTaskListPane(props: {
  readonly mode?: ProgressMode;
  readonly identity: ResolvedMemberBannerIdentity | null;
  readonly tasks: readonly TaskDto[];
  readonly targetMemberId: string;
  readonly selectedTaskId: string | null;
  readonly filter: ProgressTaskFilter;
  readonly searchQuery: string;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly onFilterChange: (next: ProgressTaskFilter) => void;
  readonly onSearchChange: (q: string) => void;
  readonly onRetry: () => void;
  readonly onSelectTask: (taskId: string) => void;
}) {
  const t = useTranslations('progress');
  return (
    <section className="prog-card prog-list-pane" aria-label={t('colTask')}>
      <div className="prog-list-pane-top">
        {props.identity ? <MemberIdentityBanner identity={props.identity} /> : null}
        <TaskListFiltersBar mode={props.mode ?? 'mine'} filter={props.filter} searchQuery={props.searchQuery} onFilterChange={props.onFilterChange} onSearchChange={props.onSearchChange} />
      </div>
      <div className="prog-list-cols" aria-hidden="true">
        <span>{t('colTask')}</span>
        <span>{t('colStatus')}</span>
        <span className="is-right">{t('colDue')}</span>
      </div>
      <div className="prog-list-scroll">
        <ProgressTaskListBody {...props} />
      </div>
    </section>
  );
}
