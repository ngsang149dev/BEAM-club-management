'use client';

import { useLocale, useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import type { MemberDetail } from '@/features/members/hooks/useMembers';
import { usePermissions } from '@/features/shared/permissions/can';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import type { MemberListItem } from '../hooks/useArchive';

export interface ArchiveMembersTableProps {
  readonly items: readonly MemberListItem[];
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly onRestore: (member: MemberListItem) => void;
  readonly onPurge: (member: MemberListItem) => void;
}

function hasMemberPii(member: MemberListItem): member is MemberDetail {
  return (
    'studentId' in member &&
    typeof member.studentId === 'string' &&
    'email' in member &&
    typeof member.email === 'string'
  );
}

function MemberIdentityCell({ member }: { readonly member: MemberListItem }) {
  const tMember = useTranslations('member');
  return (
    <div className="member-name-cell">
      <MemberAvatar
        memberId={member.id}
        fullName={member.fullName}
        avatarUrl={member.avatarUrl}
        isActive={member.isActive}
      />
      <span className="member-name-text">
        <span>{member.fullName}</span>
        {!member.isActive ? (
          <span className="member-left-badge">{tMember('leftBadge')}</span>
        ) : null}
      </span>
    </div>
  );
}

function MemberDepartmentsCell({ member }: { readonly member: MemberListItem }) {
  const tDir = useTranslations('members');
  if (member.departments.length === 0) {
    return <span className="muted-dash">{tDir('noDepartment')}</span>;
  }
  return (
    <div className="dept-chip-list">
      {member.departments.map((dept) => (
        <span key={dept.id} className="ui-chip">
          {dept.name}
        </span>
      ))}
    </div>
  );
}

function MemberRowActions({
  isAdmin,
  isRestoringThis,
  isBusy,
  onRestore,
  onPurge,
}: {
  readonly isAdmin: boolean;
  readonly isRestoringThis: boolean;
  readonly isBusy: boolean;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const t = useTranslations('archive');
  return (
    <div className="archive-row-actions">
      <button
        type="button"
        className="ui-btn secondary is-sm"
        disabled={isBusy}
        onClick={onRestore}
      >
        {isRestoringThis ? t('restoringButton') : t('restoreButton')}
      </button>
      {isAdmin ? (
        <button
          type="button"
          className="ui-btn danger is-sm"
          disabled={isBusy}
          onClick={onPurge}
        >
          {t('purgeButton')}
        </button>
      ) : null}
    </div>
  );
}

function ArchiveMemberDesktopRow({
  member,
  showPiiColumns,
  canViewDetail,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly member: MemberListItem;
  readonly showPiiColumns: boolean;
  readonly canViewDetail: boolean;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const detail = canViewDetail && hasMemberPii(member) ? member : null;

  return (
    <tr className={member.isActive ? undefined : 'is-inactive'}>
      <td>
        <MemberIdentityCell member={member} />
      </td>
      {showPiiColumns ? <td className="mono">{detail?.studentId ?? ''}</td> : null}
      {showPiiColumns ? <td>{detail?.email ?? ''}</td> : null}
      <td>
        <MemberDepartmentsCell member={member} />
      </td>
      <td className="mono">{formatTaskDateTime(member.leftAt, locale)}</td>
      <td className="ui-col-right">
        <MemberRowActions
          isAdmin={isAdmin}
          isRestoringThis={restoringId === member.id}
          isBusy={isBusy}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      </td>
    </tr>
  );
}

function ArchiveMemberMobileCard({
  member,
  canViewDetail,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly member: MemberListItem;
  readonly canViewDetail: boolean;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const t = useTranslations('archive');
  const detail = canViewDetail && hasMemberPii(member) ? member : null;

  return (
    <li className="directory-mobile-card">
      <div className="directory-mobile-head">
        <MemberIdentityCell member={member} />
      </div>
      {detail ? (
        <div className="directory-mobile-pii">
          <span className="mono">{detail.studentId}</span>
          <span>{detail.email}</span>
        </div>
      ) : null}
      <MemberDepartmentsCell member={member} />
      <div className="directory-mobile-meta">
        <span className="mono archive-mobile-time">
          {t('colLeftAt')}: {formatTaskDateTime(member.leftAt, locale)}
        </span>
        <MemberRowActions
          isAdmin={isAdmin}
          isRestoringThis={restoringId === member.id}
          isBusy={isBusy}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      </div>
    </li>
  );
}

function ArchiveMembersDesktopTable({
  items,
  showPiiColumns,
  canViewDetail,
  isAdmin,
  restoringId,
  isBusy,
  locale,
  onRestore,
  onPurge,
}: {
  readonly items: readonly MemberListItem[];
  readonly showPiiColumns: boolean;
  readonly canViewDetail: boolean;
  readonly isAdmin: boolean;
  readonly restoringId: string | null;
  readonly isBusy: boolean;
  readonly locale: string;
  readonly onRestore: (member: MemberListItem) => void;
  readonly onPurge: (member: MemberListItem) => void;
}) {
  const t = useTranslations('archive');
  const tDir = useTranslations('members');

  return (
    <div className="directory-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            <th>{tDir('colMember')}</th>
            {showPiiColumns ? <th>{tDir('colStudentId')}</th> : null}
            {showPiiColumns ? <th>{tDir('colEmail')}</th> : null}
            <th>{tDir('colDepartments')}</th>
            <th>{t('colLeftAt')}</th>
            <th className="ui-col-right">{t('colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((member) => (
            <ArchiveMemberDesktopRow
              key={member.id}
              member={member}
              showPiiColumns={showPiiColumns}
              canViewDetail={canViewDetail}
              isAdmin={isAdmin}
              restoringId={restoringId}
              isBusy={isBusy}
              locale={locale}
              onRestore={() => onRestore(member)}
              onPurge={() => onPurge(member)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArchiveMembersTable({
  items,
  isAdmin,
  restoringId,
  isBusy,
  onRestore,
  onPurge,
}: ArchiveMembersTableProps) {
  const locale = useLocale();
  const t = useTranslations('archive');
  const { can } = usePermissions();
  const canViewDetail = can('member.view_detail');
  const showPiiColumns = canViewDetail && items.some(hasMemberPii);

  return (
    <>
      {!canViewDetail ? <p className="archive-privacy-banner">{t('privacyHint')}</p> : null}
      <ArchiveMembersDesktopTable
        items={items}
        showPiiColumns={showPiiColumns}
        canViewDetail={canViewDetail}
        isAdmin={isAdmin}
        restoringId={restoringId}
        isBusy={isBusy}
        locale={locale}
        onRestore={onRestore}
        onPurge={onPurge}
      />
      <ul className="directory-mobile-list">
        {items.map((member) => (
          <ArchiveMemberMobileCard
            key={member.id}
            member={member}
            canViewDetail={canViewDetail}
            isAdmin={isAdmin}
            restoringId={restoringId}
            isBusy={isBusy}
            locale={locale}
            onRestore={() => onRestore(member)}
            onPurge={() => onPurge(member)}
          />
        ))}
      </ul>
    </>
  );
}
