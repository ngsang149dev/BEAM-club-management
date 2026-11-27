'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
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
    setRequestedMode(canInspectClubMembers ? nextMode : 'mine');
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

  return { membersQuery, departmentsQuery, deptMembers, selectedTeamMember, workloadMap };
}

function useDirectMemberTasks(targetMemberId: string, state: ReturnType<typeof useProgressViewState>) {
  const memberTasksQuery = useQuery({
    queryKey: [...TASKS_QUERY_KEYS.progressRoot, 'member', targetMemberId],
    queryFn: ({ signal }) =>
      apiFetch('/tasks', {
        query: { assigneeId: targetMemberId, sortBy: 'dueAt', sortOrder: 'asc', limit: 200 },
        signal,
      }),
    enabled: Boolean(targetMemberId),
  });

  const directTasks: readonly TaskDto[] = useMemo(
    () =>
      (memberTasksQuery.data?.items ?? []).filter(
        (task) => task.deletedAt === null && task.assignees.some((a) => a.id === targetMemberId)
      ),
    [memberTasksQuery.data, targetMemberId]
  );
  const filteredTasks = useMemo(
    () =>
      filterProgressTasks(directTasks, {
        filter: state.filter,
        q: state.searchQuery,
        selectedMemberId: targetMemberId,
      }),
    [directTasks, state.filter, state.searchQuery, targetMemberId]
  );
  const selectedTask =
    filteredTasks.find((task) => task.id === state.selectedTaskId) ?? filteredTasks[0] ?? null;
  const stats = useMemo(() => computeMemberProgressStats(directTasks), [directTasks]);

  return { memberTasksQuery, directTasks, filteredTasks, selectedTask, stats };
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
  const meQuery = useMeQuery(true);
  const { isAdmin, can } = usePermissions();
  const canInspectClubMembers = isAdmin || can('member.view');
  const currentUserId = meQuery.data?.profile.id ?? '';
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
  const taskState = useDirectMemberTasks(sel.targetMemberId, state);
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
