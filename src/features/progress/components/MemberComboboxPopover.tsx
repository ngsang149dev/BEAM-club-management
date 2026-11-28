'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import type { MemberListItem } from '@/features/members/hooks/useMembers';
import { filterPopoverMembers } from '../member-helpers';
import type { MemberWorkloadStats, ProgressPopoverFilter } from '../progress-helpers';

function MemberPopoverOption({
  member,
  workload,
  isSelected,
  onSelect,
}: {
  readonly member: MemberListItem;
  readonly workload: MemberWorkloadStats;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  const t = useTranslations('progress');
  const tMember = useTranslations('member');
  const deptsText = member.departments.map((d) => d.name).join(' · ') || t('noDepartments');

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      className={`prog-pop-item${isSelected ? ' is-active' : ''}`}
      onClick={onSelect}
    >
      <div className="prog-pop-item-main">
        <MemberAvatar memberId={member.id} fullName={member.fullName} avatarUrl={member.avatarUrl} isActive={member.isActive} size="sm" />
        <div className="prog-pop-item-text">
          <span className="prog-pop-item-name">
            {member.fullName}{!member.isActive ? ` ${tMember('leftBadge')}` : ''}
          </span>
          <span className="prog-pop-item-depts">{deptsText}</span>
        </div>
      </div>
      <div className="prog-pop-item-badges">
        <span className="prog-pop-badge">{t('memberOpenBadge', { count: workload.openCount })}</span>
        {workload.overdueCount > 0 ? (
          <span className="prog-pop-badge is-overdue">{t('memberOverdueBadge', { count: workload.overdueCount })}</span>
        ) : null}
      </div>
    </button>
  );
}

function MemberPopoverHead({
  searchQuery,
  popoverFilter,
  onSearchChange,
  onFilterChange,
}: {
  readonly searchQuery: string;
  readonly popoverFilter: ProgressPopoverFilter;
  readonly onSearchChange: (q: string) => void;
  readonly onFilterChange: (next: ProgressPopoverFilter) => void;
}) {
  const t = useTranslations('progress');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="prog-popover-head">
      <input
        ref={inputRef}
        type="search"
        className="ui-input prog-popover-search"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t('memberSearchPlaceholder')}
        aria-label={t('memberSearchLabel')}
      />
      <div className="prog-popover-filters">
        <button type="button" className={`prog-pop-pill${popoverFilter === 'all' ? ' is-active' : ''}`} onClick={() => onFilterChange('all')}>
          {t('popoverFilterAll')}
        </button>
        <button type="button" className={`prog-pop-pill is-overdue-filter${popoverFilter === 'overdue' ? ' is-active' : ''}`} onClick={() => onFilterChange('overdue')}>
          {t('popoverFilterOverdue')}
        </button>
      </div>
    </div>
  );
}

function MemberPopoverPanel(props: {
  readonly listId: string;
  readonly searchQuery: string;
  readonly popoverFilter: ProgressPopoverFilter;
  readonly filteredMembers: readonly MemberListItem[];
  readonly selectedMemberId: string | null;
  readonly workloadMap: Readonly<Record<string, MemberWorkloadStats>>;
  readonly onSearchChange: (q: string) => void;
  readonly onFilterChange: (next: ProgressPopoverFilter) => void;
  readonly onSelectMember: (memberId: string) => void;
}) {
  const t = useTranslations('progress');
  return (
    <div className="prog-popover" id={props.listId} role="listbox" aria-label={t('memberPickerLabel')}>
      <MemberPopoverHead
        searchQuery={props.searchQuery}
        popoverFilter={props.popoverFilter}
        onSearchChange={props.onSearchChange}
        onFilterChange={props.onFilterChange}
      />
      <div className="prog-popover-list">
        {props.filteredMembers.length === 0 ? (
          <p className="prog-popover-empty">{t('popoverEmpty')}</p>
        ) : (
          props.filteredMembers.map((member) => (
            <MemberPopoverOption
              key={member.id}
              member={member}
              workload={props.workloadMap[member.id] ?? { openCount: 0, overdueCount: 0 }}
              isSelected={member.id === props.selectedMemberId}
              onSelect={() => props.onSelectMember(member.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ComboboxTriggerLabel({
  selectedMember,
  workload,
}: {
  readonly selectedMember: MemberListItem | null;
  readonly workload: MemberWorkloadStats;
}) {
  const t = useTranslations('progress');
  if (!selectedMember) {
    return <span className="prog-combobox-name">{t('emptyMembers')}</span>;
  }
  return (
    <>
      <MemberAvatar memberId={selectedMember.id} fullName={selectedMember.fullName} avatarUrl={selectedMember.avatarUrl} isActive={selectedMember.isActive} size="xs" />
      <span className="prog-combobox-name">{selectedMember.fullName}</span>
      <span className="prog-combobox-counts">
        ({t('memberOpenBadge', { count: workload.openCount })}
        {workload.overdueCount > 0 ? (
          <> · <strong className="prog-text-danger">{t('memberOverdueBadge', { count: workload.overdueCount })}</strong></>
        ) : null})
      </span>
    </>
  );
}

function useOutsideClickClose(
  isOpen: boolean,
  close: () => void,
  rootRef: React.RefObject<HTMLDivElement | null>
) {
  useEscapeClose(isOpen, close);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, close, rootRef]);
}

export function MemberComboboxPopover({
  members,
  selectedMember,
  workloadMap,
  onSelectMember,
}: {
  readonly members: readonly MemberListItem[];
  readonly selectedMember: MemberListItem | null;
  readonly workloadMap: Readonly<Record<string, MemberWorkloadStats>>;
  readonly onSelectMember: (memberId: string) => void;
}) {
  const t = useTranslations('progress');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [popoverFilter, setPopoverFilter] = useState<ProgressPopoverFilter>('all');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOutsideClickClose(isOpen, () => setIsOpen(false), rootRef);

  const filteredMembers = filterPopoverMembers(members, { q: searchQuery, popoverFilter, workloadMap });
  const selectedWorkload = selectedMember ? (workloadMap[selectedMember.id] ?? { openCount: 0, overdueCount: 0 }) : { openCount: 0, overdueCount: 0 };

  return (
    <div className="prog-combobox-root" ref={rootRef}>
      <button type="button" className="prog-combobox-btn" aria-expanded={isOpen} aria-controls={listId} aria-label={t('memberPickerLabel')} onClick={() => setIsOpen((prev) => !prev)}>
        <span className="prog-combobox-label">
          <ComboboxTriggerLabel selectedMember={selectedMember} workload={selectedWorkload} />
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen ? (
        <MemberPopoverPanel
          listId={listId}
          searchQuery={searchQuery}
          popoverFilter={popoverFilter}
          filteredMembers={filteredMembers}
          selectedMemberId={selectedMember?.id ?? null}
          workloadMap={workloadMap}
          onSearchChange={setSearchQuery}
          onFilterChange={setPopoverFilter}
          onSelectMember={(memberId) => {
            onSelectMember(memberId);
            setIsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
