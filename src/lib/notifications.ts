import { z } from 'zod';
import {
  optionalCursorQuerySchema,
  parseIntegerInput,
  parseStrictBooleanInput,
} from './tasks';

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
  limit: z.preprocess(
    parseIntegerInput,
    z.number().int().min(1).max(50).default(20),
  ),
});

export type ListNotificationsQueryInput = z.infer<
  typeof listNotificationsQuerySchema
>;
