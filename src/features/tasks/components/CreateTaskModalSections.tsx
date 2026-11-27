'use client';

import { useTranslations } from 'next-intl';
import {
  TaskDepartmentPicker,
  TaskIndividualAssigneesDetails,
  type TaskAssigneeOption,
  type TaskDepartmentOption,
} from './TaskFormFields';
import { HiddenLockIcon } from './TaskHiddenSection';
import {
  NotificationBellOptionIcon,
  NotificationEmailOptionIcon,
} from './TaskNotificationOptions';
import { TaskToggleCard } from './TaskToggleCard';

export function CreateTaskAssignmentFields({
  canAssign,
  canViewMembers,
  departments,
  members,
  departmentIds,
  assigneeIds,
  disabled,
  onToggleDepartment,
  onToggleAssignee,
}: {
  readonly canAssign: boolean;
  readonly canViewMembers: boolean;
  readonly departments: readonly TaskDepartmentOption[];
  readonly members: readonly TaskAssigneeOption[];
  readonly departmentIds: readonly string[];
  readonly assigneeIds: readonly string[];
  readonly disabled: boolean;
  readonly onToggleDepartment: (id: string) => void;
  readonly onToggleAssignee: (id: string) => void;
}) {
  const tTasks = useTranslations('tasks');
  if (!canAssign) return null;

  return (
    <>
      <div className="ui-field">
        <span className="ui-label">{tTasks('departmentsLabel')}</span>
        <TaskDepartmentPicker
          departments={departments}
          selectedIds={departmentIds}
          disabled={disabled}
          onToggle={onToggleDepartment}
        />
      </div>
      <TaskIndividualAssigneesDetails
        members={members}
        canViewMembers={canViewMembers}
        selectedIds={assigneeIds}
        disabled={disabled}
        onToggle={onToggleAssignee}
      />
    </>
  );
}

function HiddenUnassignedWarning({ visible }: { readonly visible: boolean }) {
  const tTasks = useTranslations('tasks');
  if (!visible) return null;

  return (
    <div className="ui-banner is-warn" role="status">
      <div className="ui-banner-body">
        <span className="ui-banner-title">{tTasks('hiddenUnassignedWarnTitle')}</span>
        <span className="ui-banner-text">{tTasks('hiddenUnassignedWarnBody')}</span>
      </div>
    </div>
  );
}

export function CreateTaskToggleRow({
  canAssign,
  isBusy,
  notifyInApp,
  notifyEmail,
  isHidden,
  hasAnyAssignment,
  onToggleInApp,
  onToggleEmail,
  onToggleHidden,
}: {
  readonly canAssign: boolean;
  readonly isBusy: boolean;
  readonly notifyInApp: boolean;
  readonly notifyEmail: boolean;
  readonly isHidden: boolean;
  readonly hasAnyAssignment: boolean;
  readonly onToggleInApp: (next: boolean) => void;
  readonly onToggleEmail: (next: boolean) => void;
  readonly onToggleHidden: (next: boolean) => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <>
      <div className="task-create-toggles">
        {canAssign ? (
          <>
            <TaskToggleCard
              className="task-notify-option"
              checked={notifyInApp}
              disabled={isBusy}
              label={tTasks('notifyInAppLabel')}
              icon={<NotificationBellOptionIcon />}
              onToggle={onToggleInApp}
            />
            <TaskToggleCard
              className="task-notify-option"
              checked={notifyEmail}
              disabled={isBusy}
              label={tTasks('notifyEmailLabel')}
              icon={<NotificationEmailOptionIcon />}
              onToggle={onToggleEmail}
            />
          </>
        ) : null}
        <TaskToggleCard
          checked={isHidden}
          disabled={isBusy}
          label={tTasks('isHiddenShortLabel')}
          icon={<HiddenLockIcon />}
          onToggle={onToggleHidden}
        />
      </div>
      <HiddenUnassignedWarning visible={isHidden && !hasAnyAssignment} />
    </>
  );
}

export function CreateTaskModalHeader({
  titleId,
  columnName,
  onClose,
}: {
  readonly titleId: string;
  readonly columnName?: string;
  readonly onClose: () => void;
}) {
  const tTasks = useTranslations('tasks');
  const tCommon = useTranslations('common');

  return (
    <div className="ui-modal-header">
      <div>
        <h2 id={titleId} className="ui-modal-title">{tTasks('createModalTitle')}</h2>
        {columnName ? <span className="admin-card-hint">{columnName}</span> : null}
      </div>
      <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

export function CreateTaskModalActions({
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
