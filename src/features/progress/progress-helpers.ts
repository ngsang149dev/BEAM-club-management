import { getCalendarDeadlineInfo, getTodayVnIso } from '@/features/tasks/formatters';
import type { TaskAssigneeDto, TaskDto } from '@/features/tasks/hooks/useTasks';
import { deliverableUrlSchema } from '@/lib/tasks';

export type ProgressDeadlineTier =
  | 'done'
  | 'overdue'
  | 'urgent'
  | 'soon'
  | 'safe';

export type ProgressMode = 'mine' | 'team';
export type ProgressTaskFilter = 'open' | 'overdue' | 'unaccepted' | 'department' | 'done' | 'all';
export type ProgressPopoverFilter = 'all' | 'overdue';

export interface DeadlineBarMetrics {
  readonly tier: ProgressDeadlineTier;
  readonly daysDiff: number | null;
  readonly barPct: number;
  readonly fillHex: string;
}

export interface MemberProgressStats {
  readonly openCount: number;
  readonly overdueCount: number;
  readonly doneCount: number;
  readonly deliverablesCount: number;
}

export interface MemberWorkloadStats {
  readonly openCount: number;
  readonly overdueCount: number;
}

const TIER_FILL_HEX: Record<ProgressDeadlineTier, string> = {
  done: '#059669',
  overdue: '#dc2626',
  urgent: '#ea580c',
  soon: '#f59e0b',
  safe: '#10b981',
};

function computeActiveBarPct(params: {
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly tier: 'urgent' | 'soon' | 'safe';
  readonly daysDiff: number | null;
  readonly nowMs: number;
}): number {
  if (params.startAt && params.dueAt) {
    const startMs = Date.parse(params.startAt);
    const dueMs = Date.parse(params.dueAt);
    if (Number.isFinite(startMs) && Number.isFinite(dueMs) && dueMs > startMs) {
      const ratioPct = Math.round(((params.nowMs - startMs) / (dueMs - startMs)) * 100);
      return Math.max(12, Math.min(96, ratioPct));
    }
  }
  if (params.tier === 'urgent') return 86;
  if (params.tier === 'soon') return 62;
  const safeDays = Math.max(4, params.daysDiff ?? 5);
  return Math.max(20, Math.min(48, Math.round(52 - Math.min(safeDays, 8) * 4)));
}

export function computeDeadlineBarMetrics(
  task: {
    readonly startAt: string | null;
    readonly dueAt: string | null;
    readonly isCompleted: boolean;
  },
  nowMs = Date.now()
): DeadlineBarMetrics {
  const info = getCalendarDeadlineInfo(
    { isCompleted: task.isCompleted, dueAt: task.dueAt },
    getTodayVnIso(nowMs)
  );
  if (info.tier === 'done') {
    return { tier: 'done', daysDiff: null, barPct: 100, fillHex: TIER_FILL_HEX.done };
  }
  if (info.tier === 'overdue') {
    return {
      tier: 'overdue',
      daysDiff: info.daysDiff,
      barPct: 100,
      fillHex: TIER_FILL_HEX.overdue,
    };
  }
  return {
    tier: info.tier,
    daysDiff: info.daysDiff,
    barPct: computeActiveBarPct({
      startAt: task.startAt,
      dueAt: task.dueAt,
      tier: info.tier,
      daysDiff: info.daysDiff,
      nowMs,
    }),
    fillHex: TIER_FILL_HEX[info.tier],
  };
}

export function extractDeliverableHost(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function safeDeliverableHref(url: string): string {
  return deliverableUrlSchema.safeParse(url).success ? url : '#';
}

export function findMemberAssignee(
  task: Pick<TaskDto, 'assignees'>,
  memberId: string
): TaskAssigneeDto | undefined {
  if (!memberId) return undefined;
  return task.assignees.find((assignee) => assignee.id === memberId);
}

function matchesTaskFilter(
  task: TaskDto,
  selectedMemberId: string,
  filter: ProgressTaskFilter,
  nowMs?: number
): boolean {
  if (filter === 'open') return !task.isCompleted;
  if (filter === 'done') return task.isCompleted;
  if (filter === 'department') return task.assignedDepartments.length > 0;
  if (filter === 'overdue') {
    return !task.isCompleted && computeDeadlineBarMetrics(task, nowMs).tier === 'overdue';
  }
  if (filter === 'unaccepted') {
    const assignee = findMemberAssignee(task, selectedMemberId);
    return !task.isCompleted && !assignee?.acceptedAt;
  }
  return true;
}

export function filterProgressTasks(
  tasks: readonly TaskDto[],
  options: {
    readonly filter: ProgressTaskFilter;
    readonly q: string;
    readonly selectedMemberId: string;
    readonly allowDepartmentTasks?: boolean;
    readonly nowMs?: number;
  }
): TaskDto[] {
  if (!options.selectedMemberId) return [];
  const needle = options.q.trim().toLowerCase();
  return tasks.filter((task) => {
    if (task.deletedAt !== null) return false;
    if (!options.allowDepartmentTasks && !task.assignees.some((a) => a.id === options.selectedMemberId)) {
      return false;
    }
    if (!matchesTaskFilter(task, options.selectedMemberId, options.filter, options.nowMs)) {
      return false;
    }
    return !needle || task.title.toLowerCase().includes(needle);
  });
}

export function computeMemberProgressStats(
  tasks: readonly TaskDto[],
  nowMs = Date.now()
): MemberProgressStats {
  let openCount = 0;
  let overdueCount = 0;
  let doneCount = 0;
  let deliverablesCount = 0;

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    deliverablesCount += Math.max(task.deliverableCount, task.deliverables.length);
    if (task.isCompleted) {
      doneCount += 1;
      continue;
    }
    openCount += 1;
    if (computeDeadlineBarMetrics(task, nowMs).tier === 'overdue') {
      overdueCount += 1;
    }
  }

  return { openCount, overdueCount, doneCount, deliverablesCount };
}

export function aggregateClubWorkloadMap(
  allTasks: readonly TaskDto[],
  nowMs = Date.now()
): Record<string, MemberWorkloadStats> {
  const map: Record<string, { openCount: number; overdueCount: number }> = {};

  for (const task of allTasks) {
    if (task.deletedAt !== null || task.isCompleted) continue;
    const isOverdue = computeDeadlineBarMetrics(task, nowMs).tier === 'overdue';
    for (const assignee of task.assignees) {
      const current = map[assignee.id] ?? { openCount: 0, overdueCount: 0 };
      current.openCount += 1;
      if (isOverdue) current.overdueCount += 1;
      map[assignee.id] = current;
    }
  }

  return map;
}

export function canToggleTaskCompletion(params: {
  readonly isAdmin: boolean;
  readonly canUpdateAny: boolean;
  readonly canUpdateAssigned: boolean;
  readonly isSelf: boolean;
  readonly isCallerDirectlyAssigned: boolean;
}): boolean {
  if (params.isAdmin || params.canUpdateAny) return true;
  return params.canUpdateAssigned && (params.isSelf || params.isCallerDirectlyAssigned);
}
