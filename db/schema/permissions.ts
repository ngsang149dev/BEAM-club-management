import { isNotNull, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { profiles } from './identity';

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    leadUserId: uuid('lead_user_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('departments_name_uq').on(table.name),
    uniqueIndex('departments_name_lower_uq').on(sql`lower(btrim(${table.name}))`),
    index('departments_lead_user_id_idx')
      .on(table.leadUserId)
      .where(isNotNull(table.leadUserId)),
  ],
);

export const memberDepartments = pgTable(
  'member_departments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'member_departments_pkey',
      columns: [table.userId, table.departmentId],
    }),
    index('member_departments_department_id_idx').on(table.departmentId),
  ],
);

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  groupName: text('group_name').notNull(),
  description: text('description').notNull(),
  scopable: boolean('scopable').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'restrict' }),
    grantedBy: uuid('granted_by').references(() => profiles.id, {
      onDelete: 'restrict',
    }),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_permissions_pkey',
      columns: [table.userId, table.permissionCode],
    }),
    index('user_permissions_permission_code_idx').on(table.permissionCode),
  ],
);

export const permissionPresets = pgTable(
  'permission_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique('permission_presets_code_uq').on(table.code)],
);

export const presetPermissions = pgTable(
  'preset_permissions',
  {
    presetId: uuid('preset_id')
      .notNull()
      .references(() => permissionPresets.id, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'preset_permissions_pkey',
      columns: [table.presetId, table.permissionCode],
    }),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    targetUserId: uuid('target_user_id').references(() => profiles.id, {
      onDelete: 'restrict',
    }),
    detail: jsonb('detail')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_logs_created_at_idx').on(table.createdAt.desc()),
    index('audit_logs_target_user_id_created_at_idx')
      .on(table.targetUserId, table.createdAt.desc())
      .where(isNotNull(table.targetUserId)),
  ],
);
