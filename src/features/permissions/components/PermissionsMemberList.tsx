'use client';

import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/MemberAvatar';
import { isMemberDetail, type MemberListItem } from '@/features/members/hooks/useMembers';

export interface PermissionsMemberListProps {
  members: MemberListItem[];
  selectedUserId: string | null;
  searchQuery: string;
  isPending: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onSearchChange: (q: string) => void;
  onSelectMember: (userId: string) => void;
  onLoadMore: () => void;
}

function AdminShieldIcon() {
  return (
    <svg className="ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 2.8v6c0 4.3-2.8 7.3-7 9.2-4.2-1.9-7-4.9-7-9.2v-6z" />
      <path d="M9.2 12l2 2 3.6-4" />
    </svg>
  );
}

function getMemberSubtitle(
  member: MemberListItem,
  isAdmin: boolean,
  t: ReturnType<typeof useTranslations<'permissionsAdmin'>>
): string {
  if (isAdmin) return t('roleAdmin');
  if (member.departments.length > 0) {
    return member.departments.map((dept) => dept.name).join(', ');
  }
  return t('noDepartment');
}

function PermissionMemberButton({
  member,
  isSelected,
  onSelect,
}: {
  member: MemberListItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('permissionsAdmin');
  const tBadge = useTranslations('member');
  const isAdmin = isMemberDetail(member) && member.isAdmin;
  const subtitle = getMemberSubtitle(member, isAdmin, t);
  const buttonClass = [
    'perm-person',
    isSelected ? 'is-active' : '',
    !member.isActive ? 'is-off' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={buttonClass} aria-pressed={isSelected} onClick={onSelect}>
      <MemberAvatar
        memberId={member.id}
        fullName={member.fullName}
        avatarUrl={member.avatarUrl}
        isActive={member.isActive}
      />
      <span className="perm-person-text">
        <b>
          {member.fullName}
          {!member.isActive ? <span className="member-left-badge"> {tBadge('leftBadge')}</span> : null}
        </b>
        <span>{subtitle}</span>
      </span>
      {isAdmin ? <AdminShieldIcon /> : null}
    </button>
  );
}

export function PermissionsMemberList({
  members,
  selectedUserId,
  searchQuery,
  isPending,
  hasNextPage,
  isFetchingNextPage,
  onSearchChange,
  onSelectMember,
  onLoadMore,
}: PermissionsMemberListProps) {
  const t = useTranslations('permissionsAdmin');
  const tCommon = useTranslations('common');

  return (
    <aside className="perm-people">
      <div className="perm-people-head">
        <h2>{t('membersHeading')}</h2>
        <span className="ui-chip">{members.length}</span>
      </div>
      <div className="perm-search-wrap">
        <input
          className="ui-input"
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
        />
      </div>
      {isPending ? (
        <p className="perm-empty-list" role="status">{tCommon('loading')}</p>
      ) : members.length === 0 ? (
        <p className="perm-empty-list">{t('noMembers')}</p>
      ) : (
        <div className="perm-people-list">
          {members.map((member) => (
            <PermissionMemberButton
              key={member.id}
              member={member}
              isSelected={member.id === selectedUserId}
              onSelect={() => onSelectMember(member.id)}
            />
          ))}
        </div>
      )}
      {hasNextPage ? (
        <div className="perm-people-more">
          <button type="button" className="ui-btn ghost is-sm" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {t('loadMoreMembers')}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
