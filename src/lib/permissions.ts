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

const PERMISSION_CODE_SET: ReadonlySet<string> = new Set(
  PERMISSIONS.map((permission) => permission.code),
);

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
