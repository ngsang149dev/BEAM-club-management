import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMBER_PERMISSIONS,
  isPermissionCode,
  PERMISSION_PRESETS,
  PERMISSIONS,
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
});
