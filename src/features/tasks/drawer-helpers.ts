import { z } from 'zod';
import { taskTitleSchema } from '@/lib/tasks';
import { utcIsoToHoChiMinhInput } from './formatters';
import type { DepartmentDto, ReplaceTaskAssigneesRequest, TaskDto } from './hooks/useTasks';
import type { TaskAssigneeOption, TaskDepartmentOption } from './components/TaskFormFields';

export const editTaskSchema = z
  .object({
    title: taskTitleSchema,
    description: z.string().max(10000),
    startAtInput: z.string().trim().min(1, 'required'),
    dueAtInput: z.string().trim().min(1, 'required'),
  })
  .refine((d) => !(d.startAtInput && d.dueAtInput && d.startAtInput > d.dueAtInput), {
    message: 'invalidDateRange',
    path: ['dueAtInput'],
  });

export type EditTaskValues = z.infer<typeof editTaskSchema>;

export function toEditTaskValues(task: TaskDto): EditTaskValues {
  return {
    title: task.title,
    description: task.description ?? '',
    startAtInput: utcIsoToHoChiMinhInput(task.startAt),
    dueAtInput: utcIsoToHoChiMinhInput(task.dueAt),
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

export function resolveAssignedDepartmentLeads(
  assignedDepartments: TaskDto['assignedDepartments'],
  catalog: readonly DepartmentDto[],
  leftBadge: string
): string[] {
  const byId = new Map(catalog.map((dept) => [dept.id, dept]));
  const seenIds = new Set<string>();
  const labels: string[] = [];
  for (const assigned of assignedDepartments) {
    const lead = byId.get(assigned.id)?.lead;
    if (!lead || seenIds.has(lead.id)) continue;
    seenIds.add(lead.id);
    labels.push(lead.isActive ? lead.fullName : `${lead.fullName} ${leftBadge}`);
  }
  return labels;
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
