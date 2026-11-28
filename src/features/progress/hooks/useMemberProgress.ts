'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMeQuery, useSessionQuery } from '@/features/auth/hooks/useAuth';
import { useMembersInfiniteQuery, type MemberListItem } from '@/features/members/hooks/useMembers';
import { apiFetch } from '@/features/shared/api/client';
import { usePermissions } from '@/features/shared/permissions/can';
import {
  TASKS_QUERY_KEYS,
  useTaskDepartmentsQuery,
  type TaskDto,
} from '@/features/tasks/hooks/useTasks';
import {
  filterMembersByDepartment,
  resolveMemberBannerIdentity,
  stepMemberId,
} from '../member-helpers';
import {
  aggregateClubWorkloadMap,
  computeMemberProgressStats,
  filterProgressTasks,
  type ProgressMode,
  type ProgressTaskFilter,
} from '../progress-helpers';

const CLUB_MEMBERS_FILTERS = {
  q: '',
  departmentId: '',
  status: 'active',
  limit: 100,
} as const;

function resolveActiveTeamMember(
  deptMembers: readonly MemberListItem[],
  requestedId: string | null,
  currentUserId: string
): MemberListItem | null {
  if (deptMembers.length === 0) return null;
  if (requestedId) {
    const matched = deptMembers.find((m) => m.id === requestedId);
    if (matched) return matched;
  }
  return deptMembers.find((m) => m.id !== currentUserId) ?? deptMembers[0] ?? null;
}

function useProgressViewState(canInspectClubMembers: boolean) {
  const [requestedMode, setRequestedMode] = useState<ProgressMode>('mine');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [requestedMemberId, setRequestedMemberId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProgressTaskFilter>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const mode: ProgressMode = canInspectClubMembers ? requestedMode : 'mine';
  const setMode = (nextMode: ProgressMode) => {
    const resolved: ProgressMode = canInspectClubMembers ? nextMode : 'mine';
    setRequestedMode(resolved);
    if (resolved === 'team' && filter === 'department') setFilter('open');
  };

  return {
    mode,
    setMode,
    selectedDepartmentId,
    setSelectedDepartmentId,
    requestedMemberId,
    setRequestedMemberId,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    selectedTaskId,
    setSelectedTaskId,
  };
}

function useTeamRosterState(params: {
  readonly teamEnabled: boolean;
  readonly selectedDepartmentId: string;
  readonly requestedMemberId: string | null;
  readonly currentUserId: string;
}) {
  const membersQuery = useMembersInfiniteQuery(CLUB_MEMBERS_FILTERS, params.teamEnabled);
  const departmentsQuery = useTaskDepartmentsQuery(params.teamEnabled);
  const clubTasksQuery = useQuery({
    queryKey: [...TASKS_QUERY_KEYS.progressRoot, 'clubWorkload'],
    queryFn: ({ signal }) => apiFetch('/tasks', { query: { limit: 200 }, signal }),
    enabled: params.teamEnabled,
  });

  const allMembers = useMemo(
    () => membersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [membersQuery.data]
  );
  const deptMembers = useMemo(
    () => filterMembersByDepartment(allMembers, params.selectedDepartmentId),
    [allMembers, params.selectedDepartmentId]
  );
  const selectedTeamMember = useMemo(
    () => resolveActiveTeamMember(deptMembers, params.requestedMemberId, params.currentUserId),
    [deptMembers, params.requestedMemberId, params.currentUserId]
  );
  const workloadMap = useMemo(
    () => aggregateClubWorkloadMap(clubTasksQuery.data?.items ?? []),
    [clubTasksQuery.data]
  );

  return { membersQuery, departmentsQuery, clubTasksQuery, deptMembers, selectedTeamMember, workloadMap };
}

function useProgressTasksState(params: {
  readonly mode: ProgressMode;
  readonly targetMemberId: string;
  readonly clubTasksQuery: ReturnType<typeof useTeamRosterState>['clubTasksQuery'];
  readonly state: ReturnType<typeof useProgressViewState>;
}) {
  const mineTasksQuery = useQuery({
    queryKey: [...TASKS_QUERY_KEYS.progressRoot, 'mine'],
    queryFn: ({ signal }) => apiFetch('/me/tasks', { query: { includeDone: true, limit: 100 }, signal }),
    enabled: params.mode === 'mine' && Boolean(params.targetMemberId),
  });

  const memberTasksQuery = params.mode === 'mine' ? mineTasksQuery : params.clubTasksQuery;
  const scopedTasks: readonly TaskDto[] = useMemo(() => {
    const items = memberTasksQuery.data?.items ?? [];
    if (params.mode === 'mine') return items.filter((task) => task.deletedAt === null);
    if (!params.targetMemberId) return [];
    return items.filter(
      (task) => task.deletedAt === null && task.assignees.some((a) => a.id === params.targetMemberId)
    );
  }, [memberTasksQuery.data, params.mode, params.targetMemberId]);

  const filteredTasks = useMemo(
    () =>
      filterProgressTasks(scopedTasks, {
        filter: params.state.filter,
        q: params.state.searchQuery,
        selectedMemberId: params.targetMemberId,
        allowDepartmentTasks: params.mode === 'mine',
      }),
    [scopedTasks, params.state.filter, params.state.searchQuery, params.targetMemberId, params.mode]
  );
  const selectedTask =
    filteredTasks.find((task) => task.id === params.state.selectedTaskId) ?? filteredTasks[0] ?? null;
  const stats = useMemo(() => computeMemberProgressStats(scopedTasks), [scopedTasks]);

  return { memberTasksQuery, directTasks: scopedTasks, filteredTasks, selectedTask, stats };
}

function resolveProgressSelection(params: {
  readonly mode: ProgressMode;
  readonly currentUserId: string;
  readonly meProfile: ReturnType<typeof useMeQuery>['data'];
  readonly selectedTeamMember: MemberListItem | null;
}) {
  const myProfile = params.meProfile?.profile ?? null;
  const targetMemberId = params.mode === 'mine' ? params.currentUserId : (params.selectedTeamMember?.id ?? '');
  const selectedMember = params.mode === 'mine' ? myProfile : params.selectedTeamMember;
  const isSelf = Boolean(targetMemberId) && targetMemberId === params.currentUserId;
  return { myProfile, targetMemberId, selectedMember, isSelf };
}

export function useMemberProgress() {
  const sessionQuery = useSessionQuery(true);
  const meQuery = useMeQuery(true);
  const { isAdmin, can } = usePermissions();
  const canInspectClubMembers = isAdmin || can('member.view');
  const currentUserId = meQuery.data?.profile.id ?? sessionQuery.data?.userId ?? '';
  const state = useProgressViewState(canInspectClubMembers);
  const roster = useTeamRosterState({
    teamEnabled: canInspectClubMembers && state.mode === 'team',
    selectedDepartmentId: state.selectedDepartmentId,
    requestedMemberId: state.requestedMemberId,
    currentUserId,
  });

  const sel = resolveProgressSelection({
    mode: state.mode,
    currentUserId,
    meProfile: meQuery.data,
    selectedTeamMember: roster.selectedTeamMember,
  });
  const taskState = useProgressTasksState({
    mode: state.mode,
    targetMemberId: sel.targetMemberId,
    clubTasksQuery: roster.clubTasksQuery,
    state,
  });
  const memberIdentity = resolveMemberBannerIdentity({
    isSelf: sel.isSelf,
    canViewDetail: isAdmin || can('member.view_detail'),
    selectedMember: sel.selectedMember,
    meProfile: sel.myProfile,
  });

  return {
    meQuery,
    ...taskState,
    ...roster,
    ...sel,
    ...state,
    canInspectClubMembers,
    canUpdateAny: isAdmin || can('task.update_any'),
    canUpdateAssigned: can('task.update_assigned'),
    isAdmin,
    currentUserId,
    memberIdentity,
    selectMember: (memberId: string) => state.setRequestedMemberId(memberId),
    stepMember: (delta: number) => {
      const nextId = stepMemberId(roster.deptMembers, sel.targetMemberId, delta);
      if (nextId) state.setRequestedMemberId(nextId);
    },
    selectTask: (taskId: string) => state.setSelectedTaskId(taskId),
  };
}
