import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';
import { deliverableUrlSchema } from '@/lib/tasks';

const navMocks = vi.hoisted(() => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

const calendarHookMocks = vi.hoisted(() => ({
  useCalendarTasks: vi.fn(),
}));

const taskHooksMocks = vi.hoisted(() => ({
  useTaskDetailQuery: vi.fn(() => ({ isPending: false, isError: false, error: null, data: undefined, refetch: vi.fn() })),
  useTaskAssigneeMembersQuery: vi.fn(() => ({ isPending: false, isError: false, data: { items: [] } })),
  useTaskDepartmentsQuery: vi.fn(() => ({ isPending: false, isError: false, data: { items: [] } })),
  useUpdateTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReplaceTaskAssigneesMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteTaskMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateTaskHiddenMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateTaskAcceptanceMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useCreateTaskDeliverableMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteTaskDeliverableMutation: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

vi.mock('next/navigation', () => ({
  redirect: navMocks.redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/calendar/hooks/useCalendarTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/calendar/hooks/useCalendarTasks')>(
    '@/features/calendar/hooks/useCalendarTasks'
  );
  return { ...actual, useCalendarTasks: calendarHookMocks.useCalendarTasks };
});

vi.mock('@/features/tasks/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTasks')>(
    '@/features/tasks/hooks/useTasks'
  );
  return { ...actual, ...taskHooksMocks };
});

vi.mock('@/features/tasks/hooks/useTaskEvents', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTaskEvents')>(
    '@/features/tasks/hooks/useTaskEvents'
  );
  return { ...actual, useUndoTaskActionToast: vi.fn(() => vi.fn()) };
});

import BoardsRedirectPage from '@/app/boards/page';
import BoardDetailRedirectPage from '@/app/boards/[id]/page';
import { CalendarWorkspaceView } from '@/features/calendar/components/CalendarWorkspaceView';
import {
  buildCalendarSearchParams,
  buildCalendarTasksQueryParams,
  parseCalendarUrlState,
} from '@/features/calendar/hooks/useCalendarTasks';
import { resolveAssignedDepartmentLeads } from '@/features/tasks/drawer-helpers';
import { TaskAcceptanceSection } from '@/features/tasks/components/TaskAcceptanceSection';
import { TaskDeliverablesSection } from '@/features/tasks/components/TaskDeliverablesSection';
import { TaskStatusSection } from '@/features/tasks/components/TaskStatusSection';

type TaskDto = components['schemas']['TaskDto'];
type DepartmentDto = components['schemas']['DepartmentDto'];

const DEPT_MEDIA: DepartmentDto = {
  id: 'd-media',
  name: 'Truyền thông',
  lead: { id: 'u-lead', fullName: 'Tran Thi B', isActive: true, leftAt: null, departments: [] },
  memberCount: 5,
  boardCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SAMPLE_TASKS: TaskDto[] = [
  {
    id: 't-over',
    boardId: 'b-1',
    columnId: 'c-1',
    title: 'Thiết kế poster',
    description: null,
    startAt: '2026-11-10T03:00:00Z',
    dueAt: '2026-11-18T10:00:00Z',
    isCompleted: false,
    completedAt: null,
    priority: 2,
    position: 1,
    isHidden: true,
    version: 2,
    deletedAt: null,
    assignees: [{ id: 'u-me', fullName: 'Nguyen Van A', isActive: true, leftAt: null, departments: [], acceptedAt: '2026-11-12T08:00:00Z' }],
    assignedDepartments: [{ id: 'd-media', name: 'Truyền thông' }],
    deliverables: [
      {
        id: 'del-1',
        title: 'Figma Poster v1',
        url: 'https://figma.com/file/abc',
        submittedBy: { id: 'u-me', fullName: 'Nguyen Van A', isActive: true, leftAt: null, departments: [] },
        createdAt: '2026-11-14T08:00:00Z',
      },
    ],
    deliverableCount: 1,
    creator: { id: 'u-c', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
    commentCount: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-14T08:00:00Z',
  },
  {
    id: 't-done',
    boardId: 'b-1',
    columnId: 'c-2',
    title: 'Duyệt nội dung',
    description: null,
    startAt: '2026-11-19T03:00:00Z',
    dueAt: '2026-11-22T10:00:00Z',
    isCompleted: true,
    completedAt: '2026-11-19T12:00:00Z',
    priority: 1,
    position: 2,
    isHidden: false,
    version: 1,
    deletedAt: null,
    assignees: [],
    assignedDepartments: [],
    deliverables: [],
    deliverableCount: 0,
    creator: { id: 'u-c', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
    commentCount: 0,
    createdAt: '2026-11-02T00:00:00Z',
    updatedAt: '2026-11-19T12:00:00Z',
  },
  {
    id: 't-unsched',
    boardId: 'b-1',
    columnId: 'c-1',
    title: 'Ý tưởng dự phòng',
    description: null,
    startAt: null,
    dueAt: null,
    isCompleted: false,
    completedAt: null,
    priority: 1,
    position: 3,
    isHidden: false,
    version: 1,
    deletedAt: null,
    assignees: [],
    assignedDepartments: [],
    deliverables: [],
    deliverableCount: 0,
    creator: { id: 'u-c', fullName: 'Le Van C', isActive: true, leftAt: null, departments: [] },
    commentCount: 0,
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
  },
];

function renderWithIntl(node: ReactNode, opts: { permissions?: PermissionCode[]; isAdmin?: boolean; locale?: 'vi' | 'en' } = {}) {
  const locale = opts.locale ?? 'vi';
  const qc = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
        <PermissionsProvider isAdmin={opts.isAdmin ?? false} permissions={opts.permissions ?? []}>{node}</PermissionsProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('CalendarWorkspaceView & CR-10 components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calendarHookMocks.useCalendarTasks.mockReturnValue({
      todayIso: '2026-11-20',
      currentVnYear: 2026,
      state: { year: 2026, deadlineFilter: 'all', departmentId: '', q: '', selectedTaskId: null },
      tasksQuery: { isPending: false, isError: false, error: null, refetch: vi.fn(), data: { items: SAMPLE_TASKS, meta: { nextCursor: null, limit: 200 } } },
      departments: [DEPT_MEDIA],
      setYear: vi.fn(),
      setDeadlineFilter: vi.fn(),
      setDepartmentId: vi.fn(),
      setSearchQuery: vi.fn(),
      openTaskModal: vi.fn(),
      closeTaskModal: vi.fn(),
      resetFilters: vi.fn(),
    });
  });

  it('renders horizontal calendar workspace in vi & en, permissions, deadline tiers, hidden lock, and unscheduled tray', () => {
    const htmlVi = renderWithIntl(<CalendarWorkspaceView />, { permissions: ['task.create', 'task.delete'] });
    expect(htmlVi).toContain('hcal-shell');
    expect(htmlVi).toContain('data-zoom-tier="week"');
    expect(htmlVi).toContain('type="range"');
    expect(htmlVi).toContain('value="100"');
    expect(htmlVi).toContain('Hôm nay');
    expect(htmlVi).toContain('Năm');
    expect(htmlVi).toContain('Tháng');
    expect(htmlVi).toContain('Tuần');
    expect(htmlVi).toContain('Tạo công việc');
    expect(htmlVi).toContain('Thùng rác');
    expect(htmlVi).toContain('Tất cả (3)');
    expect(htmlVi).toContain('Quá hạn (1)');
    expect(htmlVi).toContain('Hoàn thành (1)');
    expect(htmlVi).toContain('deadline-overdue');
    expect(htmlVi).toContain('deadline-done');
    expect(htmlVi).toContain('Thiết kế poster');
    expect(htmlVi).toContain('1/1 đã nhận');
    expect(htmlVi).toContain('1 SP');
    expect(htmlVi).toContain('Chưa đặt hạn (1)');
    expect(htmlVi).not.toContain('Ý tưởng dự phòng');
    expect(htmlVi).not.toContain('prio-p2');

    const htmlNoCreate = renderWithIntl(<CalendarWorkspaceView />, { locale: 'en', permissions: [] });
    expect(htmlNoCreate).toContain('Today');
    expect(htmlNoCreate).toContain('Unscheduled (1)');
    expect(htmlNoCreate).not.toContain('Create task');
    expect(htmlNoCreate).not.toContain('Trash');

    calendarHookMocks.useCalendarTasks.mockReturnValueOnce({
      todayIso: '2026-11-20',
      currentVnYear: 2026,
      state: { year: 2026, deadlineFilter: 'all', departmentId: '', q: '', selectedTaskId: null },
      tasksQuery: { isPending: false, isError: false, error: null, refetch: vi.fn(), data: { items: [], meta: { nextCursor: null, limit: 200 } } },
      departments: [],
      setYear: vi.fn(),
      setDeadlineFilter: vi.fn(),
      setDepartmentId: vi.fn(),
      setSearchQuery: vi.fn(),
      openTaskModal: vi.fn(),
      closeTaskModal: vi.fn(),
      resetFilters: vi.fn(),
    });
    const emptyCalendarTrashHtml = renderWithIntl(<CalendarWorkspaceView />, { permissions: ['task.delete'] });
    expect(emptyCalendarTrashHtml).toContain('Thùng rác');
    expect(emptyCalendarTrashHtml).toContain('id="hcal-scroller"');
  });

  it('renders calendar loading and error states and parses URL/query helpers accurately', () => {
    calendarHookMocks.useCalendarTasks.mockReturnValueOnce({
      todayIso: '2026-11-20',
      currentVnYear: 2026,
      state: { year: 2026, deadlineFilter: 'all', departmentId: '', q: '', selectedTaskId: null },
      tasksQuery: { isPending: true, isError: false, error: null, refetch: vi.fn(), data: undefined },
      departments: [],
      setYear: vi.fn(),
      setDeadlineFilter: vi.fn(),
      setDepartmentId: vi.fn(),
      setSearchQuery: vi.fn(),
      openTaskModal: vi.fn(),
      closeTaskModal: vi.fn(),
      resetFilters: vi.fn(),
    });
    expect(renderWithIntl(<CalendarWorkspaceView />)).toContain('hcal-loading');

    calendarHookMocks.useCalendarTasks.mockReturnValueOnce({
      todayIso: '2026-11-20',
      currentVnYear: 2026,
      state: { year: 2026, deadlineFilter: 'all', departmentId: '', q: '', selectedTaskId: null },
      tasksQuery: {
        isPending: false,
        isError: true,
        error: new ApiClientError({ status: 500, code: 'INTERNAL_ERROR', messageKey: 'errors.500.title', details: {}, requestId: 'req-cal-500' }),
        refetch: vi.fn(),
        data: undefined,
      },
      departments: [],
      setYear: vi.fn(),
      setDeadlineFilter: vi.fn(),
      setDepartmentId: vi.fn(),
      setSearchQuery: vi.fn(),
      openTaskModal: vi.fn(),
      closeTaskModal: vi.fn(),
      resetFilters: vi.fn(),
    });
    const errHtml = renderWithIntl(<CalendarWorkspaceView />);
    expect(errHtml).toContain('req-cal-500');
    expect(errHtml).toContain('Thử lại');

    const parsed = parseCalendarUrlState(new URLSearchParams('year=2027&deadline=urgent&dept=d-1&q=poster&task=t-9'), 2026);
    expect(parsed).toEqual({ year: 2027, deadlineFilter: 'urgent', departmentId: 'd-1', q: 'poster', selectedTaskId: 't-9' });
    expect(buildCalendarSearchParams(parsed, 2026).toString()).toBe('year=2027&deadline=urgent&dept=d-1&q=poster&task=t-9');
    expect(buildCalendarTasksQueryParams(2026, 'd-1', ' poster ')).toMatchObject({ departmentId: 'd-1', q: 'poster', limit: 200 });
  });

  it('renders acceptance switch + department lead banner without PII, deliverables with safe external links, and status controls', () => {
    const acceptHtml = renderWithIntl(
      <TaskAcceptanceSection task={SAMPLE_TASKS[0]!} isAssigned currentUserId="u-me" departments={[DEPT_MEDIA]} />
    );
    expect(acceptHtml).toContain('role="switch"');
    expect(acceptHtml).toContain('aria-checked="true"');
    expect(acceptHtml).toContain('1/1 đã nhận');
    expect(acceptHtml).toContain('Nguyen Van A');
    expect(acceptHtml).toContain('✓ Đã nhận · 15:00 12-11');
    expect(acceptHtml).not.toContain('@eiu.edu.vn');

    expect(
      resolveAssignedDepartmentLeads(
        [{ id: 'd-media', name: 'Truyền thông' }, { id: 'd-old', name: 'Cũ' }],
        [
          DEPT_MEDIA,
          { ...DEPT_MEDIA, id: 'd-old', name: 'Cũ', lead: { id: 'u-old', fullName: 'Pham C', isActive: false, leftAt: '2026-01-01T00:00:00Z', departments: [] } },
        ],
        '(đã rời)'
      )
    ).toEqual(['Tran Thi B', 'Pham C (đã rời)']);

    const delivEditableHtml = renderWithIntl(
      <TaskDeliverablesSection task={SAMPLE_TASKS[0]!} canSubmit currentUserId="u-me" isAdmin={false} canUpdateAny={false} departments={[DEPT_MEDIA]} />
    );
    expect(delivEditableHtml).toContain('href="https://figma.com/file/abc"');
    expect(delivEditableHtml).toContain('target="_blank"');
    expect(delivEditableHtml).toContain('rel="noopener noreferrer"');
    expect(delivEditableHtml).toContain('Xóa');
    expect(delivEditableHtml).toContain('Tran Thi B');

    const delivReadOnlyHtml = renderWithIntl(
      <TaskDeliverablesSection task={SAMPLE_TASKS[0]!} canSubmit={false} currentUserId="u-other" isAdmin={false} canUpdateAny={false} departments={[DEPT_MEDIA]} />
    );
    expect(delivReadOnlyHtml).not.toContain('Xóa');
    expect(delivReadOnlyHtml).not.toContain('type="url"');

    expect(deliverableUrlSchema.safeParse('https://drive.google.com/file/d/1').success).toBe(true);
    expect(deliverableUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);

    expect(renderWithIntl(<TaskStatusSection task={SAMPLE_TASKS[0]!} canEdit onReload={vi.fn()} />)).toContain('<select');
    expect(renderWithIntl(<TaskStatusSection task={SAMPLE_TASKS[1]!} canEdit={false} onReload={vi.fn()} />)).toContain('task-status-pill is-done');
  });

  it('redirects /boards and /boards/[id] server routes to /tasks preserving ?task=', async () => {
    expect(() => BoardsRedirectPage()).toThrow('NEXT_REDIRECT:/tasks');
    await expect(BoardDetailRedirectPage({ searchParams: Promise.resolve({ task: 't-42' }) })).rejects.toThrow('NEXT_REDIRECT:/tasks?task=t-42');
    await expect(BoardDetailRedirectPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/tasks');
  });
});
