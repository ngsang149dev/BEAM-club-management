'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { describeTaskError } from '../error-mapping';

export interface TaskAssigneeOption {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
}

export interface TaskDepartmentOption {
  readonly id: string;
  readonly name: string;
}

export function TaskErrorBanner({
  error,
  onReloadConflict,
}: {
  error: unknown;
  onReloadConflict?: () => void;
}) {
  const tErr = useTranslations('errors');
  const tTasks = useTranslations('tasks');
  const descriptor = describeTaskError(error);
  if (!descriptor) return null;

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{tErr(descriptor.key)}</span>
        {descriptor.requestId ? (
          <span className="ui-banner-meta">
            {tErr('requestIdLabel')}: {descriptor.requestId}
          </span>
        ) : null}
        {descriptor.key === 'taskVersionConflict' && onReloadConflict ? (
          <div className="task-conflict-actions">
            <button type="button" className="ui-btn ghost is-sm" onClick={onReloadConflict}>
              {tTasks('versionConflictReload')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TaskDateField({
  label,
  clearLabel,
  value,
  disabled = false,
  errorText,
  onChange,
}: {
  readonly label: string;
  readonly clearLabel: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly errorText?: string | null;
  readonly onChange: (next: string) => void;
}) {
  const id = useId();
  return (
    <div className="ui-field">
      <div className="ui-field-label-row">
        <label className="ui-label" htmlFor={id}>{label}</label>
        {value && !disabled ? (
          <button type="button" className="task-due-clear-btn" onClick={() => onChange('')}>
            {clearLabel}
          </button>
        ) : null}
      </div>
      <input
        id={id}
        className="ui-input"
        type="date"
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(errorText)}
        onChange={(e) => onChange(e.target.value)}
      />
      {errorText ? <p className="ui-field-error" role="alert">{errorText}</p> : null}
    </div>
  );
}

export function TaskStartDateInput({
  value,
  disabled = false,
  onChange,
}: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (next: string) => void;
}) {
  const tTasks = useTranslations('tasks');
  return (
    <TaskDateField
      label={tTasks('startAtLabel')}
      clearLabel={tTasks('clearStartAt')}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function TaskDueDateInput({
  value,
  disabled = false,
  errorText,
  onChange,
}: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly errorText?: string | null;
  readonly onChange: (next: string) => void;
}) {
  const tTasks = useTranslations('tasks');
  return (
    <TaskDateField
      label={tTasks('dueAtLabel')}
      clearLabel={tTasks('clearDueAt')}
      value={value}
      disabled={disabled}
      errorText={errorText}
      onChange={onChange}
    />
  );
}

export function TaskDepartmentPicker({
  departments,
  selectedIds,
  disabled = false,
  onToggle,
}: {
  departments: readonly TaskDepartmentOption[];
  selectedIds: readonly string[];
  disabled?: boolean;
  onToggle: (departmentId: string) => void;
}) {
  const tTasks = useTranslations('tasks');

  if (departments.length === 0) {
    return <p className="ui-field-hint">{tTasks('departmentsCatalogEmpty')}</p>;
  }

  return (
    <div className="dept-checkbox-grid">
      {departments.map((dept) => {
        const checked = selectedIds.includes(dept.id);
        return (
          <label key={dept.id} className={checked ? 'dept-check-item is-checked' : 'dept-check-item'}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(dept.id)}
            />
            <span>{dept.name}</span>
          </label>
        );
      })}
    </div>
  );
}

export function TaskAssigneePicker({
  members,
  canViewMembers,
  selectedIds,
  disabled = false,
  onToggle,
}: {
  members: readonly TaskAssigneeOption[];
  canViewMembers: boolean;
  selectedIds: readonly string[];
  disabled?: boolean;
  onToggle: (userId: string) => void;
}) {
  const tTasks = useTranslations('tasks');
  const tMember = useTranslations('member');

  if (!canViewMembers) {
    return <p className="ui-field-hint">{tTasks('assigneesRestrictedNote')}</p>;
  }
  if (members.length === 0) {
    return <p className="ui-field-hint">{tTasks('assigneesEmpty')}</p>;
  }

  return (
    <div className="dept-checkbox-grid">
      {members.map((member) => {
        const checked = selectedIds.includes(member.id);
        return (
          <label key={member.id} className={checked ? 'dept-check-item is-checked' : 'dept-check-item'}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(member.id)}
            />
            <span>
              {member.fullName}
              {!member.isActive ? ` ${tMember('leftBadge')}` : ''}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function TaskIndividualAssigneesDetails({
  members,
  canViewMembers,
  selectedIds,
  disabled = false,
  onToggle,
}: {
  members: readonly TaskAssigneeOption[];
  canViewMembers: boolean;
  selectedIds: readonly string[];
  disabled?: boolean;
  onToggle: (userId: string) => void;
}) {
  const tTasks = useTranslations('tasks');

  return (
    <details className="task-individual-details">
      <summary className="task-individual-summary">
        <span>{tTasks('individualAssigneesSummary')}</span>
        {selectedIds.length > 0 ? <span className="ui-chip">{selectedIds.length}</span> : null}
      </summary>
      <div className="task-individual-body">
        <TaskAssigneePicker
          members={members}
          canViewMembers={canViewMembers}
          selectedIds={selectedIds}
          disabled={disabled}
          onToggle={onToggle}
        />
      </div>
    </details>
  );
}
