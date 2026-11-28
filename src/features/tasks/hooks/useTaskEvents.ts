'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch, isApiClientError, type components } from '@/features/shared/api/client';
import { describeTaskError, type TaskErrorKey } from '../error-mapping';
import { TASKS_QUERY_KEYS } from './useTasks';

export type TaskDto = components['schemas']['TaskDto'];
export type TaskPageResponse = components['schemas']['TaskPageResponse'];
export type TaskMutationResponse = components['schemas']['TaskMutationResponse'];
export type TaskEventDto = components['schemas']['TaskEventDto'];
export type TaskEventPageResponse = components['schemas']['TaskEventPageResponse'];
export type RevertTaskEventRequest = components['schemas']['RevertTaskEventRequest'];
export type RevertTaskEventResponse = components['schemas']['RevertTaskEventResponse'];
export type ArchiveTaskItem = components['schemas']['ArchiveTaskItem'];

export const TASK_EVENTS_PAGE_SIZE = 15;
export const WORKSPACE_TRASH_PAGE_SIZE = 50;
export const UNDO_TOAST_DURATION_MS = 10_000;

export const TASK_EVENTS_QUERY_KEYS = {
  byTask: (taskId: string) => ['taskEvents', taskId] as const,
  workspaceTrash: ['tasks', 'workspaceTrash'] as const,
};

export type TaskEventErrorKey =
  | TaskErrorKey
  | 'revertConflict'
  | 'eventNotRevertable'
  | 'taskDeletedConflict'
  | 'boardArchived'
  | 'boardHasNoColumns'
  | 'taskNotDeleted';

export interface TaskEventErrorDescriptor {
  readonly key: TaskEventErrorKey;
  readonly requestId?: string;
}

const SPECIAL_CODE_TO_KEY: Record<string, TaskEventErrorKey> = {
  REVERT_CONFLICT: 'revertConflict',
  EVENT_NOT_REVERTABLE: 'eventNotRevertable',
  TASK_DELETED: 'taskDeletedConflict',
  BOARD_ARCHIVED: 'boardArchived',
  BOARD_HAS_NO_COLUMNS: 'boardHasNoColumns',
  TASK_NOT_DELETED: 'taskNotDeleted',
};

export function resolveTaskEventErrorDescriptor(error: unknown): TaskEventErrorDescriptor | null {
  if (!error) return null;
  if (isApiClientError(error)) {
    const special = SPECIAL_CODE_TO_KEY[error.code];
    if (special) return { key: special, requestId: error.requestId };
  }
  return describeTaskError(error);
}

export function extractRevertConflictFields(error: unknown): string[] | null {
  if (!isApiClientError(error) || error.status !== 409) return null;
  const hasFields = Array.isArray(error.details.conflictingFields);
  if (error.code !== 'REVERT_CONFLICT' && !hasFields) return null;
  if (!hasFields) return [];
  const raw = error.details.conflictingFields as unknown[];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isRevertConflictError(error: unknown): boolean {
  if (!isApiClientError(error) || error.status !== 409) return false;
  if (error.code === 'REVERT_CONFLICT' || Array.isArray(error.details.conflictingFields)) {
    return true;
  }
  return !SPECIAL_CODE_TO_KEY[error.code];
}

function shouldRetryTaskEventQuery(failureCount: number, error: unknown): boolean {
  if (isApiClientError(error) && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return false;
  }
  return failureCount < 1;
}

export async function invalidateTaskEventQueries(
  queryClient: QueryClient,
  taskId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: TASK_EVENTS_QUERY_KEYS.byTask(taskId) }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.detail(taskId) }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.calendarRoot }),
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEYS.progressRoot }),
    queryClient.invalidateQueries({ queryKey: TASK_EVENTS_QUERY_KEYS.workspaceTrash }),
    queryClient.invalidateQueries({ queryKey: ['archive'] }),
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  ]);
}

export function useTaskEventsInfiniteQuery(taskId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: TASK_EVENTS_QUERY_KEYS.byTask(taskId ?? 'none'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/tasks/{id}/events', {
        params: { id: taskId ?? '' },
        query: { ...(pageParam ? { cursor: pageParam } : {}), limit: TASK_EVENTS_PAGE_SIZE },
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled: enabled && Boolean(taskId),
    retry: shouldRetryTaskEventQuery,
    refetchOnMount: 'always',
  });
}

export function useRevertTaskEventMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      eventId,
      force = false,
    }: {
      taskId: string;
      eventId: string;
      force?: boolean;
    }) =>
      apiFetch('/tasks/{id}/events/{eventId}/revert', {
        method: 'post',
        params: { id: taskId, eventId },
        body: { force },
      }),
    onSuccess: async (data) => {
      await invalidateTaskEventQueries(queryClient, data.task.id);
    },
  });
}

export function useWorkspaceTrashInfiniteQuery(enabled = true) {
  return useInfiniteQuery({
    queryKey: TASK_EVENTS_QUERY_KEYS.workspaceTrash,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/archive', {
        query: {
          tab: 'tasks',
          ...(pageParam ? { cursor: pageParam } : {}),
          limit: WORKSPACE_TRASH_PAGE_SIZE,
        },
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled,
    retry: shouldRetryTaskEventQuery,
    refetchOnMount: 'always',
  });
}

export function useRestoreTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch('/tasks/{id}/restore', {
        method: 'post',
        params: { id: taskId },
      }),
    onSuccess: async (data) => {
      await invalidateTaskEventQueries(queryClient, data.task.id);
    },
  });
}

export interface QuickUndoMessages {
  readonly success: string;
  readonly conflict: string;
  readonly errorForKey: (key: TaskEventErrorKey) => string;
}

export async function executeQuickUndo({
  queryClient,
  taskId,
  eventId,
  messages,
}: {
  readonly queryClient: QueryClient;
  readonly taskId: string;
  readonly eventId: string;
  readonly messages: QuickUndoMessages;
}): Promise<void> {
  try {
    const result = await apiFetch('/tasks/{id}/events/{eventId}/revert', {
      method: 'post',
      params: { id: taskId, eventId },
      body: { force: false },
    });
    await invalidateTaskEventQueries(queryClient, result.task.id);
    toast.success(messages.success);
  } catch (error) {
    if (isRevertConflictError(error)) {
      toast.error(messages.conflict);
      return;
    }
    const descriptor = resolveTaskEventErrorDescriptor(error);
    toast.error(messages.errorForKey(descriptor?.key ?? 'unknown'));
  }
}

export interface ShowUndoToastInput {
  readonly message: string;
  readonly taskId: string;
  readonly eventId: string | null | undefined;
}

export function useUndoTaskActionToast() {
  const queryClient = useQueryClient();
  const tHistory = useTranslations('taskHistory');
  const tErr = useTranslations('errors');

  return ({ message, taskId, eventId }: ShowUndoToastInput) => {
    void queryClient.invalidateQueries({ queryKey: TASK_EVENTS_QUERY_KEYS.byTask(taskId) });
    if (!eventId) {
      toast.success(message);
      return;
    }
    let triggered = false;
    const undoLabel = tHistory('undoAction');
    const messages: QuickUndoMessages = {
      success: tHistory('undoSuccessToast'),
      conflict: tHistory('undoConflictToast'),
      errorForKey: (key) => tErr(key),
    };
    toast.success(message, {
      duration: UNDO_TOAST_DURATION_MS,
      action: {
        label: undoLabel,
        onClick: () => {
          if (triggered) return;
          triggered = true;
          void executeQuickUndo({ queryClient, taskId, eventId, messages });
        },
      },
    });
  };
}
