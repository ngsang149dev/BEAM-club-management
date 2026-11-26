import { badRequest, notFound, unauthorized } from '@/lib/errors';
import type { DepartmentUpsertRequestInput } from '@/lib/members';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  type DeleteDepartmentResponseDto,
  type DepartmentListResponseDto,
  type DepartmentResponseDto,
  toDeleteDepartmentResponseDto,
  toDepartmentListResponseDto,
  toDepartmentResponseDto,
} from './mapper';
import { assertDepartmentCanBeDeleted } from './policy';
import type { DepartmentsRepository } from './repository';

export interface DepartmentsServiceDeps {
  readonly departmentsRepo: DepartmentsRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class DepartmentsService {
  constructor(private readonly deps: DepartmentsServiceDeps) {}

  async listDepartments(actor: AuthActor): Promise<DepartmentListResponseDto> {
    if (!actor.isActive) {
      throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
    }
    const items = await this.deps.departmentsRepo.listWithCounts();
    return toDepartmentListResponseDto(items);
  }

  async createDepartment(
    actor: AuthActor,
    input: DepartmentUpsertRequestInput,
  ): Promise<DepartmentResponseDto> {
    authorize(actor, 'department.manage');
    const now = this.deps.clock.now();

    const created = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      await this.assertValidLeadIfPresent(input.leadUserId, tx);
      const department = await this.deps.departmentsRepo.create(
        { name: input.name, leadUserId: input.leadUserId, now },
        tx,
      );
      const detail: Record<string, unknown> = {
        departmentId: department.id,
        name: department.name,
      };
      if (input.leadUserId) {
        detail.leadUserId = input.leadUserId;
      }
      await this.deps.auditWriter.record(
        { actorId: actor.id, action: 'department.created', detail, createdAt: now },
        tx,
      );
      return department;
    });

    this.deps.logger.info('Department created', {
      actorId: actor.id,
      departmentId: created.id,
    });
    return toDepartmentResponseDto(created);
  }

  async renameDepartment(
    actor: AuthActor,
    id: string,
    input: DepartmentUpsertRequestInput,
  ): Promise<DepartmentResponseDto> {
    authorize(actor, 'department.manage');
    const now = this.deps.clock.now();

    const updated = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const existing = await this.deps.departmentsRepo.lockAndFindByIdWithCounts(id, tx);
      if (!existing) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      await this.assertValidLeadIfPresent(input.leadUserId, tx);
      const department = await this.deps.departmentsRepo.rename(
        { id, name: input.name, leadUserId: input.leadUserId, now },
        tx,
      );
      if (!department) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      const previousLeadId = existing.lead?.id ?? null;
      const nextLeadId = department.lead?.id ?? null;
      const detail: Record<string, unknown> = {
        departmentId: department.id,
        name: department.name,
      };
      if (input.leadUserId !== undefined && nextLeadId !== previousLeadId) {
        detail.leadUserId = nextLeadId;
      }
      await this.deps.auditWriter.record(
        { actorId: actor.id, action: 'department.updated', detail, createdAt: now },
        tx,
      );
      return department;
    });

    this.deps.logger.info('Department updated', {
      actorId: actor.id,
      departmentId: updated.id,
    });
    return toDepartmentResponseDto(updated);
  }

  async deleteDepartment(
    actor: AuthActor,
    id: string,
  ): Promise<DeleteDepartmentResponseDto> {
    authorize(actor, 'department.manage');
    const now = this.deps.clock.now();

    await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const department =
        await this.deps.departmentsRepo.lockAndFindByIdWithCounts(id, tx);
      if (!department) {
        throw notFound('errors.notFound', {}, 'NOT_FOUND');
      }
      assertDepartmentCanBeDeleted(department);

      const deleted = await this.deps.departmentsRepo.deleteById(id, tx);
      if (!deleted) {
        throw notFound('errors.notFound', {}, 'NOT_FOUND');
      }

      await this.deps.auditWriter.record(
        {
          actorId: actor.id,
          action: 'department.deleted',
          detail: { departmentId: id, name: department.name },
          createdAt: now,
        },
        tx,
      );
    });

    this.deps.logger.info('Department deleted', {
      actorId: actor.id,
      departmentId: id,
    });
    return toDeleteDepartmentResponseDto(id);
  }

  private async assertValidLeadIfPresent(
    leadUserId: string | null | undefined,
    tx: TransactionContext,
  ): Promise<void> {
    if (typeof leadUserId !== 'string') return;
    const isActiveMember = await this.deps.departmentsRepo.isActiveLeadCandidate(
      leadUserId,
      tx,
    );
    if (!isActiveMember) {
      throw badRequest('errors.invalidDepartmentLead', {}, 'INVALID_DEPARTMENT_LEAD');
    }
  }
}
