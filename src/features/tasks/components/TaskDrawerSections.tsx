'use client';

import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { usePermissions } from '@/features/shared/permissions/can';
import { taskPrioritySchema, taskTitleSchema } from '@/lib/tasks';
import { hoChiMinhInputToUtcIso, utcIsoToHoChiMinhInput } from '../formatters';
import {
  useDeleteTaskMutation,
  useReplaceTaskAssigneesMutation,
  useTaskAssigneeMembersQuery,
  useTaskDepartmentsQuery,
  useUpdateTaskMutation,
  type TaskDto,
} from '../hooks/useTasks';
import {
  TaskDepartmentPicker,
  TaskDueDateInput,
  TaskErrorBanner,
  TaskIndividualAssigneesDetails,
  TaskNotifyDepartmentToggle,
  TaskPrioritySelect,
  type TaskAssigneeOption,
  type TaskDepartmentOption,
} from './TaskFormFields';

const editTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(10000),
  dueAtInput: z.string(),
  priority: taskPrioritySchema,
});

type EditTaskValues = z.infer<typeof editTaskSchema>;

export function TaskEditFormSection({ task, onReload }: { task: TaskDto; onReload: () => void }) {
  const tTasks = useTranslations('tasks');
  const baseId = useId();
  const updateMutation = useUpdateTaskMutation();
  const initialPrio = task.priority >= 1 && task.priority <= 4 ? (task.priority as 1 | 2 | 3 | 4) : 2;
  const { register, control, setValue, handleSubmit, formState: { errors } } =
    useForm<EditTaskValues>({
      resolver: zodResolver(editTaskSchema),
      defaultValues: {
        title: task.title,
        description: task.description ?? '',
        dueAtInput: utcIsoToHoChiMinhInput(task.dueAt),
        priority: initialPrio,
      },
    });
  const priority = useWatch({ control, name: 'priority' });
  const dueAtInput = useWatch({ control, name: 'dueAtInput' });

  const handleSave = (values: EditTaskValues) => {
    updateMutation.mutate(
      {
        id: task.id,
        payload: {
          title: values.title.trim(),
          description: values.description.trim() || null,
          dueAt: hoChiMinhInputToUtcIso(values.dueAtInput),
          priority: values.priority,
          version: task.version,
        },
      },
      { onSuccess: () => toast.success(tTasks('updatedToast')) }
    );
  };

  return (
    <form className="task-edit-form" method="post" onSubmit={handleSubmit(handleSave)} noValidate>
      <TaskErrorBanner error={updateMutation.error} onReloadConflict={onReload} />
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-title`}>{tTasks('titleLabel')}</label>
        <input id={`${baseId}-title`} className="ui-input" type="text" aria-invalid={Boolean(errors.title)} {...register('title')} />
        {errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationTitle')}</p> : null}
      </div>
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-desc`}>{tTasks('descriptionLabel')}</label>
        <textarea id={`${baseId}-desc`} className="ui-textarea" rows={4} {...register('description')} />
      </div>
      <div className="task-form-two-col">
        <TaskPrioritySelect value={priority} onChange={(next) => setValue('priority', next)} />
        <TaskDueDateInput value={dueAtInput} onChange={(next) => setValue('dueAtInput', next)} />
      </div>
      <div className="task-section-actions">
        <button type="submit" className="ui-btn primary" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? tTasks('savingDetails') : tTasks('saveDetails')}
        </button>
      </div>
    </form>
  );
}

function mergeAssigneeOptions(
  activeMembers: readonly TaskAssigneeOption[],
  existingAssignees: TaskDto['assignees']
): TaskAssigneeOption[] {
  const seen = new Set(activeMembers.map((member) => member.id));
  const formerAssignees = existingAssignees.filter((assignee) => !seen.has(assignee.id));
  return [...activeMembers, ...formerAssignees];
}

function mergeDepartmentOptions(
  catalog: readonly TaskDepartmentOption[],
  assignedDepartments: TaskDto['assignedDepartments']
): TaskDepartmentOption[] {
  const seen = new Set(catalog.map((dept) => dept.id));
  const missing = assignedDepartments.filter((dept) => !seen.has(dept.id));
  return [...catalog, ...missing];
}

function toggleId(prev: string[], id: string): string[] {
  return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
}

function useTaskAssigneesController(task: TaskDto) {
  const tTasks = useTranslations('tasks');
  const { can } = usePermissions();
  const canViewMembers = can('member.view');
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>(() =>
    task.assignedDepartments.map((dept) => dept.id)
  );
  const [notifyDepartmentMembers, setNotifyDepartmentMembers] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => task.assignees.map((a) => a.id));
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const membersQuery = useTaskAssigneeMembersQuery(canViewMembers);
  const assigneesMutation = useReplaceTaskAssigneesMutation();

  const handleSaveAssignees = () => {
    assigneesMutation.mutate(
      {
        id: task.id,
        payload: {
          departmentIds: selectedDeptIds,
          ...(canViewMembers ? { assigneeIds: selectedIds } : {}),
          notifyDepartmentMembers,
          version: task.version,
        },
      },
      { onSuccess: () => toast.success(tTasks('departmentsUpdatedToast')) }
    );
  };

  return {
    canViewMembers,
    selectedDeptIds,
    toggleDept: (id: string) => setSelectedDeptIds((prev) => toggleId(prev, id)),
    notifyDepartmentMembers,
    setNotifyDepartmentMembers,
    selectedIds,
    toggleMember: (id: string) => setSelectedIds((prev) => toggleId(prev, id)),
    pickerDepartments: mergeDepartmentOptions(departmentsQuery.data?.items ?? [], task.assignedDepartments),
    pickerMembers: mergeAssigneeOptions(membersQuery.data?.items ?? [], task.assignees),
    assigneesMutation,
    handleSaveAssignees,
  };
}

export function TaskAssigneesSection({ task, onReload }: { task: TaskDto; onReload: () => void }) {
  const tTasks = useTranslations('tasks');
  const ctrl = useTaskAssigneesController(task);

  return (
    <section className="task-drawer-section">
      <h3 className="task-section-title">{tTasks('departmentsLabel')}</h3>
      <p className="ui-field-hint">{tTasks('departmentsHint')}</p>
      <TaskErrorBanner error={ctrl.assigneesMutation.error} onReloadConflict={onReload} />
      <TaskDepartmentPicker
        departments={ctrl.pickerDepartments}
        selectedIds={ctrl.selectedDeptIds}
        disabled={ctrl.assigneesMutation.isPending}
        onToggle={ctrl.toggleDept}
      />
      <TaskNotifyDepartmentToggle
        checked={ctrl.notifyDepartmentMembers}
        disabled={ctrl.assigneesMutation.isPending}
        onChange={ctrl.setNotifyDepartmentMembers}
      />
      <TaskIndividualAssigneesDetails
        members={ctrl.pickerMembers}
        canViewMembers={ctrl.canViewMembers}
        selectedIds={ctrl.selectedIds}
        disabled={ctrl.assigneesMutation.isPending}
        onToggle={ctrl.toggleMember}
      />
      <div className="task-section-actions">
        <button type="button" className="ui-btn ghost is-sm" disabled={ctrl.assigneesMutation.isPending} onClick={ctrl.handleSaveAssignees}>
          {ctrl.assigneesMutation.isPending ? tTasks('savingAssignees') : tTasks('departmentsSaveButton')}
        </button>
      </div>
    </section>
  );
}

export function TaskDeleteSection({ task, onDeleted }: { task: TaskDto; onDeleted: () => void }) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const deleteMutation = useDeleteTaskMutation();

  const handleConfirm = () => {
    deleteMutation.mutate(task.id, {
      onSuccess: () => { toast.success(tTasks('deletedToast')); onDeleted(); },
    });
  };

  return (
    <section className="task-drawer-section task-danger-zone">
      <TaskErrorBanner error={deleteMutation.error} />
      {confirming ? (
        <div className="task-delete-confirm">
          <strong>{tTasks('deleteConfirmTitle')}</strong>
          <p className="ui-field-hint">{tTasks('deleteConfirmBody', { name: task.title })}</p>
          <div className="task-section-actions">
            <button type="button" className="ui-btn ghost is-sm" onClick={() => setConfirming(false)} disabled={deleteMutation.isPending}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="ui-btn danger is-sm" onClick={handleConfirm} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? tTasks('deleting') : tTasks('deleteConfirmSubmit')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ui-btn danger is-sm" onClick={() => setConfirming(true)}>
          {tTasks('deleteTask')}
        </button>
      )}
    </section>
  );
}
