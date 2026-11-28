import { z } from 'zod';
import {
  defaultQueryLimitSchema,
  emptyToUndefined,
  optionalCursorQuerySchema,
} from './query-params';

export const ARCHIVE_TABS = ['tasks', 'members', 'boards'] as const;
export type ArchiveTab = (typeof ARCHIVE_TABS)[number];

export const ARCHIVE_ENTITY_TYPES = ['tasks', 'members', 'boards'] as const;
export type ArchiveEntityType = (typeof ARCHIVE_ENTITY_TYPES)[number];

export const ARCHIVE_RETENTION_DAYS = [7, 30, 90] as const;
export type ArchiveRetentionDays = (typeof ARCHIVE_RETENTION_DAYS)[number] | null;

export const ARCHIVE_PURGE_MODES = [
  'marked_purged',
  'anonymized',
  'physical_delete',
] as const;
export type ArchivePurgeMode = (typeof ARCHIVE_PURGE_MODES)[number];

export const PURGED_MEMBER_DISPLAY_NAME = 'Thành viên đã xóa';

export const archiveTabSchema = z.enum(ARCHIVE_TABS);
export const archiveEntityTypeSchema = z.enum(ARCHIVE_ENTITY_TYPES);

export const archiveRetentionDaysSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(90),
  z.null(),
]);

export const updateArchiveRetentionRequestSchema = z
  .object({
    retentionDays: archiveRetentionDaysSchema,
  })
  .strict();

export type UpdateArchiveRetentionRequestInput = z.infer<
  typeof updateArchiveRetentionRequestSchema
>;

export const listArchiveQuerySchema = z.object({
  tab: z.preprocess(emptyToUndefined, archiveTabSchema.default('tasks')),
  q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200).optional()),
  cursor: optionalCursorQuerySchema,
  limit: defaultQueryLimitSchema,
});

export type ListArchiveQueryInput = z.infer<typeof listArchiveQuerySchema>;
