'use client';

import type { ReactNode } from 'react';

export interface TaskToggleCardProps {
  readonly id?: string;
  readonly checked: boolean;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onToggle: (next: boolean) => void;
}

export function TaskToggleCard({
  id,
  checked,
  label,
  icon,
  disabled = false,
  className = '',
  onToggle,
}: TaskToggleCardProps) {
  const classes = ['task-toggle-card'];
  if (checked) classes.push('is-checked');
  if (disabled) classes.push('is-disabled');
  if (className) classes.push(className);

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={classes.join(' ')}
      onClick={() => onToggle(!checked)}
    >
      <span className="task-toggle-card-main">
        {icon ? <span className="task-toggle-card-icon" aria-hidden="true">{icon}</span> : null}
        <span className="task-toggle-card-label">{label}</span>
      </span>
      <span className="task-toggle-pill" aria-hidden="true">
        <span className="task-toggle-thumb" />
      </span>
    </button>
  );
}
