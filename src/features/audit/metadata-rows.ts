import type { useTranslations } from 'next-intl';
import { readStringList } from './formatters';

export interface MetadataEntry {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

type AuditTranslator = ReturnType<typeof useTranslations<'auditLogs'>>;
type PermissionsTranslator = ReturnType<typeof useTranslations<'permissions'>>;

type AuditDetailBooleanKey =
  | 'isHidden'
  | 'accepted'
  | 'isCompleted'
  | 'accountCreated'
  | 'mustChangePassword'
  | 'remindOverdue'
  | 'removed'
  | 'forceChangeOnLogin'
  | 'sessionsRevoked';

type AuditDetailStringKey =
  | 'deliverableTitle'
  | 'assetKey'
  | 'mimeType'
  | 'taskId'
  | 'boardId'
  | 'purgedMemberId';

type AuditDetailNumberKey = 'assigneeCount' | 'departmentCount' | 'cascadedTasks';

const KNOWN_PRESET_CODES = new Set(['basic_member', 'department_lead', 'hr_manager']);
const PURGE_MODE_KEY_MAP = {
  marked_purged: 'purgeModeMarkedPurged',
  anonymized: 'purgeModeAnonymized',
  physical_delete: 'purgeModePhysicalDelete',
} as const;

function formatYesNo(flag: boolean, t: AuditTranslator): string {
  return flag ? t('detailValues.yes') : t('detailValues.no');
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pushBooleanRows(
  detail: Record<string, unknown>,
  pairs: ReadonlyArray<readonly [string, AuditDetailBooleanKey]>,
  rows: MetadataEntry[],
  t: AuditTranslator
): void {
  for (const [field, labelKey] of pairs) {
    const val = detail[field];
    if (typeof val === 'boolean') {
      rows.push({ label: t(`detailLabels.${labelKey}`), value: formatYesNo(val, t) });
    }
  }
}

function pushStringRows(
  detail: Record<string, unknown>,
  pairs: ReadonlyArray<readonly [string, AuditDetailStringKey, boolean?]>,
  rows: MetadataEntry[],
  t: AuditTranslator
): void {
  for (const [field, labelKey, mono = true] of pairs) {
    const val = readNonEmptyString(detail[field]);
    if (val) rows.push({ label: t(`detailLabels.${labelKey}`), value: val, mono });
  }
}

function pushNumberRows(
  detail: Record<string, unknown>,
  pairs: ReadonlyArray<readonly [string, AuditDetailNumberKey]>,
  rows: MetadataEntry[],
  t: AuditTranslator
): void {
  for (const [field, labelKey] of pairs) {
    const val = detail[field];
    if (typeof val === 'number' && Number.isFinite(val)) {
      rows.push({ label: t(`detailLabels.${labelKey}`), value: String(val), mono: true });
    }
  }
}

function formatPresetValue(presetCode: string, tPerm: PermissionsTranslator): string {
  if (KNOWN_PRESET_CODES.has(presetCode)) {
    return tPerm(`presets.${presetCode as 'basic_member' | 'department_lead' | 'hr_manager'}`);
  }
  return presetCode;
}

function appendPermissionDiffMetadata(
  detail: Record<string, unknown>,
  rows: MetadataEntry[],
  t: AuditTranslator,
  tPerm: PermissionsTranslator
): void {
  const presetCode = readNonEmptyString(detail.presetCode);
  if (presetCode) {
    rows.push({ label: t('detailPreset'), value: formatPresetValue(presetCode, tPerm), mono: true });
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

function appendPermissionGrantsMetadata(
  detail: Record<string, unknown>,
  rows: MetadataEntry[],
  t: AuditTranslator
): void {
  const granted = readStringList(detail.grantedPermissions);
  if (granted.length > 0) {
    rows.push({ label: t('detailLabels.grantedPermissions'), value: granted.join(', '), mono: true });
  }
  const defaults = readStringList(detail.defaultPermissions);
  if (defaults.length > 0) {
    rows.push({ label: t('detailLabels.defaultPermissions'), value: defaults.join(', '), mono: true });
  }
}

function appendTaskTitleMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  if (!('taskTitle' in detail) && !('isHidden' in detail)) return;
  const titleValue =
    detail.isHidden === true || detail.taskTitle === null
      ? t('hiddenTaskLabel')
      : String(detail.taskTitle || '—');
  rows.push({ label: t('detailLabels.taskTitle'), value: titleValue });
}

function appendTaskMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  appendTaskTitleMetadata(detail, rows, t);
  const revertedType = readNonEmptyString(detail.revertedType) ?? readNonEmptyString(detail.revertedEventType);
  if (revertedType) {
    rows.push({ label: t('detailLabels.revertedEventType'), value: revertedType, mono: true });
  }
  pushBooleanRows(
    detail,
    [['isHidden', 'isHidden'], ['accepted', 'accepted'], ['isCompleted', 'isCompleted']],
    rows,
    t
  );
  pushStringRows(detail, [['deliverableTitle', 'deliverableTitle', false]], rows, t);
  pushNumberRows(detail, [['assigneeCount', 'assigneeCount'], ['departmentCount', 'departmentCount']], rows, t);
}

function appendMemberIdentityMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  if (typeof detail.isAdmin === 'boolean') {
    rows.push({ label: t('detailAdminFlag'), value: detail.isAdmin ? t('detailEnabled') : t('detailDisabled') });
  }
  const entityName = readNonEmptyString(detail.fullName) ?? readNonEmptyString(detail.name);
  if (entityName) rows.push({ label: t('detailFieldName'), value: entityName });
  const updatedFields = readStringList(detail.updatedFields);
  if (updatedFields.length > 0) {
    rows.push({ label: t('detailLabels.updatedFields'), value: updatedFields.join(', '), mono: true });
  }
  const locale = readNonEmptyString(detail.locale);
  if (locale) rows.push({ label: t('detailFieldLocale'), value: locale, mono: true });
}

function appendDepartmentAndAccountMetadata(
  detail: Record<string, unknown>,
  rows: MetadataEntry[],
  t: AuditTranslator
): void {
  const deptIds = readStringList(detail.departmentIds);
  if (typeof detail.departmentCount !== 'number' && deptIds.length > 0) {
    rows.push({ label: t('detailFieldDepartments'), value: String(deptIds.length) });
  }
  if ('leadUserId' in detail) {
    const hasLead = typeof detail.leadUserId === 'string' && detail.leadUserId.length > 0;
    rows.push({
      label: t('detailLabels.departmentLead'),
      value: hasLead ? t('detailValues.leadAssigned') : t('detailValues.leadCleared'),
    });
  }
  pushBooleanRows(detail, [['created', 'accountCreated'], ['mustChangePassword', 'mustChangePassword']], rows, t);
}

function appendReminderMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  if (Array.isArray(detail.daysBefore)) {
    const days = detail.daysBefore.filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
    rows.push({
      label: t('detailFieldReminders'),
      value: days.length > 0 ? days.join(', ') : t('detailValues.reminderDaysNone'),
      mono: true,
    });
  }
  pushBooleanRows(detail, [['remindOverdue', 'remindOverdue']], rows, t);
}

function appendMediaMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  pushStringRows(detail, [['assetKey', 'assetKey'], ['mimeType', 'mimeType']], rows, t);
  if (typeof detail.byteLength === 'number' && Number.isFinite(detail.byteLength) && detail.byteLength >= 0) {
    const size = detail.byteLength < 1024 ? `${Math.round(detail.byteLength)} B` : `${(detail.byteLength / 1024).toFixed(1)} KB`;
    rows.push({ label: t('detailLabels.byteLength'), value: size, mono: true });
  }
  pushBooleanRows(detail, [['removed', 'removed']], rows, t);
}

function formatRetentionValue(value: unknown, t: AuditTranslator): string | null {
  if (value === null) return t('detailValues.retentionNever');
  if (typeof value === 'number' && Number.isFinite(value)) return t('detailValues.retentionDaysCount', { days: value });
  return null;
}

function appendSecurityMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  pushBooleanRows(
    detail,
    [['forceChangeOnLogin', 'forceChangeOnLogin'], ['sessionsRevoked', 'sessionsRevoked']],
    rows,
    t
  );
  for (const [field, labelKey] of [['retentionDays', 'retentionDays'], ['previousRetentionDays', 'previousRetentionDays']] as const) {
    if (!(field in detail)) continue;
    const formatted = formatRetentionValue(detail[field], t);
    if (formatted) rows.push({ label: t(`detailLabels.${labelKey}`), value: formatted });
  }
}

function appendArchiveMetadata(detail: Record<string, unknown>, rows: MetadataEntry[], t: AuditTranslator): void {
  const purgeMode = readNonEmptyString(detail.purgeMode);
  if (purgeMode) {
    const valueKey = PURGE_MODE_KEY_MAP[purgeMode as keyof typeof PURGE_MODE_KEY_MAP];
    rows.push({ label: t('detailLabels.purgeMode'), value: valueKey ? t(`detailValues.${valueKey}`) : purgeMode });
  }
  pushNumberRows(detail, [['cascadedTasks', 'cascadedTasks']], rows, t);
  pushStringRows(detail, [['taskId', 'taskId'], ['boardId', 'boardId'], ['purgedMemberId', 'purgedMemberId']], rows, t);
}

export function buildAuditMetadataRows(
  detail: Record<string, unknown>,
  t: AuditTranslator,
  tPerm: PermissionsTranslator
): MetadataEntry[] {
  const rows: MetadataEntry[] = [];
  appendPermissionDiffMetadata(detail, rows, t, tPerm);
  appendPermissionGrantsMetadata(detail, rows, t);
  appendTaskMetadata(detail, rows, t);
  appendMemberIdentityMetadata(detail, rows, t);
  appendDepartmentAndAccountMetadata(detail, rows, t);
  appendReminderMetadata(detail, rows, t);
  appendMediaMetadata(detail, rows, t);
  appendSecurityMetadata(detail, rows, t);
  appendArchiveMetadata(detail, rows, t);
  return rows;
}
