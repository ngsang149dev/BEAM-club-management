import type { MemberDetail, MemberListItem } from '@/features/members/hooks/useMembers';
import { isMemberDetail } from '@/features/members/hooks/useMembers';
import type { MemberWorkloadStats, ProgressPopoverFilter } from './progress-helpers';

export interface ResolvedMemberBannerIdentity {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly isActive: boolean;
  readonly departments: readonly { readonly id: string; readonly name: string }[];
  readonly isAdmin: boolean;
  readonly studentId: string | null;
  readonly email: string | null;
}

export function filterMembersByDepartment(
  members: readonly MemberListItem[],
  departmentId: string
): MemberListItem[] {
  if (!departmentId) return [...members];
  return members.filter((member) =>
    member.departments.some((dept) => dept.id === departmentId)
  );
}

export function filterPopoverMembers(
  members: readonly MemberListItem[],
  options: {
    readonly q: string;
    readonly popoverFilter: ProgressPopoverFilter;
    readonly workloadMap: Readonly<Record<string, MemberWorkloadStats>>;
  }
): MemberListItem[] {
  const needle = options.q.trim().toLowerCase();
  return members.filter((member) => {
    if (needle && !member.fullName.toLowerCase().includes(needle)) return false;
    if (options.popoverFilter === 'overdue') {
      return (options.workloadMap[member.id]?.overdueCount ?? 0) > 0;
    }
    return true;
  });
}

export function stepMemberId(
  members: readonly MemberListItem[],
  currentId: string,
  delta: number
): string | null {
  if (members.length === 0) return null;
  const idx = members.findIndex((m) => m.id === currentId);
  const nextIdx = idx < 0 ? 0 : (idx + delta + members.length) % members.length;
  return members[nextIdx]?.id ?? null;
}

function resolveVisibleMemberDetail(params: {
  readonly isSelf: boolean;
  readonly canViewDetail: boolean;
  readonly base: MemberListItem;
  readonly meProfile: MemberDetail | null | undefined;
}): MemberDetail | null {
  if (params.isSelf && params.meProfile) return params.meProfile;
  if (params.canViewDetail && isMemberDetail(params.base)) return params.base;
  return null;
}

function buildBannerIdentity(
  base: MemberListItem,
  detail: MemberDetail | null
): ResolvedMemberBannerIdentity {
  const shared = {
    id: base.id,
    fullName: base.fullName,
    avatarUrl: base.avatarUrl ?? null,
    isActive: base.isActive,
    departments: base.departments,
  };
  if (detail) {
    return { ...shared, isAdmin: detail.isAdmin, studentId: detail.studentId, email: detail.email };
  }
  return { ...shared, isAdmin: false, studentId: null, email: null };
}

export function resolveMemberBannerIdentity(params: {
  readonly isSelf: boolean;
  readonly canViewDetail: boolean;
  readonly selectedMember: MemberListItem | null;
  readonly meProfile: MemberDetail | null | undefined;
}): ResolvedMemberBannerIdentity | null {
  const base = params.isSelf ? (params.meProfile ?? params.selectedMember) : params.selectedMember;
  if (!base) return null;
  const detail = resolveVisibleMemberDetail({
    isSelf: params.isSelf,
    canViewDetail: params.canViewDetail,
    base,
    meProfile: params.meProfile,
  });
  return buildBannerIdentity(base, detail);
}
