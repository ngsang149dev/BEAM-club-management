import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_COLUMN_NAMES } from '@/lib/boards';
import type { AuditLogEntry, AuditLogWriter } from '@/server/modules/audit';
import {
  assertCanIncludeArchived,
  assertColumnCanBeDeleted,
  assertColumnOrderMatches,
  type BoardsRepository,
  BoardsService,
  type BoardSummaryRecord,
  type ColumnRecord,
  type CreateBoardRepoParams,
  decodeBoardCursor,
  encodeBoardCursor,
  type ListBoardsRepoParams,
  type UpdateBoardRepoParams,
} from '@/server/modules/boards';
import type { TaskRecord, TasksRepository } from '@/server/modules/tasks';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const BOARD_1 = '40000000-0000-4000-8000-000000000001';
const COL_1 = '50000000-0000-4000-8000-000000000001';
const COL_2 = '50000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const MEMBER_ID = '10000000-0000-4000-8000-000000000002';

class InMemoryBoardsRepository implements BoardsRepository {
  readonly boards = new Map<string, BoardSummaryRecord>();
  readonly columns = new Map<string, ColumnRecord[]>();
  activeColumnTaskCount = 0;

  async listBoards(params: ListBoardsRepoParams) {
    let rows = Array.from(this.boards.values());
    if (!params.includeArchived) rows = rows.filter((b) => b.archivedAt === null);
    if (params.departmentId) rows = rows.filter((b) => b.department?.id === params.departmentId);
    return { rows: rows.slice(0, params.limit), hasMore: rows.length > params.limit };
  }

  async findBoardById(boardId: string) {
    return this.boards.get(boardId) ?? null;
  }

  async findColumnsByBoardId(boardId: string) {
    return [...(this.columns.get(boardId) ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  }

  async createBoardWithDefaultColumns(input: CreateBoardRepoParams) {
    const board: BoardSummaryRecord = {
      id: BOARD_1,
      name: input.name,
      department: null,
      archivedAt: null,
      createdBy: { id: input.createdBy, fullName: 'Creator', avatarUpdatedAt: null, isActive: true, leftAt: null, departments: [] },
      createdAt: input.now,
      updatedAt: input.now,
    };
    const cols: ColumnRecord[] = input.defaultColumnNames.map((name, orderIndex) => ({
      id: `50000000-0000-4000-8000-00000000000${orderIndex + 1}`,
      boardId: BOARD_1,
      name,
      orderIndex,
      createdAt: input.now,
      updatedAt: input.now,
    }));
    this.boards.set(BOARD_1, board);
    this.columns.set(BOARD_1, cols);
    return { board, columns: cols };
  }

  async updateBoard(input: UpdateBoardRepoParams) {
    const existing = this.boards.get(input.boardId);
    if (!existing) return null;
    const next: BoardSummaryRecord = {
      ...existing,
      name: input.name ?? existing.name,
      archivedAt: input.unarchive ? null : existing.archivedAt,
      updatedAt: input.now,
    };
    this.boards.set(input.boardId, next);
    return next;
  }

  async archiveBoard(input: { readonly boardId: string; readonly now: Date }) {
    const existing = this.boards.get(input.boardId);
    if (!existing) return null;
    const next = { ...existing, archivedAt: existing.archivedAt ?? input.now, updatedAt: input.now };
    this.boards.set(input.boardId, next);
    return { board: next, wasAlreadyArchived: existing.archivedAt !== null };
  }

  async createColumn(input: { readonly boardId: string; readonly name: string; readonly orderIndex?: number; readonly now: Date }) {
    const existing = this.columns.get(input.boardId);
    if (!existing) return null;
    const col: ColumnRecord = {
      id: '50000000-0000-4000-8000-000000000099',
      boardId: input.boardId,
      name: input.name,
      orderIndex: input.orderIndex ?? existing.length,
      createdAt: input.now,
      updatedAt: input.now,
    };
    existing.push(col);
    return col;
  }

  async renameColumn(input: { readonly columnId: string; readonly name: string; readonly now: Date }) {
    for (const cols of this.columns.values()) {
      const idx = cols.findIndex((c) => c.id === input.columnId);
      if (idx >= 0) {
        const updated = { ...cols[idx]!, name: input.name, updatedAt: input.now };
        cols[idx] = updated;
        return updated;
      }
    }
    return null;
  }

  async deleteColumnSafely(columnId: string) {
    assertColumnCanBeDeleted(this.activeColumnTaskCount);
    for (const [boardId, cols] of this.columns.entries()) {
      const idx = cols.findIndex((c) => c.id === columnId);
      if (idx >= 0) {
        cols.splice(idx, 1);
        return { id: columnId, boardId };
      }
    }
    return null;
  }

  async reorderColumns(input: { readonly boardId: string; readonly columnIds: readonly string[]; readonly now: Date }) {
    const cols = this.columns.get(input.boardId);
    if (!cols) return null;
    assertColumnOrderMatches(cols.map((c) => c.id), input.columnIds);
    const reordered = input.columnIds.map((id, orderIndex) => ({
      ...cols.find((c) => c.id === id)!,
      orderIndex,
      updatedAt: input.now,
    }));
    this.columns.set(input.boardId, reordered);
    return reordered;
  }
}

class SpyAuditWriter implements AuditLogWriter {
  readonly entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

function createHarness(visibleTasks: TaskRecord[] = []) {
  const boardsRepo = new InMemoryBoardsRepository();
  const tasksRepo: Pick<TasksRepository, 'listVisibleByBoardId'> = {
    listVisibleByBoardId: async (_boardId, actor) =>
      visibleTasks.filter((t) => actor.isAdmin || !t.isHidden || t.createdBy === actor.id),
  };
  const auditWriter = new SpyAuditWriter();
  const clock = new FakeClock('2026-11-24T05:00:00.000Z');
  const logger = new StructuredLogger({ writeOut: () => undefined, writeErr: () => undefined });
  const service = new BoardsService({
    boardsRepo,
    tasksRepo,
    auditWriter,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
  });
  return { boardsRepo, auditWriter, service };
}

const ADMIN: AuthActor = { id: ADMIN_ID, isActive: true, isAdmin: true, permissions: [] };
const BASIC_MEMBER: AuthActor = { id: MEMBER_ID, isActive: true, isAdmin: false, permissions: ['member.view'] };
const INACTIVE: AuthActor = { id: MEMBER_ID, isActive: false, isAdmin: true, permissions: [] };

describe('boards policy & BoardsService', () => {
  it('enforces WQ-01 includeArchived, WQ-05 delete check, INVALID_COLUMN_ORDER, and cursor codecs', () => {
    const cursor = encodeBoardCursor({ createdAt: new Date('2026-11-24T05:00:00.000Z'), id: BOARD_1 });
    expect(decodeBoardCursor(cursor)).toEqual({
      createdAt: new Date('2026-11-24T05:00:00.000Z'),
      id: BOARD_1,
    });
    expect(() => decodeBoardCursor('bad')).toThrowError(
      expect.objectContaining({ httpStatus: 400, code: 'INVALID_CURSOR' }),
    );
    expect(() => assertCanIncludeArchived(BASIC_MEMBER, true)).toThrowError(
      expect.objectContaining({ httpStatus: 403, code: 'FORBIDDEN' }),
    );
    expect(() => assertCanIncludeArchived(ADMIN, true)).not.toThrow();
    expect(() => assertColumnOrderMatches([COL_1, COL_2], [COL_1])).toThrowError(
      expect.objectContaining({
        httpStatus: 400,
        code: 'INVALID_COLUMN_ORDER',
        messageKey: 'errors.invalidColumnOrder',
      }),
    );
    expect(() => assertColumnOrderMatches([COL_1, COL_2], [COL_1, COL_1])).toThrowError(
      expect.objectContaining({
        httpStatus: 400,
        code: 'INVALID_COLUMN_ORDER',
        messageKey: 'errors.invalidColumnOrder',
      }),
    );
    expect(() => assertColumnCanBeDeleted(1)).toThrowError(
      expect.objectContaining({
        httpStatus: 409,
        code: 'COLUMN_NOT_EMPTY',
        messageKey: 'errors.columnNotEmpty',
      }),
    );
  });

  it('enforces permissions, writes board audit_logs, and isolates hidden taskCount per viewer', async () => {
    const now = new Date('2026-11-24T05:00:00.000Z');
    const creatorSummary = { id: ADMIN_ID, fullName: 'Admin', avatarUpdatedAt: null, isActive: true, leftAt: null, departments: [] };
    const hiddenTask: TaskRecord = {
      id: '60000000-0000-4000-8000-000000000001',
      boardId: BOARD_1,
      columnId: COL_1,
      title: 'Secret',
      description: null,
      dueAt: null,
      priority: 3,
      position: '1000',
      isHidden: true,
      version: 1,
      deletedAt: null,
      createdBy: ADMIN_ID,
      assignees: [],
      creator: creatorSummary,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const { boardsRepo, auditWriter, service } = createHarness([hiddenTask]);

    await expect(service.listBoards(INACTIVE, { includeArchived: false, limit: 20 })).rejects.toMatchObject({ httpStatus: 401 });
    await expect(service.listBoards(BASIC_MEMBER, { includeArchived: true, limit: 20 })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(service.createBoard(BASIC_MEMBER, { name: 'No' })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(service.archiveBoard(BASIC_MEMBER, BOARD_1)).rejects.toMatchObject({ httpStatus: 403 });

    const createOnlyMember: AuthActor = {
      id: MEMBER_ID,
      isActive: true,
      isAdmin: false,
      permissions: ['member.view', 'board.create'],
    };
    await expect(service.updateBoard(createOnlyMember, BOARD_1, { name: 'Deny' })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(service.createColumn(createOnlyMember, BOARD_1, { name: 'Deny' })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(service.renameColumn(createOnlyMember, COL_1, { name: 'Deny' })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(service.deleteColumn(createOnlyMember, COL_1)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
    await expect(service.reorderColumns(createOnlyMember, BOARD_1, { columnIds: [COL_1, COL_2] })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    const created = await service.createBoard(ADMIN, { name: 'Ops Board' });
    expect(created.board.columns.map((c) => c.name)).toEqual([...DEFAULT_BOARD_COLUMN_NAMES]);
    expect(auditWriter.entries[0]?.action).toBe('board.created');

    // Non-viewer sees taskCount=0 & tasks=[]; admin sees taskCount=1 & tasks=[hiddenTask]
    const detailMember = await service.getBoardDetail(BASIC_MEMBER, BOARD_1);
    expect(detailMember.board.tasks).toHaveLength(0);
    expect(detailMember.board.columns[0]?.taskCount).toBe(0);

    const detailAdmin = await service.getBoardDetail(ADMIN, BOARD_1);
    expect(detailAdmin.board.tasks).toHaveLength(1);
    expect(detailAdmin.board.columns[0]?.taskCount).toBe(1);

    boardsRepo.activeColumnTaskCount = 1;
    await expect(service.deleteColumn(ADMIN, COL_1)).rejects.toMatchObject({ httpStatus: 409, code: 'COLUMN_NOT_EMPTY' });
    boardsRepo.activeColumnTaskCount = 0;
    const deleted = await service.deleteColumn(ADMIN, COL_1);
    expect(deleted).toEqual({ deleted: true, id: COL_1 });
  });
});
