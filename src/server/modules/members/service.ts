import { badRequest, notFound } from '@/lib/errors';
import type {
  CreateMemberRequestInput,
  ListMembersQueryInput,
  ResetMemberPasswordRequestInput,
  UpdateMemberRequestInput,
} from '@/lib/members';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import { hashPassword } from '@/server/shared/password';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  type MemberItemResponseDto,
  type MemberPageResponseDto,
  toMemberItemResponseDto,
  toMemberPageResponseDto,
} from './mapper';
import {
  assertAllowedEmailDomain,
  assertCanResetMemberPassword,
  canViewMemberDetail,
  decodeMemberCursor,
  encodeMemberCursor,
} from './policy';
import type { MembersRepository } from './repository';
import {
  persistActivation,
  persistDeactivation,
  persistMemberUpdate,
  persistNewMember,
  persistPasswordReset,
} from './service-helpers';

export interface MembersServiceDeps {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly config: Config;
  readonly logger: Logger;
}

export interface ResetMemberPasswordCommand {
  readonly actor: AuthActor;
  readonly memberId: string;
  readonly input: ResetMemberPasswordRequestInput;
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
    const rawInitialPassword =
      input.initialPassword ?? this.deps.config.defaultInitialPassword;
    if (!rawInitialPassword || rawInitialPassword.trim().length === 0) {
      throw badRequest(
        'errors.initialPasswordRequired',
        {},
        'INITIAL_PASSWORD_REQUIRED',
      );
    }
    const passwordHash = await hashPassword(rawInitialPassword);
    const uniqueDepartmentIds = Array.from(new Set(input.departmentIds));
    const now = this.deps.clock.now();
    const created = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistNewMember({
        membersRepo: this.deps.membersRepo,
        auditWriter: this.deps.auditWriter,
        actor,
        input,
        passwordHash,
        uniqueDepartmentIds,
        now,
        tx,
      }),
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
      persistMemberUpdate({
        membersRepo: this.deps.membersRepo,
        auditWriter: this.deps.auditWriter,
        actor,
        id,
        input,
        uniqueDepartmentIds,
        now,
        tx,
      }),
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
      persistDeactivation({
        membersRepo: this.deps.membersRepo,
        auditWriter: this.deps.auditWriter,
        actor,
        id,
        now,
        tx,
      }),
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
    const activated = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistActivation({
        membersRepo: this.deps.membersRepo,
        auditWriter: this.deps.auditWriter,
        actor,
        id,
        now,
        tx,
      }),
    );
    this.deps.logger.info('Member activated', {
      actorId: actor.id,
      targetUserId: id,
    });
    return toMemberItemResponseDto(activated, canViewMemberDetail(actor));
  }

  async resetMemberPassword(
    command: ResetMemberPasswordCommand,
  ): Promise<MemberItemResponseDto> {
    authorize(command.actor, 'member.update');
    const target = await this.deps.membersRepo.findById(command.memberId);
    if (!target) {
      throw notFound('errors.notFound', {}, 'NOT_FOUND');
    }
    assertCanResetMemberPassword(command.actor, target);
    const passwordHash = await hashPassword(command.input.newPassword);
    const now = this.deps.clock.now();
    const updated = await this.deps.transactionRunner.runInTransaction((tx) =>
      persistPasswordReset({
        membersRepo: this.deps.membersRepo,
        auditWriter: this.deps.auditWriter,
        actor: command.actor,
        memberId: command.memberId,
        passwordHash,
        now,
        tx,
      }),
    );
    this.deps.logger.info('Member password reset', {
      actorId: command.actor.id,
      targetUserId: updated.id,
    });
    return toMemberItemResponseDto(updated, canViewMemberDetail(command.actor));
  }
}
