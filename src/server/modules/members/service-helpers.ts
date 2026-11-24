import { badRequest, conflict, notFound } from '@/lib/errors';
import type {
  CreateMemberRequestInput,
  UpdateMemberRequestInput,
} from '@/lib/members';
import { DEFAULT_MEMBER_PERMISSIONS } from '@/lib/permissions';
import type { AuditLogWriter } from '@/server/modules/audit';
import type { AuthActor } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';
import { assertCanResetMemberPassword } from './policy';
import type { MemberProfileRecord, MembersRepository } from './repository';

export function collectUpdatedFields(input: UpdateMemberRequestInput): string[] {
  const fields: string[] = [];
  if (input.email !== undefined) fields.push('email');
  if (input.fullName !== undefined) fields.push('fullName');
  if (input.locale !== undefined) fields.push('locale');
  if (input.departmentIds !== undefined) fields.push('departmentIds');
  return fields;
}

export async function assertDepartmentsExist(
  membersRepo: MembersRepository,
  departmentIds: readonly string[],
  tx: TransactionContext,
): Promise<void> {
  if (departmentIds.length === 0) return;
  const existing = await membersRepo.findExistingDepartmentIds(departmentIds, tx);
  if (existing.length !== departmentIds.length) {
    throw badRequest('errors.invalidDepartmentIds', {}, 'INVALID_DEPARTMENT_IDS');
  }
}

export interface PersistNewMemberParams {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly actor: AuthActor;
  readonly input: CreateMemberRequestInput;
  readonly passwordHash: string;
  readonly uniqueDepartmentIds: readonly string[];
  readonly now: Date;
  readonly tx: TransactionContext;
}

export async function persistNewMember(
  params: PersistNewMemberParams,
): Promise<MemberProfileRecord> {
  const { membersRepo, auditWriter, actor, input, uniqueDepartmentIds, now, tx } = params;
  await assertDepartmentsExist(membersRepo, uniqueDepartmentIds, tx);
  const member = await membersRepo.createMember(
    {
      studentId: input.studentId,
      email: input.email,
      fullName: input.fullName,
      passwordHash: params.passwordHash,
      mustChangePassword: true,
      locale: input.locale,
      departmentIds: uniqueDepartmentIds,
      defaultPermissions: DEFAULT_MEMBER_PERMISSIONS,
      grantedBy: actor.id,
      now,
    },
    tx,
  );
  await auditWriter.record(
    {
      actorId: actor.id,
      action: 'member.created',
      targetUserId: member.id,
      detail: {
        departmentIds: uniqueDepartmentIds,
        locale: member.locale,
        grantedPermissions: [...DEFAULT_MEMBER_PERMISSIONS],
      },
      createdAt: now,
    },
    tx,
  );
  return member;
}

export async function persistMemberUpdate(params: {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly actor: AuthActor;
  readonly id: string;
  readonly input: UpdateMemberRequestInput;
  readonly uniqueDepartmentIds?: readonly string[];
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<MemberProfileRecord> {
  const { membersRepo, auditWriter, actor, id, input, uniqueDepartmentIds, now, tx } = params;
  const existing = await membersRepo.lockAndFindById(id, tx);
  if (!existing) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (uniqueDepartmentIds !== undefined) {
    await assertDepartmentsExist(membersRepo, uniqueDepartmentIds, tx);
  }
  const member = await membersRepo.updateMember(
    { id, email: input.email, fullName: input.fullName, locale: input.locale, departmentIds: uniqueDepartmentIds, now },
    tx,
  );
  if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  await auditWriter.record(
    { actorId: actor.id, action: 'member.updated', targetUserId: id, detail: { updatedFields: collectUpdatedFields(input) }, createdAt: now },
    tx,
  );
  return member;
}

export async function persistDeactivation(params: {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly actor: AuthActor;
  readonly id: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<MemberProfileRecord> {
  const target = await params.membersRepo.lockAndFindById(params.id, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (target.isAdmin && target.isActive) {
    const activeAdmins = await params.membersRepo.countActiveAdmins(params.tx);
    if (activeAdmins <= 1) {
      throw conflict('errors.lastActiveAdmin', {}, 'LAST_ACTIVE_ADMIN');
    }
  }
  const member = await params.membersRepo.deactivateMember(
    { id: params.id, leftAt: target.leftAt ?? params.now, now: params.now },
    params.tx,
  );
  if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  await params.membersRepo.revokeAllActiveSessions(params.id, params.now, params.tx);
  await params.auditWriter.record(
    {
      actorId: params.actor.id,
      action: 'member.deactivated',
      targetUserId: params.id,
      detail: { wasAlreadyInactive: !target.isActive },
      createdAt: params.now,
    },
    params.tx,
  );
  return member;
}

export async function persistActivation(params: {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly actor: AuthActor;
  readonly id: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<MemberProfileRecord> {
  const target = await params.membersRepo.lockAndFindById(params.id, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  const member = await params.membersRepo.activateMember(
    { id: params.id, now: params.now },
    params.tx,
  );
  if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  await params.auditWriter.record(
    {
      actorId: params.actor.id,
      action: 'member.activated',
      targetUserId: params.id,
      detail: { wasAlreadyActive: target.isActive },
      createdAt: params.now,
    },
    params.tx,
  );
  return member;
}

export async function persistPasswordReset(params: {
  readonly membersRepo: MembersRepository;
  readonly auditWriter: AuditLogWriter;
  readonly actor: AuthActor;
  readonly memberId: string;
  readonly passwordHash: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<MemberProfileRecord> {
  const target = await params.membersRepo.lockAndFindById(
    params.memberId,
    params.tx,
  );
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  assertCanResetMemberPassword(params.actor, target);
  const updated = await params.membersRepo.resetPasswordAndRevokeAllSessions(
    {
      userId: target.id,
      passwordHash: params.passwordHash,
      mustChangePassword: true,
      now: params.now,
    },
    params.tx,
  );
  if (!updated) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  await params.auditWriter.record(
    {
      actorId: params.actor.id,
      action: 'member.password_reset',
      targetUserId: updated.id,
      detail: { forceChangeOnLogin: true, sessionsRevoked: true },
      createdAt: params.now,
    },
    params.tx,
  );
  return updated;
}
