import { isNull, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { boards } from './boards';
import { profiles } from './identity';
import { departments } from './permissions';
import { tasks } from './tasks';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    isHiddenTask: boolean('is_hidden_task').notNull().default(false),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'notifications_type_chk',
      sql`${table.type} IN ('task.department_assigned', 'task.assigned')`,
    ),
    index('notifications_user_created_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('notifications_user_unread_idx')
      .on(table.userId, table.createdAt.desc())
      .where(isNull(table.readAt)),
    index('notifications_task_id_idx').on(table.taskId),
    index('notifications_actor_id_idx').on(table.actorId),
  ],
);
