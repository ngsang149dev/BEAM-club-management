import { describe, expect, it } from 'vitest';
import {
  applyPresetRequestSchema,
  computePermissionDiff,
  dedupeCanonicalPermissions,
  DEFAULT_MEMBER_PERMISSIONS,
  isPermissionCode,
  listAuditLogsQuerySchema,
  PERMISSION_CODES,
  PERMISSION_PRESET_CODES,
  PERMISSION_PRESETS,
  PERMISSIONS,
  replaceMemberPermissionsRequestSchema,
  updateAdminFlagRequestSchema,
} from '@/lib/permissions';

const EXPECTED_CODES = [
  'member.view',
  'member.view_detail',
  'member.create',
  'member.update',
  'member.deactivate',
  'department.manage',
  'board.create',
  'board.update',
  'board.delete',
  'task.create',
  'task.assign',
  'task.update_any',
  'task.update_assigned',
  'task.delete',
  'comment.create',
  'comment.delete_any',
  'reminder.configure',
  'audit.view',
] as const;

describe('permissions registry', () => {
  it('defines all 18 canonical permission codes without duplicates', () => {
    const codes = PERMISSIONS.map((permission) => permission.code);
    expect(codes).toHaveLength(18);
    expect(new Set(codes).size).toBe(18);
    expect(codes).toEqual([...EXPECTED_CODES]);
    for (const permission of PERMISSIONS) {
      expect(permission.descriptionKey).toMatch(/^permissions\.catalog\./);
    }
  });

  it('validates permission codes via isPermissionCode', () => {
    for (const code of EXPECTED_CODES) {
      expect(isPermissionCode(code)).toBe(true);
    }
    expect(isPermissionCode('')).toBe(false);
    expect(isPermissionCode('admin')).toBe(false);
    expect(isPermissionCode('task.delete_any')).toBe(false);
    expect(isPermissionCode('MEMBER.VIEW')).toBe(false);
  });

  it('matches default permissions for newly created accounts', () => {
    expect(DEFAULT_MEMBER_PERMISSIONS).toEqual([
      'member.view',
      'task.update_assigned',
      'comment.create',
    ]);
  });

  it('matches HANDOFF 3.5 permission presets', () => {
    const byCode = Object.fromEntries(
      PERMISSION_PRESETS.map((preset) => [preset.code, [...preset.permissions]]),
    );

    expect(Object.keys(byCode)).toEqual([
      'basic_member',
      'department_lead',
      'hr_manager',
    ]);
    expect(byCode.basic_member).toEqual([
      'member.view',
      'task.update_assigned',
      'comment.create',
    ]);
    expect(byCode.department_lead).toEqual([
      'member.view',
      'task.update_assigned',
      'comment.create',
      'member.view_detail',
      'board.create',
      'board.update',
      'task.create',
      'task.assign',
      'task.update_any',
    ]);
    expect(byCode.hr_manager).toEqual([
      'member.view',
      'task.update_assigned',
      'comment.create',
      'member.view_detail',
      'member.create',
      'member.update',
      'member.deactivate',
    ]);
  });

  it('derives PERMISSION_CODES and PERMISSION_PRESET_CODES and canonicalizes diffs', () => {
    expect(PERMISSION_CODES).toEqual([...EXPECTED_CODES]);
    expect(PERMISSION_PRESET_CODES).toEqual([
      'basic_member',
      'department_lead',
      'hr_manager',
    ]);
    expect(
      dedupeCanonicalPermissions([
        'audit.view',
        'member.view',
        'audit.view',
        'board.create',
      ]),
    ).toEqual(['member.view', 'board.create', 'audit.view']);

    expect(
      computePermissionDiff(
        ['member.view', 'task.update_assigned', 'comment.create', 'audit.view'],
        ['comment.create', 'board.create', 'member.view'],
      ),
    ).toEqual({
      added: ['board.create'],
      removed: ['task.update_assigned', 'audit.view'],
    });
  });

  it('validates strict E4 request and audit query schemas', () => {
    expect(
      replaceMemberPermissionsRequestSchema.safeParse({
        permissionCodes: ['member.view', 'board.create'],
      }).success,
    ).toBe(true);
    expect(
      replaceMemberPermissionsRequestSchema.safeParse({
        permissionCodes: ['unknown.perm'],
      }).success,
    ).toBe(false);
    expect(
      replaceMemberPermissionsRequestSchema.safeParse({
        permissionCodes: [],
        extra: true,
      }).success,
    ).toBe(false);

    expect(
      applyPresetRequestSchema.safeParse({ presetCode: 'department_lead' }).success,
    ).toBe(true);
    expect(
      applyPresetRequestSchema.safeParse({ presetCode: 'super_admin' }).success,
    ).toBe(false);

    expect(
      updateAdminFlagRequestSchema.safeParse({ isAdmin: true }).success,
    ).toBe(true);
    expect(
      updateAdminFlagRequestSchema.safeParse({ isAdmin: 'true' }).success,
    ).toBe(false);

    const parsedQuery = listAuditLogsQuerySchema.parse({
      actorId: '',
      from: '2026-11-20T00:00:00Z',
      to: '2026-11-24T23:59:59+07:00',
      limit: '25',
    });
    expect(parsedQuery.actorId).toBeUndefined();
    expect(parsedQuery.from).toBeInstanceOf(Date);
    expect(parsedQuery.to).toBeInstanceOf(Date);
    expect(parsedQuery.limit).toBe(25);

    const invertedRange = listAuditLogsQuerySchema.safeParse({
      from: '2026-11-25T00:00:00Z',
      to: '2026-11-24T00:00:00Z',
    });
    expect(invertedRange.success).toBe(false);
    if (!invertedRange.success) {
      expect(invertedRange.error.issues[0]?.message).toBe('errors.invalidDateRange');
    }
  });
});
