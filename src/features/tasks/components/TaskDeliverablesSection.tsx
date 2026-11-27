'use client';

import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { DELIVERABLE_TITLE_MAX, deliverableUrlSchema } from '@/lib/tasks';
import { resolveAssignedDepartmentLeads } from '../drawer-helpers';
import { formatTaskDateTime } from '../formatters';
import {
  useCreateTaskDeliverableMutation,
  useDeleteTaskDeliverableMutation,
  type DepartmentDto,
  type TaskDeliverableDto,
  type TaskDto,
} from '../hooks/useTasks';
import { TaskErrorBanner } from './TaskFormFields';
import { MemberInlineName } from './TaskPriorityBadge';

const deliverableFormSchema = z.object({
  title: z.string().trim().min(1, 'validationDeliverableTitle').max(DELIVERABLE_TITLE_MAX),
  url: deliverableUrlSchema,
});

type DeliverableFormValues = z.infer<typeof deliverableFormSchema>;

function safeExternalHref(rawUrl: string): string {
  return deliverableUrlSchema.safeParse(rawUrl).success ? rawUrl : '#';
}

function DeliverableRow({
  item,
  locale,
  canDelete,
  isDeleting,
  onDelete,
}: {
  readonly item: TaskDeliverableDto;
  readonly locale: string;
  readonly canDelete: boolean;
  readonly isDeleting: boolean;
  readonly onDelete: () => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-deliverable-row">
      <div className="task-deliverable-main">
        <a
          href={safeExternalHref(item.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="task-deliverable-link"
        >
          <span>{item.title}</span>
          <span aria-hidden="true">↗</span>
        </a>
        <div className="task-deliverable-meta">
          <MemberInlineName member={item.submittedBy} />
          <span aria-hidden="true">·</span>
          <time className="mono" dateTime={item.createdAt}>
            {formatTaskDateTime(item.createdAt, locale)}
          </time>
        </div>
      </div>
      {canDelete ? (
        <button
          type="button"
          className="ui-btn ghost is-sm"
          disabled={isDeleting}
          onClick={onDelete}
        >
          {tTasks('deliverableDelete')}
        </button>
      ) : null}
    </div>
  );
}

function DeliverableSubmitForm({
  isPending,
  onSubmitValues,
}: {
  readonly isPending: boolean;
  readonly onSubmitValues: (values: DeliverableFormValues, reset: () => void) => void;
}) {
  const tTasks = useTranslations('tasks');
  const tErr = useTranslations('errors');
  const baseId = useId();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DeliverableFormValues>({
    resolver: zodResolver(deliverableFormSchema),
    defaultValues: { title: '', url: '' },
  });

  return (
    <form
      className="task-deliverable-form"
      method="post"
      onSubmit={handleSubmit((values) => onSubmitValues(values, () => reset()))}
      noValidate
    >
      <div className="task-deliverable-inputs">
        <input
          id={`${baseId}-title`}
          type="text"
          className="ui-input"
          placeholder={tTasks('deliverableTitlePlaceholder')}
          aria-label={tTasks('deliverableTitlePlaceholder')}
          aria-invalid={Boolean(errors.title)}
          disabled={isPending}
          {...register('title')}
        />
        <input
          id={`${baseId}-url`}
          type="url"
          className="ui-input"
          placeholder={tTasks('deliverableUrlPlaceholder')}
          aria-label={tTasks('deliverableUrlPlaceholder')}
          aria-invalid={Boolean(errors.url)}
          disabled={isPending}
          {...register('url')}
        />
        <button type="submit" className="ui-btn primary is-sm" disabled={isPending}>
          {isPending ? tTasks('deliverableSubmitting') : tTasks('deliverableSubmit')}
        </button>
      </div>
      {errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationDeliverableTitle')}</p> : null}
      {errors.url ? <p className="ui-field-error" role="alert">{tErr('invalidDeliverableUrl')}</p> : null}
    </form>
  );
}

function useDeliverablesController(task: TaskDto, departments: readonly DepartmentDto[]) {
  const tTasks = useTranslations('tasks');
  const tMember = useTranslations('member');
  const [notice, setNotice] = useState<string | null>(null);
  const createMutation = useCreateTaskDeliverableMutation();
  const deleteMutation = useDeleteTaskDeliverableMutation();
  const leadNames = resolveAssignedDepartmentLeads(
    task.assignedDepartments,
    departments,
    tMember('leftBadge')
  );

  const handleCreate = (values: DeliverableFormValues, resetForm: () => void) => {
    setNotice(null);
    createMutation.mutate(
      { id: task.id, payload: { title: values.title.trim(), url: values.url.trim() } },
      {
        onSuccess: () => {
          resetForm();
          const banner =
            leadNames.length > 0
              ? tTasks('notifiedLeadsBanner', { leads: leadNames.join(', ') })
              : tTasks('notifiedCreatorBanner');
          setNotice(banner);
          toast.success(tTasks('deliverableSubmittedToast'));
        },
      }
    );
  };

  return { notice, leadNames, createMutation, deleteMutation, handleCreate };
}

function DeliverablesList({
  task,
  locale,
  currentUserId,
  isAdmin,
  canUpdateAny,
  isDeleting,
  onDelete,
}: {
  readonly task: TaskDto;
  readonly locale: string;
  readonly currentUserId: string | null | undefined;
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
  readonly isDeleting: boolean;
  readonly onDelete: (deliverableId: string) => void;
}) {
  const tTasks = useTranslations('tasks');
  if (task.deliverables.length === 0) {
    return <p className="ui-field-hint">{tTasks('deliverablesEmpty')}</p>;
  }
  return (
    <div className="task-deliverable-list">
      {task.deliverables.map((item) => {
        const canDelete = Boolean(
          isAdmin || canUpdateAny || (currentUserId && item.submittedBy.id === currentUserId)
        );
        return (
          <DeliverableRow
            key={item.id}
            item={item}
            locale={locale}
            canDelete={canDelete}
            isDeleting={isDeleting}
            onDelete={() => onDelete(item.id)}
          />
        );
      })}
    </div>
  );
}

export function TaskDeliverablesSection({
  task,
  canSubmit,
  currentUserId,
  isAdmin,
  canUpdateAny,
  departments,
}: {
  readonly task: TaskDto;
  readonly canSubmit: boolean;
  readonly currentUserId: string | null | undefined;
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
  readonly departments: readonly DepartmentDto[];
}) {
  const locale = useLocale();
  const tTasks = useTranslations('tasks');
  const ctrl = useDeliverablesController(task, departments);

  return (
    <section className="task-deliverables-card">
      <div className="task-deliverables-head">
        <h3 className="task-section-title">
          {tTasks('deliverablesTitle', { count: task.deliverables.length })}
        </h3>
        {ctrl.leadNames.length > 0 ? (
          <span className="task-deliverables-lead">
            {tTasks('deptLeadLabel', { leads: ctrl.leadNames.join(', ') })}
          </span>
        ) : null}
      </div>
      <TaskErrorBanner error={ctrl.createMutation.error ?? ctrl.deleteMutation.error} />
      {ctrl.notice ? (
        <div className="ui-banner is-success" role="status">
          <div className="ui-banner-body"><span className="ui-banner-text">{ctrl.notice}</span></div>
        </div>
      ) : null}
      <DeliverablesList
        task={task}
        locale={locale}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        canUpdateAny={canUpdateAny}
        isDeleting={ctrl.deleteMutation.isPending}
        onDelete={(deliverableId) => ctrl.deleteMutation.mutate({ id: task.id, deliverableId })}
      />
      {canSubmit ? (
        <DeliverableSubmitForm isPending={ctrl.createMutation.isPending} onSubmitValues={ctrl.handleCreate} />
      ) : null}
    </section>
  );
}
