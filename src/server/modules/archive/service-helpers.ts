import type { ListArchiveQueryInput } from '@/lib/archive';
import { conflict, notFound } from '@/lib/errors';
import { canViewMemberDetail } from '@/server/modules/members';
import { assertCanViewTask, toTaskVisibilitySubject } from '@/server/modules/tasks';
import type { AuditLogWriter } from '@/server/shared/audit-writer';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { TransactionContext } from '@/server/shared/transaction';
import { type ArchivePageResponseDto, toArchivePageResponseDto } from './mapper';
import {
  decodeArchiveBoardCursor,
  decodeArchiveMemberCursor,
  decodeArchiveTaskCursor,
  encodeArchiveBoardCursor,
  encodeArchiveMemberCursor,
  encodeArchiveTaskCursor,
} from './policy';
import type { ArchiveRepository, RestoreTaskRepoResult, RestoreTaskTargetRecord } from './types';

export async function listTasksTab(
  archiveRepo: ArchiveRepository,
  actor: AuthActor,
  query: ListArchiveQueryInput,
): Promise<ArchivePageResponseDto> {
  const cursor = query.cursor ? decodeArchiveTaskCursor(query.cursor) : undefined;
  const { rows, hasMore } = await archiveRepo.listArchivedTasks({
    actor,
    q: query.q,
    cursor,
    limit: query.limit,
  });
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeArchiveTaskCursor({ tab: 'tasks', deletedAt: last.task.deletedAt!, id: last.task.id })
      : null;
  return toArchivePageResponseDto({ tab: 'tasks', tasks: rows, nextCursor, limit: query.limit });
}

export async function listMembersTab(
  archiveRepo: ArchiveRepository,
  actor: AuthActor,
  query: ListArchiveQueryInput,
): Promise<ArchivePageResponseDto> {
  const cursor = query.cursor ? decodeArchiveMemberCursor(query.cursor) : undefined;
  const includeMemberDetail = canViewMemberDetail(actor);
  const { rows, hasMore } = await archiveRepo.listArchivedMembers({
    q: query.q,
    includeStudentIdSearch: includeMemberDetail,
    cursor,
    limit: query.limit,
  });
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeArchiveMemberCursor({ tab: 'members', leftAt: last.leftAt, id: last.id })
      : null;
  return toArchivePageResponseDto({
    tab: 'members',
    members: rows,
    includeMemberDetail,
    nextCursor,
    limit: query.limit,
  });
}

export async function listBoardsTab(
  archiveRepo: ArchiveRepository,
  actor: AuthActor,
  query: ListArchiveQueryInput,
): Promise<ArchivePageResponseDto> {
  const cursor = query.cursor ? decodeArchiveBoardCursor(query.cursor) : undefined;
  const { rows, hasMore } = await archiveRepo.listArchivedBoards({
    actor,
    q: query.q,
    cursor,
    limit: query.limit,
  });
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeArchiveBoardCursor({ tab: 'boards', archivedAt: last.board.archivedAt!, id: last.board.id })
      : null;
  return toArchivePageResponseDto({ tab: 'boards', boards: rows, nextCursor, limit: query.limit });
}

function resolveRestoreColumn(
  actor: AuthActor,
  target: RestoreTaskTargetRecord,
): { readonly prevDeletedAt: Date; readonly targetColumnId: string; readonly useFallbackPosition: boolean } {
  assertCanViewTask(actor, toTaskVisibilitySubject(target.task));
  authorize(actor, 'task.delete');
  if (target.task.deletedAt === null) throw conflict('errors.taskNotDeleted', {}, 'TASK_NOT_DELETED');
  if (target.boardPurgedAt !== null) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  if (target.boardArchivedAt !== null) throw conflict('errors.boardArchived', {}, 'BOARD_ARCHIVED');
  const targetColumnId = target.hasOriginalColumn ? target.task.columnId : target.firstColumnId;
  if (!targetColumnId) throw conflict('errors.boardHasNoColumns', {}, 'BOARD_HAS_NO_COLUMNS');
  return {
    prevDeletedAt: target.task.deletedAt,
    targetColumnId,
    useFallbackPosition: !target.hasOriginalColumn,
  };
}

export async function executeTaskRestoreTx(params: {
  readonly archiveRepo: ArchiveRepository;
  readonly auditWriter?: AuditLogWriter;
  readonly actor: AuthActor;
  readonly taskId: string;
  readonly now: Date;
  readonly tx: TransactionContext;
}): Promise<RestoreTaskRepoResult> {
  const target = await params.archiveRepo.findTaskForRestore(params.taskId, params.tx);
  if (!target) throw notFound('errors.notFound', {}, 'NOT_FOUND');
  const plan = resolveRestoreColumn(params.actor, target);
  const result = await params.archiveRepo.restoreTaskWithEvent(
    {
      taskId: params.taskId, boardId: target.task.boardId, actorId: params.actor.id,
      prevDeletedAt: plan.prevDeletedAt, prevColumnId: target.task.columnId,
      targetColumnId: plan.targetColumnId, currentPosition: target.task.position,
      useFallbackPosition: plan.useFallbackPosition, now: params.now,
    },
    params.tx,
  );
  await params.auditWriter?.record(
    {
      actorId: params.actor.id, action: 'task.restored',
      detail: {
        taskId: result.task.id, boardId: result.task.boardId,
        isHidden: result.task.isHidden, taskTitle: result.task.isHidden ? null : result.task.title,
      },
      createdAt: params.now,
    },
    params.tx,
  );
  return result;
}
