import { createElement, type ReactElement, type ReactNode } from 'react';
import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider } from '@/features/shared/permissions/can';

const apiFetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
const mutationOverrides = vi.hoisted(() => ({
  update: null as null | { error: unknown; isPending: boolean; reset: () => void; mutate: () => void },
  assignees: null as null | { error: unknown; isPending: boolean; reset: () => void; mutate: () => void },
  hidden: null as null | { error: unknown; isPending: boolean; reset: () => void; mutate: () => void },
}));
const capturedReloadCallbacks = vi.hoisted(() => [] as Array<() => void>);

vi.mock('@/features/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/features/shared/api/client')>(
    '@/features/shared/api/client'
  );
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/features/tasks/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/hooks/useTasks')>(
    '@/features/tasks/hooks/useTasks'
  );
  return {
    ...actual,
    useUpdateTaskMutation: () => mutationOverrides.update ?? actual.useUpdateTaskMutation(),
    useReplaceTaskAssigneesMutation: () => mutationOverrides.assignees ?? actual.useReplaceTaskAssigneesMutation(),
    useUpdateTaskHiddenMutation: (boardId: string) =>
      mutationOverrides.hidden ?? actual.useUpdateTaskHiddenMutation(boardId),
  };
});

vi.mock('@/features/tasks/components/TaskFormFields', async () => {
  const actual = await vi.importActual<typeof import('@/features/tasks/components/TaskFormFields')>(
    '@/features/tasks/components/TaskFormFields'
  );
  return {
    ...actual,
    TaskErrorBanner: (props: Parameters<typeof actual.TaskErrorBanner>[0]) => {
      if (props.error && props.onReloadConflict) {
        capturedReloadCallbacks.push(props.onReloadConflict);
      }
      return actual.TaskErrorBanner(props);
    },
  };
});

import { TaskDrawerActiveTabPanel } from '@/features/tasks/components/TaskDetailDrawer';
import { TaskAssigneesSection, TaskEditFormSection } from '@/features/tasks/components/TaskDrawerSections';
import { TaskHiddenSection } from '@/features/tasks/components/TaskHiddenSection';
import {
  applyAssigneeSelectionToggle,
  hasTaskVersionChanged,
  resolveAssigneeSelection,
  toEditTaskValues,
} from '@/features/tasks/drawer-helpers';
import { TASKS_QUERY_KEYS, useUpdateTaskMutation } from '@/features/tasks/hooks/useTasks';

type TaskDto = components['schemas']['TaskDto'];

function makeTask(version: number, priority: 1 | 2 | 3 | 4, deptIds: string[] = ['d-1']): TaskDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    boardId: '22222222-2222-4222-8222-222222222222',
    columnId: '33333333-3333-4333-8333-333333333333',
    title: `Task v${version}`,
    description: `Desc v${version}`,
    startAt: null,
    dueAt: '2026-11-28T17:00:00Z',
    isCompleted: false,
    completedAt: null,
    priority,
    position: 1,
    isHidden: false,
    version,
    deletedAt: null,
    assignees: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        fullName: 'Nguyễn Văn A',
        isActive: true,
        leftAt: null,
        departments: [],
        acceptedAt: null,
      },
    ],
    assignedDepartments: deptIds.map((id) => ({ id, name: `Dept ${id}` })),
    deliverables: [],
    deliverableCount: 0,
    creator: {
      id: '66666666-6666-4666-8666-666666666666',
      fullName: 'Lê Văn C',
      isActive: true,
      leftAt: null,
      departments: [],
    },
    commentCount: 0,
    createdAt: '2026-11-20T02:00:00Z',
    updatedAt: '2026-11-23T07:30:00Z',
  };
}

function renderWithProviders(node: ReactNode, queryClient = new QueryClient()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <PermissionsProvider isAdmin permissions={['member.view', 'task.assign']}>
          {node}
        </PermissionsProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('TaskDetailDrawer mount stability, form sync & conflict reload (Major-1 & Major-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationOverrides.update = null;
    mutationOverrides.assignees = null;
    mutationOverrides.hidden = null;
    capturedReloadCallbacks.length = 0;
  });

  it('keys TaskDrawerLoaded strictly by task.id (not task.version) so updates never unmount mutation observers', () => {
    const taskV4 = makeTask(4, 2);
    const taskV5 = makeTask(5, 4);

    const treeV4 = TaskDrawerActiveTabPanel({
      activeTab: 'details',
      task: taskV4,
      tabIds: { details: 't-d', comments: 't-c', history: 't-h' },
      panelIds: { details: 'p-d', comments: 'p-c', history: 'p-h' },
      onReload: vi.fn(),
      onClose: vi.fn(),
      onOpenComments: vi.fn(),
    }) as ReactElement<{ children: ReactElement }>;

    const treeV5 = TaskDrawerActiveTabPanel({
      activeTab: 'details',
      task: taskV5,
      tabIds: { details: 't-d', comments: 't-c', history: 't-h' },
      panelIds: { details: 'p-d', comments: 'p-c', history: 'p-h' },
      onReload: vi.fn(),
      onClose: vi.fn(),
      onOpenComments: vi.fn(),
    }) as ReactElement<{ children: ReactElement }>;

    expect(treeV4.props.children.key).toBe(taskV4.id);
    expect(treeV5.props.children.key).toBe(taskV5.id);
    expect(treeV4.props.children.key).toBe(treeV5.props.children.key);
  });

  it('syncs edit form values, assignee selection state, and version change guard when task.version increments', () => {
    const taskV4 = makeTask(4, 2, ['d-1']);
    const taskV5 = makeTask(5, 4, ['d-1', 'd-2']);
    const taskV6 = makeTask(6, 2, ['d-1']);

    expect(hasTaskVersionChanged({ id: taskV4.id, version: 4 }, taskV4.id, 4)).toBe(false);
    expect(hasTaskVersionChanged({ id: taskV4.id, version: 4 }, taskV4.id, 5)).toBe(true);
    expect(hasTaskVersionChanged({ id: taskV4.id, version: 4 }, 'other-task', 4)).toBe(true);

    expect(toEditTaskValues(taskV4)).toEqual({
      title: 'Task v4',
      description: 'Desc v4',
      startAtInput: '',
      dueAtInput: '2026-11-29',
    });
    expect(toEditTaskValues(taskV5).title).toBe('Task v5');
    expect(toEditTaskValues(taskV6).title).toBe('Task v6');

    const draftV4 = applyAssigneeSelectionToggle(null, taskV4, 'dept', 'd-extra');
    expect(resolveAssigneeSelection(draftV4, taskV4).deptIds).toEqual(['d-1', 'd-extra']);
    expect(resolveAssigneeSelection(draftV4, taskV5).deptIds).toEqual(['d-1', 'd-2']);
    expect(resolveAssigneeSelection(draftV4, taskV6).deptIds).toEqual(['d-1']);

    const qc = new QueryClient();
    const editHtmlV5 = renderWithProviders(
      createElement(TaskEditFormSection, { task: taskV5, onReload: vi.fn() }),
      qc
    );
    expect(editHtmlV5).not.toContain('prio-p4');
    expect(editHtmlV5).not.toContain('<option value="4"');
    expect(editHtmlV5).toContain('value="2026-11-29"');

    const assigneesHtmlV5 = renderWithProviders(
      createElement(TaskAssigneesSection, { task: taskV5, onReload: vi.fn() }),
      qc
    );
    expect(assigneesHtmlV5).toContain('Dept d-1');
    expect(assigneesHtmlV5).toContain('Dept d-2');
  });

  it('clears 409 conflict mutation errors on reload across Edit, Assignees, and Hidden sections (Major-2)', () => {
    const conflictErr = new ApiClientError({
      status: 409,
      code: 'TASK_VERSION_CONFLICT',
      messageKey: 'errors.taskVersionConflict',
      details: {},
      requestId: 'req-409-reload',
    });
    const resetEdit = vi.fn();
    const resetAssignees = vi.fn();
    const resetHidden = vi.fn();
    const onReloadEdit = vi.fn();
    const onReloadAssignees = vi.fn();
    const onReloadHidden = vi.fn();
    const taskV2 = makeTask(2, 2);

    mutationOverrides.update = { error: conflictErr, isPending: false, reset: resetEdit, mutate: vi.fn() };
    mutationOverrides.assignees = { error: conflictErr, isPending: false, reset: resetAssignees, mutate: vi.fn() };
    mutationOverrides.hidden = { error: conflictErr, isPending: false, reset: resetHidden, mutate: vi.fn() };

    const editHtml = renderWithProviders(
      createElement(TaskEditFormSection, { task: taskV2, onReload: onReloadEdit })
    );
    const assigneesHtml = renderWithProviders(
      createElement(TaskAssigneesSection, { task: taskV2, onReload: onReloadAssignees })
    );
    const hiddenHtml = renderWithProviders(
      createElement(TaskHiddenSection, { task: taskV2, onReload: onReloadHidden })
    );

    for (const html of [editHtml, assigneesHtml, hiddenHtml]) {
      expect(html).toContain('role="alert"');
      expect(html).toContain(viMessages.errors.taskVersionConflict);
      expect(html).toContain(viMessages.tasks.versionConflictReload);
    }

    expect(capturedReloadCallbacks).toHaveLength(3);
    capturedReloadCallbacks[0]?.();
    expect(resetEdit).toHaveBeenCalledTimes(1);
    expect(onReloadEdit).toHaveBeenCalledTimes(1);

    capturedReloadCallbacks[1]?.();
    expect(resetAssignees).toHaveBeenCalledTimes(1);
    expect(onReloadAssignees).toHaveBeenCalledTimes(1);

    capturedReloadCallbacks[2]?.();
    expect(resetHidden).toHaveBeenCalledTimes(1);
    expect(onReloadHidden).toHaveBeenCalledTimes(1);
  });

  it('clears 409 error on reset and still delivers per-call onSuccess undo toast across taskDetail version bump', async () => {
    const queryClient = new QueryClient();
    const taskV4 = makeTask(4, 2);
    const taskV5 = makeTask(5, 4);
    queryClient.setQueryData(TASKS_QUERY_KEYS.detail(taskV4.id), { task: taskV4 });

    let resolveBoardInvalidation!: () => void;
    const origInvalidate = queryClient.invalidateQueries.bind(queryClient);
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters, options) => {
      const key = filters?.queryKey;
      if (Array.isArray(key) && key[0] === 'taskDetail') {
        queryClient.setQueryData(TASKS_QUERY_KEYS.detail(taskV4.id), { task: taskV5 });
        return Promise.resolve();
      }
      if (Array.isArray(key) && key[0] === 'boardDetail') {
        return new Promise<void>((resolve) => {
          resolveBoardInvalidation = resolve;
        });
      }
      return origInvalidate(filters, options);
    });

    apiFetchMock
      .mockRejectedValueOnce(
        new ApiClientError({
          status: 409,
          code: 'TASK_VERSION_CONFLICT',
          messageKey: 'errors.taskVersionConflict',
          details: {},
        })
      )
      .mockResolvedValueOnce({ task: taskV5, eventId: 'ev-prio-5' });

    let capturedMutation: ReturnType<typeof useUpdateTaskMutation> | undefined;
    function MutationProbe() {
      capturedMutation = useUpdateTaskMutation();
      return null;
    }

    renderWithProviders(<MutationProbe />, queryClient);
    expect(capturedMutation).toBeDefined();

    type TaskMutationResponse = components['schemas']['TaskMutationResponse'];
    type UpdateTaskVars = { id: string; payload: components['schemas']['UpdateTaskRequest'] };
    const perCallOnSuccess = vi.fn();
    const observer = new MutationObserver<TaskMutationResponse, unknown, UpdateTaskVars>(queryClient, {
      mutationFn: ({ id, payload }) =>
        apiFetchMock('/tasks/{id}', { method: 'patch', params: { id }, body: payload }) as Promise<TaskMutationResponse>,
      onSuccess: async (data) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['boardDetail', data.task.boardId] }),
          queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.detail(data.task.id) }),
        ]);
      },
    });
    const unsubscribe = observer.subscribe(() => {});

    // 1. Trigger 409 conflict -> observer holds error -> reset() clears it cleanly
    await expect(
      observer.mutate({ id: taskV4.id, payload: { title: 'Updated v4', version: 3 } })
    ).rejects.toThrow();
    expect(observer.getCurrentResult().error).toBeInstanceOf(ApiClientError);
    observer.reset();
    expect(observer.getCurrentResult().error).toBeNull();

    // 2. Retry with refreshed v4 -> observer stays mounted across v4->v5 -> Undo toast fires
    const mutatePromise = observer.mutate(
      { id: taskV4.id, payload: { title: 'Updated v5', version: 4 } },
      {
        onSuccess: (data) => {
          perCallOnSuccess(data);
          toastMock.success(viMessages.tasks.updatedToast, { action: { label: viMessages.taskHistory.undoAction } });
        },
      }
    );

    await new Promise((r) => setTimeout(r, 10));
    expect((queryClient.getQueryData(TASKS_QUERY_KEYS.detail(taskV4.id)) as { task: TaskDto }).task.version).toBe(5);
    expect(observer.getCurrentResult().isPending).toBe(true);
    expect(observer.getCurrentResult().isError).toBe(false);
    expect(perCallOnSuccess).not.toHaveBeenCalled();

    // Since isError is false while pending, useEffect does NOT call observer.reset() -> toast fires on settle
    resolveBoardInvalidation();
    await mutatePromise;
    unsubscribe();

    expect(perCallOnSuccess).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith(
      viMessages.tasks.updatedToast,
      expect.objectContaining({ action: expect.objectContaining({ label: viMessages.taskHistory.undoAction }) })
    );
    expect(enMessages.tasks.updatedToast).toBe('Updated task.');
  });
});
