'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { buildReminderEmailPreviewData, buildSampleReminderTasks } from '../preview-helpers';
import {
  PreviewEmailCard,
  PreviewEmailEmptyState,
  PreviewEmailTasksContent,
  PreviewHeader,
  type EmailTranslator,
} from './ReminderEmailPreviewParts';

export interface ReminderEmailPreviewProps {
  readonly recipientName: string;
  readonly sendHourVn: number;
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
  readonly nowMs?: number;
}

function readSampleLabels(tEmail: EmailTranslator) {
  return {
    overdueTitle: tEmail('sampleTaskOverdue'),
    overdueDept: tEmail('sampleTaskOverdueDept'),
    todayTitle: tEmail('sampleTaskToday'),
    todayDept: tEmail('sampleTaskTodayDept'),
    soonTitle: tEmail('sampleTaskSoon'),
    soonDept: tEmail('sampleTaskSoonDept'),
    laterTitle: tEmail('sampleTaskLater'),
    laterDept: tEmail('sampleTaskLaterDept'),
  };
}

export function ReminderEmailPreview(props: ReminderEmailPreviewProps) {
  const t = useTranslations('reminders');
  const locale = useLocale();
  const [initialNowMs] = useState(() => Date.now());

  const previewLocale: 'vi' | 'en' = locale === 'en' ? 'en' : 'vi';
  const tEmail = useTranslations(previewLocale === 'en' ? 'reminders.emailContent.en' : 'reminders.emailContent.vi');
  const referenceMs = props.nowMs ?? initialNowMs;
  const sampleTasks = buildSampleReminderTasks(readSampleLabels(tEmail), props.daysBefore, referenceMs);
  const preview = buildReminderEmailPreviewData({
    tasks: sampleTasks,
    daysBefore: props.daysBefore,
    remindOverdue: props.remindOverdue,
    nowMs: referenceMs,
  });

  return (
    <aside className="admin-card rem-side" aria-label={t('previewHeading')}>
      <PreviewHeader />
      <PreviewEmailCard
        sendHourVn={props.sendHourVn}
        referenceMs={referenceMs}
        previewLocale={previewLocale}
        tEmail={tEmail}
        body={
          preview.groups.length === 0 ? (
            <PreviewEmailEmptyState tEmail={tEmail} />
          ) : (
            <PreviewEmailTasksContent
              groups={preview.groups}
              recipientName={props.recipientName}
              previewLocale={previewLocale}
              tEmail={tEmail}
            />
          )
        }
      />
    </aside>
  );
}
