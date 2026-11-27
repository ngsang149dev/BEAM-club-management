'use client';

import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { usePermissions } from '@/features/shared/permissions/can';
import { taskDescriptionSchema, taskTitleSchema } from '@/lib/tasks';
import { hoChiMinhInputToUtcIso } from '../formatters';
import {
  useCreateTaskMutation,
  useTaskAssigneeMembersQuery,
  useTaskDepartmentsQuery,
  type CreateTaskRequest,
} from '../hooks/useTasks';
import {
  TaskDueDateInput,
  TaskErrorBanner,
  TaskStartDateInput,
} from './TaskFormFields';
import {
  CreateTaskAssignmentFields,
  CreateTaskModalActions,
  CreateTaskModalHeader,
  CreateTaskToggleRow,
} from './CreateTaskModalSections';

const createTaskFormSchema = z
  .object({
    title: taskTitleSchema,
    description: z.string().max(10000),
    startAtInput: z.string(),
    dueAtInput: z.string(),
    isHidden: z.boolean(),
  })
  .refine((d) => !(d.startAtInput && d.dueAtInput && d.startAtInput > d.dueAtInput), {
    message: 'invalidDateRange',
    path: ['dueAtInput'],
  });

export type CreateTaskFormValues = z.infer<typeof createTaskFormSchema>;

export interface CreateTaskModalProps {
  readonly boardId?: string;
  readonly columnId?: string;
  readonly columnName?: string;
  readonly onClose: () => void;
}

function toggleSelectionId(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function buildAssignmentPayloadFields(params: {
  readonly canAssign: boolean;
  readonly assigneeIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly notifyInApp: boolean;
  readonly notifyEmail: boolean;
}) {
  if (!params.canAssign) {
    return {
      assigneeIds: [],
      departmentIds: [],
      notifyInApp: false,
      notifyEmail: false,
      notifyDepartmentMembers: false,
    };
  }
  return {
    assigneeIds: [...params.assigneeIds],
    departmentIds: [...params.departmentIds],
    notifyInApp: params.notifyInApp,
    notifyEmail: params.notifyEmail,
    notifyDepartmentMembers: params.notifyInApp || params.notifyEmail,
  };
}

export function buildCreateTaskRequestPayload(params: {
  readonly boardId?: string;
  readonly columnId?: string;
  readonly values: CreateTaskFormValues;
  readonly canAssign: boolean;
  readonly assigneeIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly notifyInApp: boolean;
  readonly notifyEmail: boolean;
}): CreateTaskRequest {
  const parsedDesc = taskDescriptionSchema.safeParse(params.values.description.trim() || null);
  const scope = params.boardId && params.columnId
    ? { boardId: params.boardId, columnId: params.columnId }
    : {};
  return {
    ...scope,
    title: params.values.title.trim(),
    description: parsedDesc.success ? parsedDesc.data : null,
    startAt: hoChiMinhInputToUtcIso(params.values.startAtInput),
    dueAt: hoChiMinhInputToUtcIso(params.values.dueAtInput),
    ...buildAssignmentPayloadFields(params),
    isHidden: params.values.isHidden,
  };
}

function useCreateTaskController(
  boardId: string | undefined,
  columnId: string | undefined,
  onClose: () => void
) {
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
    defaultValues: { title: '', description: '', startAtInput: '', dueAtInput: '', isHidden: false },
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

function CreateTaskFormFields({
  ctrl,
  baseId,
  onClose,
}: {
  readonly ctrl: ReturnType<typeof useCreateTaskController>;
  readonly baseId: string;
  readonly onClose: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const tErr = useTranslations('errors');
  const { register, control, setValue, handleSubmit, formState: { errors } } = ctrl.form;
  const startAtInput = useWatch({ control, name: 'startAtInput' });
  const dueAtInput = useWatch({ control, name: 'dueAtInput' });
  const isHidden = useWatch({ control, name: 'isHidden' });
  const hasAnyAssignment = ctrl.assigneeIds.length > 0 || ctrl.departmentIds.length > 0;
  const dateRangeError = errors.dueAtInput ? tErr('invalidDateRange') : null;

  return (
    <form className="ui-modal-body" method="post" onSubmit={handleSubmit(ctrl.submitForm)} noValidate>
      <TaskErrorBanner error={ctrl.createMutation.error} />
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-title`}>{tTasks('titleLabel')}</label>
        <input id={`${baseId}-title`} className="ui-input" type="text" placeholder={tTasks('titlePlaceholder')} aria-invalid={Boolean(errors.title)} {...register('title')} />
        {errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationTitle')}</p> : null}
      </div>
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-desc`}>{tTasks('descriptionLabel')}</label>
        <textarea id={`${baseId}-desc`} className="ui-textarea" rows={4} placeholder={tTasks('descriptionPlaceholder')} {...register('description')} />
      </div>
      <div className="task-form-two-col">
        <TaskStartDateInput value={startAtInput} onChange={(next) => setValue('startAtInput', next, { shouldValidate: true })} />
        <TaskDueDateInput value={dueAtInput} errorText={dateRangeError} onChange={(next) => setValue('dueAtInput', next, { shouldValidate: true })} />
      </div>
      <CreateTaskAssignmentFields
        canAssign={ctrl.canAssign}
        canViewMembers={ctrl.canViewMembers}
        departments={ctrl.departments}
        members={ctrl.members}
        departmentIds={ctrl.departmentIds}
        assigneeIds={ctrl.assigneeIds}
        disabled={ctrl.createMutation.isPending}
        onToggleDepartment={ctrl.toggleDepartment}
        onToggleAssignee={ctrl.toggleAssignee}
      />
      <CreateTaskToggleRow
        canAssign={ctrl.canAssign}
        isBusy={ctrl.createMutation.isPending}
        notifyInApp={ctrl.notifyInApp}
        notifyEmail={ctrl.notifyEmail}
        isHidden={isHidden}
        hasAnyAssignment={hasAnyAssignment}
        onToggleInApp={ctrl.setNotifyInApp}
        onToggleEmail={ctrl.setNotifyEmail}
        onToggleHidden={(next) => setValue('isHidden', next)}
      />
      <CreateTaskModalActions isPending={ctrl.createMutation.isPending} onClose={onClose} />
    </form>
  );
}

export function CreateTaskModal({ boardId, columnId, columnName, onClose }: CreateTaskModalProps) {
  const titleId = useId();
  const baseId = useId();
  useEscapeClose(true, onClose);
  const ctrl = useCreateTaskController(boardId, columnId, onClose);

  return (
    <div className="ui-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ui-modal ui-modal-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <CreateTaskModalHeader titleId={titleId} columnName={columnName} onClose={onClose} />
        <CreateTaskFormFields ctrl={ctrl} baseId={baseId} onClose={onClose} />
      </div>
    </div>
  );
}
