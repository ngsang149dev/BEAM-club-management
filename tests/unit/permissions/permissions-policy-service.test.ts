import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { PERMISSION_CODES, type PermissionCode, type PermissionPresetCode } from '@/lib/permissions';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  assertAdminFlagChangeAllowed,
  type AdminFlagUpdateRecord,
  type PermissionCatalogRecord,
  type PermissionPresetRecord,
  PermissionsService,
  type PermissionsRepository,
  type ReplaceUserPermissionsParams,
  type TargetMemberPermissionsRecord,
} from '@/server/modules/permissions';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const SECOND_ADMIN_ID = '10000000-0000-4000-8000-000000000002';
const TARGET_MEMBER_ID = '10000000-0000-4000-8000-000000000003';
const INACTIVE_ADMIN_ID = '10000000-0000-4000-8000-000000000004';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

class InMemoryPermissionsRepository implements PermissionsRepository {
  readonly catalog: PermissionCatalogRecord[] = PERMISSION_CODES.map((code) => ({
    code,
    groupName: code.split('.')[0] ?? 'system',
    description: `Desc ${code}`,
    scopable: false,
  })).reverse();

  readonly presets: PermissionPresetRecord[] = [
    {
      id: '30000000-0000-4000-8000-000000000003',
      code: 'hr_manager',
      name: 'HR Manager',
      description: 'HR preset',
      permissionCodes: ['member.deactivate', 'member.view', 'member.create'],
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      code: 'basic_member',
      name: 'Basic Member',
      description: 'Basic preset',
      permissionCodes: ['comment.create', 'member.view', 'task.update_assigned'],
    },
  ];

  readonly targets = new Map<string, TargetMemberPermissionsRecord>([
    [
      ADMIN_ID,
      { userId: ADMIN_ID, isAdmin: true, isActive: true, permissionCodes: [] },
    ],
    [
      TARGET_MEMBER_ID,
      {
        userId: TARGET_MEMBER_ID,
        isAdmin: false,
        isActive: true,
        permissionCodes: ['member.view', 'audit.view'],
      },
    ],
    [
      INACTIVE_ADMIN_ID,
      {
        userId: INACTIVE_ADMIN_ID,
        isAdmin: true,
        isActive: false,
        permissionCodes: [],
      },
    ],
  ]);

  async listCatalog(): Promise<PermissionCatalogRecord[]> {
    return [...this.catalog];
  }

  async listPresets(): Promise<PermissionPresetRecord[]> {
    return [...this.presets];
  }

  async findPresetByCode(code: PermissionPresetCode): Promise<PermissionPresetRecord | null> {
    return this.presets.find((p) => p.code === code) ?? null;
  }

  async findTargetProfilePermissions(
    userId: string,
  ): Promise<TargetMemberPermissionsRecord | null> {
    return this.targets.get(userId) ?? null;
  }

  async replaceUserPermissions(input: ReplaceUserPermissionsParams): Promise<void> {
    const existing = this.targets.get(input.userId);
    if (!existing) throw new AppError('NOT_FOUND', 'errors.notFound', 404);
    this.targets.set(input.userId, { ...existing, permissionCodes: [...input.permissionCodes] });
  }

  async lockAndUpdateAdminFlag(input: {
    readonly actorId: string;
    readonly userId: string;
    readonly isAdmin: boolean;
    readonly now: Date;
  }): Promise<AdminFlagUpdateRecord | null> {
    const target = this.targets.get(input.userId);
    if (!target) return null;
    let activeAdminCount = 0;
    for (const profile of this.targets.values()) {
      if (profile.isAdmin && profile.isActive) activeAdminCount += 1;
    }
    assertAdminFlagChangeAllowed({
      actorId: input.actorId,
      targetUserId: input.userId,
      currentIsAdmin: target.isAdmin,
      nextIsAdmin: input.isAdmin,
      targetIsActive: target.isActive,
      activeAdminCount,
    });
    this.targets.set(input.userId, { ...target, isAdmin: input.isAdmin });
    return {
      userId: target.userId,
      previousIsAdmin: target.isAdmin,
      isAdmin: input.isAdmin,
      targetIsActive: target.isActive,
      activeAdminCount,
    };
  }
}

class SpyAuditWriter implements AuditLogWriter {
  readonly entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

function createHarness() {
  const repo = new InMemoryPermissionsRepository();
  const auditWriter = new SpyAuditWriter();
  const clock = new FakeClock('2026-11-24T04:00:00.000Z');
  const rawLogs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => rawLogs.push(line),
    writeErr: (line) => rawLogs.push(line),
  });
  const service = new PermissionsService({
    permissionsRepo: repo,
    auditWriter,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
  });
  return { repo, auditWriter, rawLogs, service };
}

const ADMIN_ACTOR: AuthActor = {
  id: ADMIN_ID,
  isActive: true,
  isAdmin: true,
  permissions: [],
};

const MEMBER_UPDATE_ACTOR: AuthActor = {
  id: 'actor-member-update',
  isActive: true,
  isAdmin: false,
  permissions: ['member.view', 'member.update'],
};

const ALL_PERMS_NON_ADMIN_ACTOR: AuthActor = {
  id: 'actor-all-perms',
  isActive: true,
  isAdmin: false,
  permissions: [...PERMISSION_CODES],
};

const INACTIVE_ADMIN_ACTOR: AuthActor = {
  id: INACTIVE_ADMIN_ID,
  isActive: false,
  isAdmin: true,
  permissions: [],
};

describe('permissions policy & PermissionsService', () => {
  it('enforces assertAdminFlagChangeAllowed self-demotion and last-admin invariants', () => {
    // Self-demotion check runs BEFORE last-admin check (both 1 and >= 2 active admins)
    for (const activeAdminCount of [1, 2]) {
      expect(() =>
        assertAdminFlagChangeAllowed({
          actorId: ADMIN_ID,
          targetUserId: ADMIN_ID,
          currentIsAdmin: true,
          nextIsAdmin: false,
          targetIsActive: true,
          activeAdminCount,
        }),
      ).toThrowError(expect.objectContaining({ httpStatus: 409, code: 'CANNOT_REVOKE_OWN_ADMIN' }));
    }

    expect(() =>
      assertAdminFlagChangeAllowed({
        actorId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        currentIsAdmin: true,
        nextIsAdmin: true,
        targetIsActive: true,
        activeAdminCount: 1,
      }),
    ).not.toThrow();

    // Different actor demoting the last active admin triggers AC-09 LAST_ACTIVE_ADMIN
    expect(() =>
      assertAdminFlagChangeAllowed({
        actorId: SECOND_ADMIN_ID,
        targetUserId: ADMIN_ID,
        currentIsAdmin: true,
        nextIsAdmin: false,
        targetIsActive: true,
        activeAdminCount: 1,
      }),
    ).toThrowError(expect.objectContaining({ httpStatus: 409, code: 'LAST_ACTIVE_ADMIN' }));

    expect(() =>
      assertAdminFlagChangeAllowed({
        actorId: ADMIN_ID,
        targetUserId: SECOND_ADMIN_ID,
        currentIsAdmin: true,
        nextIsAdmin: false,
        targetIsActive: true,
        activeAdminCount: 2,
      }),
    ).not.toThrow();

    expect(() =>
      assertAdminFlagChangeAllowed({
        actorId: ADMIN_ID,
        targetUserId: INACTIVE_ADMIN_ID,
        currentIsAdmin: true,
        nextIsAdmin: false,
        targetIsActive: false,
        activeAdminCount: 1,
      }),
    ).not.toThrow();
  });

  it('rejects inactive actors with 401 and non-admins (including member.update AC-08) with 403 on all endpoints', async () => {
    const { service } = createHarness();

    for (const actor of [MEMBER_UPDATE_ACTOR, ALL_PERMS_NON_ADMIN_ACTOR]) {
      await expect(service.getCatalog(actor)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
      await expect(service.listPresets(actor)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
      await expect(service.getMemberPermissions(actor, TARGET_MEMBER_ID)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
      await expect(service.replaceMemberPermissions(actor, TARGET_MEMBER_ID, { permissionCodes: [] })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
      await expect(service.applyPreset(actor, TARGET_MEMBER_ID, { presetCode: 'basic_member' })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
      await expect(service.updateAdminFlag(actor, TARGET_MEMBER_ID, { isAdmin: true })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    }

    await expect(service.getCatalog(INACTIVE_ADMIN_ACTOR)).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(service.listPresets(INACTIVE_ADMIN_ACTOR)).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(service.getMemberPermissions(INACTIVE_ADMIN_ACTOR, TARGET_MEMBER_ID)).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(service.replaceMemberPermissions(INACTIVE_ADMIN_ACTOR, TARGET_MEMBER_ID, { permissionCodes: [] })).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(service.applyPreset(INACTIVE_ADMIN_ACTOR, TARGET_MEMBER_ID, { presetCode: 'basic_member' })).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
    await expect(service.updateAdminFlag(INACTIVE_ADMIN_ACTOR, TARGET_MEMBER_ID, { isAdmin: true })).rejects.toMatchObject({ httpStatus: 401, code: 'ACCOUNT_INACTIVE' });
  });

  it('lists canonical catalog and presets, and handles 404 for missing target/preset', async () => {
    const { service } = createHarness();

    const catalog = await service.getCatalog(ADMIN_ACTOR);
    expect(catalog.items.map((i) => i.code)).toEqual([...PERMISSION_CODES]);

    const presets = await service.listPresets(ADMIN_ACTOR);
    expect(presets.items.map((p) => p.code)).toEqual(['basic_member', 'hr_manager']);
    expect(presets.items[0]?.permissionCodes).toEqual([
      'member.view',
      'task.update_assigned',
      'comment.create',
    ]);

    await expect(service.getMemberPermissions(ADMIN_ACTOR, MISSING_ID)).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(service.replaceMemberPermissions(ADMIN_ACTOR, MISSING_ID, { permissionCodes: [] })).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(service.applyPreset(ADMIN_ACTOR, MISSING_ID, { presetCode: 'basic_member' })).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(service.applyPreset(ADMIN_ACTOR, TARGET_MEMBER_ID, { presetCode: 'department_lead' })).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
    await expect(service.updateAdminFlag(ADMIN_ACTOR, MISSING_ID, { isAdmin: true })).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });
  });

  it('replaces permissions canonically, writes diff audit_logs (AC-10), and applies presets fully (WQ-06)', async () => {
    const { service, auditWriter, rawLogs } = createHarness();

    const inputCodes: PermissionCode[] = ['comment.create', 'member.view', 'board.create', 'comment.create'];
    const replaced = await service.replaceMemberPermissions(ADMIN_ACTOR, TARGET_MEMBER_ID, {
      permissionCodes: inputCodes,
    });
    expect(replaced).toEqual({
      userId: TARGET_MEMBER_ID,
      isAdmin: false,
      permissionCodes: ['member.view', 'board.create', 'comment.create'],
    });
    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]).toMatchObject({
      actorId: ADMIN_ID,
      action: 'permissions.updated',
      targetUserId: TARGET_MEMBER_ID,
      detail: {
        added: ['board.create', 'comment.create'],
        removed: ['audit.view'],
        totalCount: 3,
      },
    });

    // No-op replace produces zero duplicate audit log entries
    await service.replaceMemberPermissions(ADMIN_ACTOR, TARGET_MEMBER_ID, {
      permissionCodes: ['board.create', 'comment.create', 'member.view'],
    });
    expect(auditWriter.entries).toHaveLength(1);

    // WQ-06 preset replaces all grants and ALWAYS writes audit_logs
    const presetApplied = await service.applyPreset(ADMIN_ACTOR, TARGET_MEMBER_ID, {
      presetCode: 'basic_member',
    });
    expect(presetApplied.permissionCodes).toEqual([
      'member.view',
      'task.update_assigned',
      'comment.create',
    ]);
    expect(auditWriter.entries).toHaveLength(2);
    expect(auditWriter.entries[1]).toMatchObject({
      action: 'permissions.preset_applied',
      targetUserId: TARGET_MEMBER_ID,
      detail: {
        presetCode: 'basic_member',
        added: ['task.update_assigned'],
        removed: ['board.create'],
        totalCount: 3,
      },
    });

    // Applying identical preset still records audit_logs
    await service.applyPreset(ADMIN_ACTOR, TARGET_MEMBER_ID, { presetCode: 'basic_member' });
    expect(auditWriter.entries).toHaveLength(3);
    expect(rawLogs.join('\n')).not.toContain('studentId');
  });

  it('blocks admin self-demotion (CANNOT_REVOKE_OWN_ADMIN), protects last active admin (AC-09), and audits grant/revoke transitions', async () => {
    const { repo, service, auditWriter } = createHarness();
    repo.targets.set(SECOND_ADMIN_ID, {
      userId: SECOND_ADMIN_ID,
      isAdmin: false,
      isActive: true,
      permissionCodes: [],
    });

    // Sole active admin self-demotion -> 409 CANNOT_REVOKE_OWN_ADMIN (zero audit logs, flag intact)
    await expect(
      service.updateAdminFlag(ADMIN_ACTOR, ADMIN_ID, { isAdmin: false }),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'CANNOT_REVOKE_OWN_ADMIN' });
    expect(repo.targets.get(ADMIN_ID)?.isAdmin).toBe(true);
    expect(auditWriter.entries).toHaveLength(0);

    // Different actor attempting to demote sole active admin -> 409 LAST_ACTIVE_ADMIN
    const OTHER_ADMIN_ACTOR: AuthActor = {
      id: '90000000-0000-4000-8000-000000000099',
      isActive: true,
      isAdmin: true,
      permissions: [],
    };
    await expect(
      service.updateAdminFlag(OTHER_ADMIN_ACTOR, ADMIN_ID, { isAdmin: false }),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'LAST_ACTIVE_ADMIN' });
    expect(repo.targets.get(ADMIN_ID)?.isAdmin).toBe(true);
    expect(auditWriter.entries).toHaveLength(0);

    const granted = await service.updateAdminFlag(ADMIN_ACTOR, SECOND_ADMIN_ID, { isAdmin: true });
    expect(granted).toEqual({ userId: SECOND_ADMIN_ID, isAdmin: true });

    // No-op grant does not write audit log
    await service.updateAdminFlag(ADMIN_ACTOR, SECOND_ADMIN_ID, { isAdmin: true });
    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]).toMatchObject({
      action: 'admin.granted',
      targetUserId: SECOND_ADMIN_ID,
      detail: { previousIsAdmin: false, isAdmin: true },
    });

    // Self-demotion STILL blocked even when >= 2 active admins exist (zero audit logs, flag intact)
    await expect(
      service.updateAdminFlag(ADMIN_ACTOR, ADMIN_ID, { isAdmin: false }),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'CANNOT_REVOKE_OWN_ADMIN' });
    expect(repo.targets.get(ADMIN_ID)?.isAdmin).toBe(true);
    expect(auditWriter.entries).toHaveLength(1);

    // No-op self grant succeeds without audit log
    await expect(
      service.updateAdminFlag(ADMIN_ACTOR, ADMIN_ID, { isAdmin: true }),
    ).resolves.toEqual({ userId: ADMIN_ID, isAdmin: true });
    expect(auditWriter.entries).toHaveLength(1);

    // Admin CAN demote ANOTHER admin when >= 2 active admins exist
    const revoked = await service.updateAdminFlag(ADMIN_ACTOR, SECOND_ADMIN_ID, { isAdmin: false });
    expect(revoked).toEqual({ userId: SECOND_ADMIN_ID, isAdmin: false });
    expect(auditWriter.entries).toHaveLength(2);
    expect(auditWriter.entries[1]).toMatchObject({
      action: 'admin.revoked',
      targetUserId: SECOND_ADMIN_ID,
      detail: { previousIsAdmin: true, isAdmin: false },
    });
  });
});
