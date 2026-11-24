export type AuditDateRange = '7d' | '30d' | '90d' | 'all';

export type AuditActionMessageKey =
  | 'memberCreated'
  | 'memberUpdated'
  | 'memberDeactivated'
  | 'memberActivated'
  | 'departmentCreated'
  | 'departmentUpdated'
  | 'departmentDeleted'
  | 'permissionsUpdated'
  | 'presetApplied'
  | 'adminUpdated'
  | 'adminGranted'
  | 'adminRevoked'
  | 'remindersUpdated';

const ACTION_TO_KEY: Record<string, AuditActionMessageKey> = {
  'member.created': 'memberCreated',
  'member.updated': 'memberUpdated',
  'member.deactivated': 'memberDeactivated',
  'member.activated': 'memberActivated',
  'department.created': 'departmentCreated',
  'department.updated': 'departmentUpdated',
  'department.deleted': 'departmentDeleted',
  'permissions.updated': 'permissionsUpdated',
  'permission.updated': 'permissionsUpdated',
  'permissions.replaced': 'permissionsUpdated',
  'permissions.preset_applied': 'presetApplied',
  'permission.preset_applied': 'presetApplied',
  'member.admin_updated': 'adminUpdated',
  'admin_flag.updated': 'adminUpdated',
  'admin.granted': 'adminGranted',
  'admin.revoked': 'adminRevoked',
  'reminders.updated': 'remindersUpdated',
  'settings.reminders_updated': 'remindersUpdated',
};

export const AUDIT_FILTER_ACTION_OPTIONS: readonly {
  readonly value: string;
  readonly key: AuditActionMessageKey;
}[] = [
  { value: 'permissions.updated', key: 'permissionsUpdated' },
  { value: 'permissions.preset_applied', key: 'presetApplied' },
  { value: 'admin.granted', key: 'adminGranted' },
  { value: 'admin.revoked', key: 'adminRevoked' },
  { value: 'member.created', key: 'memberCreated' },
  { value: 'member.updated', key: 'memberUpdated' },
  { value: 'member.deactivated', key: 'memberDeactivated' },
  { value: 'member.activated', key: 'memberActivated' },
  { value: 'department.created', key: 'departmentCreated' },
  { value: 'department.updated', key: 'departmentUpdated' },
  { value: 'department.deleted', key: 'departmentDeleted' },
  { value: 'reminders.updated', key: 'remindersUpdated' },
];

export function resolveAuditActionKey(action: string): AuditActionMessageKey | null {
  return ACTION_TO_KEY[action] ?? null;
}

const RANGE_DAYS: Record<Exclude<AuditDateRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function computeAuditFromIso(
  range: AuditDateRange,
  nowMs = Date.now()
): string | undefined {
  if (range === 'all') return undefined;
  const days = RANGE_DAYS[range];
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export function formatAuditTimestamp(
  iso: string,
  locale: string,
  withSeconds = false
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const formatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
  return formatter.format(date);
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function formatAddedRemoved(detail: Record<string, unknown>): string | null {
  const added = readStringList(detail.added);
  const removed = readStringList(detail.removed);
  if (added.length === 0 && removed.length === 0) return null;
  return [added.length ? `+${added.length}` : '', removed.length ? `-${removed.length}` : '']
    .filter(Boolean)
    .join(' / ');
}

function formatEntityPreview(detail: Record<string, unknown>): string {
  if (typeof detail.name === 'string' && detail.name) return detail.name;
  if (typeof detail.fullName === 'string' && detail.fullName) return detail.fullName;
  if (typeof detail.isAdmin === 'boolean') return detail.isAdmin ? 'isAdmin=true' : 'isAdmin=false';
  return '—';
}

export function formatAuditDetailPreview(detail: Record<string, unknown>): string {
  if (typeof detail.presetCode === 'string' && detail.presetCode) return detail.presetCode;
  const diffPreview = formatAddedRemoved(detail);
  if (diffPreview) return diffPreview;
  const permCodes = readStringList(detail.permissionCodes);
  if (permCodes.length > 0) return permCodes.slice(0, 2).join(', ');
  return formatEntityPreview(detail);
}
