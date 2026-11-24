import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver(value: Buffer | Uint8Array): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: text('student_id').notNull(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    avatarData: bytea('avatar_data'),
    avatarMime: text('avatar_mime'),
    avatarUpdatedAt: timestamp('avatar_updated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    isAdmin: boolean('is_admin').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    leftAt: timestamp('left_at', { withTimezone: true, mode: 'date' }),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }),
    locale: text('locale').notNull().default('vi'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('profiles_student_id_uq').on(table.studentId),
    uniqueIndex('profiles_email_lower_uq').on(sql`lower(${table.email})`),
    check('profiles_locale_chk', sql`${table.locale} IN ('vi', 'en')`),
    check(
      'profiles_purged_requires_inactive_chk',
      sql`${table.purgedAt} IS NULL OR ${table.isActive} = false`,
    ),
    index('profiles_archive_left_at_idx')
      .on(sql`${table.leftAt} DESC NULLS LAST`, table.id.desc())
      .where(sql`${table.isActive} = false AND ${table.purgedAt} IS NULL`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    rememberMe: boolean('remember_me').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('sessions_token_hash_uq').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: text('student_id').notNull(),
    ip: text('ip').notNull(),
    success: boolean('success').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('login_attempts_ip_created_at_idx').on(table.ip, table.createdAt.desc()),
  ],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid('updated_by').references(() => profiles.id, {
    onDelete: 'restrict',
  }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const clubAssets = pgTable(
  'club_assets',
  {
    key: text('key').primaryKey(),
    mimeType: text('mime_type').notNull(),
    data: bytea('data').notNull(),
    updatedBy: uuid('updated_by').references(() => profiles.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'club_assets_mime_type_chk',
      sql`${table.mimeType} IN ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check(
      'club_assets_data_size_chk',
      sql`octet_length(${table.data}) BETWEEN 1 AND 262144`,
    ),
  ],
);
