export {
  buildDepartmentAssignedEmail,
  type BuildDepartmentEmailParams,
  type RenderedNotificationEmail,
} from './email-template';
export {
  type NotificationDto,
  type NotificationPageResponseDto,
  type NotificationReadAllResponseDto,
  type NotificationReadResponseDto,
  toNotificationDto,
  toNotificationPageResponseDto,
  toNotificationReadAllResponseDto,
  toNotificationReadResponseDto,
} from './mapper';
export {
  buildNotificationPayload,
  decodeNotificationCursor,
  dedupeDepartmentRecipients,
  type DeduplicatedDepartmentRecipient,
  encodeNotificationCursor,
} from './policy';
export { DrizzleNotificationsRepository } from './repository';
export { NotificationsService, type NotificationsServiceDeps } from './service';
export type {
  CreateNotificationRowInput,
  DepartmentAssignmentContextRecord,
  DepartmentRecipientRecord,
  ListNotificationsRepoParams,
  NotificationCursor,
  NotificationDepartmentSummaryRecord,
  NotificationPayloadRecord,
  NotificationRecord,
  NotificationsDispatcher,
  NotificationsRepository,
  NotifyDepartmentAssignmentInput,
} from './types';
