import type { TaskPriority } from '@/lib/tasks';
import type {
  CreateTaskRepoParams,
  ReplaceAssigneesRepoParams,
  TaskAssigneeRecord,
  TaskDeliverableRecord,
  TaskDepartmentSummaryRecord,
  TaskMemberSummaryRecord,
  TaskRecord,
  UpdateTaskRepoParams,
} from './types';

export interface RawTaskRow {
  readonly id: string;
  readonly boardId: string;
  readonly columnId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: Date | null;
  readonly dueAt: Date | null;
  readonly isCompleted: boolean;
  readonly completedAt: Date | null;
  readonly priority: number;
  readonly position: string;
  readonly isHidden: boolean;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RawTaskAssigneeRow {
  readonly taskId: string;
  readonly userId: string;
  readonly acceptedAt: Date | null;
}

export interface RawTaskDeliverableRow {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly url: string;
  readonly submittedBy: string;
  readonly createdAt: Date;
}

export interface RawUserProfileRow {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
}

export interface RawMemberDepartmentRow {
  readonly userId: string;
  readonly id: string;
  readonly name: string;
}

export interface RawTaskDepartmentRow {
  readonly taskId: string;
  readonly id: string;
  readonly name: string;
}

export const toTaskPriority = (raw: number): TaskPriority =>
  raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 2;

export function sameSortedStringSets(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

export function computeAssigneeSyncPlan(
  currentIds: readonly string[],
  nextIds: readonly string[],
): { readonly toRemove: string[]; readonly toAdd: string[] } {
  const nextSet = new Set(nextIds);
  const currentSet = new Set(currentIds);
  return {
    toRemove: currentIds.filter((id) => !nextSet.has(id)),
    toAdd: nextIds.filter((id) => !currentSet.has(id)),
  };
}

export function buildAssigneesDiffChanges(input: ReplaceAssigneesRepoParams): {
  readonly assigneesChanged: boolean;
  readonly departmentsChanged: boolean;
  readonly changes: Record<string, unknown>;
} {
  const assigneesChanged = !sameSortedStringSets(
    input.currentAssigneeIds,
    input.nextAssigneeIds,
  );
  const departmentsChanged = !sameSortedStringSets(
    input.currentDepartmentIds,
    input.nextDepartmentIds,
  );
  const changes: Record<string, unknown> = {};
  if (assigneesChanged) {
    changes.assignee_ids = {
      from: input.currentAssigneeIds,
      to: input.nextAssigneeIds,
    };
  }
  if (departmentsChanged) {
    changes.department_ids = {
      from: input.currentDepartmentIds,
      to: input.nextDepartmentIds,
    };
  }
  return { assigneesChanged, departmentsChanged, changes };
}

export function groupTaskIdStrings(
  rows: ReadonlyArray<{ readonly taskId: string; readonly value: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.taskId);
    if (list) list.push(row.value);
    else map.set(row.taskId, [row.value]);
  }
  return map;
}

export function buildUserSummariesMap(
  profileRows: readonly RawUserProfileRow[],
  deptRows: readonly RawMemberDepartmentRow[],
): Map<string, TaskMemberSummaryRecord> {
  const deptMap = new Map<string, TaskDepartmentSummaryRecord[]>();
  for (const row of deptRows) {
    const list = deptMap.get(row.userId);
    const dept = { id: row.id, name: row.name };
    if (list) list.push(dept);
    else deptMap.set(row.userId, [dept]);
  }
  const map = new Map<string, TaskMemberSummaryRecord>();
  for (const row of profileRows) {
    map.set(row.id, { ...row, departments: deptMap.get(row.id) ?? [] });
  }
  return map;
}

function groupTaskAssignees(
  assigneeRows: readonly RawTaskAssigneeRow[],
  userMap: ReadonlyMap<string, TaskMemberSummaryRecord>,
): Map<string, TaskAssigneeRecord[]> {
  const map = new Map<string, TaskAssigneeRecord[]>();
  for (const row of assigneeRows) {
    const user = userMap.get(row.userId);
    if (!user) continue;
    const entry: TaskAssigneeRecord = { ...user, acceptedAt: row.acceptedAt };
    const list = map.get(row.taskId);
    if (list) list.push(entry);
    else map.set(row.taskId, [entry]);
  }
  return map;
}

function groupTaskDepartments(
  deptRows: readonly RawTaskDepartmentRow[],
): Map<string, TaskDepartmentSummaryRecord[]> {
  const map = new Map<string, TaskDepartmentSummaryRecord[]>();
  for (const row of deptRows) {
    const list = map.get(row.taskId);
    const dept = { id: row.id, name: row.name };
    if (list) list.push(dept);
    else map.set(row.taskId, [dept]);
  }
  return map;
}

function groupTaskDeliverables(
  deliverableRows: readonly RawTaskDeliverableRow[],
  userMap: ReadonlyMap<string, TaskMemberSummaryRecord>,
): Map<string, TaskDeliverableRecord[]> {
  const map = new Map<string, TaskDeliverableRecord[]>();
  for (const row of deliverableRows) {
    const submitter = userMap.get(row.submittedBy);
    if (!submitter) continue;
    const item: TaskDeliverableRecord = {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      url: row.url,
      submittedBy: submitter,
      createdAt: row.createdAt,
    };
    const list = map.get(row.taskId);
    if (list) list.push(item);
    else map.set(row.taskId, [item]);
  }
  return map;
}

export function assembleTaskRecords(params: {
  readonly taskRows: readonly RawTaskRow[];
  readonly assigneeRows: readonly RawTaskAssigneeRow[];
  readonly departmentRows: readonly RawTaskDepartmentRow[];
  readonly deliverableRows: readonly RawTaskDeliverableRow[];
  readonly commentCountRows: ReadonlyArray<{ readonly taskId: string; readonly total: number }>;
  readonly userMap: ReadonlyMap<string, TaskMemberSummaryRecord>;
}): TaskRecord[] {
  const countMap = new Map(params.commentCountRows.map((r) => [r.taskId, Number(r.total)]));
  const assigneeMap = groupTaskAssignees(params.assigneeRows, params.userMap);
  const departmentMap = groupTaskDepartments(params.departmentRows);
  const deliverableMap = groupTaskDeliverables(params.deliverableRows, params.userMap);

  return params.taskRows.map((row) => {
    const deliverables = (deliverableMap.get(row.id) ?? []).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
    return {
      ...row,
      priority: toTaskPriority(row.priority),
      assignees: (assigneeMap.get(row.id) ?? []).sort(
        (a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id),
      ),
      assignedDepartments: (departmentMap.get(row.id) ?? []).sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      ),
      deliverables,
      deliverableCount: deliverables.length,
      creator: params.userMap.get(row.createdBy)!,
      commentCount: countMap.get(row.id) ?? 0,
    };
  });
}

export function buildTaskUpdatePatch(input: UpdateTaskRepoParams): {
  updatedAt: Date;
  title?: string;
  description?: string | null;
  startAt?: Date | null;
  dueAt?: Date | null;
  isCompleted?: boolean;
  completedAt?: Date | null;
  priority?: TaskPriority;
} {
  const patch: {
    updatedAt: Date;
    title?: string;
    description?: string | null;
    startAt?: Date | null;
    dueAt?: Date | null;
    isCompleted?: boolean;
    completedAt?: Date | null;
    priority?: TaskPriority;
  } = { updatedAt: input.now };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.startAt !== undefined) patch.startAt = input.startAt;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  if (input.isCompleted !== undefined && input.changes.is_completed) {
    patch.isCompleted = input.isCompleted;
    patch.completedAt = input.isCompleted ? input.now : null;
  }
  if (input.priority !== undefined) patch.priority = input.priority;
  return patch;
}

export function buildCreateTaskEventChanges(
  input: CreateTaskRepoParams,
  resolvedColumnId: string,
): Record<string, unknown> {
  return {
    column_id: resolvedColumnId,
    priority: input.priority,
    is_hidden: input.isHidden,
    assignee_ids: input.assigneeIds,
    department_ids: input.departmentIds,
  };
}
