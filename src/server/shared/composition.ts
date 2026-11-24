import {
  type AuditLogWriter,
  DrizzleAuditRepository,
} from '@/server/modules/audit';
import {
  type AuthRepository,
  AuthService,
  DrizzleAuthRepository,
} from '@/server/modules/auth';
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
import { type Clock, SystemClock } from './clock';
import { type Config, loadConfig } from './config';
import { createDatabaseClient, type Database } from './db';
import { type Logger, StructuredLogger } from './logger';
import { type Mailer, NoopMailer } from './mailer';
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
  dispose(): Promise<void>;
}

export interface ContainerOverrides {
  readonly config?: Config;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly mailer?: Mailer;
  readonly db?: Database;
  readonly transactionRunner?: TransactionRunner;
  readonly auditWriter?: AuditLogWriter;
  readonly authRepo?: AuthRepository;
  readonly authService?: AuthService;
  readonly departmentsRepo?: DepartmentsRepository;
  readonly departmentsService?: DepartmentsService;
  readonly membersRepo?: MembersRepository;
  readonly membersService?: MembersService;
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

function buildSharedInfra(overrides: ContainerOverrides) {
  const config = overrides.config ?? loadConfig();
  const clock = overrides.clock ?? new SystemClock();
  const logger = overrides.logger ?? new StructuredLogger();
  const mailer = overrides.mailer ?? new NoopMailer();
  const { db, dispose } = resolveDatabase(config, overrides.db);
  const transactionRunner =
    overrides.transactionRunner ?? new DrizzleTransactionRunner(db);
  const auditWriter = overrides.auditWriter ?? new DrizzleAuditRepository(db);
  return {
    config,
    clock,
    logger,
    mailer,
    db,
    dispose,
    transactionRunner,
    auditWriter,
  };
}

export function createContainer(overrides: ContainerOverrides = {}): ServerContainer {
  const infra = buildSharedInfra(overrides);
  const authService =
    overrides.authService ??
    new AuthService({
      authRepo: overrides.authRepo ?? new DrizzleAuthRepository(infra.db),
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

  return { ...infra, authService, departmentsService, membersService };
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
