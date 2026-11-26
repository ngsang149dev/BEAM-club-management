'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TaskPriority } from '@/lib/tasks';
import {
  REMINDER_GROUP_MSG_KEYS,
  formatPreviewDate,
  formatPreviewShortDate,
  formatVnSendHour,
  type ReminderPreviewGroup,
  type ReminderPreviewTaskItem,
} from '../preview-helpers';

export type EmailTranslator = ReturnType<typeof useTranslations<'reminders.emailContent.vi'>>;

export function PreviewPriorityPill({
  priority,
  tEmail,
}: {
  readonly priority: TaskPriority;
  readonly tEmail: EmailTranslator;
}) {
  const key = `prio${priority}` as const;
  return (
    <span className={`ui-prio p${priority}`}>
      <span className="ui-prio-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= priority ? 'on' : undefined} />
        ))}
      </span>
      <span>{tEmail(key)}</span>
    </span>
  );
}

export function PreviewDuePill({
  item,
  previewLocale,
  tEmail,
}: {
  readonly item: ReminderPreviewTaskItem;
  readonly previewLocale: 'vi' | 'en';
  readonly tEmail: EmailTranslator;
}) {
  if (item.dayDiff < 0) {
    return (
      <span className="ui-due is-overdue">
        <span className="ui-due-dot" aria-hidden="true" />
        <span>{tEmail('dueOverdueDays', { days: Math.abs(item.dayDiff) })}</span>
      </span>
    );
  }
  if (item.dayDiff === 0) {
    return (
      <span className="ui-due is-today">
        <span className="ui-due-dot" aria-hidden="true" />
        <span>{tEmail('dueToday')}</span>
      </span>
    );
  }
  const toneClass = item.dayDiff <= 2 ? 'is-soon' : 'is-upcoming';
  const label = `${tEmail('dueInDays', { days: item.dayDiff })} · ${formatPreviewShortDate(item.dueAt, previewLocale)}`;
  return <span className={`ui-due ${toneClass}`}>{label}</span>;
}

export function PreviewTaskRow({
  item,
  previewLocale,
  tEmail,
}: {
  readonly item: ReminderPreviewTaskItem;
  readonly previewLocale: 'vi' | 'en';
  readonly tEmail: EmailTranslator;
}) {
  const title = item.isHidden ? tEmail('hiddenTaskTitle') : (item.title ?? tEmail('hiddenTaskTitle'));
  const subtitle = item.isHidden
    ? tEmail('hiddenTaskSub')
    : item.departmentNames.length > 0
      ? item.departmentNames.join(', ')
      : tEmail('openTaskSub');

  return (
    <div className="rem-email-task">
      <span className="rem-email-task-prio"><PreviewPriorityPill priority={item.priority} tEmail={tEmail} /></span>
      <span className="rem-email-task-main"><b>{title}</b><span>{subtitle}</span></span>
      <span className="rem-email-task-due"><PreviewDuePill item={item} previewLocale={previewLocale} tEmail={tEmail} /></span>
    </div>
  );
}

export function PreviewHeader({
  previewLocale,
  showSample,
  onSelectLocale,
  onToggleSample,
}: {
  readonly previewLocale: 'vi' | 'en';
  readonly showSample: boolean;
  readonly onSelectLocale: (locale: 'vi' | 'en') => void;
  readonly onToggleSample: () => void;
}) {
  const t = useTranslations('reminders');
  return (
    <div className="rem-preview-head">
      <h2>{t('previewHeading')}</h2>
      <div className="rem-preview-controls">
        <button type="button" className="ui-btn ghost is-sm" aria-pressed={showSample} onClick={onToggleSample}>
          {showSample ? t('previewSampleToggleOff') : t('previewSampleToggleOn')}
        </button>
        <div className="lang-switch" role="group" aria-label={t('previewLangAria')}>
          <button type="button" className="lang-switch-btn" aria-pressed={previewLocale === 'vi'} onClick={() => onSelectLocale('vi')}>VI</button>
          <button type="button" className="lang-switch-btn" aria-pressed={previewLocale === 'en'} onClick={() => onSelectLocale('en')}>EN</button>
        </div>
      </div>
    </div>
  );
}

export function PreviewEmailEmptyOrError({
  isLoadingTasks,
  isTasksError,
  tEmail,
  onRetryTasks,
  onEnableSample,
}: {
  readonly isLoadingTasks: boolean;
  readonly isTasksError: boolean;
  readonly tEmail: EmailTranslator;
  readonly onRetryTasks: () => void;
  readonly onEnableSample: () => void;
}) {
  const t = useTranslations('reminders');
  const tCommon = useTranslations('common');

  if (isLoadingTasks) return <p className="rem-email-state">{t('previewLoading')}</p>;
  if (isTasksError) {
    return (
      <div className="rem-email-empty">
        <p className="rem-email-state">{t('previewTasksError')}</p>
        <div className="rem-email-empty-actions">
          <button type="button" className="ui-btn is-sm" onClick={onRetryTasks}>{tCommon('retry')}</button>
          <button type="button" className="ui-btn ghost is-sm" onClick={onEnableSample}>{t('previewSampleToggleOn')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="rem-email-empty">
      <b>{tEmail('emptyTitle')}</b>
      <p>{tEmail('emptyBody')}</p>
      <button type="button" className="ui-btn is-sm" onClick={onEnableSample}>{t('previewSampleToggleOn')}</button>
    </div>
  );
}

export function PreviewEmailTasksContent({
  groups,
  recipientName,
  previewLocale,
  tEmail,
}: {
  readonly groups: readonly ReminderPreviewGroup[];
  readonly recipientName: string;
  readonly previewLocale: 'vi' | 'en';
  readonly tEmail: EmailTranslator;
}) {
  const greetingName = recipientName.trim() || tEmail('defaultName');
  return (
    <>
      <p className="rem-email-hello">{tEmail('hello', { name: greetingName })}</p>
      <p className="rem-email-lead">{tEmail('lead')}</p>
      {groups.map((group) => (
        <section key={group.key} className="rem-email-group">
          <h3 className={group.key === 'overdue' ? 'is-overdue' : undefined}>{tEmail(REMINDER_GROUP_MSG_KEYS[group.key])}</h3>
          {group.items.map((item) => (
            <PreviewTaskRow key={item.id} item={item} previewLocale={previewLocale} tEmail={tEmail} />
          ))}
        </section>
      ))}
      <Link href="/my-tasks" className="ui-btn primary is-sm rem-email-cta">{tEmail('cta')}</Link>
      <p className="rem-email-foot">{tEmail('foot')}</p>
    </>
  );
}

export function PreviewEmailCard({
  showSample,
  sendHourVn,
  referenceMs,
  previewLocale,
  tEmail,
  body,
}: {
  readonly showSample: boolean;
  readonly sendHourVn: number;
  readonly referenceMs: number;
  readonly previewLocale: 'vi' | 'en';
  readonly tEmail: EmailTranslator;
  readonly body: ReactNode;
}) {
  return (
    <div className="rem-email-frame">
      <article className="rem-email" data-component="ReminderEmail">
        <div className="rem-email-top">
          <span className="rem-email-brand"><b>BEAM</b><span>{tEmail('workspace')}</span></span>
          <span className="rem-email-badges">
            {showSample ? <span className="ui-chip rem-sample-chip">{tEmail('sampleBadge')}</span> : null}
            <span className="rem-email-lang">{tEmail('langCode')}</span>
          </span>
        </div>
        <div className="rem-email-subject">
          <span className="rem-email-kicker">{tEmail('kicker')}</span>
          <h3>{tEmail('subject')}</h3>
          <p>{tEmail('sentAt', { time: formatVnSendHour(sendHourVn), date: formatPreviewDate(referenceMs, previewLocale) })}</p>
        </div>
        <div className="rem-email-body">{body}</div>
      </article>
    </div>
  );
}
