'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  REMINDER_GROUP_MSG_KEYS,
  formatPreviewDate,
  formatPreviewShortDate,
  formatVnSendHour,
  type ReminderPreviewGroup,
  type ReminderPreviewTaskItem,
} from '../preview-helpers';

export type EmailTranslator = ReturnType<typeof useTranslations<'reminders.emailContent.vi'>>;

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
      <span className="rem-email-task-main"><b>{title}</b><span>{subtitle}</span></span>
      <span className="rem-email-task-due"><PreviewDuePill item={item} previewLocale={previewLocale} tEmail={tEmail} /></span>
    </div>
  );
}

export function PreviewHeader() {
  const t = useTranslations('reminders');
  return (
    <div className="rem-preview-head">
      <div className="rem-preview-title">
        <h2>{t('previewHeading')}</h2>
      </div>
    </div>
  );
}

export function PreviewEmailEmptyState({ tEmail }: { readonly tEmail: EmailTranslator }) {
  return (
    <div className="rem-email-empty">
      <b>{tEmail('emptyTitle')}</b>
      <p>{tEmail('emptyBody')}</p>
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
      <Link href="/progress" className="ui-btn primary is-sm rem-email-cta">{tEmail('cta')}</Link>
    </>
  );
}

export function PreviewEmailCard({
  sendHourVn,
  referenceMs,
  previewLocale,
  tEmail,
  body,
}: {
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
        </div>
        <div className="rem-email-subject">
          <h3>{tEmail('subject')}</h3>
          <p>{tEmail('sentAt', { time: formatVnSendHour(sendHourVn), date: formatPreviewDate(referenceMs, previewLocale) })}</p>
        </div>
        <div className="rem-email-body">{body}</div>
      </article>
    </div>
  );
}
