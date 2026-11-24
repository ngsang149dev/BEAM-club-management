import { describe, expect, it } from 'vitest';
import {
  assertValidAuditDateRange,
  type AuditLogRecord,
  type AuditRepository,
  AuditService,
  decodeAuditCursor,
  encodeAuditCursor,
  type ListAuditLogsParams,
} from '@/server/modules/audit';
import type { AuthActor } from '@/server/shared/authorize';
import { StructuredLogger } from '@/server/shared/logger';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const TARGET_ID = '10000000-0000-4000-8000-000000000002';
const LOG_1_ID = '70000000-0000-4000-8000-000000000001';
const LOG_2_ID = '70000000-0000-4000-8000-000000000002';

class FakeAuditRepository implements AuditRepository {
  lastParams: ListAuditLogsParams | null = null;
  rowsToReturn: AuditLogRecord[] = [];
  hasMoreToReturn = false;

  async record(): Promise<void> {
    // no-op for unit read test
  }

  async listAuditLogs(
    params: ListAuditLogsParams,
  ): Promise<{ readonly rows: AuditLogRecord[]; readonly hasMore: boolean }> {
    this.lastParams = params;
    return { rows: this.rowsToReturn, hasMore: this.hasMoreToReturn };
  }
}

function createHarness() {
  const repo = new FakeAuditRepository();
  const logger = new StructuredLogger({ writeOut: () => undefined, writeErr: () => undefined });
  const service = new AuditService({ auditRepo: repo, logger });
  return { repo, service };
}

const NO_AUDIT_ACTOR: AuthActor = {
  id: 'actor-no-audit',
  isActive: true,
  isAdmin: false,
  permissions: ['member.view', 'member.view_detail'],
};

const AUDIT_VIEWER_ACTOR: AuthActor = {
  id: ACTOR_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['audit.view'],
};

const INACTIVE_ACTOR: AuthActor = {
  id: ACTOR_ID,
  isActive: false,
  isAdmin: true,
  permissions: ['audit.view'],
};

describe('audit policy & AuditService', () => {
  it('encodes/decodes valid cursor and rejects tampered or malformed cursors (400 INVALID_CURSOR)', () => {
    const original = {
      createdAt: new Date('2026-11-24T05:10:00.123Z'),
      id: LOG_1_ID,
    };
    const encoded = encodeAuditCursor(original);
    const decoded = decodeAuditCursor(encoded);
    expect(decoded.createdAt.toISOString()).toBe(original.createdAt.toISOString());
    expect(decoded.id).toBe(LOG_1_ID);

    const badIsoCursor = Buffer.from(
      JSON.stringify({ createdAt: 'not-a-date', id: LOG_1_ID }),
      'utf8',
    ).toString('base64url');
    const badIdCursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-11-24T05:10:00.123Z', id: 'not-uuid' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeAuditCursor('tampered-cursor')).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );
    expect(() => decodeAuditCursor(`${encoded}=`)).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );
    expect(() => decodeAuditCursor(badIsoCursor)).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );
    expect(() => decodeAuditCursor(badIdCursor)).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );
  });

  it('validates from <= to date range (400 INVALID_DATE_RANGE)', () => {
    const earlier = new Date('2026-11-24T01:00:00.000Z');
    const later = new Date('2026-11-24T02:00:00.000Z');

    expect(() => assertValidAuditDateRange(earlier, earlier)).not.toThrow();
    expect(() => assertValidAuditDateRange(earlier, later)).not.toThrow();
    expect(() => assertValidAuditDateRange(earlier, undefined)).not.toThrow();
    expect(() => assertValidAuditDateRange(later, earlier)).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_DATE_RANGE' }),
    );
  });

  it('enforces audit.view authorization (401 inactive, 403 missing permission)', async () => {
    const { service } = createHarness();

    await expect(service.listAuditLogs(INACTIVE_ACTOR, { limit: 20 })).rejects.toMatchObject({
      httpStatus: 401,
      code: 'ACCOUNT_INACTIVE',
    });
    await expect(service.listAuditLogs(NO_AUDIT_ACTOR, { limit: 20 })).rejects.toMatchObject({
      httpStatus: 403,
      code: 'FORBIDDEN',
    });
  });

  it('forwards filters & cursor, projects MemberPublicSummary, scrubs detail PII, and returns nextCursor', async () => {
    const { repo, service } = createHarness();
    const from = new Date('2026-11-24T00:00:00.000Z');
    const to = new Date('2026-11-24T12:00:00.000Z');
    const inputCursor = encodeAuditCursor({
      createdAt: new Date('2026-11-24T11:00:00.000Z'),
      id: LOG_1_ID,
    });

    await expect(
      service.listAuditLogs(AUDIT_VIEWER_ACTOR, { from: to, to: from, limit: 20 }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DATE_RANGE' });
    expect(repo.lastParams).toBeNull();

    repo.rowsToReturn = [
      {
        id: LOG_2_ID,
        actor: {
          id: ACTOR_ID,
          fullName: 'Audit Viewer',
          avatarUpdatedAt: new Date('2026-11-24T09:00:00.000Z'),
          isActive: true,
          leftAt: null,
          departments: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Tech' }],
        },
        targetUser: {
          id: TARGET_ID,
          fullName: 'Former Member',
          avatarUpdatedAt: null,
          isActive: false,
          leftAt: new Date('2026-11-20T00:00:00.000Z'),
          departments: [],
        },
        action: 'permissions.updated',
        detail: {
          added: ['board.create'],
          studentId: 'MSSV-SHOULD-NOT-APPEAR',
          email: 'hidden@eiu.edu.vn',
          note: 'contact person@eiu.edu.vn',
        },
        createdAt: new Date('2026-11-24T10:00:00.000Z'),
      },
    ];
    repo.hasMoreToReturn = true;

    const page = await service.listAuditLogs(AUDIT_VIEWER_ACTOR, {
      actorId: ACTOR_ID,
      targetUserId: TARGET_ID,
      action: 'permissions.updated',
      from,
      to,
      cursor: inputCursor,
      limit: 1,
    });

    expect(repo.lastParams).toMatchObject({
      actorId: ACTOR_ID,
      targetUserId: TARGET_ID,
      action: 'permissions.updated',
      from,
      to,
      limit: 1,
      cursor: { createdAt: new Date('2026-11-24T11:00:00.000Z'), id: LOG_1_ID },
    });

    expect(page.meta.limit).toBe(1);
    expect(page.meta.nextCursor).toBeTruthy();
    expect(decodeAuditCursor(page.meta.nextCursor!)).toMatchObject({
      id: LOG_2_ID,
      createdAt: new Date('2026-11-24T10:00:00.000Z'),
    });

    const item = page.items[0]!;
    expect(Object.keys(item.actor).sort()).toEqual([
      'avatarUrl',
      'departments',
      'fullName',
      'id',
      'isActive',
      'leftAt',
    ]);
    expect(item.actor.avatarUrl).toBe(
      `/api/v1/members/${ACTOR_ID}/avatar?v=${new Date('2026-11-24T09:00:00.000Z').getTime()}`,
    );
    expect(item.targetUser).toMatchObject({
      id: TARGET_ID,
      fullName: 'Former Member',
      avatarUrl: null,
      isActive: false,
      leftAt: '2026-11-20T00:00:00.000Z',
      departments: [],
    });
    expect(item.detail).toEqual({
      added: ['board.create'],
      studentId: '[REDACTED]',
      email: '[REDACTED]',
      note: 'contact [REDACTED_EMAIL]',
    });
  });
});
