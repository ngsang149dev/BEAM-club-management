'use client';

import { useTranslations } from 'next-intl';

export interface TaskNotificationOptionsProps {
  readonly notifyInApp: boolean;
  readonly onToggleNotifyInApp: (checked: boolean) => void;
  readonly notifyEmail: boolean;
  readonly onToggleNotifyEmail: (checked: boolean) => void;
  readonly disabled?: boolean;
}

function NotificationBellOptionIcon() {
  return (
    <svg
      className="ic task-notify-option-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

function NotificationEmailOptionIcon() {
  return (
    <svg
      className="ic task-notify-option-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function TaskNotificationOptions({
  notifyInApp,
  onToggleNotifyInApp,
  notifyEmail,
  onToggleNotifyEmail,
  disabled = false,
}: TaskNotificationOptionsProps) {
  const tTasks = useTranslations('tasks');

  return (
    <div className="task-notify-card">
      <h4 className="task-notify-title">{tTasks('notifySectionTitle')}</h4>
      <div className="task-notify-options">
        <label className={`task-notify-option${notifyInApp ? ' is-checked' : ''}`}>
          <input
            type="checkbox"
            checked={notifyInApp}
            disabled={disabled}
            onChange={(event) => onToggleNotifyInApp(event.target.checked)}
          />
          <NotificationBellOptionIcon />
          <span>{tTasks('notifyInAppLabel')}</span>
        </label>
        <label className={`task-notify-option${notifyEmail ? ' is-checked' : ''}`}>
          <input
            type="checkbox"
            checked={notifyEmail}
            disabled={disabled}
            onChange={(event) => onToggleNotifyEmail(event.target.checked)}
          />
          <NotificationEmailOptionIcon />
          <span>{tTasks('notifyEmailLabel')}</span>
        </label>
      </div>
    </div>
  );
}
