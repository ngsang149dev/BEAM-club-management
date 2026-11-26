'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { useMeQuery } from '@/features/auth/hooks/useAuth';
import { usePermissions } from '@/features/shared/permissions/can';
import { formatTaskDateTime } from '@/features/tasks/formatters';
import {
  describeReminderError,
  useReminderPreviewTasksQuery,
  useReminderSettingsQuery,
  useUpdateReminderSettingsMutation,
  type ReminderSettingsDto,
  type UpdateReminderSettingsRequest,
} from '../hooks/useReminderSettings';
import {
  MAX_MILESTONE_COUNT,
  addMilestoneDay,
  areReminderDraftsEqual,
  normalizeDaysBefore,
  removeMilestoneDay,
  restoreDefaultMilestones,
  toggleMilestoneDay,
  updateReminderSettingsSchema,
} from '../preview-helpers';
import { ReminderEmailPreview } from './ReminderEmailPreview';
import { ReminderMilestonesCard } from './ReminderMilestonesCard';

function formatReminderUpdatedNote(
  settings: ReminderSettingsDto,
  locale: string,
  t: ReturnType<typeof useTranslations<'reminders'>>,
  tBadge: ReturnType<typeof useTranslations<'member'>>
): string | null {
  if (!settings.updatedAt) return null;
  const updatedTime = formatTaskDateTime(settings.updatedAt, locale);
  if (!settings.updatedBy) return t('lastUpdatedLabel', { time: updatedTime });
  const updatedByName = settings.updatedBy.isActive
    ? settings.updatedBy.fullName
    : `${settings.updatedBy.fullName} ${tBadge('leftBadge')}`;
  return t('lastUpdatedByLabel', { time: updatedTime, name: updatedByName });
}

function ReminderSaveErrorBanner(props: { readonly error: unknown; readonly validationMessage?: string | null }) {
  const tErr = useTranslations('errors');
  const descriptor = describeReminderError(props.error);
  const message = props.validationMessage ?? (descriptor ? tErr(descriptor.key) : null);
  if (!message) return null;
  const requestId = !props.validationMessage ? descriptor?.requestId : undefined;

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{message}</span>
        {requestId ? <span className="ui-banner-meta">{tErr('requestIdLabel')}: {requestId}</span> : null}
      </div>
    </div>
  );
}

function ReminderSaveBar(props: {
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const t = useTranslations('reminders');
  return (
    <div className="rem-save">
      <div className="rem-save-status">{props.isDirty ? <span className="perm-unsaved-note">{t('unsavedChanges')}</span> : null}</div>
      <div className="rem-save-actions">
        <button type="button" className="ui-btn ghost" data-testid="reminders-cancel-btn" disabled={!props.isDirty || props.isSaving} onClick={props.onCancel}>{t('cancel')}</button>
        <button type="button" className="ui-btn primary" data-testid="reminders-save-btn" disabled={!props.isDirty || props.isSaving} onClick={props.onSave}>
          {props.isSaving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

function RemindersForbiddenState() {
  const t = useTranslations('reminders');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  return (
    <ErrorState
      variant="403"
      code={tErr('403.code')}
      title={t('forbiddenTitle')}
      description={t('forbiddenDescription')}
      actions={<Link href="/boards" className="ui-btn primary">{tCommon('backToBoards')}</Link>}
    />
  );
}

function RemindersLoadErrorState({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const t = useTranslations('reminders');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const descriptor = describeReminderError(error);
  const isForbidden = descriptor?.key === 'forbidden';
  return (
    <ErrorState
      variant={isForbidden ? '403' : '500'}
      code={isForbidden ? tErr('403.code') : undefined}
      title={isForbidden ? t('forbiddenTitle') : t('loadErrorTitle')}
      description={isForbidden ? t('forbiddenDescription') : tErr(descriptor?.key ?? 'unknown')}
      requestId={descriptor?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function resolveDefaultPreviewLocale(profileLocale: string | undefined, appLocale: string): 'vi' | 'en' {
  if (profileLocale === 'en' || profileLocale === 'vi') return profileLocale;
  return appLocale === 'en' ? 'en' : 'vi';
}

function validateReminderSaveDraft(
  draft: UpdateReminderSettingsRequest,
  t: ReturnType<typeof useTranslations<'reminders'>>,
  tErr: ReturnType<typeof useTranslations<'errors'>>
): { ok: true; data: UpdateReminderSettingsRequest } | { ok: false; message: string } {
  const normalized = normalizeDaysBefore(draft.daysBefore);
  const parsed = updateReminderSettingsSchema.safeParse({ daysBefore: normalized, remindOverdue: draft.remindOverdue });
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    message: normalized.length > MAX_MILESTONE_COUNT ? t('maxMilestonesError', { max: MAX_MILESTONE_COUNT }) : tErr('validation'),
  };
}

interface RemindersMainColumnProps {
  readonly settings: ReminderSettingsDto;
  readonly effectiveDraft: UpdateReminderSettingsRequest;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly saveError: unknown;
  readonly validationMessage: string | null;
  readonly onChangeDraft: (next: UpdateReminderSettingsRequest) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

function RemindersMainColumn(props: RemindersMainColumnProps) {
  const { settings, effectiveDraft, isSaving, onChangeDraft } = props;
  const locale = useLocale();
  const t = useTranslations('reminders');
  const tBadge = useTranslations('member');
  const updatedNote = formatReminderUpdatedNote(settings, locale, t, tBadge);

  return (
    <section className="rem-main">
      <ReminderMilestonesCard
        daysBefore={effectiveDraft.daysBefore}
        remindOverdue={effectiveDraft.remindOverdue}
        disabled={isSaving}
        sendHourVn={settings.sendHourVn}
        updatedNote={updatedNote}
        onToggleDay={(day) => onChangeDraft({ ...effectiveDraft, daysBefore: toggleMilestoneDay(effectiveDraft.daysBefore, day) })}
        onAddDay={(day) => onChangeDraft({ ...effectiveDraft, daysBefore: addMilestoneDay(effectiveDraft.daysBefore, day) })}
        onRemoveDay={(day) => onChangeDraft({ ...effectiveDraft, daysBefore: removeMilestoneDay(effectiveDraft.daysBefore, day) })}
        onToggleOverdue={(next) => onChangeDraft({ ...effectiveDraft, remindOverdue: next })}
        onRestoreDefaults={() => onChangeDraft(restoreDefaultMilestones())}
      />
      <ReminderSaveErrorBanner error={props.saveError} validationMessage={props.validationMessage} />
      <ReminderSaveBar isDirty={props.isDirty} isSaving={isSaving} onCancel={props.onCancel} onSave={props.onSave} />
    </section>
  );
}

function RemindersLoadedLayout(props: {
  readonly settings: ReminderSettingsDto;
  readonly recipientName: string;
  readonly defaultPreviewLocale: 'vi' | 'en';
  readonly tasksQuery: ReturnType<typeof useReminderPreviewTasksQuery>;
}) {
  const { settings, tasksQuery } = props;
  const t = useTranslations('reminders');
  const tErr = useTranslations('errors');
  const updateMutation = useUpdateReminderSettingsMutation();
  const [draft, setDraft] = useState<UpdateReminderSettingsRequest | null>(null);
  const [validationErrorMessage, setValidationErrorMessage] = useState<string | null>(null);

  const serverConfig: UpdateReminderSettingsRequest = {
    daysBefore: normalizeDaysBefore(settings.daysBefore),
    remindOverdue: settings.remindOverdue,
  };
  const effectiveDraft = draft ?? serverConfig;
  const handleSave = () => {
    const checked = validateReminderSaveDraft(effectiveDraft, t, tErr);
    if (!checked.ok) { setValidationErrorMessage(checked.message); return; }
    setValidationErrorMessage(null);
    updateMutation.mutate(checked.data, {
      onSuccess: () => { setValidationErrorMessage(null); setDraft(null); toast.success(t('savedToast')); },
    });
  };

  return (
    <div className="rem-layout">
      <RemindersMainColumn
        settings={settings}
        effectiveDraft={effectiveDraft}
        isDirty={!areReminderDraftsEqual(effectiveDraft, serverConfig)}
        isSaving={updateMutation.isPending}
        saveError={updateMutation.error}
        validationMessage={validationErrorMessage}
        onChangeDraft={(next) => { setValidationErrorMessage(null); setDraft(next); }}
        onCancel={() => { updateMutation.reset(); setValidationErrorMessage(null); setDraft(null); }}
        onSave={handleSave}
      />
      <ReminderEmailPreview
        recipientName={props.recipientName}
        defaultLocale={props.defaultPreviewLocale}
        sendHourVn={settings.sendHourVn}
        daysBefore={effectiveDraft.daysBefore}
        remindOverdue={effectiveDraft.remindOverdue}
        tasks={tasksQuery.data?.items ?? []}
        isLoadingTasks={tasksQuery.isPending}
        isTasksError={tasksQuery.isError}
        onRetryTasks={() => void tasksQuery.refetch()}
      />
    </div>
  );
}

export function RemindersAdminView() {
  const appLocale = useLocale();
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const canConfigure = can('reminder.configure');

  const settingsQuery = useReminderSettingsQuery(canConfigure);
  const meQuery = useMeQuery(canConfigure);
  const tasksQuery = useReminderPreviewTasksQuery(canConfigure);

  if (!canConfigure) return <RemindersForbiddenState />;
  if (settingsQuery.isPending) return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  if (settingsQuery.isError || !settingsQuery.data?.settings) {
    return <RemindersLoadErrorState error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />;
  }

  return (
    <RemindersLoadedLayout
      settings={settingsQuery.data.settings}
      recipientName={meQuery.data?.profile.fullName ?? ''}
      defaultPreviewLocale={resolveDefaultPreviewLocale(meQuery.data?.profile.locale, appLocale)}
      tasksQuery={tasksQuery}
    />
  );
}
