import { badRequest, conflict, notFound } from '@/lib/errors';
import type {
  CreateMemberRequestInput,
  ListMembersQueryInput,
  UpdateMemberRequestInput,
} from '@/lib/members';
import { DEFAULT_MEMBER_PERMISSIONS } from '@/lib/permissions';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import type {
  TransactionContext,
  TransactionRunner,
} from '@/server/shared/transaction';
import {
  type MemberItemResponseDto,
  type MemberPageResponseDto,
  toMemberItemResponseDto,
  toMemberPageResponseDto,
} from './mapper';
import {
  assertAllowedEmailDomain,
  canViewMemberDetail,
  decodeMemberCursor,
  encodeMemberCursor,
} from './policy';
import type { MemberProfileRecord, MembersRepository } from './repository';

export interface MembersServiceDeps {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly config: Config;
  readonly logger: Logger;
}

function collectUpdatedFields(input: UpdateMemberRequestInput): string[] {
  const fields: string[] = [];
  if (input.email !== undefined) fields.push('email');
  if (input.fullName !== undefined) fields.push('fullName');
  if (input.locale !== undefined) fields.push('locale');
  if (input.departmentIds !== undefined) fields.push('departmentIds');
  return fields;
}

export class MembersService {
  constructor(private readonly deps: MembersServiceDeps) {}

  async listMembers(
    actor: AuthActor,
    query: ListMembersQueryInput,
  ): Promise<MemberPageResponseDto> {
    authorize(actor, 'member.view');
    const includeDetail = canViewMemberDetail(actor);
    const cursor = query.cursor ? decodeMemberCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.membersRepo.listMembers({
      q: query.q,
      includeStudentIdSearch: includeDetail,
      departmentId: query.departmentId,
      isActive: query.isActive,
      cursor,
      limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeMemberCursor({ fullName: last.fullName, id: last.id })
        : null;
    return toMemberPageResponseDto({
      items: rows,
      nextCursor,
      limit: query.limit,
      includeDetail,
    });
  }

  async getMember(actor: AuthActor, id: string): Promise<MemberItemResponseDto> {
    authorize(actor, 'member.view');
    const member = await this.deps.membersRepo.findById(id);
    if (!member) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    return toMemberItemResponseDto(member, canViewMemberDetail(actor));
  }

  async createMember(
    actor: AuthActor,
    input: CreateMemberRequestInput,
  ): Promise<MemberItemResponseDto> {
    authorize(actor, 'member.create');
    assertAllowedEmailDomain(input.email, this.deps.config.allowedEmailDomain);
    const uniqueDepartmentIds = Array.from(new Set(input.departmentIds));
    const now = this.deps.clock.now();
    const created = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistNewMember({ actor, input, uniqueDepartmentIds, now, tx }),
    );
    this.deps.logger.info('Member created', {
      actorId: actor.id,
      targetUserId: created.id,
    });
    return toMemberItemResponseDto(created, canViewMemberDetail(actor));
  }

  async updateMember(
    actor: AuthActor,
    id: string,
    input: UpdateMemberRequestInput,
  ): Promise<MemberItemResponseDto> {
    authorize(actor, 'member.update');
    if (input.email !== undefined) {
      assertAllowedEmailDomain(input.email, this.deps.config.allowedEmailDomain);
    }
    const uniqueDepartmentIds = input.departmentIds
      ? Array.from(new Set(input.departmentIds))
      : undefined;
    const now = this.deps.clock.now();
    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistMemberUpdate({ actor, id, input, uniqueDepartmentIds, now, tx }),
    );
    this.deps.logger.info('Member updated', { actorId: actor.id, targetUserId: id });
    return toMemberItemResponseDto(updated, canViewMemberDetail(actor));
  }

  async deactivateMember(
    actor: AuthActor,
    id: string,
  ): Promise<MemberItemResponseDto> {
    authorize(actor, 'member.deactivate');
    const now = this.deps.clock.now();
    const deactivated = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.persistDeactivation(actor, id, now, tx),
    );
    this.deps.logger.info('Member deactivated', {
      actorId: actor.id,
      targetUserId: id,
    });
    return toMemberItemResponseDto(deactivated, canViewMemberDetail(actor));
  }

  async activateMember(actor: AuthActor, id: string): Promise<MemberItemResponseDto> {
    authorize(actor, 'member.deactivate');
    const now = this.deps.clock.now();
    const activated = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const target = await this.deps.membersRepo.lockAndFindById(id, tx);
      if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      const member = await this.deps.membersRepo.activateMember({ id, now }, tx);
      if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      await this.deps.auditWriter.record(
        {
          actorId: actor.id,
          action: 'member.activated',
          targetUserId: id,
          detail: { wasAlreadyActive: target.isActive },
          createdAt: now,
        },
        tx,
      );
      return member;
    });
    this.deps.logger.info('Member activated', {
      actorId: actor.id,
      targetUserId: id,
    });
    return toMemberItemResponseDto(activated, canViewMemberDetail(actor));
  }

  private async persistNewMember(params: {
    readonly actor: AuthActor;
    readonly input: CreateMemberRequestInput;
    readonly uniqueDepartmentIds: readonly string[];
    readonly now: Date;
    readonly tx: TransactionContext;
  }): Promise<MemberProfileRecord> {
    await this.assertDepartmentsExist(params.uniqueDepartmentIds, params.tx);
    const member = await this.deps.membersRepo.createMember(
      {
        studentId: params.input.studentId,
        email: params.input.email,
        fullName: params.input.fullName,
        locale: params.input.locale,
        departmentIds: params.uniqueDepartmentIds,
        defaultPermissions: DEFAULT_MEMBER_PERMISSIONS,
        grantedBy: params.actor.id,
        now: params.now,
      },
      params.tx,
    );
    await this.deps.auditWriter.record(
      {
        actorId: params.actor.id,
        action: 'member.created',
        targetUserId: member.id,
        detail: {
          departmentIds: params.uniqueDepartmentIds,
          locale: member.locale,
          grantedPermissions: [...DEFAULT_MEMBER_PERMISSIONS],
        },
        createdAt: params.now,
      },
      params.tx,
    );
    return member;
  }

  private async persistMemberUpdate(params: {
    readonly actor: AuthActor;
    readonly id: string;
    readonly input: UpdateMemberRequestInput;
    readonly uniqueDepartmentIds?: readonly string[];
    readonly now: Date;
    readonly tx: TransactionContext;
  }): Promise<MemberProfileRecord> {
    const existing = await this.deps.membersRepo.lockAndFindById(
      params.id,
      params.tx,
    );
    if (!existing) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    if (params.uniqueDepartmentIds !== undefined) {
      await this.assertDepartmentsExist(params.uniqueDepartmentIds, params.tx);
    }
    const member = await this.deps.membersRepo.updateMember(
      {
        id: params.id,
        email: params.input.email,
        fullName: params.input.fullName,
        locale: params.input.locale,
        departmentIds: params.uniqueDepartmentIds,
        now: params.now,
      },
      params.tx,
    );
    if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    await this.deps.auditWriter.record(
      {
        actorId: params.actor.id,
        action: 'member.updated',
        targetUserId: params.id,
        detail: { updatedFields: collectUpdatedFields(params.input) },
        createdAt: params.now,
      },
      params.tx,
    );
    return member;
  }

  private async persistDeactivation(
    actor: AuthActor,
    id: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<MemberProfileRecord> {
    const target = await this.deps.membersRepo.lockAndFindById(id, tx);
    if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    if (target.isAdmin && target.isActive) {
      const activeAdmins = await this.deps.membersRepo.countActiveAdmins(tx);
      if (activeAdmins <= 1) {
        throw conflict('errors.lastActiveAdmin', {}, 'LAST_ACTIVE_ADMIN');
      }
    }
    const member = await this.deps.membersRepo.deactivateMember(
      { id, leftAt: target.leftAt ?? now, now },
      tx,
    );
    if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    await this.deps.membersRepo.revokeAllActiveSessions(id, now, tx);
    await this.deps.auditWriter.record(
      {
        actorId: actor.id,
        action: 'member.deactivated',
        targetUserId: id,
        detail: { wasAlreadyInactive: !target.isActive },
        createdAt: now,
      },
      tx,
    );
    return member;
  }

  private async assertDepartmentsExist(
    departmentIds: readonly string[],
    tx: TransactionContext,
  ): Promise<void> {
    if (departmentIds.length === 0) return;
    const existing = await this.deps.membersRepo.findExistingDepartmentIds(
      departmentIds,
      tx,
    );
    if (existing.length !== departmentIds.length) {
      throw badRequest('errors.invalidDepartmentIds', {}, 'INVALID_DEPARTMENT_IDS');
    }
  }
}
