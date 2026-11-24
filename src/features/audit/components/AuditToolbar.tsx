'use client';

import { useTranslations } from 'next-intl';
import type { MemberListItem } from '@/features/members/hooks/useMembers';
import {
  AUDIT_FILTER_ACTION_OPTIONS,
  type AuditDateRange,
} from '../formatters';
import type { AuditFiltersState } from '../hooks/useAuditLogs';

const DATE_RANGE_OPTIONS: {
  readonly value: AuditDateRange;
  readonly key: 'range7d' | 'range30d' | 'range90d' | 'rangeAll';
}[] = [
  { value: '7d', key: 'range7d' },
  { value: '30d', key: 'range30d' },
  { value: '90d', key: 'range90d' },
  { value: 'all', key: 'rangeAll' },
];

export interface AuditToolbarProps {
  filters: AuditFiltersState;
  members: readonly MemberListItem[];
  canFilterMembers: boolean;
  onActionChange: (action: string) => void;
  onDateRangeChange: (dateRange: AuditDateRange) => void;
  onActorChange: (actorId: string) => void;
  onTargetChange: (targetUserId: string) => void;
  onClearFilters: () => void;
}

function AuditMemberSelects({
  members,
  actorId,
  targetUserId,
  onActorChange,
  onTargetChange,
}: {
  members: readonly MemberListItem[];
  actorId: string;
  targetUserId: string;
  onActorChange: (actorId: string) => void;
  onTargetChange: (targetUserId: string) => void;
}) {
  const t = useTranslations('auditLogs');
  const tBadge = useTranslations('member');
  const formatMemberOption = (m: MemberListItem) =>
    m.isActive ? m.fullName : `${m.fullName} ${tBadge('leftBadge')}`;

  return (
    <>
      <div className="audit-filter-item">
        <select className="ui-select" value={actorId} onChange={(e) => onActorChange(e.target.value)} aria-label={t('actorFilterLabel')}>
          <option value="">{t('allActors')}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{formatMemberOption(m)}</option>)}
        </select>
      </div>
      <div className="audit-filter-item">
        <select className="ui-select" value={targetUserId} onChange={(e) => onTargetChange(e.target.value)} aria-label={t('targetFilterLabel')}>
          <option value="">{t('allTargets')}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{formatMemberOption(m)}</option>)}
        </select>
      </div>
    </>
  );
}

export function AuditToolbar({
  filters,
  members,
  canFilterMembers,
  onActionChange,
  onDateRangeChange,
  onActorChange,
  onTargetChange,
  onClearFilters,
}: AuditToolbarProps) {
  const t = useTranslations('auditLogs');

  return (
    <div className="audit-toolbar">
      <div className="audit-filter-item">
        <select className="ui-select" value={filters.action} onChange={(e) => onActionChange(e.target.value)} aria-label={t('actionFilterLabel')}>
          <option value="">{t('allActions')}</option>
          {AUDIT_FILTER_ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{t(`actions.${option.key}`)}</option>
          ))}
        </select>
      </div>
      <div className="audit-filter-item">
        <select className="ui-select" value={filters.dateRange} onChange={(e) => onDateRangeChange(e.target.value as AuditDateRange)} aria-label={t('dateRangeLabel')}>
          {DATE_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{t(option.key)}</option>
          ))}
        </select>
      </div>
      {canFilterMembers ? (
        <AuditMemberSelects
          members={members}
          actorId={filters.actorId}
          targetUserId={filters.targetUserId}
          onActorChange={onActorChange}
          onTargetChange={onTargetChange}
        />
      ) : null}
      <button type="button" className="ui-btn ghost is-sm" onClick={onClearFilters}>{t('clearFilters')}</button>
    </div>
  );
}
