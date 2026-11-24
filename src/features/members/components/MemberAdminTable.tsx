'use client';

import { useTranslations } from 'next-intl';
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ActionMenu';
import { MemberAvatar } from '@/components/MemberAvatar';
import { usePermissions } from '@/features/shared/permissions/can';
import { isMemberDetail, type MemberListItem } from '../hooks/useMembers';

export function canViewerResetMemberPassword({
  viewerIsAdmin,
}: {
  viewerIsAdmin: boolean;
  canUpdateMember?: boolean;
  member?: MemberListItem;
}): boolean {
  return viewerIsAdmin;
}

export function MemberIdentityCell({ member }: { member: MemberListItem }) {
  const tBadge = useTranslations('member');

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
        {!member.isActive ? <span className="member-left-badge">{tBadge('leftBadge')}</span> : null}
      </span>
    </div>
  );
}

export function MemberStatusPill({ isActive }: { isActive: boolean }) {
  const tDir = useTranslations('members');
  return (
    <span className={isActive ? 'status-pill is-active' : 'status-pill is-inactive'}>
      {isActive ? tDir('statusPillActive') : tDir('statusPillInactive')}
    </span>
  );
}

export function MemberDepartmentsCell({ member }: { member: MemberListItem }) {
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

function MemberStatusMenuItem({
  member,
  onStatusAction,
}: {
  member: MemberListItem;
  onStatusAction: (member: MemberListItem, action: 'deactivate' | 'activate') => void;
}) {
  const tAdmin = useTranslations('memberAdmin');
  const nextAction = member.isActive ? 'deactivate' : 'activate';
  const label = member.isActive ? tAdmin('deactivateAction') : tAdmin('activateAction');

  return (
    <ActionMenuItem
      variant={member.isActive ? 'danger' : 'default'}
      onSelect={() => onStatusAction(member, nextAction)}
    >
      {label}
    </ActionMenuItem>
  );
}

function MemberAdminRowActions({
  member,
  onEdit,
  onResetPassword,
  onStatusAction,
}: {
  member: MemberListItem;
  onEdit: (member: MemberListItem) => void;
  onResetPassword: (member: MemberListItem) => void;
  onStatusAction: (member: MemberListItem, action: 'deactivate' | 'activate') => void;
}) {
  const tAdmin = useTranslations('memberAdmin');
  const { isAdmin, can } = usePermissions();
  const canEdit = can('member.update');
  const canResetPassword = canViewerResetMemberPassword({
    viewerIsAdmin: isAdmin,
  });
  const canDeactivate = can('member.deactivate');
  const hasPrimaryAction = canEdit || canResetPassword;

  if (!hasPrimaryAction && !canDeactivate) {
    return null;
  }

  return (
    <div className="admin-row-actions">
      <ActionMenu label={tAdmin('rowActionsMenu')}>
        {canEdit ? (
          <ActionMenuItem onSelect={() => onEdit(member)}>
            {tAdmin('editAction')}
          </ActionMenuItem>
        ) : null}
        {canResetPassword ? (
          <ActionMenuItem onSelect={() => onResetPassword(member)}>
            {tAdmin('resetPasswordAction')}
          </ActionMenuItem>
        ) : null}
        {hasPrimaryAction && canDeactivate ? <ActionMenuSeparator /> : null}
        {canDeactivate ? (
          <MemberStatusMenuItem member={member} onStatusAction={onStatusAction} />
        ) : null}
      </ActionMenu>
    </div>
  );
}

function MemberAdminRow({
  member,
  canViewDetail,
  onEdit,
  onResetPassword,
  onStatusAction,
}: {
  member: MemberListItem;
  canViewDetail: boolean;
  onEdit: (member: MemberListItem) => void;
  onResetPassword: (member: MemberListItem) => void;
  onStatusAction: (member: MemberListItem, action: 'deactivate' | 'activate') => void;
}) {
  const detail = canViewDetail && isMemberDetail(member) ? member : null;

  return (
    <tr className={member.isActive ? undefined : 'is-inactive'}>
      <td><MemberIdentityCell member={member} /></td>
      {canViewDetail ? <td className="mono">{detail?.studentId ?? ''}</td> : null}
      {canViewDetail ? <td>{detail?.email ?? ''}</td> : null}
      <td><MemberDepartmentsCell member={member} /></td>
      <td><MemberStatusPill isActive={member.isActive} /></td>
      <td className="ui-col-right">
        <MemberAdminRowActions
          member={member}
          onEdit={onEdit}
          onResetPassword={onResetPassword}
          onStatusAction={onStatusAction}
        />
      </td>
    </tr>
  );
}

function MemberAdminMobileCard({
  member,
  canViewDetail,
  onEdit,
  onResetPassword,
  onStatusAction,
}: {
  member: MemberListItem;
  canViewDetail: boolean;
  onEdit: (member: MemberListItem) => void;
  onResetPassword: (member: MemberListItem) => void;
  onStatusAction: (member: MemberListItem, action: 'deactivate' | 'activate') => void;
}) {
  const detail = canViewDetail && isMemberDetail(member) ? member : null;

  return (
    <li className="directory-mobile-card">
      <div className="directory-mobile-head">
        <MemberIdentityCell member={member} />
        <MemberStatusPill isActive={member.isActive} />
      </div>
      {detail ? (
        <div className="directory-mobile-pii">
          <span className="mono">{detail.studentId}</span>
          <span>{detail.email}</span>
        </div>
      ) : null}
      <div className="directory-mobile-meta">
        <MemberDepartmentsCell member={member} />
        <MemberAdminRowActions
          member={member}
          onEdit={onEdit}
          onResetPassword={onResetPassword}
          onStatusAction={onStatusAction}
        />
      </div>
    </li>
  );
}

export function MemberAdminTable({
  members,
  canViewDetail,
  onEdit,
  onResetPassword,
  onStatusAction,
}: {
  members: MemberListItem[];
  canViewDetail: boolean;
  onEdit: (member: MemberListItem) => void;
  onResetPassword: (member: MemberListItem) => void;
  onStatusAction: (member: MemberListItem, action: 'deactivate' | 'activate') => void;
}) {
  const tDir = useTranslations('members');
  const tAdmin = useTranslations('memberAdmin');

  return (
    <>
      <div className="directory-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>{tDir('colMember')}</th>
              {canViewDetail ? <th>{tDir('colStudentId')}</th> : null}
              {canViewDetail ? <th>{tDir('colEmail')}</th> : null}
              <th>{tDir('colDepartments')}</th>
              <th>{tDir('colStatus')}</th>
              <th className="ui-col-right">{tAdmin('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <MemberAdminRow
                key={member.id}
                member={member}
                canViewDetail={canViewDetail}
                onEdit={onEdit}
                onResetPassword={onResetPassword}
                onStatusAction={onStatusAction}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="directory-mobile-list">
        {members.map((member) => (
          <MemberAdminMobileCard
            key={member.id}
            member={member}
            canViewDetail={canViewDetail}
            onEdit={onEdit}
            onResetPassword={onResetPassword}
            onStatusAction={onStatusAction}
          />
        ))}
      </ul>
    </>
  );
}
