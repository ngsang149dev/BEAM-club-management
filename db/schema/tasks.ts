import { isNotNull, isNull, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { boards, columns } from './boards';
import { profiles } from './identity';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'restrict' }),
    columnId: uuid('column_id').references(() => columns.id, {
      onDelete: 'restrict',
    }),
    title: text('title').notNull(),
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    priority: smallint('priority').notNull().default(2),
    position: numeric('position').notNull(),
    isHidden: boolean('is_hidden').notNull().default(false),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('tasks_priority_chk', sql`${table.priority} BETWEEN 1 AND 4`),
    check('tasks_version_chk', sql`${table.version} >= 1`),
    check(
      'tasks_active_column_not_null_chk',
      sql`${table.deletedAt} IS NOT NULL OR ${table.columnId} IS NOT NULL`,
    ),
    index('tasks_board_column_position_active_idx')
      .on(table.boardId, table.columnId, table.position)
      .where(isNull(table.deletedAt)),
    index('tasks_due_at_active_idx')
      .on(table.dueAt)
      .where(sql`${table.deletedAt} IS NULL AND ${table.dueAt} IS NOT NULL`),
    index('tasks_board_deleted_at_idx')
      .on(table.boardId, table.deletedAt.desc())
      .where(isNotNull(table.deletedAt)),
    index('tasks_created_by_idx').on(table.createdBy),
  ],
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'task_assignees_pkey',
      columns: [table.taskId, table.userId],
    }),
    index('task_assignees_user_id_idx').on(table.userId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('comments_task_id_created_at_idx').on(table.taskId, table.createdAt)],
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'restrict' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    changes: jsonb('changes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    revertsEventId: uuid('reverts_event_id').references(
      (): AnyPgColumn => taskEvents.id,
      { onDelete: 'restrict' },
    ),
    forced: boolean('forced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('task_events_task_id_created_at_idx').on(table.taskId, table.createdAt.desc()),
    index('task_events_reverts_event_id_idx')
      .on(table.revertsEventId)
      .where(isNotNull(table.revertsEventId)),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('reminders_task_user_kind_uq').on(table.taskId, table.userId, table.kind),
  ],
);
