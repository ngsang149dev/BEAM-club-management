'use client';

import { useTranslations } from 'next-intl';
import type { MemberListItem } from '@/features/members/hooks/useMembers';
import type { DepartmentDto } from '@/features/tasks/hooks/useTasks';
import type {
  MemberProgressStats,
  MemberWorkloadStats,
  ProgressMode,
} from '../progress-helpers';
import { MemberComboboxPopover } from './MemberComboboxPopover';

function ModeSwitch({
  canInspectClubMembers,
  mode,
  onModeChange,
}: {
  readonly canInspectClubMembers: boolean;
  readonly mode: ProgressMode;
  readonly onModeChange: (next: ProgressMode) => void;
}) {
  const t = useTranslations('progress');
  return (
    <div className="prog-mode-switch" role="group" aria-label={t('modeAriaLabel')}>
      <button
        type="button"
        className={`prog-mode-btn${mode === 'mine' ? ' is-active' : ''}`}
        aria-pressed={mode === 'mine'}
        onClick={() => onModeChange('mine')}
      >
        {t('modeMine')}
      </button>
      {canInspectClubMembers ? (
        <button
          type="button"
          className={`prog-mode-btn${mode === 'team' ? ' is-active' : ''}`}
          aria-pressed={mode === 'team'}
          onClick={() => onModeChange('team')}
        >
          {t('modeTeam')}
        </button>
      ) : null}
    </div>
  );
}

function MemberStepperButtons({
  displayIdx,
  total,
  onStep,
}: {
  readonly displayIdx: number;
  readonly total: number;
  readonly onStep: (delta: number) => void;
}) {
  const t = useTranslations('progress');
  return (
    <div className="prog-stepper">
      <button
        type="button"
        className="prog-step-btn"
        aria-label={t('prevMemberAria')}
        title={t('prevMemberAria')}
        disabled={total <= 1}
        onClick={() => onStep(-1)}
      >
        ◀
      </button>
      <span className="prog-step-index mono">{displayIdx}/{total}</span>
      <button
        type="button"
        className="prog-step-btn"
        aria-label={t('nextMemberAria')}
        title={t('nextMemberAria')}
        disabled={total <= 1}
        onClick={() => onStep(1)}
      >
        ▶
      </button>
    </div>
  );
}

function TeamMemberPickerBar(props: {
  readonly departments: readonly DepartmentDto[];
  readonly selectedDepartmentId: string;
  readonly onDepartmentChange: (departmentId: string) => void;
  readonly members: readonly MemberListItem[];
  readonly selectedMember: MemberListItem | null;
  readonly workloadMap: Readonly<Record<string, MemberWorkloadStats>>;
  readonly onSelectMember: (memberId: string) => void;
  readonly onStepMember: (delta: number) => void;
}) {
  const t = useTranslations('progress');
  const currentIndex = props.selectedMember
    ? props.members.findIndex((m) => m.id === props.selectedMember?.id)
    : -1;
  const displayIdx = props.members.length === 0 ? 0 : Math.max(0, currentIndex) + 1;

  return (
    <div className="prog-picker-bar">
      <select
        className="ui-select prog-dept-select"
        value={props.selectedDepartmentId}
        onChange={(e) => props.onDepartmentChange(e.target.value)}
        aria-label={t('departmentFilterLabel')}
      >
        <option value="">{t('allDepartments')}</option>
        {props.departments.map((dept) => (
          <option key={dept.id} value={dept.id}>{dept.name}</option>
        ))}
      </select>
      <MemberComboboxPopover
        members={props.members}
        selectedMember={props.selectedMember}
        workloadMap={props.workloadMap}
        onSelectMember={props.onSelectMember}
      />
      <MemberStepperButtons displayIdx={displayIdx} total={props.members.length} onStep={props.onStepMember} />
    </div>
  );
}

function StatsPillStrip({ stats }: { readonly stats: MemberProgressStats }) {
  const t = useTranslations('progress');
  return (
    <div className="prog-stats-strip">
      <span className="prog-stat-pill"><span>{t('statOpen')}:</span> <strong>{stats.openCount}</strong></span>
      <span className={`prog-stat-pill${stats.overdueCount > 0 ? ' is-overdue' : ''}`}><span>{t('statOverdue')}:</span> <strong>{stats.overdueCount}</strong></span>
      <span className="prog-stat-pill"><span>{t('statDone')}:</span> <strong className="prog-text-done">{stats.doneCount}</strong></span>
      <span className="prog-stat-pill"><span>{t('statDeliverables')}:</span> <strong className="prog-text-pink">{stats.deliverablesCount}</strong></span>
    </div>
  );
}

export function ProgressHeaderBar(props: {
  readonly canInspectClubMembers: boolean;
  readonly mode: ProgressMode;
  readonly onModeChange: (next: ProgressMode) => void;
  readonly departments: readonly DepartmentDto[];
  readonly selectedDepartmentId: string;
  readonly onDepartmentChange: (departmentId: string) => void;
  readonly members: readonly MemberListItem[];
  readonly selectedMember: MemberListItem | null;
  readonly workloadMap: Readonly<Record<string, MemberWorkloadStats>>;
  readonly onSelectMember: (memberId: string) => void;
  readonly onStepMember: (delta: number) => void;
  readonly stats: MemberProgressStats;
}) {
  return (
    <header className="prog-header">
      <div className="prog-header-controls">
        <ModeSwitch canInspectClubMembers={props.canInspectClubMembers} mode={props.mode} onModeChange={props.onModeChange} />
        {props.canInspectClubMembers && props.mode === 'team' ? (
          <TeamMemberPickerBar
            departments={props.departments}
            selectedDepartmentId={props.selectedDepartmentId}
            onDepartmentChange={props.onDepartmentChange}
            members={props.members}
            selectedMember={props.selectedMember}
            workloadMap={props.workloadMap}
            onSelectMember={props.onSelectMember}
            onStepMember={props.onStepMember}
          />
        ) : null}
      </div>
      <StatsPillStrip stats={props.stats} />
    </header>
  );
}
