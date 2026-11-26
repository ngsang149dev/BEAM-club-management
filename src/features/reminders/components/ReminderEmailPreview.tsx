'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@/features/shared/api/client';
import { buildReminderEmailPreviewData, buildSampleReminderGroups } from '../preview-helpers';
import {
  PreviewEmailCard,
  PreviewEmailEmptyOrError,
  PreviewEmailTasksContent,
  PreviewHeader,
  type EmailTranslator,
} from './ReminderEmailPreviewParts';

type TaskDto = components['schemas']['TaskDto'];

export interface ReminderEmailPreviewProps {
  readonly recipientName: string;
  readonly defaultLocale: 'vi' | 'en';
  readonly sendHourVn: number;
  readonly daysBefore: readonly number[];
  readonly remindOverdue: boolean;
  readonly tasks: readonly TaskDto[];
  readonly isLoadingTasks: boolean;
  readonly isTasksError: boolean;
  readonly onRetryTasks: () => void;
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
  const [overrideLocale, setOverrideLocale] = useState<'vi' | 'en' | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [initialNowMs] = useState(() => Date.now());

  const previewLocale: 'vi' | 'en' = overrideLocale ?? props.defaultLocale;
  const tEmail = useTranslations(previewLocale === 'en' ? 'reminders.emailContent.en' : 'reminders.emailContent.vi');
  const referenceMs = props.nowMs ?? initialNowMs;
  const realPreview = buildReminderEmailPreviewData({
    tasks: props.tasks,
    daysBefore: props.daysBefore,
    remindOverdue: props.remindOverdue,
    nowMs: referenceMs,
  });
  const groups = showSample ? buildSampleReminderGroups(readSampleLabels(tEmail), referenceMs) : realPreview.groups;
  const showEmptyOrError = !showSample && (props.isLoadingTasks || props.isTasksError || groups.length === 0);

  return (
    <aside className="admin-card rem-side" aria-label={t('previewHeading')}>
      <PreviewHeader
        previewLocale={previewLocale}
        showSample={showSample}
        onSelectLocale={setOverrideLocale}
        onToggleSample={() => setShowSample((prev) => !prev)}
      />
      {showSample ? (
        <div className="ui-banner rem-sample-banner" role="status">
          <span className="ui-banner-text">{t('previewSampleBanner')}</span>
        </div>
      ) : null}
      <PreviewEmailCard
        showSample={showSample}
        sendHourVn={props.sendHourVn}
        referenceMs={referenceMs}
        previewLocale={previewLocale}
        tEmail={tEmail}
        body={
          showEmptyOrError ? (
            <PreviewEmailEmptyOrError
              isLoadingTasks={props.isLoadingTasks}
              isTasksError={props.isTasksError}
              tEmail={tEmail}
              onRetryTasks={props.onRetryTasks}
              onEnableSample={() => setShowSample(true)}
            />
          ) : (
            <PreviewEmailTasksContent
              groups={groups}
              recipientName={props.recipientName}
              previewLocale={previewLocale}
              tEmail={tEmail}
            />
          )
        }
      />
      <p className="rem-preview-note">{t('previewPrivacyNote')}</p>
    </aside>
  );
}
