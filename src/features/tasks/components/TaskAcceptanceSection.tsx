'use client';

import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { MemberAvatar } from '@/components/MemberAvatar';
import { resolveAssignedDepartmentLeads } from '../drawer-helpers';
import { formatVnMonthDayTime } from '../formatters';
import {
  useUpdateTaskAcceptanceMutation,
  type DepartmentDto,
  type TaskAssigneeDto,
  type TaskDto,
} from '../hooks/useTasks';
import { TaskErrorBanner } from './TaskFormFields';
import { MemberInlineName } from './TaskPriorityBadge';
import { TaskToggleCard } from './TaskToggleCard';

function AcceptCheckIcon() {
  return (
    <svg className="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AssigneeAcceptanceRow({
  assignee,
  locale,
}: {
  readonly assignee: TaskAssigneeDto;
  readonly locale: string;
}) {
  const tTasks = useTranslations('tasks');
  const deptText = assignee.departments.map((dept) => dept.name).join(', ');
  const acceptedTime = assignee.acceptedAt
    ? formatVnMonthDayTime(assignee.acceptedAt, locale)
    : '';

  return (
    <div className="task-acceptance-row">
      <div className="task-acceptance-person">
        <MemberAvatar
          memberId={assignee.id}
          fullName={assignee.fullName}
          avatarUrl={assignee.avatarUrl}
          isActive={assignee.isActive}
          size="sm"
        />
        <div className="task-acceptance-person-meta">
          <div className="task-acceptance-name">
            <MemberInlineName member={assignee} />
          </div>
          {deptText ? <div className="task-acceptance-dept">{deptText}</div> : null}
        </div>
      </div>
      {assignee.acceptedAt ? (
        <span className="task-accept-pill is-accepted">
          ✓ {tTasks('acceptedStatus')} · {acceptedTime}
        </span>
      ) : (
        <span className="task-accept-pill is-pending">{tTasks('pendingAcceptStatus')}</span>
      )}
    </div>
  );
}

function useAcceptanceController(
  task: TaskDto,
  currentUserId: string | null | undefined,
  departments: readonly DepartmentDto[]
) {
  const tTasks = useTranslations('tasks');
  const tMember = useTranslations('member');
  const acceptanceMutation = useUpdateTaskAcceptanceMutation();

  const currentAssignee = currentUserId
    ? task.assignees.find((assignee) => assignee.id === currentUserId)
    : undefined;
  const isAccepted = Boolean(currentAssignee?.acceptedAt);
  const acceptedCount = task.assignees.filter((assignee) => Boolean(assignee.acceptedAt)).length;
  const leadNames = resolveAssignedDepartmentLeads(
    task.assignedDepartments,
    departments,
    tMember('leftBadge')
  );

  const handleToggle = (nextAccepted: boolean) => {
    acceptanceMutation.mutate(
      { id: task.id, accepted: nextAccepted },
      {
        onSuccess: () => {
          if (!nextAccepted) return;
          const banner =
            leadNames.length > 0
              ? tTasks('notifiedLeadsBanner', { leads: leadNames.join(', ') })
              : tTasks('notifiedCreatorBanner');
          toast.success(banner);
        },
      }
    );
  };

  return { isAccepted, acceptedCount, acceptanceMutation, handleToggle };
}

export function TaskAcceptanceSection({
  task,
  isAssigned,
  currentUserId,
  departments,
}: {
  readonly task: TaskDto;
  readonly isAssigned: boolean;
  readonly currentUserId: string | null | undefined;
  readonly departments: readonly DepartmentDto[];
}) {
  const locale = useLocale();
  const tTasks = useTranslations('tasks');
  const ctrl = useAcceptanceController(task, currentUserId, departments);

  return (
    <section className="task-side-card">
      <div className="task-side-card-head">
        <h3 className="task-section-title">{tTasks('assigneesLabel')}</h3>
        <span className="task-acceptance-count-pill">
          {tTasks('acceptedCountBadge', { accepted: ctrl.acceptedCount, total: task.assignees.length })}
        </span>
      </div>
      {isAssigned ? (
        <TaskToggleCard
          checked={ctrl.isAccepted}
          disabled={ctrl.acceptanceMutation.isPending}
          label={tTasks('acceptTaskSwitch')}
          icon={<AcceptCheckIcon />}
          onToggle={ctrl.handleToggle}
        />
      ) : null}
      <TaskErrorBanner error={ctrl.acceptanceMutation.error} />
      {task.assignees.length === 0 ? (
        <p className="ui-field-hint">{tTasks('assigneesEmpty')}</p>
      ) : (
        <div className="task-acceptance-list">
          {task.assignees.map((assignee) => (
            <AssigneeAcceptanceRow key={assignee.id} assignee={assignee} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}
