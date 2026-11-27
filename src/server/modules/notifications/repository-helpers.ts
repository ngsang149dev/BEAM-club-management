import { notificationTypeSchema } from '@/lib/notifications';
import type { TaskMemberSummaryRecord } from '@/server/modules/tasks';
import type {
  LeadRecipientCandidateRecord,
  NotificationRecord,
  TaskActivityNotificationContextRecord,
} from './types';

export interface SelectedNotificationRow {
  readonly id: string;
  readonly type: string;
  readonly taskId: string;
  readonly boardId: string;
  readonly departmentId: string | null;
  readonly actorId: string;
  readonly isHiddenTask: boolean;
  readonly payload: Record<string, unknown>;
  readonly readAt: Date | null;
  readonly createdAt: Date;
  readonly liveTaskTitle: string;
  readonly liveTaskIsHidden: boolean;
  readonly liveBoardName: string;
  readonly liveDepartmentName: string | null;
}

export interface RawLeadProfileRow {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: string;
  readonly isAdmin: boolean;
}

function readPayloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const val = payload[key];
  return typeof val === 'string' && val.length > 0 ? val : null;
}

export function mapSelectedNotificationRows(
  rows: readonly SelectedNotificationRow[],
  actorMap: ReadonlyMap<string, TaskMemberSummaryRecord>,
): NotificationRecord[] {
  return rows.map((row) => {
    const isHiddenTask = row.isHiddenTask || row.liveTaskIsHidden;
    const parsedType = notificationTypeSchema.safeParse(row.type);
    return {
      id: row.id,
      type: parsedType.success ? parsedType.data : 'task.department_assigned',
      taskId: row.taskId,
      boardId: row.boardId,
      departmentId: row.departmentId,
      departmentName:
        readPayloadString(row.payload, 'departmentName') ??
        row.liveDepartmentName ??
        null,
      boardName:
        row.liveBoardName || readPayloadString(row.payload, 'boardName') || '',
      taskTitle: isHiddenTask ? null : row.liveTaskTitle,
      isHiddenTask,
      actor: actorMap.get(row.actorId)!,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  });
}

function appendMappedId(map: Map<string, string[]>, key: string | null, value: string): void {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface AssembleTaskActivityContextParams {
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly description?: string | null;
    readonly startAt?: Date | null;
    readonly dueAt?: Date | null;
    readonly isCompleted?: boolean;
    readonly isHidden: boolean;
    readonly createdBy: string;
  };
  readonly board: { readonly id: string; readonly name: string };
  readonly actor: { readonly id: string; readonly fullName: string };
  readonly taskDepts: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly leadUserId: string | null;
  }>;
  readonly taskAssigneeIds: readonly string[];
  readonly deliverable: {
    readonly id: string;
    readonly title: string;
    readonly url: string;
  } | null;
  readonly candidateProfiles: readonly RawLeadProfileRow[];
  readonly candidateMemberDepts: ReadonlyArray<{
    readonly userId: string;
    readonly departmentId: string;
  }>;
}

export function assembleTaskActivityContext(
  params: AssembleTaskActivityContextParams,
): TaskActivityNotificationContextRecord {
  const leadDeptsByUser = new Map<string, string[]>();
  params.taskDepts.forEach((d) => appendMappedId(leadDeptsByUser, d.leadUserId, d.id));
  const memberDeptsByUser = new Map<string, string[]>();
  params.candidateMemberDepts.forEach((r) => appendMappedId(memberDeptsByUser, r.userId, r.departmentId));
  const candidates: LeadRecipientCandidateRecord[] = params.candidateProfiles.map((profile) => ({
    userId: profile.userId,
    email: profile.email,
    fullName: profile.fullName,
    locale: profile.locale === 'en' ? 'en' : 'vi',
    isAdmin: profile.isAdmin,
    memberDepartmentIds: memberDeptsByUser.get(profile.userId) ?? [],
    leadDepartmentIds: leadDeptsByUser.get(profile.userId) ?? [],
    isCreator: profile.userId === params.task.createdBy,
  }));
  return {
    task: {
      ...params.task,
      assigneeIds: params.taskAssigneeIds,
      assignedDepartmentIds: params.taskDepts.map((d) => d.id),
    },
    board: params.board,
    actor: params.actor,
    assignedDepartments: params.taskDepts.map((d) => ({ id: d.id, name: d.name })),
    deliverable: params.deliverable,
    candidates,
  };
}
