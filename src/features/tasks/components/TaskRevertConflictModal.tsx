'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import { resolveConflictFieldLabel } from '../event-formatters';
import { resolveTaskEventErrorDescriptor, type TaskEventDto } from '../hooks/useTaskEvents';

export interface RevertConflictState {
  readonly event: TaskEventDto;
  readonly conflictingFields: readonly string[];
}

export function TaskEventErrorBanner({ error }: { readonly error: unknown }) {
  const tErr = useTranslations('errors');
  const descriptor = resolveTaskEventErrorDescriptor(error);
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
      </div>
    </div>
  );
}

function ConflictFieldsBox({ fields }: { readonly fields: readonly string[] }) {
  const tHistory = useTranslations('taskHistory');
  if (fields.length === 0) return null;

  return (
    <div className="task-conflict-fields-box">
      <strong className="task-section-title">{tHistory('conflictFieldsLabel')}</strong>
      <ul className="task-conflict-field-list">
        {fields.map((field) => (
          <li key={field} className="ui-chip task-conflict-field-chip">
            {resolveConflictFieldLabel(field, tHistory)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TaskRevertConflictModal({
  conflict,
  isPending,
  error,
  onClose,
  onConfirmForce,
}: {
  readonly conflict: RevertConflictState | null;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly onClose: () => void;
  readonly onConfirmForce: () => void;
}) {
  const tHistory = useTranslations('taskHistory');
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(Boolean(conflict), onClose);

  if (!conflict) return null;

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{tHistory('conflictModalTitle')}</h2>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={tCommon('close')}
            onClick={onClose}
            disabled={isPending}
          >
            ✕
          </button>
        </div>
        <div className="ui-modal-body">
          <TaskEventErrorBanner error={error} />
          <p className="ui-modal-copy">{tHistory('conflictModalBody')}</p>
          <ConflictFieldsBox fields={conflict.conflictingFields} />
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isPending}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="ui-btn primary" onClick={onConfirmForce} disabled={isPending}>
              {isPending ? tHistory('reverting') : tHistory('conflictConfirmForce')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
