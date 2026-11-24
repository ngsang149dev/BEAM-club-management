'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  formatAuditTimestamp,
  readStringList,
  resolveAuditActionKey,
} from '../formatters';
import type { AuditLogDto, MemberPublicSummary } from '../hooks/useAuditLogs';

interface MetadataEntry {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

const KNOWN_PRESET_CODES = new Set(['basic_member', 'department_lead', 'hr_manager']);

function formatPresetValue(
  presetCode: string,
  tPerm: ReturnType<typeof useTranslations<'permissions'>>
): string {
  if (KNOWN_PRESET_CODES.has(presetCode)) {
    return tPerm(`presets.${presetCode as 'basic_member' | 'department_lead' | 'hr_manager'}`);
  }
  return presetCode;
}

function appendPermissionMetadata(
  detail: Record<string, unknown>,
  rows: MetadataEntry[],
  t: ReturnType<typeof useTranslations<'auditLogs'>>,
  tPerm: ReturnType<typeof useTranslations<'permissions'>>
): void {
  if (typeof detail.presetCode === 'string' && detail.presetCode) {
    rows.push({ label: t('detailPreset'), value: formatPresetValue(detail.presetCode, tPerm), mono: true });
  }
  const added = readStringList(detail.added);
  if (added.length > 0) rows.push({ label: t('detailAdded'), value: added.join(', '), mono: true });
  const removed = readStringList(detail.removed);
  if (removed.length > 0) rows.push({ label: t('detailRemoved'), value: removed.join(', '), mono: true });
  const codes = readStringList(detail.permissionCodes);
  if (codes.length > 0 && added.length === 0 && removed.length === 0) {
    rows.push({ label: t('detailMetadataLabel'), value: codes.join(', '), mono: true });
  }
}

function appendEntityMetadata(
  detail: Record<string, unknown>,
  rows: MetadataEntry[],
  t: ReturnType<typeof useTranslations<'auditLogs'>>
): void {
  if (typeof detail.isAdmin === 'boolean') {
    rows.push({ label: t('detailAdminFlag'), value: detail.isAdmin ? t('detailEnabled') : t('detailDisabled') });
  }
  const entityName = typeof detail.fullName === 'string' ? detail.fullName : detail.name;
  if (typeof entityName === 'string' && entityName) {
    rows.push({ label: t('detailFieldName'), value: entityName });
  }
  const deptIds = readStringList(detail.departmentIds);
  if (deptIds.length > 0) rows.push({ label: t('detailFieldDepartments'), value: String(deptIds.length) });
  if (typeof detail.locale === 'string' && detail.locale) {
    rows.push({ label: t('detailFieldLocale'), value: detail.locale, mono: true });
  }
  if (Array.isArray(detail.daysBefore)) {
    rows.push({ label: t('detailFieldReminders'), value: detail.daysBefore.join(', '), mono: true });
  }
}

function buildMetadataRows(
  detail: Record<string, unknown>,
  t: ReturnType<typeof useTranslations<'auditLogs'>>,
  tPerm: ReturnType<typeof useTranslations<'permissions'>>
): MetadataEntry[] {
  const rows: MetadataEntry[] = [];
  appendPermissionMetadata(detail, rows, t, tPerm);
  appendEntityMetadata(detail, rows, t);
  return rows;
}

function PersonAuditLabel({ member }: { member: MemberPublicSummary | null }) {
  const t = useTranslations('auditLogs');
  const tBadge = useTranslations('member');
  if (!member) return <span>{t('noTargetDash')}</span>;
  return (
    <span>
      {member.fullName}
      {!member.isActive ? <span className="member-left-badge"> {tBadge('leftBadge')}</span> : null}
    </span>
  );
}

export function AuditDetailPane({ entry }: { entry: AuditLogDto | null }) {
  const locale = useLocale();
  const t = useTranslations('auditLogs');
  const tPerm = useTranslations('permissions');

  if (!entry) {
    return (
      <aside className="audit-side" aria-label={t('detailHeading')}>
        <h3>{t('detailHeading')}</h3>
        <p className="admin-empty-inline">{t('detailSelectPrompt')}</p>
        <p className="audit-privacy-note">{t('detailPrivacyNotice')}</p>
      </aside>
    );
  }

  const actionKey = resolveAuditActionKey(entry.action);
  const actionLabel = actionKey ? t(`actions.${actionKey}`) : entry.action;
  const metaRows = buildMetadataRows(entry.detail, t, tPerm);

  return (
    <aside className="audit-side" aria-label={t('detailHeading')}>
      <h3>{t('detailHeading')}</h3>
      <div className="audit-detail">
        <div className="audit-detail-row">
          <span>{t('detailTimeLabel')}</span>
          <b className="mono">{formatAuditTimestamp(entry.createdAt, locale, true)}</b>
        </div>
        <div className="audit-detail-row">
          <span>{t('detailActorLabel')}</span>
          <b><PersonAuditLabel member={entry.actor} /></b>
        </div>
        <div className="audit-detail-row">
          <span>{t('detailActionLabel')}</span>
          <b>{actionLabel}</b>
        </div>
        <div className="audit-detail-row">
          <span>{t('detailTargetLabel')}</span>
          <b><PersonAuditLabel member={entry.targetUser} /></b>
        </div>
        {metaRows.length === 0 ? (
          <div className="audit-detail-row">
            <span>{t('detailMetadataLabel')}</span>
            <b className="muted-dash">{t('noMetadata')}</b>
          </div>
        ) : (
          metaRows.map((row) => (
            <div key={row.label} className="audit-detail-row">
              <span>{row.label}</span>
              <b className={row.mono ? 'mono' : undefined}>{row.value}</b>
            </div>
          ))
        )}
      </div>
      <p className="audit-privacy-note">{t('detailPrivacyNotice')}</p>
    </aside>
  );
}
