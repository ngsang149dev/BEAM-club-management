import type {
  ArchiveEntityType,
  ListArchiveQueryInput,
  UpdateArchiveRetentionRequestInput,
} from '@/lib/archive';
import { notFound } from '@/lib/errors';
import type { AuditLogWriter } from '@/server/modules/audit';
import { type BoardSummaryResponseDto, toBoardSummaryDto } from '@/server/modules/boards';
import { canViewMemberDetail, type MemberItemResponseDto, toMemberItemResponseDto } from '@/server/modules/members';
import { assertActorActive, type TaskMutationResponseDto, toTaskMutationResponseDto } from '@/server/modules/tasks';
import { type AuthActor, authorize } from '@/server/shared/authorize';
import type { Clock } from '@/server/shared/clock';
import type { Config } from '@/server/shared/config';
import type { Logger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';
import {
  type ArchivePageResponseDto,
  type ArchiveRetentionSettingsResponseDto,
  type CronArchivePurgeResponseDto,
  type PurgeArchiveItemResponseDto,
  toArchiveRetentionSettingsResponseDto,
  toCronArchivePurgeResponseDto,
  toPurgeArchiveItemResponseDto,
} from './mapper';
import {
  assertCanManageArchiveAdmin,
  assertCanViewArchiveTab,
  assertCanViewRetentionSettings,
  assertValidCronAuthorization,
  computeArchiveCutoff,
} from './policy';
import { executeTaskRestoreTx, listBoardsTab, listMembersTab, listTasksTab } from './service-helpers';
import type { ArchiveRepository, PurgeEntityResult } from './types';

export interface ArchiveServiceDeps {
  readonly archiveRepo: ArchiveRepository;
  readonly auditWriter: AuditLogWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly config: Pick<Config, 'cronSecret'>;
  readonly logger: Logger;
}

const PURGE_AUDIT_ACTIONS: Record<ArchiveEntityType, string> = {
  tasks: 'archive.task_purged',
  members: 'archive.member_purged',
  boards: 'archive.board_purged',
};

export class ArchiveService {
  constructor(private readonly deps: ArchiveServiceDeps) {}

  async listArchive(actor: AuthActor, query: ListArchiveQueryInput): Promise<ArchivePageResponseDto> {
    assertCanViewArchiveTab(actor, query.tab);
    if (query.tab === 'tasks') return listTasksTab(this.deps.archiveRepo, actor, query);
    if (query.tab === 'members') return listMembersTab(this.deps.archiveRepo, actor, query);
    return listBoardsTab(this.deps.archiveRepo, actor, query);
  }

  async restoreTask(actor: AuthActor, taskId: string): Promise<TaskMutationResponseDto> {
    assertActorActive(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      executeTaskRestoreTx({ archiveRepo: this.deps.archiveRepo, actor, taskId, now, tx }),
    );
    this.deps.logger.info('Archived task restored', {
      actorId: actor.id,
      taskId,
      boardId: result.task.boardId,
      eventId: result.eventId,
    });
    return toTaskMutationResponseDto(result);
  }

  async restoreMember(actor: AuthActor, memberId: string): Promise<MemberItemResponseDto> {
    authorize(actor, 'member.deactivate');
    const now = this.deps.clock.now();
    const restored = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const member = await this.deps.archiveRepo.lockAndRestoreMember(memberId, now, tx);
      if (!member) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      await this.deps.auditWriter.record(
        { actorId: actor.id, action: 'archive.member_restored', targetUserId: memberId, detail: {}, createdAt: now },
        tx,
      );
      return member;
    });
    this.deps.logger.info('Archived member restored', { actorId: actor.id, memberId });
    return toMemberItemResponseDto(restored, canViewMemberDetail(actor));
  }

  async restoreBoard(actor: AuthActor, boardId: string): Promise<BoardSummaryResponseDto> {
    authorize(actor, 'board.delete');
    const now = this.deps.clock.now();
    const restored = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const board = await this.deps.archiveRepo.lockAndRestoreBoard(boardId, now, tx);
      if (!board) throw notFound('errors.notFound', {}, 'NOT_FOUND');
      await this.deps.auditWriter.record(
        { actorId: actor.id, action: 'archive.board_restored', detail: { boardId }, createdAt: now },
        tx,
      );
      return board;
    });
    this.deps.logger.info('Archived board restored', { actorId: actor.id, boardId });
    return { board: toBoardSummaryDto(restored) };
  }

  async purgeEntity(actor: AuthActor, entityType: ArchiveEntityType, id: string): Promise<PurgeArchiveItemResponseDto> {
    assertCanManageArchiveAdmin(actor);
    const now = this.deps.clock.now();
    const result = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const purgeResult = await this.runEntityPurge(entityType, id, now, tx);
      await this.deps.auditWriter.record(
        { actorId: actor.id, action: PURGE_AUDIT_ACTIONS[entityType], targetUserId: purgeResult.targetUserId, detail: purgeResult.detail, createdAt: now },
        tx,
      );
      return purgeResult;
    });
    this.deps.logger.info('Archived entity permanently purged', { actorId: actor.id, entityType, id, mode: result.mode });
    return toPurgeArchiveItemResponseDto(result);
  }

  async getRetentionSettings(actor: AuthActor): Promise<ArchiveRetentionSettingsResponseDto> {
    assertCanViewRetentionSettings(actor);
    return toArchiveRetentionSettingsResponseDto(await this.deps.archiveRepo.getRetentionSetting());
  }

  async updateRetentionSettings(actor: AuthActor, input: UpdateArchiveRetentionRequestInput): Promise<ArchiveRetentionSettingsResponseDto> {
    assertCanManageArchiveAdmin(actor);
    const now = this.deps.clock.now();
    const current = await this.deps.transactionRunner.runInTransaction(async (tx) => {
      const updated = await this.deps.archiveRepo.upsertRetentionSetting(
        { retentionDays: input.retentionDays, actorId: actor.id, now },
        tx,
      );
      await this.deps.auditWriter.record(
        { actorId: actor.id, action: 'settings.archive_retention_updated', detail: { previousRetentionDays: updated.previousRetentionDays, retentionDays: input.retentionDays }, createdAt: now },
        tx,
      );
      return updated.current;
    });
    this.deps.logger.info('Archive retention settings updated', { actorId: actor.id, retentionDays: input.retentionDays });
    return toArchiveRetentionSettingsResponseDto(current);
  }

  async runAutoPurgeCron(authHeader: string | null | undefined): Promise<CronArchivePurgeResponseDto> {
    assertValidCronAuthorization(authHeader, this.deps.config.cronSecret);
    const setting = await this.deps.archiveRepo.getRetentionSetting();
    if (setting.retentionDays === null) {
      this.deps.logger.info('Archive auto-purge skipped (disabled)', { retentionDays: null });
      return toCronArchivePurgeResponseDto({ retentionDays: null, cutoffAt: null, purgedTasks: 0, purgedBoards: 0, purgedMembers: 0 });
    }
    const now = this.deps.clock.now();
    const cutoffAt = computeArchiveCutoff(now, setting.retentionDays);
    const result = await this.deps.transactionRunner.runInTransaction((tx) =>
      this.deps.archiveRepo.runAutoPurge(cutoffAt, now, tx),
    );
    this.deps.logger.info('Archive auto-purge completed', { retentionDays: setting.retentionDays, cutoffAt: cutoffAt.toISOString(), ...result });
    return toCronArchivePurgeResponseDto({ retentionDays: setting.retentionDays, cutoffAt, ...result });
  }

  private runEntityPurge(entityType: ArchiveEntityType, id: string, now: Date, tx: TransactionContext): Promise<PurgeEntityResult> {
    if (entityType === 'tasks') return this.deps.archiveRepo.purgeTask(id, now, tx);
    if (entityType === 'boards') return this.deps.archiveRepo.purgeBoard(id, now, tx);
    return this.deps.archiveRepo.purgeMember(id, now, tx);
  }
}
