'use client';

import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { TaskErrorBanner } from '@/features/tasks/components/TaskFormFields';
import {
  useCreateTaskDeliverableMutation,
  useDeleteTaskDeliverableMutation,
  type TaskDeliverableDto,
  type TaskDto,
} from '@/features/tasks/hooks/useTasks';
import { DELIVERABLE_TITLE_MAX, deliverableUrlSchema } from '@/lib/tasks';
import { extractDeliverableHost, safeDeliverableHref } from '../progress-helpers';

const deliverableFormSchema = z.object({
  title: z.string().trim().min(1, 'validationDeliverableTitle').max(DELIVERABLE_TITLE_MAX),
  url: deliverableUrlSchema,
});

type DeliverableFormValues = z.infer<typeof deliverableFormSchema>;

function DeliverableInlineForm({
  isPending,
  onSubmitValues,
}: {
  readonly isPending: boolean;
  readonly onSubmitValues: (values: DeliverableFormValues, reset: () => void) => void;
}) {
  const tCommon = useTranslations('common');
  const tTasks = useTranslations('tasks');
  const tErr = useTranslations('errors');
  const baseId = useId();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<DeliverableFormValues>({
    resolver: zodResolver(deliverableFormSchema),
    defaultValues: { title: '', url: '' },
  });

  return (
    <form className="prog-deliv-form" method="post" onSubmit={handleSubmit((values) => onSubmitValues(values, () => reset()))} noValidate>
      <input
        id={`${baseId}-title`}
        type="text"
        className="ui-input prog-deliv-input"
        placeholder={tTasks('deliverableTitlePlaceholder')}
        aria-label={tTasks('deliverableTitlePlaceholder')}
        aria-invalid={Boolean(errors.title)}
        disabled={isPending}
        {...register('title')}
      />
      <div className="prog-deliv-url-row">
        <input
          id={`${baseId}-url`}
          type="url"
          className="ui-input prog-deliv-input"
          placeholder={tTasks('deliverableUrlPlaceholder')}
          aria-label={tTasks('deliverableUrlPlaceholder')}
          aria-invalid={Boolean(errors.url)}
          disabled={isPending}
          {...register('url')}
        />
        <button type="submit" className="ui-btn primary is-sm" disabled={isPending}>
          {isPending ? tTasks('deliverableSubmitting') : tCommon('save')}
        </button>
      </div>
      {errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationDeliverableTitle')}</p> : null}
      {errors.url ? <p className="ui-field-error" role="alert">{tErr('invalidDeliverableUrl')}</p> : null}
    </form>
  );
}

function ProgressDeliverableRow({
  item,
  canDelete,
  isDeleting,
  onDelete,
}: {
  readonly item: TaskDeliverableDto;
  readonly canDelete: boolean;
  readonly isDeleting: boolean;
  readonly onDelete: () => void;
}) {
  const t = useTranslations('progress');
  const tTasks = useTranslations('tasks');
  const host = extractDeliverableHost(item.url) || t('deliverableExternalFallback');

  return (
    <div className="prog-deliv-row">
      <a href={safeDeliverableHref(item.url)} target="_blank" rel="noopener noreferrer" className="prog-deliv-link">
        <span className="prog-deliv-title">{item.title}</span>
        <span className="prog-deliv-host mono">{host} ↗</span>
      </a>
      {canDelete ? (
        <button
          type="button"
          className="ui-btn ghost is-sm prog-deliv-del-btn"
          disabled={isDeleting}
          onClick={onDelete}
          aria-label={`${tTasks('deliverableDelete')}: ${item.title}`}
        >
          {tTasks('deliverableDelete')}
        </button>
      ) : null}
    </div>
  );
}

function ProgressDeliverableItemsList({
  deliverables,
  currentUserId,
  isAdmin,
  canUpdateAny,
  isDeleting,
  onDelete,
}: {
  readonly deliverables: readonly TaskDeliverableDto[];
  readonly currentUserId: string;
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
  readonly isDeleting: boolean;
  readonly onDelete: (deliverableId: string) => void;
}) {
  const t = useTranslations('progress');
  if (deliverables.length === 0) {
    return <p className="prog-deliv-empty">{t('deliverablesEmpty')}</p>;
  }
  return (
    <>
      {deliverables.map((item) => (
        <ProgressDeliverableRow
          key={item.id}
          item={item}
          canDelete={Boolean(isAdmin || canUpdateAny || (currentUserId && item.submittedBy.id === currentUserId))}
          isDeleting={isDeleting}
          onDelete={() => onDelete(item.id)}
        />
      ))}
    </>
  );
}

function useDeliverablesCardController(taskId: string) {
  const tTasks = useTranslations('tasks');
  const [showForm, setShowForm] = useState(false);
  const createMutation = useCreateTaskDeliverableMutation();
  const deleteMutation = useDeleteTaskDeliverableMutation();

  const handleCreate = (values: DeliverableFormValues, resetForm: () => void) => {
    createMutation.mutate(
      { id: taskId, payload: { title: values.title.trim(), url: values.url.trim() } },
      {
        onSuccess: () => {
          resetForm();
          setShowForm(false);
          toast.success(tTasks('deliverableSubmittedToast'));
        },
      }
    );
  };

  return { showForm, setShowForm, createMutation, deleteMutation, handleCreate };
}

export function ProgressDeliverablesCard({
  task,
  canSubmit,
  currentUserId,
  isAdmin,
  canUpdateAny,
}: {
  readonly task: TaskDto;
  readonly canSubmit: boolean;
  readonly currentUserId: string;
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
}) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const ctrl = useDeliverablesCardController(task.id);
  const allowAdd = canSubmit && !task.isCompleted;

  return (
    <section className="prog-card prog-deliv-card" aria-label={t('deliverablesTitle', { count: task.deliverables.length })}>
      <div className="prog-deliv-head">
        <h3 className="prog-deliv-heading">{t('deliverablesTitle', { count: task.deliverables.length })}</h3>
        {allowAdd ? (
          <button type="button" className="prog-deliv-toggle-btn" aria-expanded={ctrl.showForm} onClick={() => ctrl.setShowForm((prev) => !prev)}>
            {ctrl.showForm ? tCommon('close') : t('deliverableAddToggle')}
          </button>
        ) : null}
      </div>
      {ctrl.showForm && allowAdd ? (
        <DeliverableInlineForm isPending={ctrl.createMutation.isPending} onSubmitValues={ctrl.handleCreate} />
      ) : null}
      <TaskErrorBanner error={ctrl.createMutation.error ?? ctrl.deleteMutation.error} />
      <div className="prog-deliv-scroll">
        <ProgressDeliverableItemsList
          deliverables={task.deliverables}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canUpdateAny={canUpdateAny}
          isDeleting={ctrl.deleteMutation.isPending}
          onDelete={(deliverableId) => ctrl.deleteMutation.mutate({ id: task.id, deliverableId })}
        />
      </div>
    </section>
  );
}
