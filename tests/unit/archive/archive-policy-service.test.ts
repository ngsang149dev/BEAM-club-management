import { describe, expect, it } from 'vitest';
import type { ArchiveEntityType, ArchiveRetentionDays } from '@/lib/archive';
import { AppError } from '@/lib/errors';
import {
  type ArchiveRepository,
  type ArchiveRetentionRecord,
  ArchiveService,
  type ArchivedBoardItemRecord,
  type ArchivedTaskItemRecord,
  type AutoPurgeExecutionResult,
  buildAnonymizedProfilePatch,
  computeArchiveCutoff,
  decodeArchiveBoardCursor,
  decodeArchiveMemberCursor,
  decodeArchiveTaskCursor,
  encodeArchiveBoardCursor,
  encodeArchiveMemberCursor,
  encodeArchiveTaskCursor,
  type ListArchivedBoardsParams,
  type ListArchivedMembersParams,
  type ListArchivedTasksParams,
  parseStoredRetentionDays,
  type PurgeEntityResult,
  type RestoreTaskRepoParams,
  type RestoreTaskRepoResult,
  type RestoreTaskTargetRecord,
} from '@/server/modules/archive';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import type { BoardSummaryRecord } from '@/server/modules/boards';
import type { MemberProfileRecord } from '@/server/modules/members';
import type { TaskRecord } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const NOW = new Date('2026-11-24T07:00:00.000Z');
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const DELETER_ID = '10000000-0000-4000-8000-000000000002';
const CREATOR_ID = '10000000-0000-4000-8000-000000000003';
const ASSIGNEE_ID = '10000000-0000-4000-8000-000000000004';
const MEMBER_MGR_ID = '10000000-0000-4000-8000-000000000005';
const BOARD_DEL_ID = '10000000-0000-4000-8000-000000000006';
const VIEWER_ID = '10000000-0000-4000-8000-000000000007';
const BOARD_ID = '20000000-0000-4000-8000-000000000001';
const COL_ORIG = '30000000-0000-4000-8000-000000000001';
const COL_FIRST = '30000000-0000-4000-8000-000000000002';
const TASK_1 = '40000000-0000-4000-8000-000000000001';
const MEMBER_1 = '50000000-0000-4000-8000-000000000001';

function makeActor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    id: VIEWER_ID,
    isActive: true,
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

function makeUserSummary(id: string, fullName = 'User Name') {
  return {
    id,
    fullName,
    avatarUpdatedAt: null,
    isActive: true,
    leftAt: null,
    departments: [],
  };
}

function makeTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: TASK_1,
    boardId: BOARD_ID,
    columnId: COL_ORIG,
    title: 'Archived Task',
    description: 'Task description',
    dueAt: null,
    priority: 2,
    position: '1000',
    isHidden: false,
    version: 1,
    deletedAt: new Date('2026-11-20T00:00:00.000Z'),
    createdBy: CREATOR_ID,
    assignees: [makeUserSummary(ASSIGNEE_ID, 'Assignee')],
    creator: makeUserSummary(CREATOR_ID, 'Creator'),
    commentCount: 0,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-20T00:00:00.000Z'),
    ...overrides,
  };
}

function makeMemberRecord(overrides: Partial<MemberProfileRecord> = {}): MemberProfileRecord {
  return {
    id: MEMBER_1,
    studentId: '22310001',
    email: 'secret-student@eiu.edu.vn',
    fullName: 'Inactive Member',
    avatarUpdatedAt: null,
    isAdmin: false,
    isActive: false,
    leftAt: new Date('2026-11-10T00:00:00.000Z'),
    locale: 'vi',
    mustChangePassword: false,
    departments: [],
    ...overrides,
  };
}

function makeBoardRecord(overrides: Partial<BoardSummaryRecord> = {}): BoardSummaryRecord {
  return {
    id: BOARD_ID,
    name: 'Archived Board',
    department: null,
    archivedAt: new Date('2026-11-15T00:00:00.000Z'),
    createdBy: makeUserSummary(CREATOR_ID, 'Creator'),
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-15T00:00:00.000Z'),
    ...overrides,
  };
}

class FakeArchiveRepository implements ArchiveRepository {
  archivedTasks: ArchivedTaskItemRecord[] = [];
  archivedMembers: MemberProfileRecord[] = [];
  archivedBoards: ArchivedBoardItemRecord[] = [];
  restoreTaskTarget: RestoreTaskTargetRecord | null = null;
  lastRestoreTaskInput: RestoreTaskRepoParams | null = null;
  lastListTasksParams: ListArchivedTasksParams | null = null;
  lastListMembersParams: ListArchivedMembersParams | null = null;
  lastListBoardsParams: ListArchivedBoardsParams | null = null;
  retention: ArchiveRetentionRecord = { retentionDays: null, updatedAt: null, updatedBy: null };
  autoPurgeResult: AutoPurgeExecutionResult = { purgedTasks: 0, purgedBoards: 0, purgedMembers: 0 };
  lastAutoPurgeCutoff: Date | null = null;
  memberToRestore: MemberProfileRecord | null = makeMemberRecord({ isActive: true, leftAt: null });
  boardToRestore: BoardSummaryRecord | null = makeBoardRecord({ archivedAt: null });
  purgeResultOverride: Partial<Record<ArchiveEntityType, PurgeEntityResult>> = {};

  async listArchivedTasks(params: ListArchivedTasksParams) {
    this.lastListTasksParams = params;
    return {
      rows: this.archivedTasks.slice(0, params.limit),
      hasMore: this.archivedTasks.length > params.limit,
    };
  }

  async listArchivedMembers(params: ListArchivedMembersParams) {
    this.lastListMembersParams = params;
    return {
      rows: this.archivedMembers.slice(0, params.limit),
      hasMore: this.archivedMembers.length > params.limit,
    };
  }

  async listArchivedBoards(params: ListArchivedBoardsParams) {
    this.lastListBoardsParams = params;
    return {
      rows: this.archivedBoards.slice(0, params.limit),
      hasMore: this.archivedBoards.length > params.limit,
    };
  }

  async findTaskForRestore(): Promise<RestoreTaskTargetRecord | null> {
    return this.restoreTaskTarget;
  }

  async restoreTaskWithEvent(input: RestoreTaskRepoParams): Promise<RestoreTaskRepoResult> {
    this.lastRestoreTaskInput = input;
    return {
      task: makeTaskRecord({
        id: input.taskId,
        columnId: input.targetColumnId,
        position: input.useFallbackPosition ? '2000' : input.currentPosition,
        deletedAt: null,
        version: 2,
      }),
      eventId: '80000000-0000-4000-8000-000000000001',
    };
  }

  async lockAndRestoreMember(): Promise<MemberProfileRecord | null> {
    return this.memberToRestore;
  }

  async lockAndRestoreBoard(): Promise<BoardSummaryRecord | null> {
    return this.boardToRestore;
  }

  async purgeTask(taskId: string): Promise<PurgeEntityResult> {
    return (
      this.purgeResultOverride.tasks ?? {
        entityType: 'tasks',
        id: taskId,
        mode: 'marked_purged',
        detail: { taskId, boardId: BOARD_ID, purgeMode: 'marked_purged' },
        targetUserId: null,
      }
    );
  }

  async purgeBoard(boardId: string): Promise<PurgeEntityResult> {
    return (
      this.purgeResultOverride.boards ?? {
        entityType: 'boards',
        id: boardId,
        mode: 'marked_purged',
        detail: { boardId, purgeMode: 'marked_purged', cascadedTasks: 2 },
        targetUserId: null,
      }
    );
  }

  async purgeMember(memberId: string): Promise<PurgeEntityResult> {
    return (
      this.purgeResultOverride.members ?? {
        entityType: 'members',
        id: memberId,
        mode: 'anonymized',
        detail: { purgedMemberId: memberId, purgeMode: 'anonymized' },
        targetUserId: memberId,
      }
    );
  }

  async getRetentionSetting(): Promise<ArchiveRetentionRecord> {
    return this.retention;
  }

  async upsertRetentionSetting(input: {
    readonly retentionDays: ArchiveRetentionDays;
    readonly actorId: string;
    readonly now: Date;
  }) {
    const previousRetentionDays = this.retention.retentionDays;
    this.retention = {
      retentionDays: input.retentionDays,
      updatedAt: input.now,
      updatedBy: makeUserSummary(input.actorId, 'Admin'),
    };
    return { previousRetentionDays, current: this.retention };
  }

  async runAutoPurge(cutoff: Date): Promise<AutoPurgeExecutionResult> {
    this.lastAutoPurgeCutoff = cutoff;
    return this.autoPurgeResult;
  }
}

function createHarness() {
  const archiveRepo = new FakeArchiveRepository();
  const auditEntries: AuditLogEntry[] = [];
  const logLines: string[] = [];
  const auditWriter: AuditLogWriter = {
    record: async (entry) => {
      auditEntries.push(entry);
    },
  };
  const transactionRunner: TransactionRunner = {
    runInTransaction: (fn) => fn({} as TransactionContext),
  };
  const logger = new StructuredLogger({
    writeOut: (line) => logLines.push(line),
    writeErr: (line) => logLines.push(line),
  });
  const service = new ArchiveService({
    archiveRepo,
    auditWriter,
    transactionRunner,
    clock: new FakeClock(NOW),
    config: { cronSecret: 'super-secret-cron-token-1234' },
    logger,
  });
  return { archiveRepo, auditEntries, logLines, service };
}

async function expectAppError(
  promise: Promise<unknown>,
  expected: { status: number; code?: string },
): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.httpStatus).toBe(expected.status);
    if (expected.code) expect(appErr.code).toBe(expected.code);
    return appErr;
  }
  throw new Error('Expected promise to reject with AppError');
}

describe('Archive policy & ArchiveService unit tests', () => {
  it('encodes/decodes cursors for tasks, members (null & non-null leftAt), and boards, rejecting invalid/mismatched cursors', () => {
    const taskCursor = encodeArchiveTaskCursor({ tab: 'tasks', deletedAt: NOW, id: TASK_1 });
    expect(decodeArchiveTaskCursor(taskCursor)).toEqual({ tab: 'tasks', deletedAt: NOW, id: TASK_1 });

    const memberNullCursor = encodeArchiveMemberCursor({ tab: 'members', leftAt: null, id: MEMBER_1 });
    expect(decodeArchiveMemberCursor(memberNullCursor)).toEqual({ tab: 'members', leftAt: null, id: MEMBER_1 });

    const memberDateCursor = encodeArchiveMemberCursor({ tab: 'members', leftAt: NOW, id: MEMBER_1 });
    expect(decodeArchiveMemberCursor(memberDateCursor)).toEqual({ tab: 'members', leftAt: NOW, id: MEMBER_1 });

    const boardCursor = encodeArchiveBoardCursor({ tab: 'boards', archivedAt: NOW, id: BOARD_ID });
    expect(decodeArchiveBoardCursor(boardCursor)).toEqual({ tab: 'boards', archivedAt: NOW, id: BOARD_ID });

    expect(() => decodeArchiveTaskCursor(boardCursor)).toThrow(AppError);
    expect(() => decodeArchiveMemberCursor(taskCursor)).toThrow(AppError);
    expect(() => decodeArchiveBoardCursor(`${boardCursor}=`)).toThrow(AppError);
    expect(() => decodeArchiveTaskCursor('not-valid-json')).toThrow(AppError);
  });

  it('enforces per-tab listArchive permissions (401 inactive, 403 missing permission, 200 matching permission/admin)', async () => {
    const { service } = createHarness();
    await expectAppError(
      service.listArchive(makeActor({ isActive: false, isAdmin: true }), { tab: 'tasks', limit: 20 }),
      { status: 401, code: 'ACCOUNT_INACTIVE' },
    );

    await expectAppError(
      service.listArchive(makeActor({ permissions: ['member.deactivate', 'board.delete'] }), { tab: 'tasks', limit: 20 }),
      { status: 403, code: 'FORBIDDEN' },
    );
    await expectAppError(
      service.listArchive(makeActor({ permissions: ['task.delete', 'board.delete'] }), { tab: 'members', limit: 20 }),
      { status: 403, code: 'FORBIDDEN' },
    );
    await expectAppError(
      service.listArchive(makeActor({ permissions: ['task.delete', 'member.deactivate'] }), { tab: 'boards', limit: 20 }),
      { status: 403, code: 'FORBIDDEN' },
    );

    const taskRes = await service.listArchive(
      makeActor({ id: DELETER_ID, permissions: ['task.delete'] }),
      { tab: 'tasks', limit: 20 },
    );
    expect(taskRes.tab).toBe('tasks');
    const adminBoards = await service.listArchive(
      makeActor({ id: ADMIN_ID, isAdmin: true }),
      { tab: 'boards', limit: 20 },
    );
    expect(adminBoards.tab).toBe('boards');

    const boardDelActor = makeActor({ id: BOARD_DEL_ID, permissions: ['board.delete'] });
    const restoredBoardRes = await service.restoreBoard(boardDelActor, BOARD_ID);
    expect(restoredBoardRes.board.id).toBe(BOARD_ID);
    await expectAppError(
      service.restoreBoard(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), BOARD_ID),
      { status: 403, code: 'FORBIDDEN' },
    );
  });

  it('masks studentId/email and disables studentId search when caller lacks member.view_detail', async () => {
    const { archiveRepo, service } = createHarness();
    archiveRepo.archivedMembers = [makeMemberRecord()];

    const maskedList = await service.listArchive(
      makeActor({ id: MEMBER_MGR_ID, permissions: ['member.deactivate'] }),
      { tab: 'members', q: '22310001', limit: 20 },
    );
    expect(archiveRepo.lastListMembersParams?.includeStudentIdSearch).toBe(false);
    expect(maskedList.members).toHaveLength(1);
    expect('studentId' in maskedList.members[0]!).toBe(false);
    expect('email' in maskedList.members[0]!).toBe(false);

    const maskedRestore = await service.restoreMember(
      makeActor({ id: MEMBER_MGR_ID, permissions: ['member.deactivate'] }),
      MEMBER_1,
    );
    expect('studentId' in maskedRestore.member).toBe(false);
    expect('email' in maskedRestore.member).toBe(false);

    const detailList = await service.listArchive(
      makeActor({ id: MEMBER_MGR_ID, permissions: ['member.deactivate', 'member.view_detail'] }),
      { tab: 'members', q: '22310001', limit: 20 },
    );
    expect(archiveRepo.lastListMembersParams?.includeStudentIdSearch).toBe(true);
    expect('studentId' in detailList.members[0]!).toBe(true);
    expect('email' in detailList.members[0]!).toBe(true);
  });

  it('enforces hidden task 404 BEFORE permission/state errors, board states, and WQ-33 column fallback in restoreTask', async () => {
    const { archiveRepo, service } = createHarness();

    // Missing / purged task -> 404
    archiveRepo.restoreTaskTarget = null;
    await expectAppError(
      service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1),
      { status: 404, code: 'NOT_FOUND' },
    );

    // Hidden task -> 404 to non-viewer EVEN WITH task.delete (and even if task is active!)
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord({ isHidden: true, deletedAt: null }),
      boardArchivedAt: null,
      boardPurgedAt: null,
      hasOriginalColumn: true,
      firstColumnId: COL_FIRST,
    };
    await expectAppError(
      service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1),
      { status: 404, code: 'NOT_FOUND' },
    );

    // Hidden task -> creator WITHOUT task.delete gets 403 (passes visibility!)
    await expectAppError(
      service.restoreTask(makeActor({ id: CREATOR_ID, permissions: [] }), TASK_1),
      { status: 403, code: 'FORBIDDEN' },
    );

    // Non-deleted task -> 409 TASK_NOT_DELETED
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord({ deletedAt: null }),
      boardArchivedAt: null,
      boardPurgedAt: null,
      hasOriginalColumn: true,
      firstColumnId: COL_FIRST,
    };
    await expectAppError(
      service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1),
      { status: 409, code: 'TASK_NOT_DELETED' },
    );

    // Purged parent board -> 404
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord(),
      boardArchivedAt: NOW,
      boardPurgedAt: NOW,
      hasOriginalColumn: true,
      firstColumnId: COL_FIRST,
    };
    await expectAppError(
      service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1),
      { status: 404, code: 'NOT_FOUND' },
    );

    // Archived parent board -> 409 BOARD_ARCHIVED
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord(),
      boardArchivedAt: NOW,
      boardPurgedAt: null,
      hasOriginalColumn: true,
      firstColumnId: COL_FIRST,
    };
    await expectAppError(
      service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1),
      { status: 409, code: 'BOARD_ARCHIVED' },
    );

    // Board has no columns -> 409 BOARD_HAS_NO_COLUMNS
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord({ columnId: null }),
      boardArchivedAt: null,
      boardPurgedAt: null,
      hasOriginalColumn: false,
      firstColumnId: null,
    };
    await expectAppError(
      service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1),
      { status: 409, code: 'BOARD_HAS_NO_COLUMNS' },
    );

    // Original column intact -> keeps columnId & position
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord({ columnId: COL_ORIG, position: '1500' }),
      boardArchivedAt: null,
      boardPurgedAt: null,
      hasOriginalColumn: true,
      firstColumnId: COL_FIRST,
    };
    const kept = await service.restoreTask(makeActor({ id: DELETER_ID, permissions: ['task.delete'] }), TASK_1);
    expect(archiveRepo.lastRestoreTaskInput?.targetColumnId).toBe(COL_ORIG);
    expect(archiveRepo.lastRestoreTaskInput?.useFallbackPosition).toBe(false);
    expect(kept.task.columnId).toBe(COL_ORIG);

    // WQ-33 original column deleted -> falls back to first column + maxPos+1000
    archiveRepo.restoreTaskTarget = {
      task: makeTaskRecord({ columnId: null, isHidden: true }),
      boardArchivedAt: null,
      boardPurgedAt: null,
      hasOriginalColumn: false,
      firstColumnId: COL_FIRST,
    };
    const fallback = await service.restoreTask(
      makeActor({ id: ASSIGNEE_ID, permissions: ['task.delete'] }),
      TASK_1,
    );
    expect(archiveRepo.lastRestoreTaskInput?.targetColumnId).toBe(COL_FIRST);
    expect(archiveRepo.lastRestoreTaskInput?.useFallbackPosition).toBe(true);
    expect(fallback.task.columnId).toBe(COL_FIRST);
    expect(fallback.eventId).toBeTruthy();
  });

  it('enforces Admin-only purgeEntity, retention settings permissions, and cron bearer auth + cutoff without leaking PII', async () => {
    const { archiveRepo, auditEntries, logLines, service } = createHarness();
    const superNonAdmin = makeActor({
      id: DELETER_ID,
      isAdmin: false,
      permissions: ['task.delete', 'member.deactivate', 'board.delete'],
    });
    const admin = makeActor({ id: ADMIN_ID, isAdmin: true });

    // Non-admin blocked on purge & retention PUT
    const forbiddenPurge = await expectAppError(
      service.purgeEntity(superNonAdmin, 'tasks', TASK_1),
      { status: 403, code: 'FORBIDDEN' },
    );
    expect(forbiddenPurge.details.requiredPermission).toBe('admin');

    await expectAppError(
      service.updateRetentionSettings(superNonAdmin, { retentionDays: 30 }),
      { status: 403, code: 'FORBIDDEN' },
    );

    // Retention GET allowed for Archive tab holder, denied for member.view only
    await expectAppError(
      service.getRetentionSettings(makeActor({ permissions: ['member.view'] })),
      { status: 403, code: 'FORBIDDEN' },
    );
    const readRetention = await service.getRetentionSettings(superNonAdmin);
    expect(readRetention.settings.retentionDays).toBeNull();

    // Admin updates retention & purges member -> clean audit + zero PII in logs
    const updatedRetention = await service.updateRetentionSettings(admin, { retentionDays: 30 });
    expect(updatedRetention.settings.retentionDays).toBe(30);
    expect(auditEntries.at(-1)?.action).toBe('settings.archive_retention_updated');

    const purgeRes = await service.purgeEntity(admin, 'members', MEMBER_1);
    expect(purgeRes).toEqual({ purged: true, entityType: 'members', id: MEMBER_1, mode: 'anonymized' });
    expect(auditEntries.at(-1)?.action).toBe('archive.member_purged');
    expect(auditEntries.at(-1)?.targetUserId).toBe(MEMBER_1);

    // Cron auth checks
    await expectAppError(service.runAutoPurgeCron(null), { status: 401, code: 'UNAUTHORIZED' });
    await expectAppError(service.runAutoPurgeCron('Bearer wrong-secret'), { status: 401, code: 'UNAUTHORIZED' });

    archiveRepo.autoPurgeResult = { purgedTasks: 3, purgedBoards: 1, purgedMembers: 2 };
    const cronRes = await service.runAutoPurgeCron('Bearer super-secret-cron-token-1234');
    expect(cronRes).toEqual({
      retentionDays: 30,
      cutoffAt: computeArchiveCutoff(NOW, 30).toISOString(),
      purgedTasks: 3,
      purgedBoards: 1,
      purgedMembers: 2,
    });
    expect(archiveRepo.lastAutoPurgeCutoff?.toISOString()).toBe('2026-10-25T07:00:00.000Z');

    // Disabled retention skips auto-purge
    await service.updateRetentionSettings(admin, { retentionDays: null });
    archiveRepo.lastAutoPurgeCutoff = null;
    const skippedRes = await service.runAutoPurgeCron('Bearer super-secret-cron-token-1234');
    expect(skippedRes).toEqual({
      retentionDays: null,
      cutoffAt: null,
      purgedTasks: 0,
      purgedBoards: 0,
      purgedMembers: 0,
    });
    expect(archiveRepo.lastAutoPurgeCutoff).toBeNull();

    // Pure helpers check
    expect(parseStoredRetentionDays({ retentionDays: 90 })).toBe(90);
    expect(parseStoredRetentionDays({ retentionDays: 14 })).toBeNull();
    const patch = buildAnonymizedProfilePatch(MEMBER_1, NOW);
    expect(patch.studentId).toBe(`PURGED-${MEMBER_1}`);
    expect(patch.email).toBe(`purged+${MEMBER_1}@redacted.local`);
    expect(patch.isAdmin).toBe(false);
    expect(patch.isActive).toBe(false);

    const joinedLogs = logLines.join('\n');
    expect(joinedLogs).not.toContain('22310001');
    expect(joinedLogs).not.toContain('secret-student@eiu.edu.vn');
    expect(joinedLogs).not.toContain('super-secret-cron-token-1234');
  });
});
