'use client';

import { useState, type InputHTMLAttributes, type Ref } from 'react';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  ref?: Ref<HTMLInputElement>;
  hasError?: boolean;
  errorClassName?: string;
  showLabel: string;
  hideLabel: string;
  visible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        className="ic"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <path d="M1 1l22 22" />
      </svg>
    );
  }
  return (
    <svg
      className="ic"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PasswordInput({
  ref,
  className,
  hasError = false,
  errorClassName = 'has-error',
  showLabel,
  hideLabel,
  visible,
  onVisibilityChange,
  disabled,
  id,
  ...rest
}: PasswordInputProps) {
  const [internalVisible, setInternalVisible] = useState(false);
  const isControlled = visible !== undefined;
  const isVisible = isControlled ? visible : internalVisible;

  const handleToggle = () => {
    const next = !isVisible;
    if (isControlled) {
      onVisibilityChange?.(next);
      return;
    }
    setInternalVisible(next);
  };

  const resolvedClassName = [
    className ?? 'ui-input',
    'password-input',
    hasError ? errorClassName : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="password-input-wrap">
      <input
        {...rest}
        ref={ref}
        id={id}
        type={isVisible ? 'text' : 'password'}
        className={resolvedClassName}
        aria-invalid={hasError || rest['aria-invalid']}
        disabled={disabled}
      />
      <button
        type="button"
        className="password-toggle-btn"
        aria-label={isVisible ? hideLabel : showLabel}
        aria-pressed={isVisible}
        aria-controls={id}
        disabled={disabled}
        onClick={handleToggle}
      >
        <EyeIcon open={isVisible} />
      </button>
    </div>
  );
}
