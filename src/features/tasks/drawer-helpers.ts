import { z } from 'zod';
import { taskPrioritySchema, taskTitleSchema } from '@/lib/tasks';
import { utcIsoToHoChiMinhInput } from './formatters';
import type { ReplaceTaskAssigneesRequest, TaskDto } from './hooks/useTasks';
import type { TaskAssigneeOption, TaskDepartmentOption } from './components/TaskFormFields';

export const editTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(10000),
  dueAtInput: z.string(),
  priority: taskPrioritySchema,
});

export type EditTaskValues = z.infer<typeof editTaskSchema>;

export function toEditTaskValues(task: TaskDto): EditTaskValues {
  const initialPrio = task.priority >= 1 && task.priority <= 4 ? (task.priority as 1 | 2 | 3 | 4) : 2;
  return {
    title: task.title,
    description: task.description ?? '',
    dueAtInput: utcIsoToHoChiMinhInput(task.dueAt),
    priority: initialPrio,
  };
}

export function mergeAssigneeOptions(
  activeMembers: readonly TaskAssigneeOption[],
  existingAssignees: TaskDto['assignees']
): TaskAssigneeOption[] {
  const seen = new Set(activeMembers.map((member) => member.id));
  const formerAssignees = existingAssignees.filter((assignee) => !seen.has(assignee.id));
  return [...activeMembers, ...formerAssignees];
}

export function mergeDepartmentOptions(
  catalog: readonly TaskDepartmentOption[],
  assignedDepartments: TaskDto['assignedDepartments']
): TaskDepartmentOption[] {
  const seen = new Set(catalog.map((dept) => dept.id));
  const missing = assignedDepartments.filter((dept) => !seen.has(dept.id));
  return [...catalog, ...missing];
}

export function toggleId(prev: string[], id: string): string[] {
  return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
}

export function buildReplaceTaskAssigneesPayload(params: {
  readonly departmentIds: readonly string[];
  readonly assigneeIds?: readonly string[];
  readonly canViewMembers?: boolean;
  readonly notifyInApp: boolean;
  readonly notifyEmail: boolean;
  readonly version: number;
}): ReplaceTaskAssigneesRequest {
  const includeAssignees = params.canViewMembers ?? params.assigneeIds !== undefined;
  return {
    departmentIds: [...params.departmentIds],
    ...(includeAssignees && params.assigneeIds !== undefined
      ? { assigneeIds: [...params.assigneeIds] }
      : {}),
    notifyInApp: params.notifyInApp,
    notifyEmail: params.notifyEmail,
    notifyDepartmentMembers: params.notifyInApp || params.notifyEmail,
    version: params.version,
  };
}

export interface AssigneeSelectionDraft {
  readonly taskId: string;
  readonly version: number;
  readonly deptIds: string[];
  readonly memberIds: string[];
}

export function resolveAssigneeSelection(
  draft: AssigneeSelectionDraft | null,
  task: TaskDto
): { readonly deptIds: string[]; readonly memberIds: string[] } {
  if (draft && draft.taskId === task.id && draft.version === task.version) {
    return { deptIds: draft.deptIds, memberIds: draft.memberIds };
  }
  return {
    deptIds: task.assignedDepartments.map((dept) => dept.id),
    memberIds: task.assignees.map((assignee) => assignee.id),
  };
}

export function hasTaskVersionChanged(
  prev: { readonly id: string; readonly version: number },
  nextId: string,
  nextVersion: number
): boolean {
  return prev.id !== nextId || prev.version !== nextVersion;
}

export function applyAssigneeSelectionToggle(
  prev: AssigneeSelectionDraft | null,
  task: TaskDto,
  kind: 'dept' | 'member',
  id: string
): AssigneeSelectionDraft {
  const base = resolveAssigneeSelection(prev, task);
  return {
    taskId: task.id,
    version: task.version,
    deptIds: kind === 'dept' ? toggleId(base.deptIds, id) : base.deptIds,
    memberIds: kind === 'member' ? toggleId(base.memberIds, id) : base.memberIds,
  };
}
