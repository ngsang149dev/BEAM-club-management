import type { useTranslations } from 'next-intl';
import type { components } from '@/features/shared/api/client';
import type { PermissionCode } from '@/features/shared/permissions/can';
import { formatTaskDueDate } from './formatters';

export type TaskDto = components['schemas']['TaskDto'];
export type TaskEventDto = components['schemas']['TaskEventDto'];
export type TaskHistoryTranslator = ReturnType<typeof useTranslations<'taskHistory'>>;

const LEGACY_PRIORITY_KEYS = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' } as const;

export interface TaskHistoryLookup {
  readonly columnsById: ReadonlyMap<string, string>;
  readonly departmentsById: ReadonlyMap<string, string>;
  readonly membersById: ReadonlyMap<string, string>;
}

interface EventFormatContext {
  readonly locale: string;
  readonly lookup: TaskHistoryLookup;
  readonly tHistory: TaskHistoryTranslator;
}

export interface CanRevertEventParams {
  readonly event: Pick<TaskEventDto, 'type' | 'revertable'>;
  readonly isAdmin: boolean;
  readonly can: (permission: PermissionCode) => boolean;
  readonly currentUserId: string | null | undefined;
  readonly currentDepartmentIds?: readonly string[];
  readonly task: Pick<TaskDto, 'assignees' | 'assignedDepartments' | 'creator'>;
}

const NON_REVERTABLE_TYPES = new Set([
  'task.created',
  'task.accepted',
  'task.deliverable_added',
  'task.deliverable_removed',
  'comment.added',
  'comment.deleted',
]);

function isTaskAssigneeOrDeptMember(
  task: Pick<TaskDto, 'assignees' | 'assignedDepartments'>,
  currentUserId: string | null | undefined,
  currentDepartmentIds: readonly string[]
): boolean {
  if (!currentUserId) return false;
  if (task.assignees.some((assignee) => assignee.id === currentUserId)) return true;
  return task.assignedDepartments.some((dept) => currentDepartmentIds.includes(dept.id));
}

type RevertPermissionRule = (params: CanRevertEventParams) => boolean;

const REVERT_PERMISSION_RULES: Record<string, RevertPermissionRule> = {
  'task.updated': ({ can, task, currentUserId, currentDepartmentIds = [] }) =>
    can('task.update_any') ||
    (can('task.update_assigned') && isTaskAssigneeOrDeptMember(task, currentUserId, currentDepartmentIds)),
  'task.moved': ({ can, task, currentUserId, currentDepartmentIds = [] }) =>
    can('task.update_any') ||
    (can('task.update_assigned') && isTaskAssigneeOrDeptMember(task, currentUserId, currentDepartmentIds)),
  'task.assignees_changed': ({ can }) => can('task.assign'),
  'task.hidden_changed': ({ currentUserId, task }) => Boolean(currentUserId && task.creator.id === currentUserId),
  'task.deleted': ({ can }) => can('task.delete'),
  'task.restored': ({ can }) => can('task.delete'),
};

export function canActorRevertEvent(params: CanRevertEventParams): boolean {
  if (!params.event.revertable || NON_REVERTABLE_TYPES.has(params.event.type)) return false;
  if (params.isAdmin) return true;
  const rule = REVERT_PERMISSION_RULES[params.event.type];
  return rule ? rule(params) : false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDiffPair(changes: Record<string, unknown>, key: string): { from: unknown; to: unknown } | null {
  const entry = changes[key];
  if (!isPlainRecord(entry)) return null;
  if (!('from' in entry) && !('to' in entry)) return null;
  return { from: entry.from, to: entry.to };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readPriority(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncateText(text: string, maxLength = 60): string {
  const trimmed = text.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`;
}

function resolveColumnLabel(columnId: string | null, lookup: TaskHistoryLookup, tHistory: TaskHistoryTranslator): string {
  return (columnId ? lookup.columnsById.get(columnId) : undefined) ?? tHistory('unknownColumn');
}

function resolveEntityListLabel(params: {
  readonly ids: readonly string[];
  readonly namesById: ReadonlyMap<string, string>;
  readonly countKey: 'memberCountValue' | 'departmentCountValue';
  readonly namedPlusMoreKey: 'namedPlusMoreMembers' | 'namedPlusMoreDepartments';
  readonly tHistory: TaskHistoryTranslator;
}): string {
  if (params.ids.length === 0) return params.tHistory('noneValue');
  const resolved: string[] = [];
  let unknownCount = 0;
  for (const id of params.ids) {
    const name = params.namesById.get(id);
    if (name) resolved.push(name);
    else unknownCount += 1;
  }
  if (resolved.length === 0) return params.tHistory(params.countKey, { count: params.ids.length });
  if (unknownCount === 0) return resolved.join(', ');
  return params.tHistory(params.namedPlusMoreKey, { names: resolved.join(', '), count: unknownCount });
}

const DATE_DIFF_KEYS = {
  due_at: { set: 'events.dueAtSet', cleared: 'events.dueAtCleared', changed: 'events.dueAtChanged' },
  start_at: { set: 'events.startAtSet', cleared: 'events.startAtCleared', changed: 'events.startAtChanged' },
} as const;

function formatDateDiff(
  diff: { from: unknown; to: unknown },
  field: 'due_at' | 'start_at',
  ctx: EventFormatContext
): string {
  const keys = DATE_DIFF_KEYS[field];
  const fromIso = readString(diff.from);
  const toIso = readString(diff.to);
  if (!fromIso && toIso) return ctx.tHistory(keys.set, { to: formatTaskDueDate(toIso, ctx.locale) });
  if (fromIso && !toIso) return ctx.tHistory(keys.cleared, { from: formatTaskDueDate(fromIso, ctx.locale) });
  if (fromIso && toIso) {
    return ctx.tHistory(keys.changed, { from: formatTaskDueDate(fromIso, ctx.locale), to: formatTaskDueDate(toIso, ctx.locale) });
  }
  return ctx.tHistory('events.taskUpdatedGeneric');
}

function formatCompletedDiff(diff: { from: unknown; to: unknown }, ctx: EventFormatContext): string {
  const label = (val: boolean) => ctx.tHistory(val ? 'statusDone' : 'statusActive');
  if (typeof diff.from === 'boolean' && typeof diff.to === 'boolean') {
    return ctx.tHistory('events.isCompletedChanged', { from: label(diff.from), to: label(diff.to) });
  }
  if (typeof diff.to === 'boolean') return ctx.tHistory('events.isCompletedSet', { to: label(diff.to) });
  return ctx.tHistory('events.taskUpdatedGeneric');
}

function formatDescriptionDiff(diff: { from: unknown; to: unknown }, ctx: EventFormatContext): string {
  const fromText = readString(diff.from);
  const toText = readString(diff.to);
  if (!fromText && toText) return ctx.tHistory('events.descriptionAdded');
  if (fromText && !toText) return ctx.tHistory('events.descriptionCleared');
  return ctx.tHistory('events.descriptionUpdated');
}

function formatLegacyPriorityLabel(level: number, tHistory: TaskHistoryTranslator): string {
  const key = level === 1 || level === 3 || level === 4 ? LEGACY_PRIORITY_KEYS[level] : 'medium';
  return tHistory(`priorityLevels.${key}`);
}

function formatPriorityAndTitle(changes: Record<string, unknown>, ctx: EventFormatContext, parts: string[]): void {
  const prioDiff = readDiffPair(changes, 'priority');
  const fromPrio = prioDiff ? readPriority(prioDiff.from) : null;
  const toPrio = prioDiff ? readPriority(prioDiff.to) : null;
  if (fromPrio !== null && toPrio !== null) {
    parts.push(
      ctx.tHistory('events.priorityChanged', {
        from: formatLegacyPriorityLabel(fromPrio, ctx.tHistory),
        to: formatLegacyPriorityLabel(toPrio, ctx.tHistory),
      })
    );
  }
  const titleDiff = readDiffPair(changes, 'title');
  const fromTitle = titleDiff ? readString(titleDiff.from) : null;
  const toTitle = titleDiff ? readString(titleDiff.to) : null;
  if (fromTitle && toTitle) {
    parts.push(ctx.tHistory('events.titleChanged', { from: truncateText(fromTitle), to: truncateText(toTitle) }));
  }
}

function formatTaskUpdatedEvent(changes: Record<string, unknown>, ctx: EventFormatContext): string {
  const parts: string[] = [];
  formatPriorityAndTitle(changes, ctx, parts);
  const startDiff = readDiffPair(changes, 'start_at');
  if (startDiff) parts.push(formatDateDiff(startDiff, 'start_at', ctx));
  const dueDiff = readDiffPair(changes, 'due_at');
  if (dueDiff) parts.push(formatDateDiff(dueDiff, 'due_at', ctx));
  const completedDiff = readDiffPair(changes, 'is_completed');
  if (completedDiff) parts.push(formatCompletedDiff(completedDiff, ctx));
  const descDiff = readDiffPair(changes, 'description');
  if (descDiff) parts.push(formatDescriptionDiff(descDiff, ctx));
  return parts.length > 0 ? parts.join(' · ') : ctx.tHistory('events.taskUpdatedGeneric');
}

const ENTITY_DIFF_META = {
  member: {
    countKey: 'memberCountValue', namedPlusMoreKey: 'namedPlusMoreMembers',
    addedKey: 'events.assignedTo', clearedKey: 'events.assigneesCleared', changedKey: 'events.assigneesChanged',
  },
  department: {
    countKey: 'departmentCountValue', namedPlusMoreKey: 'namedPlusMoreDepartments',
    addedKey: 'events.departmentsAssigned', clearedKey: 'events.departmentsCleared', changedKey: 'events.departmentsChanged',
  },
} as const;

function formatIdListChange(diff: { from: unknown; to: unknown }, kind: 'member' | 'department', ctx: EventFormatContext): string {
  const meta = ENTITY_DIFF_META[kind];
  const namesById = kind === 'member' ? ctx.lookup.membersById : ctx.lookup.departmentsById;
  const fromIds = readStringArray(diff.from);
  const toIds = readStringArray(diff.to);
  const formatIds = (ids: readonly string[]) =>
    resolveEntityListLabel({ ids, namesById, countKey: meta.countKey, namedPlusMoreKey: meta.namedPlusMoreKey, tHistory: ctx.tHistory });
  if (fromIds.length === 0 && toIds.length > 0) return ctx.tHistory(meta.addedKey, { to: formatIds(toIds) });
  if (fromIds.length > 0 && toIds.length === 0) return ctx.tHistory(meta.clearedKey, { from: formatIds(fromIds) });
  return ctx.tHistory(meta.changedKey, { from: formatIds(fromIds), to: formatIds(toIds) });
}

function formatTaskAssigneesEvent(changes: Record<string, unknown>, ctx: EventFormatContext): string {
  const parts: string[] = [];
  const assigneeDiff = readDiffPair(changes, 'assignee_ids');
  if (assigneeDiff) parts.push(formatIdListChange(assigneeDiff, 'member', ctx));
  const deptDiff = readDiffPair(changes, 'department_ids');
  if (deptDiff) parts.push(formatIdListChange(deptDiff, 'department', ctx));
  return parts.length > 0 ? parts.join(' · ') : ctx.tHistory('events.assignmentsUpdatedGeneric');
}

function formatTaskMovedEvent(changes: Record<string, unknown>, ctx: EventFormatContext): string {
  const colDiff = readDiffPair(changes, 'column_id');
  const fromId = colDiff ? readString(colDiff.from) : null;
  const toId = colDiff ? readString(colDiff.to) : null;
  if (fromId && toId && fromId === toId) {
    const colName = ctx.lookup.columnsById.get(toId);
    return colName ? ctx.tHistory('events.taskReorderedInColumn', { column: colName }) : ctx.tHistory('events.taskReordered');
  }
  return ctx.tHistory('events.taskMoved', {
    from: resolveColumnLabel(fromId, ctx.lookup, ctx.tHistory),
    to: resolveColumnLabel(toId, ctx.lookup, ctx.tHistory),
  });
}

const EVENT_SUMMARY_BUILDERS: Record<string, (changes: Record<string, unknown>, ctx: EventFormatContext) => string> = {
  'task.created': (changes, ctx) => {
    const colId = readString(changes.column_id);
    const colName = colId ? ctx.lookup.columnsById.get(colId) : undefined;
    return colName ? ctx.tHistory('events.taskCreatedInColumn', { column: colName }) : ctx.tHistory('events.taskCreated');
  },
  'task.updated': formatTaskUpdatedEvent,
  'task.moved': formatTaskMovedEvent,
  'task.assignees_changed': formatTaskAssigneesEvent,
  'task.hidden_changed': (changes, ctx) =>
    ctx.tHistory(readDiffPair(changes, 'is_hidden')?.to === true ? 'events.hiddenEnabled' : 'events.hiddenDisabled'),
  'task.deleted': (_c, ctx) => ctx.tHistory('events.taskDeleted'),
  'task.restored': (changes, ctx) => {
    const colId = readString(readDiffPair(changes, 'column_id')?.to);
    const colName = colId ? ctx.lookup.columnsById.get(colId) : undefined;
    return colName ? ctx.tHistory('events.taskRestoredToColumn', { column: colName }) : ctx.tHistory('events.taskRestored');
  },
  'task.accepted': (changes, ctx) =>
    ctx.tHistory((readDiffPair(changes, 'accepted')?.to ?? changes.accepted) === false ? 'events.taskUnaccepted' : 'events.taskAccepted'),
  'task.deliverable_added': (_c, ctx) => ctx.tHistory('events.deliverableAdded'),
  'task.deliverable_removed': (_c, ctx) => ctx.tHistory('events.deliverableRemoved'),
  'comment.added': (_c, ctx) => ctx.tHistory('events.commentAdded'),
  'comment.deleted': (_c, ctx) => ctx.tHistory('events.commentDeleted'),
};

export function formatTaskEventSummary(params: {
  readonly event: Pick<TaskEventDto, 'type' | 'changes'>;
  readonly locale: string;
  readonly lookup: TaskHistoryLookup;
  readonly tHistory: TaskHistoryTranslator;
}): string {
  const changes = isPlainRecord(params.event.changes) ? params.event.changes : {};
  const builder = EVENT_SUMMARY_BUILDERS[params.event.type];
  return builder
    ? builder(changes, { locale: params.locale, lookup: params.lookup, tHistory: params.tHistory })
    : params.tHistory('events.unknownActivity');
}

const CONFLICT_FIELD_KEYS = {
  title: 'title', description: 'description', priority: 'priority', start_at: 'start_at',
  due_at: 'due_at', is_completed: 'is_completed', column_id: 'column_id', position: 'position',
  assignee_ids: 'assignee_ids', department_ids: 'department_ids', is_hidden: 'is_hidden', deleted_at: 'deleted_at',
} as const;

type ConflictFieldKey = keyof typeof CONFLICT_FIELD_KEYS;

export function resolveConflictFieldLabel(field: string, tHistory: TaskHistoryTranslator): string {
  const mapped = CONFLICT_FIELD_KEYS[field as ConflictFieldKey];
  return tHistory(mapped ? `conflictFields.${mapped}` : 'conflictFields.other');
}
