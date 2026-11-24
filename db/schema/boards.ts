import { isNotNull, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { profiles } from './identity';
import { departments } from './permissions';

export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    departmentId: uuid('department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'boards_purged_requires_archived_chk',
      sql`${table.purgedAt} IS NULL OR ${table.archivedAt} IS NOT NULL`,
    ),
    index('boards_department_id_idx')
      .on(table.departmentId)
      .where(isNotNull(table.departmentId)),
    index('boards_archive_archived_at_idx')
      .on(table.archivedAt.desc(), table.id.desc())
      .where(sql`${table.archivedAt} IS NOT NULL AND ${table.purgedAt} IS NULL`),
  ],
);

export const columns = pgTable(
  'columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('columns_board_id_order_index_idx').on(table.boardId, table.orderIndex),
  ],
);
