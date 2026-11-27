'use client';

import { useTranslations } from 'next-intl';
import { TaskToggleCard } from './TaskToggleCard';

export interface TaskNotificationOptionsProps {
  readonly notifyInApp: boolean;
  readonly onToggleNotifyInApp: (checked: boolean) => void;
  readonly notifyEmail: boolean;
  readonly onToggleNotifyEmail: (checked: boolean) => void;
  readonly disabled?: boolean;
}

export function NotificationBellOptionIcon() {
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

export function NotificationEmailOptionIcon() {
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
        <TaskToggleCard
          className="task-notify-option"
          checked={notifyInApp}
          disabled={disabled}
          label={tTasks('notifyInAppLabel')}
          icon={<NotificationBellOptionIcon />}
          onToggle={onToggleNotifyInApp}
        />
        <TaskToggleCard
          className="task-notify-option"
          checked={notifyEmail}
          disabled={disabled}
          label={tTasks('notifyEmailLabel')}
          icon={<NotificationEmailOptionIcon />}
          onToggle={onToggleNotifyEmail}
        />
      </div>
    </div>
  );
}
