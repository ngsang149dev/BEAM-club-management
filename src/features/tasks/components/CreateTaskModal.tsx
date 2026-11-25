'use client';

import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { usePermissions } from '@/features/shared/permissions/can';
import { taskDescriptionSchema, taskPrioritySchema, taskTitleSchema } from '@/lib/tasks';
import { hoChiMinhInputToUtcIso } from '../formatters';
import {
  useCreateTaskMutation,
  useTaskAssigneeMembersQuery,
  useTaskDepartmentsQuery,
  type CreateTaskRequest,
} from '../hooks/useTasks';
import {
  TaskDepartmentPicker,
  TaskDueDateInput,
  TaskErrorBanner,
  TaskIndividualAssigneesDetails,
  TaskPrioritySelect,
} from './TaskFormFields';
import { TaskNotificationOptions } from './TaskNotificationOptions';

const createTaskFormSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(10000),
  dueAtInput: z.string(),
  priority: taskPrioritySchema,
  isHidden: z.boolean(),
});

export type CreateTaskFormValues = z.infer<typeof createTaskFormSchema>;

export interface CreateTaskModalProps {
  boardId: string;
  columnId: string;
  columnName: string;
  onClose: () => void;
}

function toggleSelectionId(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

export function buildCreateTaskRequestPayload(params: {
  readonly boardId: string;
  readonly columnId: string;
  readonly values: CreateTaskFormValues;
  readonly canAssign: boolean;
  readonly assigneeIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly notifyInApp: boolean;
  readonly notifyEmail: boolean;
}): CreateTaskRequest {
  const parsedDesc = taskDescriptionSchema.safeParse(params.values.description.trim() || null);
  return {
    boardId: params.boardId,
    columnId: params.columnId,
    title: params.values.title.trim(),
    description: parsedDesc.success ? parsedDesc.data : null,
    dueAt: hoChiMinhInputToUtcIso(params.values.dueAtInput),
    priority: params.values.priority,
    assigneeIds: params.canAssign ? [...params.assigneeIds] : [],
    departmentIds: params.canAssign ? [...params.departmentIds] : [],
    notifyInApp: params.canAssign ? params.notifyInApp : false,
    notifyEmail: params.canAssign ? params.notifyEmail : false,
    notifyDepartmentMembers: params.canAssign ? params.notifyInApp || params.notifyEmail : false,
    isHidden: params.values.isHidden,
  };
}

function useCreateTaskController(boardId: string, columnId: string, onClose: () => void) {
  const tTasks = useTranslations('tasks');
  const { can } = usePermissions();
  const canAssign = can('task.assign');
  const canViewMembers = can('member.view');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [notifyInApp, setNotifyInApp] = useState<boolean>(true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(true);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const departmentsQuery = useTaskDepartmentsQuery(canAssign);
  const membersQuery = useTaskAssigneeMembersQuery(canAssign && canViewMembers);
  const createMutation = useCreateTaskMutation();
  const form = useForm<CreateTaskFormValues>({
    resolver: zodResolver(createTaskFormSchema),
    defaultValues: { title: '', description: '', dueAtInput: '', priority: 2, isHidden: false },
  });

  const submitForm = (values: CreateTaskFormValues) => {
    const payload = buildCreateTaskRequestPayload({
      boardId,
      columnId,
      values,
      canAssign,
      assigneeIds,
      departmentIds,
      notifyInApp,
      notifyEmail,
    });
    createMutation.mutate(payload, {
      onSuccess: (res) => {
        toast.success(tTasks('createdToast', { title: res.task.title }));
        onClose();
      },
    });
  };

  return {
    canAssign,
    canViewMembers,
    departmentIds,
    toggleDepartment: (id: string) => setDepartmentIds((prev) => toggleSelectionId(prev, id)),
    notifyInApp,
    setNotifyInApp,
    notifyEmail,
    setNotifyEmail,
    assigneeIds,
    toggleAssignee: (id: string) => setAssigneeIds((prev) => toggleSelectionId(prev, id)),
    departments: departmentsQuery.data?.items ?? [],
    members: membersQuery.data?.items ?? [],
    createMutation,
    form,
    submitForm,
  };
}

function CreateTaskAssignmentFields({ ctrl }: { ctrl: ReturnType<typeof useCreateTaskController> }) {
  const tTasks = useTranslations('tasks');
  if (!ctrl.canAssign) return null;

  return (
    <>
      <div className="ui-field">
        <span className="ui-label">{tTasks('departmentsLabel')}</span>
        <TaskDepartmentPicker
          departments={ctrl.departments}
          selectedIds={ctrl.departmentIds}
          disabled={ctrl.createMutation.isPending}
          onToggle={ctrl.toggleDepartment}
        />
      </div>
      <TaskIndividualAssigneesDetails
        members={ctrl.members}
        canViewMembers={ctrl.canViewMembers}
        selectedIds={ctrl.assigneeIds}
        disabled={ctrl.createMutation.isPending}
        onToggle={ctrl.toggleAssignee}
      />
      <TaskNotificationOptions
        notifyInApp={ctrl.notifyInApp}
        onToggleNotifyInApp={ctrl.setNotifyInApp}
        notifyEmail={ctrl.notifyEmail}
        onToggleNotifyEmail={ctrl.setNotifyEmail}
        disabled={ctrl.createMutation.isPending}
      />
    </>
  );
}

function CreateTaskModalHeader({
  titleId,
  columnName,
  onClose,
}: {
  readonly titleId: string;
  readonly columnName: string;
  readonly onClose: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');

  return (
    <div className="ui-modal-header">
      <div>
        <h2 id={titleId} className="ui-modal-title">{tTasks('createModalTitle')}</h2>
        <span className="admin-card-hint">{columnName}</span>
      </div>
      <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
    </div>
  );
}

function CreateTaskModalActions({
  isPending,
  onClose,
}: {
  readonly isPending: boolean;
  readonly onClose: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');

  return (
    <div className="ui-modal-actions">
      <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isPending}>
        {tCommon('cancel')}
      </button>
      <button type="submit" className="ui-btn primary" disabled={isPending}>
        {isPending ? tTasks('creating') : tTasks('createSubmit')}
      </button>
    </div>
  );
}

export function CreateTaskModal({ boardId, columnId, columnName, onClose }: CreateTaskModalProps) {
  const tTasks = useTranslations('tasks');
  const titleId = useId();
  const baseId = useId();
  useEscapeClose(true, onClose);
  const ctrl = useCreateTaskController(boardId, columnId, onClose);
  const { register, control, setValue, handleSubmit, formState: { errors } } = ctrl.form;
  const priority = useWatch({ control, name: 'priority' });
  const dueAtInput = useWatch({ control, name: 'dueAtInput' });
  const isHidden = useWatch({ control, name: 'isHidden' });
  const hasAnyAssignment = ctrl.assigneeIds.length > 0 || ctrl.departmentIds.length > 0;

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal ui-modal-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <CreateTaskModalHeader titleId={titleId} columnName={columnName} onClose={onClose} />
        <form className="ui-modal-body" method="post" onSubmit={handleSubmit(ctrl.submitForm)} noValidate>
          <TaskErrorBanner error={ctrl.createMutation.error} />
          <div className="ui-field">
            <label className="ui-label" htmlFor={`${baseId}-title`}>{tTasks('titleLabel')}</label>
            <input id={`${baseId}-title`} className="ui-input" type="text" placeholder={tTasks('titlePlaceholder')} aria-invalid={Boolean(errors.title)} {...register('title')} />
            {errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationTitle')}</p> : null}
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor={`${baseId}-desc`}>{tTasks('descriptionLabel')}</label>
            <textarea id={`${baseId}-desc`} className="ui-textarea" rows={6} placeholder={tTasks('descriptionPlaceholder')} {...register('description')} />
          </div>
          <div className="task-form-two-col">
            <TaskPrioritySelect value={priority} onChange={(next) => setValue('priority', next)} />
            <TaskDueDateInput value={dueAtInput} onChange={(next) => setValue('dueAtInput', next)} />
          </div>
          <CreateTaskAssignmentFields ctrl={ctrl} />
          <label className="ui-check-inline">
            <input type="checkbox" {...register('isHidden')} />
            <span>{tTasks('isHiddenLabel')}</span>
          </label>
          {isHidden && !hasAnyAssignment ? (
            <div className="ui-banner is-warn" role="status">
              <div className="ui-banner-body">
                <span className="ui-banner-title">{tTasks('hiddenUnassignedWarnTitle')}</span>
                <span className="ui-banner-text">{tTasks('hiddenUnassignedWarnBody')}</span>
              </div>
            </div>
          ) : null}
          <CreateTaskModalActions isPending={ctrl.createMutation.isPending} onClose={onClose} />
        </form>
      </div>
    </div>
  );
}
