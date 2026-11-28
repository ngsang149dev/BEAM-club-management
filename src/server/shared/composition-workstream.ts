import {
  type ArchiveRepository,
  ArchiveService,
  DrizzleArchiveRepository,
} from '@/server/modules/archive';
import {
  type BoardsRepository,
  BoardsService,
  DrizzleBoardsRepository,
} from '@/server/modules/boards';
import {
  type CommentsRepository,
  CommentsService,
  DrizzleCommentsRepository,
} from '@/server/modules/comments';
import {
  DrizzleNotificationsRepository,
  type NotificationsRepository,
  NotificationsService,
} from '@/server/modules/notifications';
import {
  DrizzleRemindersRepository,
  type RemindersRepository,
  RemindersService,
} from '@/server/modules/reminders';
import {
  DrizzleTaskEventsRepository,
  type TaskEventsRepository,
  TaskEventsService,
} from '@/server/modules/task-events';
import {
  DrizzleTasksRepository,
  type TasksRepository,
  TasksService,
} from '@/server/modules/tasks';
import type { SharedInfraContext } from './composition-services';

export interface WorkstreamServiceOverrides {
  readonly tasksRepo?: TasksRepository;
  readonly tasksService?: TasksService;
  readonly taskEventsRepo?: TaskEventsRepository;
  readonly taskEventsService?: TaskEventsService;
  readonly commentsRepo?: CommentsRepository;
  readonly commentsService?: CommentsService;
  readonly notificationsRepo?: NotificationsRepository;
  readonly notificationsService?: NotificationsService;
  readonly boardsRepo?: BoardsRepository;
  readonly boardsService?: BoardsService;
  readonly archiveRepo?: ArchiveRepository;
  readonly archiveService?: ArchiveService;
  readonly remindersRepo?: RemindersRepository;
  readonly remindersService?: RemindersService;
}

function buildNotificationsService(
  infra: SharedInfraContext,
  overrides: WorkstreamServiceOverrides,
) {
  const notificationsRepo =
    overrides.notificationsRepo ?? new DrizzleNotificationsRepository(infra.db);
  return (
    overrides.notificationsService ??
    new NotificationsService({
      notificationsRepo,
      transactionRunner: infra.transactionRunner,
      mailer: infra.mailer,
      clock: infra.clock,
      config: infra.config,
      logger: infra.logger,
    })
  );
}

function buildArchiveService(
  infra: SharedInfraContext,
  overrides: WorkstreamServiceOverrides,
) {
  return (
    overrides.archiveService ??
    new ArchiveService({
      archiveRepo: overrides.archiveRepo ?? new DrizzleArchiveRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      config: infra.config,
      logger: infra.logger,
    })
  );
}

function buildRemindersService(
  infra: SharedInfraContext,
  overrides: WorkstreamServiceOverrides,
) {
  return (
    overrides.remindersService ??
    new RemindersService({
      remindersRepo:
        overrides.remindersRepo ?? new DrizzleRemindersRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      mailer: infra.mailer,
      clock: infra.clock,
      config: infra.config,
      logger: infra.logger,
    })
  );
}

function buildBoardsService(
  infra: SharedInfraContext,
  overrides: WorkstreamServiceOverrides,
  tasksRepo: TasksRepository,
) {
  return (
    overrides.boardsService ??
    new BoardsService({
      boardsRepo: overrides.boardsRepo ?? new DrizzleBoardsRepository(infra.db),
      tasksRepo,
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
    })
  );
}

function buildTaskEventsService(
  infra: SharedInfraContext,
  overrides: WorkstreamServiceOverrides,
) {
  return (
    overrides.taskEventsService ??
    new TaskEventsService({
      taskEventsRepo:
        overrides.taskEventsRepo ?? new DrizzleTaskEventsRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
    })
  );
}

export function buildWorkstreamServices(
  infra: SharedInfraContext,
  overrides: WorkstreamServiceOverrides,
) {
  const notificationsService = buildNotificationsService(infra, overrides);
  const tasksRepo = overrides.tasksRepo ?? new DrizzleTasksRepository(infra.db);
  const commentsRepo = overrides.commentsRepo ?? new DrizzleCommentsRepository(infra.db);
  const tasksService =
    overrides.tasksService ??
    new TasksService({
      tasksRepo,
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
      notificationsDispatcher: notificationsService,
    });
  const commentsService =
    overrides.commentsService ??
    new CommentsService({
      commentsRepo,
      tasksRepo,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
    });
  return {
    tasksService,
    taskEventsService: buildTaskEventsService(infra, overrides),
    commentsService,
    notificationsService,
    boardsService: buildBoardsService(infra, overrides, tasksRepo),
    archiveService: buildArchiveService(infra, overrides),
    remindersService: buildRemindersService(infra, overrides),
  };
}
