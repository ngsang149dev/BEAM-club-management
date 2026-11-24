import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { DEFAULT_MEMBER_PERMISSIONS, type PermissionCode } from '@/lib/permissions';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  type CreateMemberParams,
  type ListMembersParams,
  type MemberProfileRecord,
  type MembersRepository,
  MembersService,
  type UpdateMemberParams,
} from '@/server/modules/members';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import { StructuredLogger } from '@/server/shared/logger';
import { DEV_SEED_PASSWORD, verifyPassword } from '@/server/shared/password';
import type {
  TransactionContext,
  TransactionRunner,
} from '@/server/shared/transaction';

class InMemoryMembersRepository implements MembersRepository {
  readonly profiles = new Map<string, MemberProfileRecord>();
  readonly passwordHashes = new Map<string, string | null>();
  readonly permissions = new Map<string, PermissionCode[]>();
  readonly activeSessions = new Set<string>();
  readonly validDepartments = new Map<string, string>([
    ['11111111-1111-4111-8111-111111111111', 'Tech'],
    ['22222222-2222-4222-8222-222222222222', 'Media'],
  ]);
  lastListParams: ListMembersParams | null = null;
  private seq = 0;

  async listMembers(
    params: ListMembersParams,
  ): Promise<{ readonly rows: MemberProfileRecord[]; readonly hasMore: boolean }> {
    this.lastListParams = params;
    let items = Array.from(this.profiles.values());
    if (params.q) {
      const qLower = params.q.toLowerCase();
      items = items.filter(
        (m) =>
          m.fullName.toLowerCase().includes(qLower) ||
          (params.includeStudentIdSearch &&
            m.studentId.toLowerCase().includes(qLower)),
      );
    }
    if (params.departmentId) {
      items = items.filter((m) =>
        m.departments.some((d) => d.id === params.departmentId),
      );
    }
    if (params.isActive !== undefined) {
      items = items.filter((m) => m.isActive === params.isActive);
    }
    items.sort(
      (a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id),
    );
    if (params.cursor) {
      const cursor = params.cursor;
      items = items.filter(
        (m) =>
          m.fullName > cursor.fullName ||
          (m.fullName === cursor.fullName && m.id > cursor.id),
      );
    }
    const hasMore = items.length > params.limit;
    return { rows: items.slice(0, params.limit), hasMore };
  }

  async findById(id: string): Promise<MemberProfileRecord | null> {
    return this.profiles.get(id) ?? null;
  }

  async lockAndFindById(id: string): Promise<MemberProfileRecord | null> {
    return this.profiles.get(id) ?? null;
  }

  async findExistingDepartmentIds(ids: readonly string[]): Promise<string[]> {
    return ids.filter((id) => this.validDepartments.has(id));
  }

  async createMember(input: CreateMemberParams): Promise<MemberProfileRecord> {
    for (const existing of this.profiles.values()) {
      if (existing.studentId === input.studentId) {
        throw new AppError('STUDENT_ID_EXISTS', 'errors.studentIdExists', 409);
      }
      if (existing.email.toLowerCase() === input.email.toLowerCase()) {
        throw new AppError('EMAIL_EXISTS', 'errors.emailExists', 409);
      }
    }
    this.seq += 1;
    const id = `99999999-9999-4999-8999-${String(this.seq).padStart(12, '0')}`;
    const record: MemberProfileRecord = {
      id,
      studentId: input.studentId,
      email: input.email,
      fullName: input.fullName,
      isAdmin: false,
      isActive: true,
      leftAt: null,
      locale: input.locale,
      mustChangePassword: input.mustChangePassword,
      departments: input.departmentIds.map((deptId) => ({
        id: deptId,
        name: this.validDepartments.get(deptId) ?? deptId,
      })),
    };
    this.profiles.set(id, record);
    this.passwordHashes.set(id, input.passwordHash);
    this.permissions.set(id, [...input.defaultPermissions]);
    return record;
  }

  async updateMember(
    input: UpdateMemberParams,
  ): Promise<MemberProfileRecord | null> {
    const existing = this.profiles.get(input.id);
    if (!existing) return null;
    const updated: MemberProfileRecord = {
      ...existing,
      email: input.email ?? existing.email,
      fullName: input.fullName ?? existing.fullName,
      locale: input.locale ?? existing.locale,
      departments: input.departmentIds
        ? input.departmentIds.map((deptId) => ({
            id: deptId,
            name: this.validDepartments.get(deptId) ?? deptId,
          }))
        : existing.departments,
    };
    this.profiles.set(input.id, updated);
    return updated;
  }

  async countActiveAdmins(): Promise<number> {
    let count = 0;
    for (const profile of this.profiles.values()) {
      if (profile.isAdmin && profile.isActive) count += 1;
    }
    return count;
  }

  async deactivateMember(input: {
    readonly id: string;
    readonly leftAt: Date;
  }): Promise<MemberProfileRecord | null> {
    const existing = this.profiles.get(input.id);
    if (!existing) return null;
    const updated: MemberProfileRecord = {
      ...existing,
      isActive: false,
      leftAt: input.leftAt,
    };
    this.profiles.set(input.id, updated);
    return updated;
  }

  async revokeAllActiveSessions(userId: string): Promise<void> {
    this.activeSessions.delete(userId);
  }

  async activateMember(input: {
    readonly id: string;
  }): Promise<MemberProfileRecord | null> {
    const existing = this.profiles.get(input.id);
    if (!existing) return null;
    const updated: MemberProfileRecord = {
      ...existing,
      isActive: true,
      leftAt: null,
    };
    this.profiles.set(input.id, updated);
    return updated;
  }

  async resetPasswordAndRevokeAllSessions(input: {
    readonly userId: string;
    readonly passwordHash: string;
    readonly mustChangePassword: boolean;
    readonly now: Date;
  }): Promise<MemberProfileRecord | null> {
    const existing = this.profiles.get(input.userId);
    if (!existing) return null;
    const updated: MemberProfileRecord = {
      ...existing,
      mustChangePassword: input.mustChangePassword,
    };
    this.profiles.set(input.userId, updated);
    this.passwordHashes.set(input.userId, input.passwordHash);
    this.activeSessions.delete(input.userId);
    return updated;
  }
}

class SpyAuditWriter implements AuditLogWriter {
  readonly entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const TEST_CONFIG: Config = {
  nodeEnv: 'test',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  sessionSecret: 'unit-test-secret-0123456789abcdef',
  sessionTtlDefaultHours: 24,
  sessionTtlRememberDays: 30,
  allowedEmailDomain: 'eiu.edu.vn',
  defaultInitialPassword: DEV_SEED_PASSWORD,
  cronSecret: 'unit-test-cron-secret',
  smtp: {},
  appUrl: 'http://localhost:3000',
  undoToastSeconds: 10,
};

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

function createHarness(configOverrides: Partial<Config> = {}) {
  const repo = new InMemoryMembersRepository();
  const auditWriter = new SpyAuditWriter();
  const clock = new FakeClock('2026-11-24T00:00:00.000Z');
  const rawLogs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => rawLogs.push(line),
    writeErr: (line) => rawLogs.push(line),
  });

  repo.profiles.set('10000000-0000-4000-8000-000000000001', {
    id: '10000000-0000-4000-8000-000000000001',
    studentId: 'MSSV-ADMIN-01',
    email: 'admin01@eiu.edu.vn',
    fullName: 'Alpha Admin',
    isAdmin: true,
    isActive: true,
    leftAt: null,
    locale: 'vi',
    mustChangePassword: false,
    departments: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Tech' }],
  });
  repo.activeSessions.add('10000000-0000-4000-8000-000000000001');
  repo.profiles.set('10000000-0000-4000-8000-000000000002', {
    id: '10000000-0000-4000-8000-000000000002',
    studentId: 'MSSV-SECRET-02',
    email: 'beta@eiu.edu.vn',
    fullName: 'Beta Member',
    isAdmin: false,
    isActive: true,
    leftAt: null,
    locale: 'en',
    mustChangePassword: false,
    departments: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Media' }],
  });
  repo.activeSessions.add('10000000-0000-4000-8000-000000000002');

  const service = new MembersService({
    membersRepo: repo,
    auditWriter,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    config: { ...TEST_CONFIG, ...configOverrides },
    logger,
  });
  return { repo, auditWriter, clock, rawLogs, service };
}

const NO_PERM_ACTOR: AuthActor = {
  id: 'actor-none',
  isActive: true,
  isAdmin: false,
  permissions: [],
};

const VIEW_ONLY_ACTOR: AuthActor = {
  id: 'actor-view',
  isActive: true,
  isAdmin: false,
  permissions: ['member.view'],
};

const CREATE_NO_DETAIL_ACTOR: AuthActor = {
  id: 'actor-create-only',
  isActive: true,
  isAdmin: false,
  permissions: ['member.create', 'member.update', 'member.deactivate'],
};

const DETAIL_ADMIN_ACTOR: AuthActor = {
  id: '10000000-0000-4000-8000-000000000001',
  isActive: true,
  isAdmin: true,
  permissions: [],
};

describe('MembersService permissions, PII masking & rules', () => {
  it('enforces 403 for all member.* permissions when missing', async () => {
    const { service } = createHarness();

    await expect(
      service.listMembers(NO_PERM_ACTOR, { limit: 20 }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.getMember(
        NO_PERM_ACTOR,
        '10000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.createMember(VIEW_ONLY_ACTOR, {
        studentId: 'MSSV-NEW-1',
        email: 'new1@eiu.edu.vn',
        fullName: 'New',
        departmentIds: [],
        locale: 'vi',
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.updateMember(
        VIEW_ONLY_ACTOR,
        '10000000-0000-4000-8000-000000000002',
        { fullName: 'X' },
      ),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.deactivateMember(
        VIEW_ONLY_ACTOR,
        '10000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.activateMember(
        VIEW_ONLY_ACTOR,
        '10000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    await expect(
      service.resetMemberPassword({
        actor: VIEW_ONLY_ACTOR,
        memberId: '10000000-0000-4000-8000-000000000002',
        input: { newPassword: 'ResetPass#2026' },
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
  });

  it('masks studentId/email on read & hides studentId from search q without member.view_detail (AC-11, WQ-11)', async () => {
    const { service } = createHarness();

    const listBasic = await service.listMembers(VIEW_ONLY_ACTOR, {
      q: 'MSSV-SECRET-02',
      limit: 20,
    });
    expect(listBasic.items).toHaveLength(0);

    const listAllBasic = await service.listMembers(VIEW_ONLY_ACTOR, { limit: 20 });
    expect(listAllBasic.items).toHaveLength(2);
    for (const item of listAllBasic.items) {
      expect('studentId' in item).toBe(false);
      expect('email' in item).toBe(false);
      expect('locale' in item).toBe(false);
      expect('isAdmin' in item).toBe(false);
      expect('mustChangePassword' in item).toBe(false);
      expect('passwordHash' in item).toBe(false);
    }

    const detailBasic = await service.getMember(
      VIEW_ONLY_ACTOR,
      '10000000-0000-4000-8000-000000000002',
    );
    expect('studentId' in detailBasic.member).toBe(false);
    expect('email' in detailBasic.member).toBe(false);
    expect('mustChangePassword' in detailBasic.member).toBe(false);
    expect('passwordHash' in detailBasic.member).toBe(false);

    const listDetail = await service.listMembers(
      {
        id: 'actor-detail',
        isActive: true,
        isAdmin: false,
        permissions: ['member.view', 'member.view_detail'],
      },
      { q: 'MSSV-SECRET-02', limit: 20 },
    );
    expect(listDetail.items).toHaveLength(1);
    expect(listDetail.items[0]).toMatchObject({
      studentId: 'MSSV-SECRET-02',
      email: 'beta@eiu.edu.vn',
    });
  });

  it('masks studentId/email on POST/PATCH/deactivate/activate when caller lacks member.view_detail', async () => {
    const { repo, auditWriter, rawLogs, service } = createHarness();

    const created = await service.createMember(CREATE_NO_DETAIL_ACTOR, {
      studentId: 'MSSV-NEW-MASKED',
      email: 'masked@eiu.edu.vn',
      fullName: 'Gamma Masked',
      departmentIds: ['11111111-1111-4111-8111-111111111111'],
      locale: 'en',
    });
    expect('studentId' in created.member).toBe(false);
    expect('email' in created.member).toBe(false);
    expect(repo.permissions.get(created.member.id)).toEqual(
      DEFAULT_MEMBER_PERMISSIONS,
    );

    const updated = await service.updateMember(
      CREATE_NO_DETAIL_ACTOR,
      created.member.id,
      { fullName: 'Gamma Updated' },
    );
    expect('studentId' in updated.member).toBe(false);
    expect('email' in updated.member).toBe(false);

    const deactivated = await service.deactivateMember(
      CREATE_NO_DETAIL_ACTOR,
      created.member.id,
    );
    expect('studentId' in deactivated.member).toBe(false);
    expect(deactivated.member.isActive).toBe(false);

    const activated = await service.activateMember(
      CREATE_NO_DETAIL_ACTOR,
      created.member.id,
    );
    expect('studentId' in activated.member).toBe(false);
    expect(activated.member.isActive).toBe(true);

    const serializedAudit = JSON.stringify(auditWriter.entries);
    const serializedLogs = JSON.stringify(rawLogs);
    expect(serializedAudit).not.toContain('MSSV-NEW-MASKED');
    expect(serializedAudit).not.toContain('masked@eiu.edu.vn');
    expect(serializedLogs).not.toContain('MSSV-NEW-MASKED');
    expect(serializedLogs).not.toContain('masked@eiu.edu.vn');
  });

  it('validates email domain (AC-14), departmentIds, duplicates, and last active admin (AC-09)', async () => {
    const { repo, service } = createHarness();

    await expect(
      service.createMember(DETAIL_ADMIN_ACTOR, {
        studentId: 'MSSV-BAD-MAIL',
        email: 'bad@gmail.com',
        fullName: 'Bad Mail',
        departmentIds: [],
        locale: 'vi',
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_EMAIL_DOMAIN' });

    await expect(
      service.createMember(DETAIL_ADMIN_ACTOR, {
        studentId: 'MSSV-BAD-DEPT',
        email: 'ok@eiu.edu.vn',
        fullName: 'Bad Dept',
        departmentIds: ['99999999-9999-4999-8999-999999999999'],
        locale: 'vi',
      }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DEPARTMENT_IDS' });

    await expect(
      service.createMember(DETAIL_ADMIN_ACTOR, {
        studentId: 'MSSV-ADMIN-01',
        email: 'unique@eiu.edu.vn',
        fullName: 'Dup SID',
        departmentIds: [],
        locale: 'vi',
      }),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'STUDENT_ID_EXISTS' });

    await expect(
      service.deactivateMember(
        DETAIL_ADMIN_ACTOR,
        '10000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'LAST_ACTIVE_ADMIN' });

    // Non-admin deactivation revokes active sessions
    const memberDeact = await service.deactivateMember(
      DETAIL_ADMIN_ACTOR,
      '10000000-0000-4000-8000-000000000002',
    );
    expect(memberDeact.member.isActive).toBe(false);
    expect(
      repo.activeSessions.has('10000000-0000-4000-8000-000000000002'),
    ).toBe(false);
  });

  it('validates updateMember errors (400 INVALID_EMAIL_DOMAIN, 404 NOT_FOUND, 400 INVALID_DEPARTMENT_IDS)', async () => {
    const { service } = createHarness();

    await expect(
      service.updateMember(
        DETAIL_ADMIN_ACTOR,
        '10000000-0000-4000-8000-000000000002',
        { email: 'outside@gmail.com' },
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_EMAIL_DOMAIN' });

    await expect(
      service.updateMember(
        DETAIL_ADMIN_ACTOR,
        '99999999-9999-4999-8999-000000000099',
        { fullName: 'Missing Member' },
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    await expect(
      service.updateMember(
        DETAIL_ADMIN_ACTOR,
        '10000000-0000-4000-8000-000000000002',
        { departmentIds: ['99999999-9999-4999-8999-000000000099'] },
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DEPARTMENT_IDS' });
  });

  it('forwards departmentId, isActive, and decoded cursor in listMembers', async () => {
    const { service, repo } = createHarness();

    const page1 = await service.listMembers(VIEW_ONLY_ACTOR, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.meta.nextCursor).toBeTruthy();

    const page2 = await service.listMembers(VIEW_ONLY_ACTOR, {
      limit: 1,
      cursor: page1.meta.nextCursor!,
      isActive: true,
    });
    expect(repo.lastListParams).toMatchObject({
      limit: 1,
      isActive: true,
      includeStudentIdSearch: false,
      cursor: {
        fullName: 'Alpha Admin',
        id: '10000000-0000-4000-8000-000000000001',
      },
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).toBe('10000000-0000-4000-8000-000000000002');
    expect(page2.meta.nextCursor).toBeNull();

    const mediaOnly = await service.listMembers(VIEW_ONLY_ACTOR, {
      departmentId: '22222222-2222-4222-8222-222222222222',
      isActive: true,
      limit: 20,
    });
    expect(repo.lastListParams).toMatchObject({
      departmentId: '22222222-2222-4222-8222-222222222222',
      isActive: true,
    });
    expect(mediaOnly.items.map((item) => item.id)).toEqual([
      '10000000-0000-4000-8000-000000000002',
    ]);

    await service.deactivateMember(
      DETAIL_ADMIN_ACTOR,
      '10000000-0000-4000-8000-000000000002',
    );
    const inactive = await service.listMembers(VIEW_ONLY_ACTOR, {
      isActive: false,
      limit: 20,
    });
    expect(repo.lastListParams?.isActive).toBe(false);
    expect(inactive.items.map((item) => item.id)).toEqual([
      '10000000-0000-4000-8000-000000000002',
    ]);
  });

  it('sets hashed initialPassword (custom, config fallback, or 400 in production) and marks mustChangePassword=true without leaking secrets', async () => {
    const customHarness = createHarness();
    const customCreated = await customHarness.service.createMember(DETAIL_ADMIN_ACTOR, {
      studentId: 'MSSV-CUSTOM-PW',
      email: 'custom-pw@eiu.edu.vn',
      fullName: 'Custom Password Member',
      departmentIds: [],
      locale: 'vi',
      initialPassword: 'CustomInitial#2026',
    });
    expect(customCreated.member).toMatchObject({
      studentId: 'MSSV-CUSTOM-PW',
      mustChangePassword: true,
    });
    expect('passwordHash' in customCreated.member).toBe(false);
    const customHash = customHarness.repo.passwordHashes.get(customCreated.member.id);
    expect(customHash).toBeTruthy();
    await expect(verifyPassword('CustomInitial#2026', customHash)).resolves.toBe(true);

    const fallbackCreated = await customHarness.service.createMember(
      CREATE_NO_DETAIL_ACTOR,
      {
        studentId: 'MSSV-FALLBACK-PW',
        email: 'fallback-pw@eiu.edu.vn',
        fullName: 'Fallback Password Member',
        departmentIds: [],
        locale: 'vi',
      },
    );
    expect('mustChangePassword' in fallbackCreated.member).toBe(false);
    expect('passwordHash' in fallbackCreated.member).toBe(false);
    const fallbackHash = customHarness.repo.passwordHashes.get(
      fallbackCreated.member.id,
    );
    await expect(verifyPassword(DEV_SEED_PASSWORD, fallbackHash)).resolves.toBe(true);

    const serializedAudit = JSON.stringify(customHarness.auditWriter.entries);
    const serializedLogs = JSON.stringify(customHarness.rawLogs);
    expect(serializedAudit).not.toContain('CustomInitial#2026');
    expect(serializedAudit).not.toContain(DEV_SEED_PASSWORD);
    expect(serializedAudit).not.toContain(customHash ?? '');
    expect(serializedLogs).not.toContain('CustomInitial#2026');
    expect(serializedLogs).not.toContain(DEV_SEED_PASSWORD);

    const prodHarness = createHarness({
      nodeEnv: 'production',
      defaultInitialPassword: undefined,
    });
    await expect(
      prodHarness.service.createMember(DETAIL_ADMIN_ACTOR, {
        studentId: 'MSSV-PROD-NO-DEFAULT',
        email: 'prod-nodefault@eiu.edu.vn',
        fullName: 'Prod Missing Default',
        departmentIds: [],
        locale: 'vi',
      }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      code: 'INITIAL_PASSWORD_REQUIRED',
      messageKey: 'errors.initialPasswordRequired',
    });

    const prodWithExplicit = await prodHarness.service.createMember(
      DETAIL_ADMIN_ACTOR,
      {
        studentId: 'MSSV-PROD-CUSTOM',
        email: 'prod-custom@eiu.edu.vn',
        fullName: 'Prod Explicit Pass',
        departmentIds: [],
        locale: 'vi',
        initialPassword: 'ProdExplicit#2026',
      },
    );
    expect(prodWithExplicit.member).toMatchObject({ mustChangePassword: true });
  });

  it('enforces resetMemberPassword authorization, non-admin admin-target 403 guard, session revocation, and zero secret leaks', async () => {
    const { repo, auditWriter, rawLogs, service } = createHarness();

    // Non-admin with member.update CANNOT reset an admin's password -> 403
    await expect(
      service.resetMemberPassword({
        actor: CREATE_NO_DETAIL_ACTOR,
        memberId: '10000000-0000-4000-8000-000000000001',
        input: { newPassword: 'AttemptTakeover#2026' },
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    expect(repo.activeSessions.has('10000000-0000-4000-8000-000000000001')).toBe(true);
    expect(auditWriter.entries).toHaveLength(0);

    // Non-admin with member.update CAN reset a regular member -> 200 PublicSummary (no mustChangePassword/PII)
    const memberReset = await service.resetMemberPassword({
      actor: CREATE_NO_DETAIL_ACTOR,
      memberId: '10000000-0000-4000-8000-000000000002',
      input: { newPassword: 'MemberReset#2026' },
    });
    expect('studentId' in memberReset.member).toBe(false);
    expect('mustChangePassword' in memberReset.member).toBe(false);
    expect('passwordHash' in memberReset.member).toBe(false);
    expect(repo.activeSessions.has('10000000-0000-4000-8000-000000000002')).toBe(false);
    const memberHash = repo.passwordHashes.get('10000000-0000-4000-8000-000000000002');
    await expect(verifyPassword('MemberReset#2026', memberHash)).resolves.toBe(true);

    // Admin CAN reset an admin's password -> 200 MemberDetail with mustChangePassword=true
    const adminReset = await service.resetMemberPassword({
      actor: DETAIL_ADMIN_ACTOR,
      memberId: '10000000-0000-4000-8000-000000000001',
      input: { newPassword: 'AdminReset#2026' },
    });
    expect(adminReset.member).toMatchObject({
      id: '10000000-0000-4000-8000-000000000001',
      mustChangePassword: true,
    });
    expect('passwordHash' in adminReset.member).toBe(false);
    expect(repo.activeSessions.has('10000000-0000-4000-8000-000000000001')).toBe(false);

    // Missing target -> 404
    await expect(
      service.resetMemberPassword({
        actor: DETAIL_ADMIN_ACTOR,
        memberId: '99999999-9999-4999-8999-000000000099',
        input: { newPassword: 'MissingTarget#2026' },
      }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    expect(auditWriter.entries).toHaveLength(2);
    expect(auditWriter.entries.map((e) => e.action)).toEqual([
      'member.password_reset',
      'member.password_reset',
    ]);
    expect(auditWriter.entries[0]?.detail).toEqual({
      forceChangeOnLogin: true,
      sessionsRevoked: true,
    });

    const serializedAudit = JSON.stringify(auditWriter.entries);
    const serializedLogs = JSON.stringify(rawLogs);
    for (const secret of [
      'AttemptTakeover#2026',
      'MemberReset#2026',
      'AdminReset#2026',
      memberHash ?? '',
    ]) {
      expect(serializedAudit).not.toContain(secret);
      expect(serializedLogs).not.toContain(secret);
    }
  });
});
