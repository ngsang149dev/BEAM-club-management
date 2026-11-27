'use client';

import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { TaskErrorBanner } from '@/features/tasks/components/TaskFormFields';
import {
  MemberInlineName,
  TaskDepartmentChips,
} from '@/features/tasks/components/TaskPriorityBadge';
import { formatShortVnDate } from '@/features/tasks/formatters';
import { useUndoTaskActionToast } from '@/features/tasks/hooks/useTaskEvents';
import {
  useUpdateTaskAcceptanceMutation,
  useUpdateTaskMutation,
  type TaskDto,
} from '@/features/tasks/hooks/useTasks';
import {
  canToggleTaskCompletion,
  findMemberAssignee,
} from '../progress-helpers';
import { InspectorDeadlineBox } from './ProgressDeadlineBox';
import { ProgressDeliverablesCard } from './ProgressDeliverablesCard';

function AcceptanceControl({
  task,
  targetMemberId,
  isSelf,
  isPending,
  onToggleAccept,
}: {
  readonly task: TaskDto;
  readonly targetMemberId: string;
  readonly isSelf: boolean;
  readonly isPending: boolean;
  readonly onToggleAccept: (accepted: boolean) => void;
}) {
  const t = useTranslations('progress');
  const assignee = findMemberAssignee(task, targetMemberId);
  const accepted = Boolean(assignee?.acceptedAt);
  const dateShort = assignee?.acceptedAt ? formatShortVnDate(assignee.acceptedAt) : '';

  if (!isSelf) {
    return (
      <span className={`prog-accept-readonly ${accepted ? 'is-accepted' : 'is-pending'}`}>
        {accepted ? t('acceptedWithDate', { date: dateShort }) : t('unacceptedReadonly')}
      </span>
    );
  }
  return (
    <button type="button" className={`prog-accept-btn${accepted ? ' is-accepted' : ''}`} disabled={isPending} onClick={() => onToggleAccept(!accepted)}>
      {accepted ? t('acceptedWithDate', { date: dateShort }) : t('acceptButton')}
    </button>
  );
}

function useInspectorSummaryActions(task: TaskDto) {
  const tTasks = useTranslations('tasks');
  const acceptanceMutation = useUpdateTaskAcceptanceMutation();
  const updateMutation = useUpdateTaskMutation();
  const showUndoToast = useUndoTaskActionToast();

  const toggleAccept = (accepted: boolean) => {
    acceptanceMutation.mutate(
      { id: task.id, accepted },
      { onSuccess: () => { if (accepted) toast.success(tTasks('notifiedCreatorBanner')); } }
    );
  };

  const toggleComplete = () => {
    updateMutation.mutate(
      { id: task.id, payload: { isCompleted: !task.isCompleted, version: task.version } },
      {
        onSuccess: (data) =>
          showUndoToast({
            message: tTasks('updatedToast'),
            taskId: data.task.id,
            boardId: data.task.boardId,
            eventId: data.eventId,
          }),
      }
    );
  };

  return { acceptanceMutation, updateMutation, toggleAccept, toggleComplete };
}

function ProgressSummaryHeader({ task, onOpenDetail }: { readonly task: TaskDto; readonly onOpenDetail: (id: string) => void }) {
  const t = useTranslations('progress');
  const tTasks = useTranslations('tasks');
  return (
    <div className="prog-summary-top">
      <div className="prog-summary-chips">
        <TaskDepartmentChips departments={task.assignedDepartments} />
        {task.isHidden ? <span className="ui-chip task-hidden-chip">{tTasks('hiddenBadge')}</span> : null}
      </div>
      <button type="button" className="prog-expand-btn" onClick={() => onOpenDetail(task.id)}>
        {t('expandDetail')}
      </button>
    </div>
  );
}

function ProgressSummaryActions(props: {
  readonly task: TaskDto;
  readonly targetMemberId: string;
  readonly isSelf: boolean;
  readonly canToggleComplete: boolean;
  readonly isAcceptPending: boolean;
  readonly isCompletePending: boolean;
  readonly onToggleAccept: (accepted: boolean) => void;
  readonly onToggleComplete: () => void;
  readonly onOpenComments: (taskId: string) => void;
}) {
  const t = useTranslations('progress');
  return (
    <div className="prog-summary-actions">
      <div className="prog-summary-actions-left">
        <AcceptanceControl
          task={props.task}
          targetMemberId={props.targetMemberId}
          isSelf={props.isSelf}
          isPending={props.isAcceptPending}
          onToggleAccept={props.onToggleAccept}
        />
        {props.canToggleComplete ? (
          <button type="button" className="ui-btn ghost is-sm prog-complete-btn" disabled={props.isCompletePending} onClick={props.onToggleComplete}>
            {props.task.isCompleted ? t('reopenButton') : t('completeButton')}
          </button>
        ) : null}
      </div>
      <button type="button" className="prog-comments-trigger" onClick={() => props.onOpenComments(props.task.id)}>
        💬 {t('commentsButton', { count: props.task.commentCount })}
      </button>
    </div>
  );
}

function ProgressSummaryCard({
  task,
  targetMemberId,
  isSelf,
  canToggleComplete,
  onOpenDetail,
  onOpenComments,
  onRefresh,
}: {
  readonly task: TaskDto;
  readonly targetMemberId: string;
  readonly isSelf: boolean;
  readonly canToggleComplete: boolean;
  readonly onOpenDetail: (taskId: string) => void;
  readonly onOpenComments: (taskId: string) => void;
  readonly onRefresh: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations('progress');
  const { acceptanceMutation, updateMutation, toggleAccept, toggleComplete } = useInspectorSummaryActions(task);

  return (
    <section className="prog-card prog-summary-card" aria-label={task.title}>
      <ProgressSummaryHeader task={task} onOpenDetail={onOpenDetail} />
      <div>
        <h2 className="prog-summary-title">{task.title}</h2>
        {task.description ? <p className="prog-summary-desc">{task.description}</p> : null}
        <div className="prog-summary-creator">
          {t('assignedByLabel')} <strong><MemberInlineName member={task.creator} /></strong>
        </div>
      </div>
      <InspectorDeadlineBox task={task} locale={locale} />
      <TaskErrorBanner
        error={acceptanceMutation.error ?? updateMutation.error}
        onReloadConflict={() => {
          updateMutation.reset();
          onRefresh();
        }}
      />
      <ProgressSummaryActions
        task={task}
        targetMemberId={targetMemberId}
        isSelf={isSelf}
        canToggleComplete={canToggleComplete}
        isAcceptPending={acceptanceMutation.isPending}
        isCompletePending={updateMutation.isPending}
        onToggleAccept={toggleAccept}
        onToggleComplete={toggleComplete}
        onOpenComments={onOpenComments}
      />
    </section>
  );
}

export function ProgressInspectorPane(props: {
  readonly task: TaskDto | null;
  readonly targetMemberId: string;
  readonly currentUserId: string;
  readonly isSelf: boolean;
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
  readonly canUpdateAssigned: boolean;
  readonly onOpenDetail: (taskId: string) => void;
  readonly onOpenComments: (taskId: string) => void;
  readonly onRefresh: () => void;
}) {
  const t = useTranslations('progress');
  if (!props.task) {
    return (
      <aside className="prog-inspector">
        <div className="prog-card prog-empty-inspector"><p>{t('emptyInspector')}</p></div>
      </aside>
    );
  }
  const isCallerAssigned = Boolean(findMemberAssignee(props.task, props.currentUserId));
  const canToggleComplete = canToggleTaskCompletion({
    isAdmin: props.isAdmin,
    canUpdateAny: props.canUpdateAny,
    canUpdateAssigned: props.canUpdateAssigned,
    isSelf: props.isSelf,
    isCallerDirectlyAssigned: isCallerAssigned,
  });

  return (
    <aside className="prog-inspector">
      <ProgressSummaryCard
        key={`${props.task.id}-${props.task.version}`}
        task={props.task}
        targetMemberId={props.targetMemberId}
        isSelf={props.isSelf}
        canToggleComplete={canToggleComplete}
        onOpenDetail={props.onOpenDetail}
        onOpenComments={props.onOpenComments}
        onRefresh={props.onRefresh}
      />
      <ProgressDeliverablesCard
        key={props.task.id}
        task={props.task}
        canSubmit={props.isSelf || props.isAdmin || props.canUpdateAny || isCallerAssigned}
        currentUserId={props.currentUserId}
        isAdmin={props.isAdmin}
        canUpdateAny={props.canUpdateAny}
      />
    </aside>
  );
}
