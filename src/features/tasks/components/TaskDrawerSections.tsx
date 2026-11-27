'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { TrashBinIcon } from '@/components/TrashIcons';
import { usePermissions } from '@/features/shared/permissions/can';
import {
  applyAssigneeSelectionToggle,
  buildReplaceTaskAssigneesPayload,
  editTaskSchema,
  hasTaskVersionChanged,
  mergeAssigneeOptions,
  mergeDepartmentOptions,
  resolveAssigneeSelection,
  toEditTaskValues,
  type AssigneeSelectionDraft,
  type EditTaskValues,
} from '../drawer-helpers';
import { hoChiMinhInputToUtcIso } from '../formatters';
import { useUndoTaskActionToast } from '../hooks/useTaskEvents';
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
  TaskStartDateInput,
} from './TaskFormFields';
import { TaskNotificationOptions } from './TaskNotificationOptions';

export { buildReplaceTaskAssigneesPayload };

function useTaskEditFormController(task: TaskDto) {
  const tTasks = useTranslations('tasks');
  const updateMutation = useUpdateTaskMutation();
  const showUndoToast = useUndoTaskActionToast();
  const form = useForm<EditTaskValues>({
    resolver: zodResolver(editTaskSchema),
    defaultValues: toEditTaskValues(task),
  });
  const { reset } = form;
  const { isError: isUpdateError, reset: resetMutation } = updateMutation;
  const syncedRef = useRef({ id: task.id, version: task.version });

  useEffect(() => {
    if (!hasTaskVersionChanged(syncedRef.current, task.id, task.version)) return;
    syncedRef.current = { id: task.id, version: task.version };
    reset(toEditTaskValues(task));
    if (isUpdateError) resetMutation();
  }, [task, reset, isUpdateError, resetMutation]);

  const handleSave = (values: EditTaskValues) => {
    updateMutation.mutate(
      {
        id: task.id,
        payload: {
          title: values.title.trim(),
          description: values.description.trim() || null,
          startAt: hoChiMinhInputToUtcIso(values.startAtInput),
          dueAt: hoChiMinhInputToUtcIso(values.dueAtInput),
          version: task.version,
        },
      },
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

  return { ...form, updateMutation, handleSave };
}

export function TaskEditFormSection({ task, onReload }: { task: TaskDto; onReload: () => void }) {
  const tTasks = useTranslations('tasks');
  const tErr = useTranslations('errors');
  const baseId = useId();
  const ctrl = useTaskEditFormController(task);
  const startAtInput = useWatch({ control: ctrl.control, name: 'startAtInput' });
  const dueAtInput = useWatch({ control: ctrl.control, name: 'dueAtInput' });
  const dateRangeError = ctrl.formState.errors.dueAtInput ? tErr('invalidDateRange') : null;

  return (
    <form className="task-edit-form" method="post" onSubmit={ctrl.handleSubmit(ctrl.handleSave)} noValidate>
      <TaskErrorBanner
        error={ctrl.updateMutation.error}
        onReloadConflict={() => {
          ctrl.updateMutation.reset();
          onReload();
        }}
      />
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-title`}>{tTasks('titleLabel')}</label>
        <input id={`${baseId}-title`} className="ui-input" type="text" aria-invalid={Boolean(ctrl.formState.errors.title)} {...ctrl.register('title')} />
        {ctrl.formState.errors.title ? <p className="ui-field-error" role="alert">{tTasks('validationTitle')}</p> : null}
      </div>
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-desc`}>{tTasks('descriptionLabel')}</label>
        <textarea id={`${baseId}-desc`} className="ui-textarea" rows={5} {...ctrl.register('description')} />
      </div>
      <div className="task-form-two-col">
        <TaskStartDateInput value={startAtInput} onChange={(next) => ctrl.setValue('startAtInput', next, { shouldValidate: true })} />
        <TaskDueDateInput value={dueAtInput} errorText={dateRangeError} onChange={(next) => ctrl.setValue('dueAtInput', next, { shouldValidate: true })} />
      </div>
      <div className="task-section-actions">
        <button type="submit" className="ui-btn primary" disabled={ctrl.updateMutation.isPending}>
          {ctrl.updateMutation.isPending ? tTasks('savingDetails') : tTasks('saveDetails')}
        </button>
      </div>
    </form>
  );
}

function useTaskAssigneesController(task: TaskDto) {
  const tTasks = useTranslations('tasks');
  const { can } = usePermissions();
  const canViewMembers = can('member.view');
  const [selectionDraft, setSelectionDraft] = useState<AssigneeSelectionDraft | null>(null);
  const [notifyInApp, setNotifyInApp] = useState<boolean>(true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(true);
  const { deptIds: selectedDeptIds, memberIds: selectedIds } = resolveAssigneeSelection(selectionDraft, task);
  const departmentsQuery = useTaskDepartmentsQuery(true);
  const membersQuery = useTaskAssigneeMembersQuery(canViewMembers);
  const assigneesMutation = useReplaceTaskAssigneesMutation();
  const { isError: isAssigneesError, reset: resetAssigneesMutation } = assigneesMutation;
  const syncedVersionRef = useRef({ id: task.id, version: task.version });
  const showUndoToast = useUndoTaskActionToast();

  useEffect(() => {
    if (!hasTaskVersionChanged(syncedVersionRef.current, task.id, task.version)) return;
    syncedVersionRef.current = { id: task.id, version: task.version };
    if (isAssigneesError) resetAssigneesMutation();
  }, [task.id, task.version, isAssigneesError, resetAssigneesMutation]);

  const toggleSelection = (kind: 'dept' | 'member', id: string) =>
    setSelectionDraft((prev) => applyAssigneeSelectionToggle(prev, task, kind, id));

  const handleSaveAssignees = () => {
    const payload = buildReplaceTaskAssigneesPayload({
      departmentIds: selectedDeptIds,
      assigneeIds: selectedIds,
      canViewMembers,
      notifyInApp,
      notifyEmail,
      version: task.version,
    });
    assigneesMutation.mutate(
      { id: task.id, payload },
      {
        onSuccess: (data) =>
          showUndoToast({
            message: tTasks('departmentsUpdatedToast'),
            taskId: data.task.id,
            boardId: data.task.boardId,
            eventId: data.eventId,
          }),
      }
    );
  };

  return {
    canViewMembers,
    selectedDeptIds,
    toggleDept: (id: string) => toggleSelection('dept', id),
    notifyInApp,
    setNotifyInApp,
    notifyEmail,
    setNotifyEmail,
    selectedIds,
    toggleMember: (id: string) => toggleSelection('member', id),
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
    <section className="task-side-card">
      <h3 className="task-section-title">{tTasks('departmentsLabel')}</h3>
      <TaskErrorBanner
        error={ctrl.assigneesMutation.error}
        onReloadConflict={() => {
          ctrl.assigneesMutation.reset();
          onReload();
        }}
      />
      <TaskDepartmentPicker
        departments={ctrl.pickerDepartments}
        selectedIds={ctrl.selectedDeptIds}
        disabled={ctrl.assigneesMutation.isPending}
        onToggle={ctrl.toggleDept}
      />
      <TaskIndividualAssigneesDetails
        members={ctrl.pickerMembers}
        canViewMembers={ctrl.canViewMembers}
        selectedIds={ctrl.selectedIds}
        disabled={ctrl.assigneesMutation.isPending}
        onToggle={ctrl.toggleMember}
      />
      <TaskNotificationOptions
        notifyInApp={ctrl.notifyInApp}
        onToggleNotifyInApp={ctrl.setNotifyInApp}
        notifyEmail={ctrl.notifyEmail}
        onToggleNotifyEmail={ctrl.setNotifyEmail}
        disabled={ctrl.assigneesMutation.isPending}
      />
      <div className="task-section-actions">
        <button type="button" className="ui-btn secondary" disabled={ctrl.assigneesMutation.isPending} onClick={ctrl.handleSaveAssignees}>
          {ctrl.assigneesMutation.isPending ? tTasks('savingAssignees') : tTasks('saveAssignments')}
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
  const showUndoToast = useUndoTaskActionToast();

  const handleConfirm = () => {
    deleteMutation.mutate(task.id, {
      onSuccess: (data) => {
        showUndoToast({
          message: tTasks('deletedToast'),
          taskId: data.task.id,
          boardId: data.task.boardId,
          eventId: data.eventId,
        });
        onDeleted();
      },
    });
  };

  return (
    <section className="task-side-card task-danger-zone">
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
              <TrashBinIcon size={14} /> <span>{deleteMutation.isPending ? tTasks('deleting') : tTasks('deleteConfirmSubmit')}</span>
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ui-btn danger task-trash-btn" onClick={() => setConfirming(true)}>
          <TrashBinIcon size={15} /> <span>{tTasks('deleteTask')}</span>
        </button>
      )}
    </section>
  );
}
