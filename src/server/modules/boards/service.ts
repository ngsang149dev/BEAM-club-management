import { notFound } from '@/lib/errors';
import {
  type CreateBoardRequestInput,
  type CreateColumnRequestInput,
  DEFAULT_BOARD_COLUMN_NAMES,
  type ListBoardsQueryInput,
  type ReorderColumnsRequestInput,
  type UpdateBoardRequestInput,
  type UpdateColumnRequestInput,
} from '@/lib/boards';
import type { AuditLogWriter } from '@/server/modules/audit';
import { assertActorActive, type TasksRepository } from '@/server/modules/tasks';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Logger } from '@/server/shared/logger';
import type { TransactionRunner } from '@/server/shared/transaction';
import {
  type BoardDetailResponseDto,
  type BoardPageResponseDto,
  type BoardSummaryResponseDto,
  type ColumnListResponseDto,
  type ColumnResponseDto,
  countVisibleTasksByColumn,
  type DeleteColumnResponseDto,
  toBoardDetailResponseDto,
  toBoardPageResponseDto,
  toBoardSummaryDto,
  toColumnDto,
} from './mapper';
import { assertCanIncludeArchived, decodeBoardCursor, encodeBoardCursor } from './policy';
import type { BoardsRepository } from './repository';

export interface BoardsServiceDeps {
  readonly boardsRepo: BoardsRepository;
  readonly tasksRepo: Pick<TasksRepository, 'listVisibleByBoardId'>;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

function collectBoardUpdatedFields(input: UpdateBoardRequestInput): string[] {
  const fields: string[] = [];
  if (input.name !== undefined) fields.push('name');
  if (input.departmentId !== undefined) fields.push('departmentId');
  if (input.unarchive === true) fields.push('unarchive');
  return fields;
}

export class BoardsService {
  constructor(private readonly deps: BoardsServiceDeps) {}

  async listBoards(actor: AuthActor, query: ListBoardsQueryInput): Promise<BoardPageResponseDto> {
    assertActorActive(actor);
    assertCanIncludeArchived(actor, query.includeArchived);
    const cursor = query.cursor ? decodeBoardCursor(query.cursor) : undefined;
    const { rows, hasMore } = await this.deps.boardsRepo.listBoards({
      actor,
      now: this.deps.clock.now(),
      departmentId: query.departmentId,
      includeArchived: query.includeArchived,
      q: query.q,
      cursor,
      limit: query.limit,
    });
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last ? encodeBoardCursor({ createdAt: last.createdAt, id: last.id }) : null;
    return toBoardPageResponseDto({ items: rows, nextCursor, limit: query.limit });
  }

  async getBoardDetail(actor: AuthActor, boardId: string): Promise<BoardDetailResponseDto> {
    assertActorActive(actor);
    const board = await this.deps.boardsRepo.findBoardById(boardId);
    if (!board) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    const [columns, visibleTasks] = await Promise.all([
      this.deps.boardsRepo.findColumnsByBoardId(boardId),
      this.deps.tasksRepo.listVisibleByBoardId(boardId, actor),
    ]);
    return toBoardDetailResponseDto({ board, columns, visibleTasks, now: this.deps.clock.now() });
  }

  async createBoard(
    actor: AuthActor,
    input: CreateBoardRequestInput,
  ): Promise<BoardDetailResponseDto> {
    authorize(actor, 'board.create');
    const now = this.deps.clock.now();
    const created = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const result = await this.deps.boardsRepo.createBoardWithDefaultColumns(
        {
          name: input.name,
          departmentId: input.departmentId ?? null,
          createdBy: actor.id,
          defaultColumnNames: DEFAULT_BOARD_COLUMN_NAMES,
          now,
        },
        tx,
      );
      await this.deps.auditWriter.record(
        {
          actorId: actor.id,
          action: 'board.created',
          detail: { boardId: result.board.id, name: result.board.name, departmentId: input.departmentId ?? null },
          createdAt: now,
        },
        tx,
      );
      return result;
    });
    this.deps.logger.info('Board created', { actorId: actor.id, boardId: created.board.id });
    return toBoardDetailResponseDto({
      board: created.board,
      columns: created.columns,
      visibleTasks: [],
      now,
    });
  }

  async updateBoard(
    actor: AuthActor,
    boardId: string,
    input: UpdateBoardRequestInput,
  ): Promise<BoardSummaryResponseDto> {
    authorize(actor, 'board.update');
    const now = this.deps.clock.now();
    const updated = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const board = await this.deps.boardsRepo.updateBoard(
        { boardId, name: input.name, departmentId: input.departmentId, unarchive: input.unarchive, now },
        tx,
      );
      if (!board) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      const statsMap = await this.deps.boardsRepo.countBoardTaskStats({ boardIds: [board.id], actor, now }, tx);
      await this.deps.auditWriter.record(
        {
          actorId: actor.id,
          action: 'board.updated',
          detail: { boardId, updatedFields: collectBoardUpdatedFields(input) },
          createdAt: now,
        },
        tx,
      );
      return { ...board, ...(statsMap.get(board.id) ?? { visibleTaskCount: 0, overdueTaskCount: 0 }) };
    });
    this.deps.logger.info('Board updated', { actorId: actor.id, boardId });
    return { board: toBoardSummaryDto(updated) };
  }

  async archiveBoard(actor: AuthActor, boardId: string): Promise<BoardSummaryResponseDto> {
    authorize(actor, 'board.delete');
    const now = this.deps.clock.now();
    const archived = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const result = await this.deps.boardsRepo.archiveBoard({ boardId, now }, tx);
      if (!result) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      const statsMap = await this.deps.boardsRepo.countBoardTaskStats(
        { boardIds: [result.board.id], actor, now },
        tx,
      );
      await this.deps.auditWriter.record(
        {
          actorId: actor.id,
          action: 'board.archived',
          detail: { boardId, wasAlreadyArchived: result.wasAlreadyArchived },
          createdAt: now,
        },
        tx,
      );
      return { ...result.board, ...(statsMap.get(result.board.id) ?? { visibleTaskCount: 0, overdueTaskCount: 0 }) };
    });
    this.deps.logger.info('Board archived', { actorId: actor.id, boardId });
    return { board: toBoardSummaryDto(archived) };
  }

  async createColumn(
    actor: AuthActor,
    boardId: string,
    input: CreateColumnRequestInput,
  ): Promise<ColumnResponseDto> {
    authorize(actor, 'board.update');
    const now = this.deps.clock.now();
    const column = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const created = await this.deps.boardsRepo.createColumn(
        { boardId, name: input.name, orderIndex: input.orderIndex, now },
        tx,
      );
      if (!created) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      return created;
    });
    return { column: toColumnDto(column, 0) };
  }

  async renameColumn(
    actor: AuthActor,
    columnId: string,
    input: UpdateColumnRequestInput,
  ): Promise<ColumnResponseDto> {
    authorize(actor, 'board.update');
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const column = await this.deps.boardsRepo.renameColumn({ columnId, name: input.name, now }, tx);
      if (!column) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      const visibleTasks = await this.deps.tasksRepo.listVisibleByBoardId(column.boardId, actor, tx);
      const count = countVisibleTasksByColumn(visibleTasks).get(column.id) ?? 0;
      return { column, count };
    });
    return { column: toColumnDto(result.column, result.count) };
  }

  async deleteColumn(actor: AuthActor, columnId: string): Promise<DeleteColumnResponseDto> {
    authorize(actor, 'board.update');
    await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const deleted = await this.deps.boardsRepo.deleteColumnSafely(columnId, tx);
      if (!deleted) throw notFound('errors.notFound', {}, 'NOT_FOUND');
    });
    this.deps.logger.info('Column deleted', { actorId: actor.id, columnId });
    return { deleted: true, id: columnId };
  }

  async reorderColumns(
    actor: AuthActor,
    boardId: string,
    input: ReorderColumnsRequestInput,
  ): Promise<ColumnListResponseDto> {
    authorize(actor, 'board.update');
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const cols = await this.deps.boardsRepo.reorderColumns(
        { boardId, columnIds: input.columnIds, now },
        tx,
      );
      if (!cols) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      const visibleTasks = await this.deps.tasksRepo.listVisibleByBoardId(boardId, actor, tx);
      const counts = countVisibleTasksByColumn(visibleTasks);
      return { cols, counts };
    });
    return { items: result.cols.map((col) => toColumnDto(col, result.counts.get(col.id) ?? 0)) };
  }
}
