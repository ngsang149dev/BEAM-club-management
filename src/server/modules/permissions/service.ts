import { notFound } from '@/lib/errors';
import type {
  ApplyPresetRequestInput,
  ReplaceMemberPermissionsRequestInput,
  UpdateAdminFlagRequestInput,
} from '@/lib/permissions';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type AuthActor, authorizeAdmin } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  type MemberPermissionsResponseDto,
  type PermissionCatalogResponseDto,
  type PermissionPresetListResponseDto,
  type UpdateAdminFlagResponseDto,
  toMemberPermissionsResponseDto,
  toPermissionCatalogResponseDto,
  toPermissionPresetListResponseDto,
  toUpdateAdminFlagResponseDto,
} from './mapper';
import {
  assertAdminFlagChangeAllowed,
  computePermissionDiff,
  dedupeCanonicalPermissions,
} from './policy';
import type { PermissionsRepository } from './repository';

export interface PermissionsServiceDeps {
  readonly permissionsRepo: PermissionsRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class PermissionsService {
  constructor(private readonly deps: PermissionsServiceDeps) {}

  async getCatalog(actor: AuthActor): Promise<PermissionCatalogResponseDto> {
    authorizeAdmin(actor);
    const items = await this.deps.permissionsRepo.listCatalog();
    return toPermissionCatalogResponseDto(items);
  }

  async listPresets(actor: AuthActor): Promise<PermissionPresetListResponseDto> {
    authorizeAdmin(actor);
    const items = await this.deps.permissionsRepo.listPresets();
    return toPermissionPresetListResponseDto(items);
  }

  async getMemberPermissions(
    actor: AuthActor,
    targetUserId: string,
  ): Promise<MemberPermissionsResponseDto> {
    authorizeAdmin(actor);
    const target = await this.deps.permissionsRepo.findTargetProfilePermissions(targetUserId);
    if (!target) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return toMemberPermissionsResponseDto(target);
  }

  async replaceMemberPermissions(
    actor: AuthActor,
    targetUserId: string,
    input: ReplaceMemberPermissionsRequestInput,
  ): Promise<MemberPermissionsResponseDto> {
    authorizeAdmin(actor);
    const canonical = dedupeCanonicalPermissions(input.permissionCodes);
    const now = this.deps.clock.now();

    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistReplacePermissions({ actorId: actor.id, targetUserId, canonical, now, tx }),
    );

    this.deps.logger.info('Member permissions updated', {
      actorId: actor.id,
      targetUserId,
      addedCount: result.addedCount,
      removedCount: result.removedCount,
    });
    return toMemberPermissionsResponseDto(result.record);
  }

  async applyPreset(
    actor: AuthActor,
    targetUserId: string,
    input: ApplyPresetRequestInput,
  ): Promise<MemberPermissionsResponseDto> {
    authorizeAdmin(actor);
    const now = this.deps.clock.now();

    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistApplyPreset({ actorId: actor.id, targetUserId, presetCode: input.presetCode, now, tx }),
    );

    this.deps.logger.info('Permission preset applied', {
      actorId: actor.id,
      targetUserId,
      presetCode: input.presetCode,
    });
    return toMemberPermissionsResponseDto(updated);
  }

  async updateAdminFlag(
    actor: AuthActor,
    targetUserId: string,
    input: UpdateAdminFlagRequestInput,
  ): Promise<UpdateAdminFlagResponseDto> {
    authorizeAdmin(actor);
    const now = this.deps.clock.now();

    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistAdminFlag({ actorId: actor.id, targetUserId, isAdmin: input.isAdmin, now, tx }),
    );

    this.deps.logger.info('Admin flag updated', {
      actorId: actor.id,
      targetUserId,
      isAdmin: updated.isAdmin,
    });
    return toUpdateAdminFlagResponseDto(updated.userId, updated.isAdmin);
  }

  private async persistReplacePermissions(params: {
    readonly actorId: string;
    readonly targetUserId: string;
    readonly canonical: ReturnType<typeof dedupeCanonicalPermissions>;
    readonly now: Date;
    readonly tx: Parameters<PermissionsRepository['replaceUserPermissions']>[1];
  }) {
    const target = await this.deps.permissionsRepo.findTargetProfilePermissions(
      params.targetUserId,
      params.tx,
    );
    if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');

    const { added, removed } = computePermissionDiff(target.permissionCodes, params.canonical);
    await this.deps.permissionsRepo.replaceUserPermissions(
      {
        userId: params.targetUserId,
        permissionCodes: params.canonical,
        grantedBy: params.actorId,
        now: params.now,
      },
      params.tx,
    );
    if (added.length > 0 || removed.length > 0) {
      await this.deps.auditWriter.record(
        {
          actorId: params.actorId,
          action: 'permissions.updated',
          targetUserId: params.targetUserId,
          detail: { added, removed, totalCount: params.canonical.length },
          createdAt: params.now,
        },
        params.tx,
      );
    }
    return {
      record: { ...target, permissionCodes: params.canonical },
      addedCount: added.length,
      removedCount: removed.length,
    };
  }

  private async persistApplyPreset(params: {
    readonly actorId: string;
    readonly targetUserId: string;
    readonly presetCode: ApplyPresetRequestInput['presetCode'];
    readonly now: Date;
    readonly tx: Parameters<PermissionsRepository['replaceUserPermissions']>[1];
  }) {
    const target = await this.deps.permissionsRepo.findTargetProfilePermissions(params.targetUserId, params.tx);
    if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    const preset = await this.deps.permissionsRepo.findPresetByCode(params.presetCode, params.tx);
    if (!preset) throw notFound('errors.notFound', {}, 'NOT_FOUND');

    const presetPermissions = dedupeCanonicalPermissions(preset.permissionCodes);
    const { added, removed } = computePermissionDiff(target.permissionCodes, presetPermissions);
    await this.deps.permissionsRepo.replaceUserPermissions(
      { userId: params.targetUserId, permissionCodes: presetPermissions, grantedBy: params.actorId, now: params.now },
      params.tx,
    );
    await this.deps.auditWriter.record(
      {
        actorId: params.actorId,
        action: 'permissions.preset_applied',
        targetUserId: params.targetUserId,
        detail: { presetCode: params.presetCode, added, removed, totalCount: presetPermissions.length },
        createdAt: params.now,
      },
      params.tx,
    );
    return { ...target, permissionCodes: presetPermissions };
  }

  private async persistAdminFlag(params: {
    readonly actorId: string;
    readonly targetUserId: string;
    readonly isAdmin: boolean;
    readonly now: Date;
    readonly tx: Parameters<PermissionsRepository['lockAndUpdateAdminFlag']>[1];
  }) {
    const state = await this.deps.permissionsRepo.lockAndUpdateAdminFlag(
      {
        actorId: params.actorId,
        userId: params.targetUserId,
        isAdmin: params.isAdmin,
        now: params.now,
      },
      params.tx,
    );
    if (!state) throw notFound('errors.notFound', {}, 'NOT_FOUND');

    assertAdminFlagChangeAllowed({
      actorId: params.actorId,
      targetUserId: params.targetUserId,
      currentIsAdmin: state.previousIsAdmin,
      nextIsAdmin: params.isAdmin,
      targetIsActive: state.targetIsActive,
      activeAdminCount: state.activeAdminCount,
    });
    if (state.previousIsAdmin !== params.isAdmin) {
      await this.deps.auditWriter.record(
        {
          actorId: params.actorId,
          action: params.isAdmin ? 'admin.granted' : 'admin.revoked',
          targetUserId: params.targetUserId,
          detail: { previousIsAdmin: state.previousIsAdmin, isAdmin: params.isAdmin },
          createdAt: params.now,
        },
        params.tx,
      );
    }
    return state;
  }
}
