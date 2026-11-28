import { z } from 'zod';
import {
  createQueryLimitSchema,
  optionalCursorQuerySchema,
  parseStrictBooleanInput,
} from './query-params';

export const NOTIFICATION_TYPES = [
  'task.department_assigned',
  'task.assigned',
  'task.accepted',
  'task.deliverable_submitted',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z.preprocess(parseStrictBooleanInput, z.boolean().optional()),
  cursor: optionalCursorQuerySchema,
  limit: createQueryLimitSchema(50, 20),
});

export type ListNotificationsQueryInput = z.infer<
  typeof listNotificationsQuerySchema
>;
