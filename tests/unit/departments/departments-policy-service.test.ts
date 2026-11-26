import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  assertDepartmentCanBeDeleted,
  type DepartmentRecord,
  type DepartmentsRepository,
  DepartmentsService,
} from '@/server/modules/departments';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type {
  TransactionContext,
  TransactionRunner,
} from '@/server/shared/transaction';

class InMemoryDepartmentsRepository implements DepartmentsRepository {
  readonly rows = new Map<string, DepartmentRecord>();
  readonly leadCandidates = new Map<string, NonNullable<DepartmentRecord['lead']>>();
  private seq = 0;

  async listWithCounts(): Promise<DepartmentRecord[]> {
    return Array.from(this.rows.values()).sort((a, b) =>
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }

  async findByIdWithCounts(id: string): Promise<DepartmentRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async lockAndFindByIdWithCounts(id: string): Promise<DepartmentRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async isActiveLeadCandidate(leadUserId: string): Promise<boolean> {
    return this.leadCandidates.has(leadUserId);
  }

  async create(input: {
    readonly name: string;
    readonly leadUserId?: string | null;
    readonly now: Date;
  }): Promise<DepartmentRecord> {
    for (const existing of this.rows.values()) {
      if (existing.name.trim().toLowerCase() === input.name.trim().toLowerCase()) {
        throw new AppError(
          'DEPARTMENT_NAME_EXISTS',
          'errors.departmentNameExists',
          409,
        );
      }
    }
    this.seq += 1;
    const lead = input.leadUserId ? (this.leadCandidates.get(input.leadUserId) ?? null) : null;
    const created: DepartmentRecord = {
      id: `dept-${this.seq}`,
      name: input.name,
      lead,
      memberCount: 0,
      boardCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.rows.set(created.id, created);
    return created;
  }

  async rename(input: {
    readonly id: string;
    readonly name: string;
    readonly leadUserId?: string | null;
    readonly now: Date;
  }): Promise<DepartmentRecord | null> {
    const existing = this.rows.get(input.id);
    if (!existing) return null;
    for (const other of this.rows.values()) {
      if (
        other.id !== input.id &&
        other.name.trim().toLowerCase() === input.name.trim().toLowerCase()
      ) {
        throw new AppError(
          'DEPARTMENT_NAME_EXISTS',
          'errors.departmentNameExists',
          409,
        );
      }
    }
    const lead =
      input.leadUserId === undefined
        ? existing.lead
        : input.leadUserId === null
          ? null
          : (this.leadCandidates.get(input.leadUserId) ?? null);
    const updated: DepartmentRecord = {
      ...existing,
      name: input.name,
      lead,
      updatedAt: input.now,
    };
    this.rows.set(input.id, updated);
    return updated;
  }

  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
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
  const repo = new InMemoryDepartmentsRepository();
  const auditWriter = new SpyAuditWriter();
  const clock = new FakeClock('2026-11-24T00:00:00.000Z');
  const logs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => logs.push(line),
    writeErr: (line) => logs.push(line),
  });
  const service = new DepartmentsService({
    departmentsRepo: repo,
    auditWriter,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
  });
  return { repo, auditWriter, clock, logs, service };
}

const BASIC_ACTOR: AuthActor = {
  id: 'actor-basic',
  isActive: true,
  isAdmin: false,
  permissions: ['member.view'],
};

const MANAGER_ACTOR: AuthActor = {
  id: 'actor-dept-mgr',
  isActive: true,
  isAdmin: false,
  permissions: ['department.manage'],
};

describe('departments policy', () => {
  it('blocks deletion when memberCount > 0 or boardCount > 0 (WQ-10)', () => {
    expect(() =>
      assertDepartmentCanBeDeleted({ memberCount: 0, boardCount: 0 }),
    ).not.toThrow();

    for (const counts of [
      { memberCount: 1, boardCount: 0 },
      { memberCount: 0, boardCount: 2 },
      { memberCount: 3, boardCount: 1 },
    ]) {
      try {
        assertDepartmentCanBeDeleted(counts);
        expect.unreachable('Expected conflict error');
      } catch (error) {
        const appError = error as AppError;
        expect(appError.httpStatus).toBe(409);
        expect(appError.code).toBe('DEPARTMENT_IN_USE');
        expect(appError.details).toEqual(counts);
      }
    }
  });
});

describe('DepartmentsService', () => {
  it('allows any active user to list departments without department.manage', async () => {
    const { repo, service } = createHarness();
    repo.rows.set('d1', {
      id: 'd1',
      name: 'Media',
      lead: null,
      memberCount: 2,
      boardCount: 1,
      createdAt: new Date('2026-11-24T00:00:00.000Z'),
      updatedAt: new Date('2026-11-24T00:00:00.000Z'),
    });

    const list = await service.listDepartments(BASIC_ACTOR);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: 'd1',
      name: 'Media',
      lead: null,
      memberCount: 2,
      boardCount: 1,
    });
  });

  it('enforces department.manage on create, rename, and delete and records audit_logs', async () => {
    const { auditWriter, service } = createHarness();

    await expect(
      service.createDepartment(BASIC_ACTOR, { name: 'Tech' }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    const created = await service.createDepartment(MANAGER_ACTOR, { name: 'Tech' });
    expect(created.department.name).toBe('Tech');

    await expect(
      service.createDepartment(MANAGER_ACTOR, { name: ' tech ' }),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'DEPARTMENT_NAME_EXISTS' });

    await expect(
      service.renameDepartment(BASIC_ACTOR, created.department.id, {
        name: 'Engineering',
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    const renamed = await service.renameDepartment(
      MANAGER_ACTOR,
      created.department.id,
      { name: 'Engineering' },
    );
    expect(renamed.department.name).toBe('Engineering');

    await expect(
      service.deleteDepartment(BASIC_ACTOR, created.department.id),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    const deleted = await service.deleteDepartment(
      MANAGER_ACTOR,
      created.department.id,
    );
    expect(deleted).toEqual({ deleted: true, id: created.department.id });

    expect(auditWriter.entries.map((entry) => entry.action)).toEqual([
      'department.created',
      'department.updated',
      'department.deleted',
    ]);
  });

  it('returns 404 on missing department and 409 when deleting non-empty department', async () => {
    const { repo, service } = createHarness();
    repo.rows.set('d-busy', {
      id: 'd-busy',
      name: 'Events',
      lead: null,
      memberCount: 1,
      boardCount: 0,
      createdAt: new Date('2026-11-24T00:00:00.000Z'),
      updatedAt: new Date('2026-11-24T00:00:00.000Z'),
    });

    await expect(
      service.renameDepartment(MANAGER_ACTOR, 'missing-id', { name: 'X' }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    await expect(
      service.deleteDepartment(MANAGER_ACTOR, 'missing-id'),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    await expect(
      service.deleteDepartment(MANAGER_ACTOR, 'd-busy'),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'DEPARTMENT_IN_USE' });
  });

  it('validates leadUserId against active profiles, preserves on omitted PATCH, clears on null, and omits PII', async () => {
    const { repo, auditWriter, service } = createHarness();
    const LEAD_ID = '10000000-0000-4000-8000-000000000099';
    repo.leadCandidates.set(LEAD_ID, {
      id: LEAD_ID,
      fullName: 'Lead User',
      avatarUpdatedAt: null,
      isActive: true,
      leftAt: null,
      departments: [],
    });

    await expect(
      service.createDepartment(MANAGER_ACTOR, {
        name: 'Media',
        leadUserId: '10000000-0000-4000-8000-000000000888',
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DEPARTMENT_LEAD' });

    const created = await service.createDepartment(MANAGER_ACTOR, {
      name: 'Media',
      leadUserId: LEAD_ID,
    });
    expect(created.department.lead).toEqual({
      id: LEAD_ID,
      fullName: 'Lead User',
      avatarUrl: null,
      isActive: true,
      leftAt: null,
      departments: [],
    });
    expect(created.department.lead).not.toHaveProperty('studentId');
    expect(created.department.lead).not.toHaveProperty('email');
    expect(auditWriter.entries[0]?.detail).toEqual({
      departmentId: created.department.id,
      name: 'Media',
      leadUserId: LEAD_ID,
    });

    // Omitting leadUserId preserves existing lead
    const renamed = await service.renameDepartment(MANAGER_ACTOR, created.department.id, {
      name: 'Media & PR',
    });
    expect(renamed.department.lead?.id).toBe(LEAD_ID);

    // Passing invalid leadUserId on update rejects cleanly
    await expect(
      service.renameDepartment(MANAGER_ACTOR, created.department.id, {
        name: 'Media & PR',
        leadUserId: '10000000-0000-4000-8000-000000000888',
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DEPARTMENT_LEAD' });

    // Passing leadUserId: null clears the lead
    const cleared = await service.renameDepartment(MANAGER_ACTOR, created.department.id, {
      name: 'Media & PR',
      leadUserId: null,
    });
    expect(cleared.department.lead).toBeNull();
    expect(auditWriter.entries.at(-1)?.detail).toEqual({
      departmentId: created.department.id,
      name: 'Media & PR',
      leadUserId: null,
    });
  });
});
