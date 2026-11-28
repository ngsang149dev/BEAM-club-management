'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatAuditTimestamp, resolveAuditActionKey } from '../formatters';
import type { AuditLogDto, MemberPublicSummary } from '../hooks/useAuditLogs';
import { buildAuditMetadataRows } from '../metadata-rows';

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
  const metaRows = buildAuditMetadataRows(entry.detail, t, tPerm);

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
