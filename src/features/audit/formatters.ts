export type AuditDateRange = '7d' | '30d' | '90d' | 'all';

export type AuditActionMessageKey =
  | 'memberBootstrapAdmin'
  | 'memberCreated'
  | 'memberUpdated'
  | 'memberPasswordReset'
  | 'memberDeactivated'
  | 'memberActivated'
  | 'memberAvatarUpdated'
  | 'memberAvatarRemoved'
  | 'departmentCreated'
  | 'departmentUpdated'
  | 'departmentDeleted'
  | 'permissionsUpdated'
  | 'presetApplied'
  | 'adminUpdated'
  | 'adminGranted'
  | 'adminRevoked'
  | 'taskCreated'
  | 'taskUpdated'
  | 'taskCompleted'
  | 'taskReopened'
  | 'taskAssigneesChanged'
  | 'taskAccepted'
  | 'taskDeliverableAdded'
  | 'taskDeliverableRemoved'
  | 'taskHiddenChanged'
  | 'taskDeleted'
  | 'taskRestored'
  | 'taskReverted'
  | 'remindersUpdated'
  | 'boardCreated'
  | 'boardUpdated'
  | 'boardArchived'
  | 'brandingLogoUpdated'
  | 'brandingLogoRemoved'
  | 'brandingWordmarkUpdated'
  | 'brandingWordmarkRemoved'
  | 'brandingGalleryCreated'
  | 'brandingGalleryUpdated'
  | 'brandingGalleryDeleted'
  | 'brandingGalleryReordered'
  | 'archiveMemberRestored'
  | 'archiveBoardRestored'
  | 'archiveTaskPurged'
  | 'archiveBoardPurged'
  | 'archiveMemberPurged'
  | 'archiveRetentionUpdated';

const ACTION_TO_KEY: Record<string, AuditActionMessageKey> = {
  'member.bootstrap_admin': 'memberBootstrapAdmin',
  'member.created': 'memberCreated',
  'member.updated': 'memberUpdated',
  'member.password_reset': 'memberPasswordReset',
  'member.deactivated': 'memberDeactivated',
  'member.activated': 'memberActivated',
  'member.avatar_updated': 'memberAvatarUpdated',
  'member.avatar_removed': 'memberAvatarRemoved',
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
  'task.created': 'taskCreated',
  'task.updated': 'taskUpdated',
  'task.completed': 'taskCompleted',
  'task.reopened': 'taskReopened',
  'task.assignees_changed': 'taskAssigneesChanged',
  'task.accepted': 'taskAccepted',
  'task.deliverable_added': 'taskDeliverableAdded',
  'task.deliverable_removed': 'taskDeliverableRemoved',
  'task.hidden_changed': 'taskHiddenChanged',
  'task.deleted': 'taskDeleted',
  'task.restored': 'taskRestored',
  'task.reverted': 'taskReverted',
  'reminders.updated': 'remindersUpdated',
  'settings.reminders_updated': 'remindersUpdated',
  'board.created': 'boardCreated',
  'board.updated': 'boardUpdated',
  'board.archived': 'boardArchived',
  'branding.logo_updated': 'brandingLogoUpdated',
  'branding.logo_removed': 'brandingLogoRemoved',
  'branding.wordmark_updated': 'brandingWordmarkUpdated',
  'branding.wordmark_removed': 'brandingWordmarkRemoved',
  'branding.gallery_item_created': 'brandingGalleryCreated',
  'branding.gallery_item_updated': 'brandingGalleryUpdated',
  'branding.gallery_item_deleted': 'brandingGalleryDeleted',
  'branding.gallery_reordered': 'brandingGalleryReordered',
  'archive.member_restored': 'archiveMemberRestored',
  'archive.board_restored': 'archiveBoardRestored',
  'archive.task_purged': 'archiveTaskPurged',
  'archive.board_purged': 'archiveBoardPurged',
  'archive.member_purged': 'archiveMemberPurged',
  'settings.archive_retention_updated': 'archiveRetentionUpdated',
};

export const AUDIT_FILTER_ACTION_OPTIONS: readonly {
  readonly value: string;
  readonly key: AuditActionMessageKey;
}[] = [
  { value: 'task.created', key: 'taskCreated' },
  { value: 'task.updated', key: 'taskUpdated' },
  { value: 'task.completed', key: 'taskCompleted' },
  { value: 'task.reopened', key: 'taskReopened' },
  { value: 'task.assignees_changed', key: 'taskAssigneesChanged' },
  { value: 'task.accepted', key: 'taskAccepted' },
  { value: 'task.deliverable_added', key: 'taskDeliverableAdded' },
  { value: 'task.deliverable_removed', key: 'taskDeliverableRemoved' },
  { value: 'task.hidden_changed', key: 'taskHiddenChanged' },
  { value: 'task.deleted', key: 'taskDeleted' },
  { value: 'task.restored', key: 'taskRestored' },
  { value: 'task.reverted', key: 'taskReverted' },
  { value: 'permissions.updated', key: 'permissionsUpdated' },
  { value: 'permissions.preset_applied', key: 'presetApplied' },
  { value: 'admin.granted', key: 'adminGranted' },
  { value: 'admin.revoked', key: 'adminRevoked' },
  { value: 'member.bootstrap_admin', key: 'memberBootstrapAdmin' },
  { value: 'member.created', key: 'memberCreated' },
  { value: 'member.updated', key: 'memberUpdated' },
  { value: 'member.password_reset', key: 'memberPasswordReset' },
  { value: 'member.deactivated', key: 'memberDeactivated' },
  { value: 'member.activated', key: 'memberActivated' },
  { value: 'member.avatar_updated', key: 'memberAvatarUpdated' },
  { value: 'member.avatar_removed', key: 'memberAvatarRemoved' },
  { value: 'department.created', key: 'departmentCreated' },
  { value: 'department.updated', key: 'departmentUpdated' },
  { value: 'department.deleted', key: 'departmentDeleted' },
  { value: 'settings.reminders_updated', key: 'remindersUpdated' },
  { value: 'branding.logo_updated', key: 'brandingLogoUpdated' },
  { value: 'branding.logo_removed', key: 'brandingLogoRemoved' },
  { value: 'branding.wordmark_updated', key: 'brandingWordmarkUpdated' },
  { value: 'branding.wordmark_removed', key: 'brandingWordmarkRemoved' },
  { value: 'branding.gallery_item_created', key: 'brandingGalleryCreated' },
  { value: 'branding.gallery_item_updated', key: 'brandingGalleryUpdated' },
  { value: 'branding.gallery_item_deleted', key: 'brandingGalleryDeleted' },
  { value: 'branding.gallery_reordered', key: 'brandingGalleryReordered' },
  { value: 'archive.member_restored', key: 'archiveMemberRestored' },
  { value: 'archive.task_purged', key: 'archiveTaskPurged' },
  { value: 'archive.member_purged', key: 'archiveMemberPurged' },
  { value: 'settings.archive_retention_updated', key: 'archiveRetentionUpdated' },
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
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(date);
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatAddedRemoved(detail: Record<string, unknown>): string | null {
  const added = readStringList(detail.added);
  const removed = readStringList(detail.removed);
  if (added.length === 0 && removed.length === 0) return null;
  return [added.length ? `+${added.length}` : '', removed.length ? `-${removed.length}` : '']
    .filter(Boolean)
    .join(' / ');
}

function readRevertedTaskType(detail: Record<string, unknown>): string | null {
  return readNonEmptyString(detail.revertedType) ?? readNonEmptyString(detail.revertedEventType);
}

function formatTaskDetailPreview(detail: Record<string, unknown>, hiddenTaskLabel: string): string | null {
  const revertedType = readRevertedTaskType(detail);
  if (!('taskTitle' in detail) && !('isHidden' in detail)) return revertedType;
  if (detail.isHidden === true || detail.taskTitle === null) return hiddenTaskLabel;
  const title = readNonEmptyString(detail.taskTitle);
  const deliv = readNonEmptyString(detail.deliverableTitle);
  if (title && deliv) return `${title} · ${deliv}`;
  return title ?? revertedType;
}

function formatArchivePreview(detail: Record<string, unknown>): string | null {
  if ('retentionDays' in detail) {
    if (detail.retentionDays === null) return 'null';
    if (typeof detail.retentionDays === 'number' && Number.isFinite(detail.retentionDays)) {
      return `${detail.retentionDays}d`;
    }
  }
  return (
    readNonEmptyString(detail.purgeMode) ??
    readNonEmptyString(detail.taskId) ??
    readNonEmptyString(detail.boardId) ??
    readNonEmptyString(detail.purgedMemberId)
  );
}

function formatGalleryOrFieldsPreview(detail: Record<string, unknown>): string | null {
  const updatedFields = readStringList(detail.updatedFields);
  if (updatedFields.length > 0) return updatedFields.join(', ');
  const itemIds = readStringList(detail.itemIds);
  if (itemIds.length > 0) return `${itemIds.length} items`;
  return readNonEmptyString(detail.itemId);
}

function formatRemindersPreview(detail: Record<string, unknown>): string | null {
  const hasDays = Array.isArray(detail.daysBefore);
  const hasOverdue = typeof detail.remindOverdue === 'boolean';
  if (!hasDays && !hasOverdue) return null;
  const parts: string[] = [];
  if (hasDays) {
    const days = (detail.daysBefore as unknown[]).filter(
      (day): day is number => typeof day === 'number' && Number.isFinite(day)
    );
    parts.push(`[${days.join(', ')}]`);
  }
  if (hasOverdue) parts.push(`overdue=${detail.remindOverdue ? 'yes' : 'no'}`);
  return parts.join(' · ');
}

function formatDepartmentOrNamedPreview(detail: Record<string, unknown>): string | null {
  const namePreview = readNonEmptyString(detail.name);
  if (!('leadUserId' in detail)) return namePreview;
  const leadPreview = readNonEmptyString(detail.leadUserId) ? 'lead=assigned' : 'lead=cleared';
  return namePreview ? `${namePreview} · ${leadPreview}` : leadPreview;
}

function formatPermissionListPreview(detail: Record<string, unknown>): string | null {
  for (const key of ['permissionCodes', 'grantedPermissions', 'defaultPermissions'] as const) {
    const list = readStringList(detail[key]);
    if (list.length > 0) return list.slice(0, 2).join(', ');
  }
  return null;
}

function formatEntityPreview(detail: Record<string, unknown>): string {
  const textPreview =
    formatDepartmentOrNamedPreview(detail) ??
    readNonEmptyString(detail.fullName) ??
    readNonEmptyString(detail.mimeType) ??
    readNonEmptyString(detail.assetKey);
  if (textPreview) return textPreview;
  const subPreview = formatGalleryOrFieldsPreview(detail) ?? formatRemindersPreview(detail);
  if (subPreview) return subPreview;
  if (typeof detail.isAdmin === 'boolean') return detail.isAdmin ? 'isAdmin=true' : 'isAdmin=false';
  return formatArchivePreview(detail) ?? '—';
}

export function formatAuditDetailPreview(
  detail: Record<string, unknown>,
  hiddenTaskLabel = '(Công việc ẩn)'
): string {
  const taskPreview = formatTaskDetailPreview(detail, hiddenTaskLabel);
  if (taskPreview) return taskPreview;
  if (typeof detail.presetCode === 'string' && detail.presetCode) return detail.presetCode;
  const diffPreview = formatAddedRemoved(detail);
  if (diffPreview) return diffPreview;
  const permPreview = formatPermissionListPreview(detail);
  if (permPreview) return permPreview;
  return formatEntityPreview(detail);
}
