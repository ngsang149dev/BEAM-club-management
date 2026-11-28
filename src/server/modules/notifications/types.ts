import type { NotificationType } from '@/lib/notifications';
import type { TaskMemberSummaryRecord } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';

export interface NotificationCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface NotificationDepartmentSummaryRecord {
  readonly id: string;
  readonly name: string;
}

export interface NotificationPayloadRecord {
  readonly taskTitle: string | null;
  readonly boardName: string;
  readonly departmentName: string | null;
}

export interface NotificationRecord {
  readonly id: string;
  readonly type: NotificationType;
  readonly taskId: string;
  readonly boardId: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly boardName: string;
  readonly taskTitle: string | null;
  readonly isHiddenTask: boolean;
  readonly actor: TaskMemberSummaryRecord;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface DepartmentRecipientRecord {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: 'vi' | 'en';
  readonly departmentId: string;
}

export interface DirectAssigneeRecipientRecord {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: 'vi' | 'en';
}

export interface DepartmentAssignmentContextRecord {
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly description?: string | null;
    readonly startAt?: Date | null;
    readonly dueAt?: Date | null;
    readonly isCompleted?: boolean;
    readonly isHidden: boolean;
  };
  readonly board: {
    readonly id: string;
    readonly name: string;
  };
  readonly actor: {
    readonly id: string;
    readonly fullName: string;
  };
  readonly departments: readonly NotificationDepartmentSummaryRecord[];
  readonly members: readonly DepartmentRecipientRecord[];
  readonly directAssignees?: readonly DirectAssigneeRecipientRecord[];
}

export interface LeadRecipientCandidateRecord {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: 'vi' | 'en';
  readonly isAdmin: boolean;
  readonly memberDepartmentIds: readonly string[];
  readonly leadDepartmentIds: readonly string[];
  readonly isCreator: boolean;
}

export interface TaskActivityNotificationContextRecord {
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly description?: string | null;
    readonly startAt?: Date | null;
    readonly dueAt?: Date | null;
    readonly isCompleted?: boolean;
    readonly isHidden: boolean;
    readonly createdBy: string;
    readonly assigneeIds: readonly string[];
    readonly assignedDepartmentIds: readonly string[];
  };
  readonly board: {
    readonly id: string;
    readonly name: string;
  };
  readonly actor: {
    readonly id: string;
    readonly fullName: string;
  };
  readonly assignedDepartments: readonly NotificationDepartmentSummaryRecord[];
  readonly deliverable?: {
    readonly id: string;
    readonly title: string;
    readonly url: string;
  } | null;
  readonly candidates: readonly LeadRecipientCandidateRecord[];
}

export interface CreateNotificationRowInput {
  readonly userId: string;
  readonly type: NotificationType;
  readonly taskId: string;
  readonly boardId: string;
  readonly departmentId: string | null;
  readonly actorId: string;
  readonly isHiddenTask: boolean;
  readonly payload: NotificationPayloadRecord;
  readonly createdAt: Date;
}

export interface ListNotificationsRepoParams {
  readonly unreadOnly?: boolean;
  readonly cursor?: NotificationCursor;
  readonly limit: number;
}

export interface NotifyDepartmentAssignmentInput {
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly departmentIds: readonly string[];
  readonly assigneeIds?: readonly string[];
  readonly notifyInApp?: boolean;
  readonly notifyEmail?: boolean;
  readonly isHiddenTask: boolean;
  readonly now: Date;
}

export interface NotifyTaskAcceptedInput {
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly isHiddenTask: boolean;
  readonly now: Date;
}

export interface NotifyDeliverableSubmittedInput {
  readonly taskId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly deliverableId: string;
  readonly isHiddenTask: boolean;
  readonly now: Date;
}

export interface NotificationsDispatcher {
  notifyDepartmentAssignment(
    input: NotifyDepartmentAssignmentInput,
  ): Promise<void>;
  notifyTaskAccepted(input: NotifyTaskAcceptedInput): Promise<void>;
  notifyDeliverableSubmitted(
    input: NotifyDeliverableSubmittedInput,
  ): Promise<void>;
}

export interface NotificationsRepository {
  loadDepartmentAssignmentContext(input: {
    readonly taskId: string;
    readonly boardId: string;
    readonly actorId: string;
    readonly departmentIds: readonly string[];
    readonly assigneeIds?: readonly string[];
  }): Promise<DepartmentAssignmentContextRecord | null>;
  loadTaskActivityContext(input: {
    readonly taskId: string;
    readonly boardId: string;
    readonly actorId: string;
    readonly deliverableId?: string;
  }): Promise<TaskActivityNotificationContextRecord | null>;
  insertNotifications(
    rows: readonly CreateNotificationRowInput[],
    tx?: TransactionContext,
  ): Promise<ReadonlyArray<{ readonly id: string; readonly userId: string }>>;
  listVisibleForUser(
    actor: AuthActor,
    params: ListNotificationsRepoParams,
  ): Promise<{
    readonly rows: NotificationRecord[];
    readonly unreadCount: number;
    readonly hasMore: boolean;
  }>;
  markReadForUser(
    actor: AuthActor,
    notificationId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<{
    readonly notification: NotificationRecord;
    readonly unreadCount: number;
  } | null>;
  markAllReadForUser(
    actor: AuthActor,
    now: Date,
    tx: TransactionContext,
  ): Promise<{
    readonly updatedCount: number;
    readonly unreadCount: number;
  }>;
}
