import type { TaskPriority } from '@/lib/tasks';
import type {
  CreateTaskRepoParams,
  ReplaceAssigneesRepoParams,
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
  readonly dueAt: Date | null;
  readonly priority: number;
  readonly position: string;
  readonly isHidden: boolean;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
  assigneeRows: ReadonlyArray<{ readonly taskId: string; readonly userId: string }>,
  userMap: ReadonlyMap<string, TaskMemberSummaryRecord>,
): Map<string, TaskMemberSummaryRecord[]> {
  const map = new Map<string, TaskMemberSummaryRecord[]>();
  for (const row of assigneeRows) {
    const user = userMap.get(row.userId);
    if (!user) continue;
    const list = map.get(row.taskId);
    if (list) list.push(user);
    else map.set(row.taskId, [user]);
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

export function assembleTaskRecords(params: {
  readonly taskRows: readonly RawTaskRow[];
  readonly assigneeRows: ReadonlyArray<{ readonly taskId: string; readonly userId: string }>;
  readonly departmentRows: readonly RawTaskDepartmentRow[];
  readonly commentCountRows: ReadonlyArray<{ readonly taskId: string; readonly total: number }>;
  readonly userMap: ReadonlyMap<string, TaskMemberSummaryRecord>;
}): TaskRecord[] {
  const countMap = new Map(params.commentCountRows.map((r) => [r.taskId, Number(r.total)]));
  const assigneeMap = groupTaskAssignees(params.assigneeRows, params.userMap);
  const departmentMap = groupTaskDepartments(params.departmentRows);

  return params.taskRows.map((row) => ({
    ...row,
    priority: toTaskPriority(row.priority),
    assignees: (assigneeMap.get(row.id) ?? []).sort(
      (a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id),
    ),
    assignedDepartments: (departmentMap.get(row.id) ?? []).sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
    creator: params.userMap.get(row.createdBy)!,
    commentCount: countMap.get(row.id) ?? 0,
  }));
}

export function buildTaskUpdatePatch(input: UpdateTaskRepoParams): {
  updatedAt: Date;
  title?: string;
  description?: string | null;
  dueAt?: Date | null;
  priority?: TaskPriority;
} {
  const patch: {
    updatedAt: Date;
    title?: string;
    description?: string | null;
    dueAt?: Date | null;
    priority?: TaskPriority;
  } = { updatedAt: input.now };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  if (input.priority !== undefined) patch.priority = input.priority;
  return patch;
}

export function buildCreateTaskEventChanges(input: CreateTaskRepoParams): Record<string, unknown> {
  return {
    column_id: input.columnId,
    priority: input.priority,
    is_hidden: input.isHidden,
    assignee_ids: input.assigneeIds,
    department_ids: input.departmentIds,
  };
}
