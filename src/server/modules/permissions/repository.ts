import { and, count, eq, inArray, sql } from 'drizzle-orm';
import {
  permissionPresets,
  permissions,
  presetPermissions,
  profiles,
  userPermissions,
} from '@db/schema';
import { conflict } from '@/lib/errors';
import type { PermissionCode, PermissionPresetCode } from '@/lib/permissions';
import type { DbExecutor } from '@/server/shared/db';
import type { TransactionContext } from '@/server/shared/transaction';
import {
  assertAdminFlagChangeAllowed,
  isPermissionPresetCode,
  normalizeStoredPermissions,
} from './policy';

export interface PermissionCatalogRecord {
  readonly code: PermissionCode;
  readonly groupName: string;
  readonly description: string;
  readonly scopable: boolean;
}

export interface PermissionPresetRecord {
  readonly id: string;
  readonly code: PermissionPresetCode;
  readonly name: string;
  readonly description: string | null;
  readonly permissionCodes: readonly PermissionCode[];
}

export interface TargetMemberPermissionsRecord {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly permissionCodes: readonly PermissionCode[];
}

export interface AdminFlagUpdateRecord {
  readonly userId: string;
  readonly previousIsAdmin: boolean;
  readonly isAdmin: boolean;
  readonly targetIsActive: boolean;
  readonly activeAdminCount: number;
}

export interface ReplaceUserPermissionsParams {
  readonly userId: string;
  readonly permissionCodes: readonly PermissionCode[];
  readonly grantedBy: string;
  readonly now: Date;
}

export interface LockAndUpdateAdminFlagParams {
  readonly actorId: string;
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly now: Date;
}

export interface PermissionsRepository {
  listCatalog(): Promise<PermissionCatalogRecord[]>;
  listPresets(): Promise<PermissionPresetRecord[]>;
  findPresetByCode(
    code: PermissionPresetCode,
    tx?: TransactionContext,
  ): Promise<PermissionPresetRecord | null>;
  findTargetProfilePermissions(
    userId: string,
    tx?: TransactionContext,
  ): Promise<TargetMemberPermissionsRecord | null>;
  replaceUserPermissions(
    input: ReplaceUserPermissionsParams,
    tx: TransactionContext,
  ): Promise<void>;
  lockAndUpdateAdminFlag(
    input: LockAndUpdateAdminFlagParams,
    tx: TransactionContext,
  ): Promise<AdminFlagUpdateRecord | null>;
}

function extractPgHint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 3 && typeof current === 'object' && current !== null; i += 1) {
    const rec = current as { code?: unknown; hint?: unknown; cause?: unknown };
    if (typeof rec.code === 'string') {
      return typeof rec.hint === 'string' && rec.code === 'P0001' ? rec.hint : undefined;
    }
    current = rec.cause;
  }
  return undefined;
}

function rethrowAdminFlagError(error: unknown): never {
  if (extractPgHint(error) === 'LAST_ACTIVE_ADMIN') {
    throw conflict('errors.lastActiveAdmin', {}, 'LAST_ACTIVE_ADMIN');
  }
  throw error;
}

function groupPresetPermissions(
  rows: ReadonlyArray<{ readonly presetId: string; readonly permissionCode: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.presetId);
    if (list) list.push(row.permissionCode);
    else map.set(row.presetId, [row.permissionCode]);
  }
  return map;
}

export class DrizzlePermissionsRepository implements PermissionsRepository {
  constructor(private readonly db: DbExecutor) {}

  async listCatalog(): Promise<PermissionCatalogRecord[]> {
    const rows = await this.db
      .select({
        code: permissions.code,
        groupName: permissions.groupName,
        description: permissions.description,
        scopable: permissions.scopable,
      })
      .from(permissions);
    const catalog: PermissionCatalogRecord[] = [];
    for (const row of rows) {
      const normalized = normalizeStoredPermissions([row.code]);
      const code = normalized[0];
      if (!code) continue;
      catalog.push({
        code,
        groupName: row.groupName,
        description: row.description,
        scopable: row.scopable,
      });
    }
    return catalog;
  }

  async listPresets(): Promise<PermissionPresetRecord[]> {
    const presetRows = await this.db
      .select({
        id: permissionPresets.id,
        code: permissionPresets.code,
        name: permissionPresets.name,
        description: permissionPresets.description,
      })
      .from(permissionPresets);
    if (presetRows.length === 0) return [];

    const permRows = await this.db
      .select({
        presetId: presetPermissions.presetId,
        permissionCode: presetPermissions.permissionCode,
      })
      .from(presetPermissions)
      .where(inArray(presetPermissions.presetId, presetRows.map((p) => p.id)));
    const permMap = groupPresetPermissions(permRows);

    const results: PermissionPresetRecord[] = [];
    for (const preset of presetRows) {
      if (!isPermissionPresetCode(preset.code)) continue;
      results.push({
        id: preset.id,
        code: preset.code,
        name: preset.name,
        description: preset.description,
        permissionCodes: normalizeStoredPermissions(permMap.get(preset.id) ?? []),
      });
    }
    return results;
  }

  async findPresetByCode(
    code: PermissionPresetCode,
    tx?: TransactionContext,
  ): Promise<PermissionPresetRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor
      .select({
        id: permissionPresets.id,
        code: permissionPresets.code,
        name: permissionPresets.name,
        description: permissionPresets.description,
      })
      .from(permissionPresets)
      .where(eq(permissionPresets.code, code))
      .limit(1);
    const preset = rows[0];
    if (!preset || !isPermissionPresetCode(preset.code)) return null;

    const permRows = await executor
      .select({ permissionCode: presetPermissions.permissionCode })
      .from(presetPermissions)
      .where(eq(presetPermissions.presetId, preset.id));

    return {
      id: preset.id,
      code: preset.code,
      name: preset.name,
      description: preset.description,
      permissionCodes: normalizeStoredPermissions(permRows.map((r) => r.permissionCode)),
    };
  }

  async findTargetProfilePermissions(
    userId: string,
    tx?: TransactionContext,
  ): Promise<TargetMemberPermissionsRecord | null> {
    const executor = tx ?? this.db;
    const baseQuery = executor
      .select({
        userId: profiles.id,
        isAdmin: profiles.isAdmin,
        isActive: profiles.isActive,
      })
      .from(profiles)
      .where(eq(profiles.id, userId));
    const profileRows = await (tx ? baseQuery.for('update').limit(1) : baseQuery.limit(1));
    const target = profileRows[0];
    if (!target) return null;

    const grantRows = await executor
      .select({ permissionCode: userPermissions.permissionCode })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId));

    return {
      userId: target.userId,
      isAdmin: target.isAdmin,
      isActive: target.isActive,
      permissionCodes: normalizeStoredPermissions(grantRows.map((r) => r.permissionCode)),
    };
  }

  async replaceUserPermissions(
    input: ReplaceUserPermissionsParams,
    tx: TransactionContext,
  ): Promise<void> {
    await tx.delete(userPermissions).where(eq(userPermissions.userId, input.userId));
    if (input.permissionCodes.length === 0) return;

    await tx.insert(userPermissions).values(
      input.permissionCodes.map((permissionCode) => ({
        userId: input.userId,
        permissionCode,
        grantedBy: input.grantedBy,
        grantedAt: input.now,
        createdAt: input.now,
      })),
    );
  }

  async lockAndUpdateAdminFlag(
    input: LockAndUpdateAdminFlagParams,
    tx: TransactionContext,
  ): Promise<AdminFlagUpdateRecord | null> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('beam_last_active_admin'))`);
    const lockedRows = await tx
      .select({ userId: profiles.id, isAdmin: profiles.isAdmin, isActive: profiles.isActive })
      .from(profiles)
      .where(eq(profiles.id, input.userId))
      .for('update')
      .limit(1);
    const target = lockedRows[0];
    if (!target) return null;

    const countRows = await tx
      .select({ value: count() })
      .from(profiles)
      .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true)));
    const activeAdminCount = Number(countRows[0]?.value ?? 0);

    assertAdminFlagChangeAllowed({
      actorId: input.actorId,
      targetUserId: input.userId,
      currentIsAdmin: target.isAdmin,
      nextIsAdmin: input.isAdmin,
      targetIsActive: target.isActive,
      activeAdminCount,
    });

    if (target.isAdmin !== input.isAdmin) {
      await this.persistAdminFlagUpdate(input, tx);
    }

    return {
      userId: target.userId,
      previousIsAdmin: target.isAdmin,
      isAdmin: input.isAdmin,
      targetIsActive: target.isActive,
      activeAdminCount,
    };
  }

  private async persistAdminFlagUpdate(
    input: LockAndUpdateAdminFlagParams,
    tx: TransactionContext,
  ): Promise<void> {
    try {
      await tx
        .update(profiles)
        .set({ isAdmin: input.isAdmin, updatedAt: input.now })
        .where(eq(profiles.id, input.userId));
    } catch (error) {
      rethrowAdminFlagError(error);
    }
  }
}
