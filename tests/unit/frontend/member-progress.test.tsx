import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import type { components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const apiFetchMock = vi.hoisted(() => vi.fn());
const authHooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
}));
const membersHooksMock = vi.hoisted(() => ({
  useMembersInfiniteQuery: vi.fn(),
}));
const tasksHooksMock = vi.hoisted(() => ({
  useTaskDepartmentsQuery: vi.fn(),
  useTaskDetailQuery: vi.fn(() => ({ isPending: false, isError: false, error: null, data: undefined, refetch: vi.fn() })),
  useUpdateTaskAcceptanceMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useCreateTaskDeliverableMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteTaskDeliverableMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));
const commentsHooksMock = vi.hoisted(() => ({
  useTaskCommentsInfiniteQuery: vi.fn(),
  useCreateCommentMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteCommentMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

vi.mock('@/features/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/features/shared/api/client')>('@/features/shared/api/client');
  return { ...actual, apiFetch: apiFetchMock };
});
vi.mock('@/features/auth/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/hooks/useAuth')>('@/features/auth/hooks/useAuth');
  return { ...actual, ...authHooksMock };
});
vi.mock('@/features/members/hooks/useMembers', async () => {
  const actual = await vi.importActual<typeof import('@/features/members/hooks/useMembers')>('@/features/members/hooks/useMembers');
  return { ...actual, useMembersInfiniteQuery: membersHooksMock.useMembersInfiniteQuery };
});
vi.mock('@/features/tasks/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTasks')>('@/features/tasks/hooks/useTasks');
  return { ...actual, ...tasksHooksMock };
});
vi.mock('@/features/comments/hooks/useComments', async () => {
  const actual = await vi.importActual<typeof import('@/features/comments/hooks/useComments')>('@/features/comments/hooks/useComments');
  return { ...actual, ...commentsHooksMock };
});

import {
  MemberProgressView,
  aggregateClubWorkloadMap,
  computeDeadlineBarMetrics,
  computeMemberProgressStats,
  extractDeliverableHost,
  filterProgressTasks,
  resolveMemberBannerIdentity,
  safeDeliverableHref,
} from '@/features/progress';
import { ProgressCommentsModal } from '@/features/progress/components/ProgressCommentsModal';
import { ProgressHeaderBar } from '@/features/progress/components/ProgressHeaderBar';
import { ProgressInspectorPane } from '@/features/progress/components/ProgressInspectorPane';
import { ProgressTaskListPane } from '@/features/progress/components/ProgressTaskListPane';
import { TASKS_QUERY_KEYS, invalidateTaskQueries } from '@/features/tasks/hooks/task-query-keys';

type TaskDto = components['schemas']['TaskDto'];
type MemberDetail = components['schemas']['MemberDetail'];
type MemberPublicSummary = components['schemas']['MemberPublicSummary'];

const NOW_FIXED_MS = Date.parse('2026-11-26T05:00:00.000Z'); // 12:00 UTC+7 on 2026-11-26

const ME_PROFILE: MemberDetail = {
  id: 'u-me',
  fullName: 'Đào Văn Thanh',
  studentId: '2131200045',
  email: 'thanh.dao@eiu.edu.vn',
  locale: 'vi',
  isActive: true,
  leftAt: null,
  isAdmin: false,
  mustChangePassword: false,
  departments: [{ id: 'dept-media', name: 'Ban Truyền thông' }],
  avatarUrl: null,
};

const PEER_PUBLIC: MemberPublicSummary = {
  id: 'u-peer',
  fullName: 'Trần Thị Minh Anh',
  isActive: true,
  leftAt: null,
  departments: [{ id: 'dept-media', name: 'Ban Truyền thông' }],
  avatarUrl: null,
};

const PEER_DETAIL: MemberDetail = {
  ...PEER_PUBLIC,
  studentId: '2131200012',
  email: 'minhanh.tran@eiu.edu.vn',
  locale: 'vi',
  isAdmin: true,
  mustChangePassword: false,
};

function makeTask(overrides: Partial<TaskDto>): TaskDto {
  return {
    id: 't-default',
    boardId: 'b-1',
    columnId: 'c-1',
    title: 'Sample progress task',
    description: 'Detailed instructions',
    startAt: '2026-11-24T00:00:00.000Z',
    dueAt: '2026-11-27T12:00:00.000Z',
    isCompleted: false,
    completedAt: null,
    priority: 2,
    position: 1000,
    isHidden: false,
    version: 1,
    deletedAt: null,
    assignees: [{ id: 'u-me', fullName: 'Đào Văn Thanh', isActive: true, leftAt: null, departments: [], avatarUrl: null, acceptedAt: null }],
    assignedDepartments: [{ id: 'dept-media', name: 'Ban Truyền thông' }],
    deliverables: [],
    deliverableCount: 0,
    creator: { id: 'u-lead', fullName: 'Phạm Quản Lý', isActive: false, leftAt: '2026-11-10T00:00:00.000Z', departments: [], avatarUrl: null },
    commentCount: 2,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithProviders(
  node: ReactNode,
  options: { permissions?: PermissionCode[]; isAdmin?: boolean; locale?: 'vi' | 'en'; queryClient?: QueryClient } = {}
) {
  const locale = options.locale ?? 'vi';
  const queryClient = options.queryClient ?? new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
        <PermissionsProvider isAdmin={options.isAdmin ?? false} permissions={options.permissions ?? []}>
          {node}
        </PermissionsProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('CR-13-01 Member Progress helpers & workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authHooksMock.useMeQuery.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: { profile: ME_PROFILE, permissions: ['task.update_assigned', 'comment.create'] },
    });
    membersHooksMock.useMembersInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { pages: [{ items: [ME_PROFILE, PEER_DETAIL], meta: { nextCursor: null, limit: 100 } }] },
    });
    tasksHooksMock.useTaskDepartmentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [{ id: 'dept-media', name: 'Ban Truyền thông', lead: null, memberCount: 3, boardCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] },
    });
    commentsHooksMock.useTaskCommentsInfiniteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      data: { pages: [{ items: [], meta: { nextCursor: null, limit: 10 } }], pageParams: [undefined] },
    });
  });

  it('computes dynamic deadline bar metrics, ratios, clamping, and safe URL host extraction', () => {
    expect(computeDeadlineBarMetrics({ startAt: null, dueAt: '2026-11-24T00:00:00Z', isCompleted: true }, NOW_FIXED_MS)).toEqual({
      tier: 'done', daysDiff: null, barPct: 100, fillHex: '#059669',
    });
    expect(computeDeadlineBarMetrics({ startAt: null, dueAt: '2026-11-24T00:00:00Z', isCompleted: false }, NOW_FIXED_MS)).toEqual({
      tier: 'overdue', daysDiff: -2, barPct: 100, fillHex: '#dc2626',
    });
    expect(computeDeadlineBarMetrics({ startAt: null, dueAt: '2026-11-27T00:00:00Z', isCompleted: false }, NOW_FIXED_MS)).toEqual({
      tier: 'urgent', daysDiff: 1, barPct: 86, fillHex: '#ea580c',
    });
    expect(computeDeadlineBarMetrics({ startAt: null, dueAt: '2026-11-28T00:00:00Z', isCompleted: false }, NOW_FIXED_MS)).toEqual({
      tier: 'soon', daysDiff: 2, barPct: 62, fillHex: '#f59e0b',
    });
    const safeNoStart = computeDeadlineBarMetrics({ startAt: null, dueAt: '2026-12-03T00:00:00Z', isCompleted: false }, NOW_FIXED_MS);
    expect(safeNoStart.tier).toBe('safe');
    expect(safeNoStart.fillHex).toBe('#10b981');
    expect(safeNoStart.barPct).toBeGreaterThanOrEqual(20);
    expect(safeNoStart.barPct).toBeLessThanOrEqual(48);

    expect(computeDeadlineBarMetrics({ startAt: null, dueAt: null, isCompleted: false }, NOW_FIXED_MS)).toEqual({
      tier: 'safe', daysDiff: 4, barPct: 36, fillHex: '#10b981',
    });

    // Clamping elapsed ratio 12..96% when both startAt & dueAt are valid
    const futureStart = computeDeadlineBarMetrics({ startAt: '2026-11-27T00:00:00Z', dueAt: '2026-12-05T00:00:00Z', isCompleted: false }, NOW_FIXED_MS);
    expect(futureStart.barPct).toBe(12);
    const nearlyDue = computeDeadlineBarMetrics({ startAt: '2026-11-01T00:00:00Z', dueAt: '2026-11-26T06:00:00Z', isCompleted: false }, NOW_FIXED_MS);
    expect(nearlyDue.barPct).toBe(96);

    expect(extractDeliverableHost('https://www.drive.google.com/drive/folders/abc')).toBe('drive.google.com');
    expect(extractDeliverableHost('https://docs.google.com/document/d/123')).toBe('docs.google.com');
    expect(extractDeliverableHost('javascript:alert(1)')).toBe('');
    expect(extractDeliverableHost('not-a-valid-url')).toBe('');
    expect(safeDeliverableHref('https://drive.google.com/abc')).toBe('https://drive.google.com/abc');
    expect(safeDeliverableHref('javascript:alert(1)')).toBe('#');
  });

  it('enforces direct-only filtering in team mode, includes Việc của Ban tasks when allowDepartmentTasks=true, and builds workload map', () => {
    const directOverdue = makeTask({
      id: 't-direct-over',
      title: 'Direct overdue task',
      dueAt: '2026-11-24T00:00:00.000Z',
      assignedDepartments: [],
      deliverables: [{ id: 'd-1', title: 'Draft', url: 'https://docs.google.com/1', submittedBy: PEER_PUBLIC, createdAt: '2026-11-24T00:00:00Z' }],
      deliverableCount: 1,
    });
    const directAcceptedDone = makeTask({
      id: 't-direct-done',
      title: 'Completed task',
      isCompleted: true,
      dueAt: '2026-11-25T00:00:00.000Z',
      assignees: [{ ...ME_PROFILE, acceptedAt: '2026-11-21T00:00:00Z' }],
      assignedDepartments: [],
      deliverableCount: 2,
    });
    const deptOnlyNotDirectlyAssigned = makeTask({
      id: 't-dept-only',
      title: 'Department task for my dept',
      assignees: [{ ...PEER_PUBLIC, acceptedAt: null }],
      assignedDepartments: [{ id: 'dept-media', name: 'Ban Truyền thông' }],
    });
    const softDeleted = makeTask({
      id: 't-deleted',
      title: 'Soft deleted task',
      deletedAt: '2026-11-25T00:00:00Z',
    });
    const allTasks = [directOverdue, directAcceptedDone, deptOnlyNotDirectlyAssigned, softDeleted];

    expect(filterProgressTasks(allTasks, { filter: 'all', q: '', selectedMemberId: 'u-me', nowMs: NOW_FIXED_MS }).map((t) => t.id)).toEqual([
      't-direct-over',
      't-direct-done',
    ]);
    expect(filterProgressTasks(allTasks, { filter: 'open', q: '', selectedMemberId: 'u-me', nowMs: NOW_FIXED_MS }).map((t) => t.id)).toEqual([
      't-direct-over',
    ]);
    expect(filterProgressTasks(allTasks, { filter: 'overdue', q: '', selectedMemberId: 'u-me', nowMs: NOW_FIXED_MS }).map((t) => t.id)).toEqual([
      't-direct-over',
    ]);
    expect(filterProgressTasks(allTasks, { filter: 'unaccepted', q: '', selectedMemberId: 'u-me', nowMs: NOW_FIXED_MS }).map((t) => t.id)).toEqual([
      't-direct-over',
    ]);
    expect(filterProgressTasks(allTasks, { filter: 'done', q: 'completed', selectedMemberId: 'u-me', nowMs: NOW_FIXED_MS }).map((t) => t.id)).toEqual([
      't-direct-done',
    ]);
    expect(
      filterProgressTasks(allTasks, {
        filter: 'department',
        q: '',
        selectedMemberId: 'u-me',
        allowDepartmentTasks: true,
        nowMs: NOW_FIXED_MS,
      }).map((t) => t.id)
    ).toEqual(['t-dept-only']);
    expect(
      filterProgressTasks(allTasks, {
        filter: 'open',
        q: '',
        selectedMemberId: 'u-me',
        allowDepartmentTasks: true,
        nowMs: NOW_FIXED_MS,
      }).map((t) => t.id)
    ).toEqual(['t-direct-over', 't-dept-only']);

    const directOnly = filterProgressTasks(allTasks, { filter: 'all', q: '', selectedMemberId: 'u-me', nowMs: NOW_FIXED_MS });
    expect(computeMemberProgressStats(directOnly, NOW_FIXED_MS)).toEqual({
      openCount: 1,
      overdueCount: 1,
      doneCount: 1,
      deliverablesCount: 3,
    });
    expect(aggregateClubWorkloadMap(allTasks, NOW_FIXED_MS)).toEqual({
      'u-me': { openCount: 1, overdueCount: 1 },
      'u-peer': { openCount: 1, overdueCount: 0 },
    });
  });

  it('hides mode switcher when missing member.view, shows Việc của Ban & Giao cho Ban pill in mine mode, and disables club queries when unauthorized', () => {
    const qc = new QueryClient();
    const directTask = makeTask({ id: 't-mine-1', title: 'My direct task' });
    const deptTask = makeTask({
      id: 't-dept-1',
      title: 'Ban media task',
      assignees: [],
      assignedDepartments: [{ id: 'dept-media', name: 'Truyền thông' }],
    });
    qc.setQueryData([...TASKS_QUERY_KEYS.progressRoot, 'mine'], {
      items: [directTask, deptTask],
      meta: { nextCursor: null, limit: 100 },
    });

    const withoutMemberViewHtml = renderWithProviders(<MemberProgressView />, {
      permissions: ['task.update_assigned', 'comment.create'],
      isAdmin: false,
      queryClient: qc,
    });
    expect(withoutMemberViewHtml).not.toContain('prog-mode-switch');
    expect(withoutMemberViewHtml).not.toContain('Thành viên CLB');
    expect(withoutMemberViewHtml).toContain('Việc của Ban');
    expect(withoutMemberViewHtml).toContain('Giao cho Ban');
    expect(membersHooksMock.useMembersInfiniteQuery).toHaveBeenCalledWith(expect.any(Object), false);
    expect(tasksHooksMock.useTaskDepartmentsQuery).toHaveBeenCalledWith(false);
    expect(withoutMemberViewHtml).toContain('My direct task');
    expect(withoutMemberViewHtml).toContain('Ban media task');
    expect(withoutMemberViewHtml).toContain('2131200045'); // self sees own PII

    const withMemberViewHtml = renderWithProviders(<MemberProgressView />, {
      permissions: ['member.view', 'task.update_assigned'],
      isAdmin: false,
      queryClient: qc,
    });
    expect(withMemberViewHtml).toContain('prog-mode-switch');
    expect(withMemberViewHtml).toContain('Thành viên CLB');
    // Still in 'mine' mode initially so /members remains disabled until switching to 'team'
    expect(membersHooksMock.useMembersInfiniteQuery).toHaveBeenLastCalledWith(expect.any(Object), false);
  });

  it('strictly masks peer studentId and email without member.view_detail while showing them with member.view_detail', () => {
    expect(
      resolveMemberBannerIdentity({
        isSelf: false,
        canViewDetail: false,
        selectedMember: PEER_DETAIL, // even if object contains PII, guard strips it
        meProfile: ME_PROFILE,
      })
    ).toMatchObject({ id: 'u-peer', studentId: null, email: null, isAdmin: false });

    expect(
      resolveMemberBannerIdentity({
        isSelf: false,
        canViewDetail: true,
        selectedMember: PEER_DETAIL,
        meProfile: ME_PROFILE,
      })
    ).toMatchObject({ id: 'u-peer', studentId: '2131200012', email: 'minhanh.tran@eiu.edu.vn', isAdmin: true });

    const publicBannerIdentity = resolveMemberBannerIdentity({
      isSelf: false,
      canViewDetail: false,
      selectedMember: PEER_PUBLIC,
      meProfile: ME_PROFILE,
    });
    const publicHtml = renderWithProviders(
      <ProgressTaskListPane
        identity={publicBannerIdentity}
        tasks={[makeTask({ id: 't-p1', assignees: [{ ...PEER_PUBLIC, acceptedAt: null }] })]}
        targetMemberId="u-peer"
        selectedTaskId="t-p1"
        filter="open"
        searchQuery=""
        isPending={false}
        isError={false}
        error={null}
        onFilterChange={vi.fn()}
        onSearchChange={vi.fn()}
        onRetry={vi.fn()}
        onSelectTask={vi.fn()}
      />,
      { permissions: ['member.view'] }
    );
    expect(publicHtml).toContain('Trần Thị Minh Anh');
    expect(publicHtml).not.toContain('prog-comment-pill');
    expect(publicHtml).not.toContain('2131200012');
    expect(publicHtml).not.toContain('minhanh.tran@eiu.edu.vn');

    const detailBannerIdentity = resolveMemberBannerIdentity({
      isSelf: false,
      canViewDetail: true,
      selectedMember: PEER_DETAIL,
      meProfile: ME_PROFILE,
    });
    const detailHtml = renderWithProviders(
      <ProgressTaskListPane
        identity={detailBannerIdentity}
        tasks={[makeTask({ id: 't-p1', assignees: [{ ...PEER_DETAIL, acceptedAt: null }] })]}
        targetMemberId="u-peer"
        selectedTaskId="t-p1"
        filter="open"
        searchQuery=""
        isPending={false}
        isError={false}
        error={null}
        onFilterChange={vi.fn()}
        onSearchChange={vi.fn()}
        onRetry={vi.fn()}
        onSelectTask={vi.fn()}
      />,
      { permissions: ['member.view', 'member.view_detail'] }
    );
    expect(detailHtml).toContain('2131200012');
    expect(detailHtml).toContain('minhanh.tran@eiu.edu.vn');
  });

  it('renders 2 stacked inspector cards, safe deliverable links, read-only peer acceptance, and Comments Modal', () => {
    const task = makeTask({
      id: 't-insp',
      title: 'Workshop Recap Video',
      isHidden: true,
      deliverableCount: 2,
      deliverables: [
        { id: 'd-safe', title: 'RAW Folder', url: 'https://drive.google.com/raw', submittedBy: ME_PROFILE, createdAt: '2026-11-25T00:00:00Z' },
        { id: 'd-bad', title: 'Bad Link', url: 'javascript:alert(1)', submittedBy: ME_PROFILE, createdAt: '2026-11-25T00:00:00Z' },
      ],
    });

    const selfHtml = renderWithProviders(
      <ProgressInspectorPane
        task={task}
        targetMemberId="u-me"
        currentUserId="u-me"
        isSelf
        isAdmin={false}
        canUpdateAny={false}
        canUpdateAssigned
        onOpenDetail={vi.fn()}
        onOpenComments={vi.fn()}
        onRefresh={vi.fn()}
      />,
      { permissions: ['task.update_assigned'] }
    );
    expect(selfHtml).toContain('prog-summary-card');
    expect(selfHtml).toContain('prog-deliv-card');
    expect(selfHtml).toContain('Mở rộng ⤢');
    expect(selfHtml).toContain('(đã rời)');
    expect(selfHtml).toContain('Nhận việc');
    expect(selfHtml).toContain('Hoàn thành');
    expect(selfHtml).toContain('+ Nộp link');
    expect(selfHtml).toContain('RAW Folder');
    expect(selfHtml).toContain('drive.google.com ↗');
    expect(selfHtml).toContain('href="#"');
    expect(selfHtml).not.toContain('javascript:alert(1)');
    expect(selfHtml).toContain('Bình luận (2)');

    const peerHtml = renderWithProviders(
      <ProgressInspectorPane
        task={makeTask({ id: 't-peer', assignees: [{ ...PEER_PUBLIC, acceptedAt: null }] })}
        targetMemberId="u-peer"
        currentUserId="u-me"
        isSelf={false}
        isAdmin={false}
        canUpdateAny={false}
        canUpdateAssigned
        onOpenDetail={vi.fn()}
        onOpenComments={vi.fn()}
        onRefresh={vi.fn()}
      />,
      { permissions: ['member.view', 'task.update_assigned'] }
    );
    expect(peerHtml).toContain('Chưa xác nhận nhận');
    expect(peerHtml).not.toContain('prog-accept-btn');

    const closedModalHtml = renderWithProviders(<ProgressCommentsModal task={null} onClose={vi.fn()} />);
    expect(closedModalHtml).toBe('');

    const openModalHtml = renderWithProviders(<ProgressCommentsModal task={task} onClose={vi.fn()} />, {
      permissions: ['comment.create'],
      locale: 'en',
    });
    expect(openModalHtml).toContain('role="dialog"');
    expect(openModalHtml).toContain('aria-modal="true"');
    expect(openModalHtml).toContain('Task comments');
    expect(openModalHtml).toContain('Workshop Recap Video');
    expect(openModalHtml).toContain('task-comments-section');
  });

  it('renders HeaderBar team mode controls in English and invalidates progressRoot on task updates', async () => {
    const headerHtml = renderWithProviders(
      <ProgressHeaderBar
        canInspectClubMembers
        mode="team"
        onModeChange={vi.fn()}
        departments={[{ id: 'dept-media', name: 'Media', lead: null, memberCount: 2, boardCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]}
        selectedDepartmentId=""
        onDepartmentChange={vi.fn()}
        members={[ME_PROFILE, PEER_PUBLIC]}
        selectedMember={PEER_PUBLIC}
        workloadMap={{ 'u-peer': { openCount: 3, overdueCount: 1 } }}
        onSelectMember={vi.fn()}
        onStepMember={vi.fn()}
        stats={{ openCount: 3, overdueCount: 1, doneCount: 4, deliverablesCount: 2 }}
      />,
      { locale: 'en' }
    );
    expect(headerHtml).toContain('Club members');
    expect(headerHtml).toContain('All departments');
    expect(headerHtml).toContain('2/2');
    expect(headerHtml).toContain('3 open');
    expect(headerHtml).toContain('1 overdue');

    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    await invalidateTaskQueries(qc, 't-1');
    const keys = invalidateSpy.mock.calls.map(([arg]) => arg?.queryKey);
    expect(keys).toContainEqual(TASKS_QUERY_KEYS.progressRoot);
  });
});
