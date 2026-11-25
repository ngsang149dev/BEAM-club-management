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
} from '../hooks/useTasks';
import {
  TaskDepartmentPicker,
  TaskDueDateInput,
  TaskErrorBanner,
  TaskIndividualAssigneesDetails,
  TaskNotifyDepartmentToggle,
  TaskPrioritySelect,
} from './TaskFormFields';

const createTaskFormSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(10000),
  dueAtInput: z.string(),
  priority: taskPrioritySchema,
  isHidden: z.boolean(),
});

type CreateTaskFormValues = z.infer<typeof createTaskFormSchema>;

export interface CreateTaskModalProps {
  boardId: string;
  columnId: string;
  columnName: string;
  onClose: () => void;
}

function toggleSelectionId(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function useCreateTaskController(boardId: string, columnId: string, onClose: () => void) {
  const tTasks = useTranslations('tasks');
  const { can } = usePermissions();
  const canAssign = can('task.assign');
  const canViewMembers = can('member.view');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [notifyDepartmentMembers, setNotifyDepartmentMembers] = useState<boolean>(true);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const departmentsQuery = useTaskDepartmentsQuery(canAssign);
  const membersQuery = useTaskAssigneeMembersQuery(canAssign && canViewMembers);
  const createMutation = useCreateTaskMutation();
  const form = useForm<CreateTaskFormValues>({
    resolver: zodResolver(createTaskFormSchema),
    defaultValues: { title: '', description: '', dueAtInput: '', priority: 2, isHidden: false },
  });

  const submitForm = (values: CreateTaskFormValues) => {
    const parsedDesc = taskDescriptionSchema.safeParse(values.description.trim() || null);
    createMutation.mutate(
      {
        boardId,
        columnId,
        title: values.title.trim(),
        description: parsedDesc.success ? parsedDesc.data : null,
        dueAt: hoChiMinhInputToUtcIso(values.dueAtInput),
        priority: values.priority,
        assigneeIds: canAssign ? assigneeIds : [],
        departmentIds: canAssign ? departmentIds : [],
        notifyDepartmentMembers: canAssign ? notifyDepartmentMembers : false,
        isHidden: values.isHidden,
      },
      { onSuccess: (res) => { toast.success(tTasks('createdToast', { title: res.task.title })); onClose(); } }
    );
  };

  return {
    canAssign,
    canViewMembers,
    departmentIds,
    toggleDepartment: (id: string) => setDepartmentIds((prev) => toggleSelectionId(prev, id)),
    notifyDepartmentMembers,
    setNotifyDepartmentMembers,
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
    <div className="ui-field">
      <span className="ui-label">{tTasks('departmentsLabel')}</span>
      <p className="ui-field-hint">{tTasks('departmentsHint')}</p>
      <TaskDepartmentPicker
        departments={ctrl.departments}
        selectedIds={ctrl.departmentIds}
        disabled={ctrl.createMutation.isPending}
        onToggle={ctrl.toggleDepartment}
      />
      <TaskNotifyDepartmentToggle
        checked={ctrl.notifyDepartmentMembers}
        disabled={ctrl.createMutation.isPending}
        onChange={ctrl.setNotifyDepartmentMembers}
      />
      <TaskIndividualAssigneesDetails
        members={ctrl.members}
        canViewMembers={ctrl.canViewMembers}
        selectedIds={ctrl.assigneeIds}
        disabled={ctrl.createMutation.isPending}
        onToggle={ctrl.toggleAssignee}
      />
    </div>
  );
}

export function CreateTaskModal({ boardId, columnId, columnName, onClose }: CreateTaskModalProps) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const titleId = useId();
  const baseId = useId();
  useEscapeClose(true, onClose);
  const ctrl = useCreateTaskController(boardId, columnId, onClose);
  const { register, control, setValue, handleSubmit, formState: { errors } } = ctrl.form;
  const priority = useWatch({ control, name: 'priority' });
  const dueAtInput = useWatch({ control, name: 'dueAtInput' });

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal ui-modal-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <div>
            <h2 id={titleId} className="ui-modal-title">{tTasks('createModalTitle')}</h2>
            <span className="admin-card-hint">{columnName}</span>
          </div>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        <form className="ui-modal-body" method="post" onSubmit={handleSubmit(ctrl.submitForm)} noValidate>
          <TaskErrorBanner error={ctrl.createMutation.error} />
          <div className="ui-field">
            <label className="ui-label" htmlFor={`${baseId}-title`}>{tTasks('titleLabel')}</label>
            <input id={`${baseId}-title`} className="ui-input" type="text" placeholder={tTasks('titlePlaceholder')} aria-invalid={Boolean(errors.title)} {...register('title')} />
            {errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationTitle')}</p> : null}
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor={`${baseId}-desc`}>{tTasks('descriptionLabel')}</label>
            <textarea id={`${baseId}-desc`} className="ui-textarea" rows={3} placeholder={tTasks('descriptionPlaceholder')} {...register('description')} />
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
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={ctrl.createMutation.isPending}>{tCommon('cancel')}</button>
            <button type="submit" className="ui-btn primary" disabled={ctrl.createMutation.isPending}>
              {ctrl.createMutation.isPending ? tTasks('creating') : tTasks('createSubmit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
