import {
  type ArchiveRepository,
  ArchiveService,
  DrizzleArchiveRepository,
} from '@/server/modules/archive';
import {
  type AuditLogWriter,
  type AuditRepository,
  AuditService,
  DrizzleAuditRepository,
} from '@/server/modules/audit';
import {
  type AuthRepository,
  AuthService,
  DrizzleAuthRepository,
} from '@/server/modules/auth';
import {
  type BoardsRepository,
  BoardsService,
  DrizzleBoardsRepository,
} from '@/server/modules/boards';
import {
  type BrandingRepository,
  BrandingService,
  DrizzleBrandingRepository,
} from '@/server/modules/branding';
import {
  type CommentsRepository,
  CommentsService,
  DrizzleCommentsRepository,
} from '@/server/modules/comments';
import {
  type DepartmentsRepository,
  DepartmentsService,
  DrizzleDepartmentsRepository,
} from '@/server/modules/departments';
import {
  DrizzleMembersRepository,
  type MembersRepository,
  MembersService,
} from '@/server/modules/members';
import {
  DrizzleNotificationsRepository,
  type NotificationsRepository,
  NotificationsService,
} from '@/server/modules/notifications';
import {
  DrizzlePermissionsRepository,
  type PermissionsRepository,
  PermissionsService,
} from '@/server/modules/permissions';
import {
  DrizzleTasksRepository,
  type TasksRepository,
  TasksService,
} from '@/server/modules/tasks';
import type { Clock } from './clock';
import type { Config } from './config';
import type { Database } from './db';
import type { Logger } from './logger';
import type { Mailer } from './mailer';
import type { TransactionRunner } from './transaction';

export interface ServiceOverrides {
  readonly auditRepo?: AuditRepository;
  readonly auditService?: AuditService;
  readonly brandingRepo?: BrandingRepository;
  readonly brandingService?: BrandingService;
  readonly authRepo?: AuthRepository;
  readonly authService?: AuthService;
  readonly departmentsRepo?: DepartmentsRepository;
  readonly departmentsService?: DepartmentsService;
  readonly membersRepo?: MembersRepository;
  readonly membersService?: MembersService;
  readonly permissionsRepo?: PermissionsRepository;
  readonly permissionsService?: PermissionsService;
  readonly tasksRepo?: TasksRepository;
  readonly tasksService?: TasksService;
  readonly commentsRepo?: CommentsRepository;
  readonly commentsService?: CommentsService;
  readonly notificationsRepo?: NotificationsRepository;
  readonly notificationsService?: NotificationsService;
  readonly boardsRepo?: BoardsRepository;
  readonly boardsService?: BoardsService;
  readonly archiveRepo?: ArchiveRepository;
  readonly archiveService?: ArchiveService;
}

export interface SharedInfraContext {
  readonly config: Config;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly mailer: Mailer;
  readonly db: Database;
  readonly transactionRunner: TransactionRunner;
  readonly auditRepo: AuditRepository;
  readonly auditWriter: AuditLogWriter;
}

export function buildDirectoryServices(
  infra: SharedInfraContext,
  overrides: ServiceOverrides,
) {
  const authService =
    overrides.authService ??
    new AuthService({
      authRepo: overrides.authRepo ?? new DrizzleAuthRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      config: infra.config,
      logger: infra.logger,
    });
  const departmentsService =
    overrides.departmentsService ??
    new DepartmentsService({
      departmentsRepo: overrides.departmentsRepo ?? new DrizzleDepartmentsRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
    });
  const membersService =
    overrides.membersService ??
    new MembersService({
      membersRepo: overrides.membersRepo ?? new DrizzleMembersRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      config: infra.config,
      logger: infra.logger,
    });
  return { authService, departmentsService, membersService };
}

export function buildGovernanceServices(
  infra: SharedInfraContext,
  overrides: ServiceOverrides,
) {
  const permissionsService =
    overrides.permissionsService ??
    new PermissionsService({
      permissionsRepo: overrides.permissionsRepo ?? new DrizzlePermissionsRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
    });
  const auditService =
    overrides.auditService ??
    new AuditService({
      auditRepo: infra.auditRepo,
      logger: infra.logger,
    });
  const brandingService =
    overrides.brandingService ??
    new BrandingService({
      brandingRepo: overrides.brandingRepo ?? new DrizzleBrandingRepository(infra.db),
      auditWriter: infra.auditWriter,
      transactionRunner: infra.transactionRunner,
      clock: infra.clock,
      logger: infra.logger,
    });
  return { permissionsService, auditService, brandingService };
}

function buildNotificationsService(
  infra: SharedInfraContext,
  overrides: ServiceOverrides,
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
  overrides: ServiceOverrides,
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

function buildBoardsService(
  infra: SharedInfraContext,
  overrides: ServiceOverrides,
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

export function buildWorkstreamServices(
  infra: SharedInfraContext,
  overrides: ServiceOverrides,
) {
  const notificationsService = buildNotificationsService(infra, overrides);
  const tasksRepo = overrides.tasksRepo ?? new DrizzleTasksRepository(infra.db);
  const commentsRepo = overrides.commentsRepo ?? new DrizzleCommentsRepository(infra.db);
  const tasksService =
    overrides.tasksService ??
    new TasksService({
      tasksRepo,
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
    commentsService,
    notificationsService,
    boardsService: buildBoardsService(infra, overrides, tasksRepo),
    archiveService: buildArchiveService(infra, overrides),
  };
}

export function createDefaultAuditRepo(db: Database): AuditRepository {
  return new DrizzleAuditRepository(db);
}
