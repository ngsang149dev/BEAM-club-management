import { z } from 'zod';
import {
  defaultQueryLimitSchema,
  emptyToUndefined,
  optionalCursorQuerySchema,
  optionalIsoDateQuerySchema,
  optionalUuidQuerySchema,
} from './query-params';

export interface PermissionDefinition {
  readonly code: PermissionCode;
  readonly group: PermissionGroup;
  readonly descriptionKey: string;
}

export type PermissionGroup =
  | 'members'
  | 'departments'
  | 'boards'
  | 'tasks'
  | 'comments'
  | 'system';

export const PERMISSIONS = [
  {
    code: 'member.view',
    group: 'members',
    descriptionKey: 'permissions.catalog.member_view',
  },
  {
    code: 'member.view_detail',
    group: 'members',
    descriptionKey: 'permissions.catalog.member_view_detail',
  },
  {
    code: 'member.create',
    group: 'members',
    descriptionKey: 'permissions.catalog.member_create',
  },
  {
    code: 'member.update',
    group: 'members',
    descriptionKey: 'permissions.catalog.member_update',
  },
  {
    code: 'member.deactivate',
    group: 'members',
    descriptionKey: 'permissions.catalog.member_deactivate',
  },
  {
    code: 'department.manage',
    group: 'departments',
    descriptionKey: 'permissions.catalog.department_manage',
  },
  {
    code: 'board.create',
    group: 'boards',
    descriptionKey: 'permissions.catalog.board_create',
  },
  {
    code: 'board.update',
    group: 'boards',
    descriptionKey: 'permissions.catalog.board_update',
  },
  {
    code: 'board.delete',
    group: 'boards',
    descriptionKey: 'permissions.catalog.board_delete',
  },
  {
    code: 'task.create',
    group: 'tasks',
    descriptionKey: 'permissions.catalog.task_create',
  },
  {
    code: 'task.assign',
    group: 'tasks',
    descriptionKey: 'permissions.catalog.task_assign',
  },
  {
    code: 'task.update_any',
    group: 'tasks',
    descriptionKey: 'permissions.catalog.task_update_any',
  },
  {
    code: 'task.update_assigned',
    group: 'tasks',
    descriptionKey: 'permissions.catalog.task_update_assigned',
  },
  {
    code: 'task.delete',
    group: 'tasks',
    descriptionKey: 'permissions.catalog.task_delete',
  },
  {
    code: 'comment.create',
    group: 'comments',
    descriptionKey: 'permissions.catalog.comment_create',
  },
  {
    code: 'comment.delete_any',
    group: 'comments',
    descriptionKey: 'permissions.catalog.comment_delete_any',
  },
  {
    code: 'reminder.configure',
    group: 'system',
    descriptionKey: 'permissions.catalog.reminder_configure',
  },
  {
    code: 'audit.view',
    group: 'system',
    descriptionKey: 'permissions.catalog.audit_view',
  },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES: readonly [PermissionCode, ...PermissionCode[]] = [
  PERMISSIONS[0].code,
  ...PERMISSIONS.slice(1).map((permission) => permission.code),
];

const PERMISSION_CODE_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_CODE_SET.has(value);
}

export const DEFAULT_MEMBER_PERMISSIONS = [
  'member.view',
  'task.update_assigned',
  'comment.create',
] as const satisfies readonly PermissionCode[];

export interface PermissionPresetDefinition {
  readonly code: PermissionPresetCode;
  readonly nameKey: string;
  readonly permissions: readonly PermissionCode[];
}

export const PERMISSION_PRESET_CODES = [
  'basic_member',
  'department_lead',
  'hr_manager',
] as const;

export const PERMISSION_PRESETS = [
  {
    code: 'basic_member',
    nameKey: 'permissions.presets.basic_member',
    permissions: DEFAULT_MEMBER_PERMISSIONS,
  },
  {
    code: 'department_lead',
    nameKey: 'permissions.presets.department_lead',
    permissions: [
      ...DEFAULT_MEMBER_PERMISSIONS,
      'member.view_detail',
      'board.create',
      'board.update',
      'task.create',
      'task.assign',
      'task.update_any',
    ],
  },
  {
    code: 'hr_manager',
    nameKey: 'permissions.presets.hr_manager',
    permissions: [
      ...DEFAULT_MEMBER_PERMISSIONS,
      'member.view_detail',
      'member.create',
      'member.update',
      'member.deactivate',
    ],
  },
] as const;

export type PermissionPresetCode = (typeof PERMISSION_PRESETS)[number]['code'];

export const permissionCodeSchema = z.enum(PERMISSION_CODES);
export const permissionPresetCodeSchema = z.enum(PERMISSION_PRESET_CODES);

export const replaceMemberPermissionsRequestSchema = z
  .object({
    permissionCodes: z.array(permissionCodeSchema),
  })
  .strict();

export type ReplaceMemberPermissionsRequestInput = z.infer<
  typeof replaceMemberPermissionsRequestSchema
>;

export const applyPresetRequestSchema = z
  .object({
    presetCode: permissionPresetCodeSchema,
  })
  .strict();

export type ApplyPresetRequestInput = z.infer<typeof applyPresetRequestSchema>;

export const updateAdminFlagRequestSchema = z
  .object({
    isAdmin: z.boolean(),
  })
  .strict();

export type UpdateAdminFlagRequestInput = z.infer<
  typeof updateAdminFlagRequestSchema
>;

export const listAuditLogsQuerySchema = z
  .object({
    actorId: optionalUuidQuerySchema,
    targetUserId: optionalUuidQuerySchema,
    action: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).max(100).optional(),
    ),
    from: optionalIsoDateQuerySchema,
    to: optionalIsoDateQuerySchema,
    cursor: optionalCursorQuerySchema,
    limit: defaultQueryLimitSchema,
  })
  .refine(
    (data) => !data.from || !data.to || data.from.getTime() <= data.to.getTime(),
    { message: 'errors.invalidDateRange', path: ['from'] },
  );

export type ListAuditLogsQueryInput = z.infer<typeof listAuditLogsQuerySchema>;

export function dedupeCanonicalPermissions(
  codes: readonly PermissionCode[],
): PermissionCode[] {
  const seen = new Set<PermissionCode>(codes);
  return PERMISSION_CODES.filter((code) => seen.has(code));
}

export function computePermissionDiff(
  current: readonly PermissionCode[],
  next: readonly PermissionCode[],
): { readonly added: PermissionCode[]; readonly removed: PermissionCode[] } {
  const currentSet = new Set<PermissionCode>(current);
  const nextSet = new Set<PermissionCode>(next);
  return {
    added: PERMISSION_CODES.filter((code) => nextSet.has(code) && !currentSet.has(code)),
    removed: PERMISSION_CODES.filter((code) => currentSet.has(code) && !nextSet.has(code)),
  };
}
