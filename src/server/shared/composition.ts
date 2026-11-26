import type { ArchiveService } from '@/server/modules/archive';
import type { AuditLogWriter, AuditService } from '@/server/modules/audit';
import type { AuthService } from '@/server/modules/auth';
import type { BoardsService } from '@/server/modules/boards';
import type { BrandingService } from '@/server/modules/branding';
import type { CommentsService } from '@/server/modules/comments';
import type { DepartmentsService } from '@/server/modules/departments';
import type { MembersService } from '@/server/modules/members';
import type { NotificationsService } from '@/server/modules/notifications';
import type { PermissionsService } from '@/server/modules/permissions';
import type { RemindersService } from '@/server/modules/reminders';
import type { TaskEventsService } from '@/server/modules/task-events';
import type { TasksService } from '@/server/modules/tasks';
import { type Clock, SystemClock } from './clock';
import {
  buildDirectoryServices,
  buildGovernanceServices,
  createDefaultAuditRepo,
  type DirectoryGovernanceOverrides,
  type SharedInfraContext,
} from './composition-services';
import {
  buildWorkstreamServices,
  type WorkstreamServiceOverrides,
} from './composition-workstream';
import { type Config, loadConfig } from './config';
import { createDatabaseClient, type Database } from './db';
import { type Logger, StructuredLogger } from './logger';
import { createMailerFromConfig, type Mailer } from './mailer';
import { DrizzleTransactionRunner, type TransactionRunner } from './transaction';

export interface ServerContainer {
  readonly config: Config;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly mailer: Mailer;
  readonly db: Database;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditLogWriter;
  readonly authService: AuthService;
  readonly departmentsService: DepartmentsService;
  readonly membersService: MembersService;
  readonly permissionsService: PermissionsService;
  readonly auditService: AuditService;
  readonly brandingService: BrandingService;
  readonly tasksService: TasksService;
  readonly taskEventsService: TaskEventsService;
  readonly commentsService: CommentsService;
  readonly notificationsService: NotificationsService;
  readonly boardsService: BoardsService;
  readonly archiveService: ArchiveService;
  readonly remindersService: RemindersService;
  dispose(): Promise<void>;
}

export type ServiceOverrides = DirectoryGovernanceOverrides &
  WorkstreamServiceOverrides;

export interface ContainerOverrides extends ServiceOverrides {
  readonly config?: Config;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly mailer?: Mailer;
  readonly db?: Database;
  readonly transactionRunner?: TransactionRunner;
  readonly auditWriter?: AuditLogWriter;
}

const globalForContainer = globalThis as typeof globalThis & {
  __beamServerContainer?: ServerContainer;
};

function resolveDatabase(
  config: Config,
  dbOverride?: Database,
): { db: Database; dispose: () => Promise<void> } {
  if (dbOverride) {
    return {
      db: dbOverride,
      dispose: () => Promise.resolve(),
    };
  }
  const client = createDatabaseClient(config.databaseUrl);
  return {
    db: client.db,
    dispose: () => client.close(),
  };
}

function buildSharedInfra(
  overrides: ContainerOverrides,
): SharedInfraContext & { readonly dispose: () => Promise<void> } {
  const config = overrides.config ?? loadConfig();
  const clock = overrides.clock ?? new SystemClock();
  const logger = overrides.logger ?? new StructuredLogger();
  const mailer = overrides.mailer ?? createMailerFromConfig(config);
  const { db, dispose } = resolveDatabase(config, overrides.db);
  const transactionRunner =
    overrides.transactionRunner ?? new DrizzleTransactionRunner(db);
  const auditRepo = overrides.auditRepo ?? createDefaultAuditRepo(db);
  const auditWriter = overrides.auditWriter ?? auditRepo;
  return {
    config,
    clock,
    logger,
    mailer,
    db,
    dispose,
    transactionRunner,
    auditRepo,
    auditWriter,
  };
}

export function createContainer(overrides: ContainerOverrides = {}): ServerContainer {
  const infra = buildSharedInfra(overrides);
  const directory = buildDirectoryServices(infra, overrides);
  const governance = buildGovernanceServices(infra, overrides);
  const workstream = buildWorkstreamServices(infra, overrides);

  return {
    config: infra.config,
    clock: infra.clock,
    logger: infra.logger,
    mailer: infra.mailer,
    db: infra.db,
    dispose: infra.dispose,
    transactionRunner: infra.transactionRunner,
    auditWriter: infra.auditWriter,
    ...directory,
    ...governance,
    ...workstream,
  };
}

export function getContainer(): ServerContainer {
  if (!globalForContainer.__beamServerContainer) {
    globalForContainer.__beamServerContainer = createContainer();
  }
  return globalForContainer.__beamServerContainer;
}

export function setContainerForTesting(
  container: ServerContainer | undefined,
): void {
  globalForContainer.__beamServerContainer = container;
}
