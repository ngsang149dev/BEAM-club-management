'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { apiFetch } from '@/features/shared/api/client';
import { usePermissions } from '@/features/shared/permissions/can';
import { canActorRevertEvent, type TaskHistoryLookup } from '../event-formatters';
import {
  extractRevertConflictFields,
  useRevertTaskEventMutation,
  useTaskEventsInfiniteQuery,
  type TaskEventDto,
} from '../hooks/useTaskEvents';
import { useTaskAssigneeMembersQuery, useTaskDepartmentsQuery, type TaskDto } from '../hooks/useTasks';
import { TaskHistoryRow } from './TaskHistoryRow';
import {
  TaskEventErrorBanner,
  TaskRevertConflictModal,
  type RevertConflictState,
} from './TaskRevertConflictModal';

function addLookupLabels<T extends { readonly id: string }>(
  map: Map<string, string>,
  items: readonly T[] | undefined,
  getLabel: (item: T) => string
): void {
  for (const item of items ?? []) map.set(item.id, getLabel(item));
}

function useTaskHistoryLookup(task: TaskDto, canViewMembers: boolean): TaskHistoryLookup {
  const boardQuery = useQuery({
    queryKey: ['boardColumns', task.boardId],
    queryFn: ({ signal }) => apiFetch('/boards/{id}', { params: { id: task.boardId }, signal }),
    enabled: Boolean(task.boardId),
    staleTime: 5 * 60_000,
  });
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const membersQuery = useTaskAssigneeMembersQuery(canViewMembers);
  const boardColumns = boardQuery.data?.board.columns;
  const deptItems = departmentsQuery.data?.items;
  const memberItems = membersQuery.data?.items;

  return useMemo(() => {
    const columnsById = new Map<string, string>();
    for (const col of boardColumns ?? []) columnsById.set(col.id, col.name);
    const departmentsById = new Map<string, string>();
    addLookupLabels(departmentsById, task.assignedDepartments, (dept) => dept.name);
    addLookupLabels(departmentsById, deptItems, (dept) => dept.name);
    const membersById = new Map<string, string>();
    membersById.set(task.creator.id, task.creator.fullName);
    addLookupLabels(membersById, task.assignees, (assignee) => assignee.fullName);
    addLookupLabels(membersById, memberItems, (member) => member.fullName);
    return { columnsById, departmentsById, membersById };
  }, [boardColumns, deptItems, memberItems, task.assignedDepartments, task.assignees, task.creator]);
}

function resolveProfileContext(profile: { id: string; departments?: Array<{ id: string }> } | undefined) {
  return {
    currentUserId: profile?.id,
    currentDepartmentIds: profile?.departments?.map((dept) => dept.id) ?? [],
  };
}

function resolveRevertErrors(
  conflictState: RevertConflictState | null,
  rawError: unknown
): { readonly inlineError: unknown; readonly modalError: unknown } {
  if (!conflictState) return { inlineError: rawError, modalError: null };
  const isConflict = extractRevertConflictFields(rawError) !== null;
  return { inlineError: null, modalError: isConflict ? null : rawError };
}

function useTaskHistoryController(task: TaskDto, onTaskDeleted: () => void) {
  const tHistory = useTranslations('taskHistory');
  const { isAdmin, can } = usePermissions();
  const meQuery = useMeQuery(true);
  const lookup = useTaskHistoryLookup(task, isAdmin || can('member.view'));
  const eventsQuery = useTaskEventsInfiniteQuery(task.id, true);
  const revertMutation = useRevertTaskEventMutation();
  const [conflictState, setConflictState] = useState<RevertConflictState | null>(null);
  const { currentUserId, currentDepartmentIds } = resolveProfileContext(meQuery.data?.profile);

  const handleRevert = (event: TaskEventDto, force = false) => {
    revertMutation.reset();
    revertMutation.mutate(
      { taskId: task.id, eventId: event.id, force },
      {
        onSuccess: () => {
          setConflictState(null);
          toast.success(tHistory('revertSuccessToast'));
          if (event.type === 'task.restored') onTaskDeleted();
        },
        onError: (error) => {
          if (force) return;
          const conflictingFields = extractRevertConflictFields(error);
          if (conflictingFields !== null) setConflictState({ event, conflictingFields });
        },
      }
    );
  };

  const { inlineError, modalError } = resolveRevertErrors(conflictState, revertMutation.error);
  return {
    lookup,
    eventsQuery,
    conflictState,
    revertingEventId: revertMutation.variables?.eventId ?? null,
    isReverting: revertMutation.isPending,
    inlineError,
    modalError,
    canRevertEvent: (event: TaskEventDto) =>
      canActorRevertEvent({ event, isAdmin, can, currentUserId, currentDepartmentIds, task }),
    handleRevert,
    closeConflictModal: () => { revertMutation.reset(); setConflictState(null); },
  };
}

function HistoryEventsList({
  events,
  ctrl,
}: {
  readonly events: readonly TaskEventDto[];
  readonly ctrl: ReturnType<typeof useTaskHistoryController>;
}) {
  const tHistory = useTranslations('taskHistory');

  return (
    <>
      <ul className="task-history-list">
        {events.map((event) => (
          <TaskHistoryRow
            key={event.id}
            event={event}
            lookup={ctrl.lookup}
            canRevert={ctrl.canRevertEvent(event)}
            isRevertingThis={ctrl.isReverting && ctrl.revertingEventId === event.id}
            isBusy={ctrl.isReverting}
            onRevert={(target) => ctrl.handleRevert(target, false)}
          />
        ))}
      </ul>
      {ctrl.eventsQuery.hasNextPage ? (
        <div className="task-history-more">
          <button
            type="button"
            className="ui-btn ghost is-sm"
            onClick={() => ctrl.eventsQuery.fetchNextPage()}
            disabled={ctrl.eventsQuery.isFetchingNextPage}
          >
            {ctrl.eventsQuery.isFetchingNextPage ? tHistory('loadingMore') : tHistory('loadMore')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function HistoryListBody({ ctrl }: { readonly ctrl: ReturnType<typeof useTaskHistoryController> }) {
  const tHistory = useTranslations('taskHistory');
  const tCommon = useTranslations('common');
  const { eventsQuery } = ctrl;

  if (eventsQuery.isPending) return <p className="ui-field-hint" role="status">{tHistory('loading')}</p>;
  if (eventsQuery.isError) {
    return (
      <div className="task-history-load-error">
        <TaskEventErrorBanner error={eventsQuery.error} />
        <button type="button" className="ui-btn ghost is-sm" onClick={() => eventsQuery.refetch()}>
          {tCommon('retry')}
        </button>
      </div>
    );
  }
  const events = eventsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (events.length === 0) {
    return (
      <div className="task-history-empty">
        <strong>{tHistory('emptyTitle')}</strong>
        <p className="ui-field-hint">{tHistory('emptyDescription')}</p>
      </div>
    );
  }
  return <HistoryEventsList events={events} ctrl={ctrl} />;
}

export function TaskHistorySection({
  task,
  onTaskDeleted,
}: {
  readonly task: TaskDto;
  readonly onTaskDeleted: () => void;
}) {
  const tHistory = useTranslations('taskHistory');
  const ctrl = useTaskHistoryController(task, onTaskDeleted);

  return (
    <section className="task-history-section">
      <div className="task-history-header">
        <span className="task-history-meta">{tHistory('sortNewestFirst')}</span>
      </div>
      <TaskEventErrorBanner error={ctrl.inlineError} />
      <div className="task-history-scroll">
        <HistoryListBody ctrl={ctrl} />
      </div>
      <TaskRevertConflictModal
        conflict={ctrl.conflictState}
        isPending={ctrl.isReverting}
        error={ctrl.modalError}
        onClose={ctrl.closeConflictModal}
        onConfirmForce={() => {
          if (ctrl.conflictState) ctrl.handleRevert(ctrl.conflictState.event, true);
        }}
      />
    </section>
  );
}
