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
  DrizzlePermissionsRepository,
  type PermissionsRepository,
  PermissionsService,
} from '@/server/modules/permissions';
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
  readonly permissionsService: PermissionsService;
  readonly auditService: AuditService;
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
  readonly auditRepo?: AuditRepository;
  readonly auditService?: AuditService;
  readonly authRepo?: AuthRepository;
  readonly authService?: AuthService;
  readonly departmentsRepo?: DepartmentsRepository;
  readonly departmentsService?: DepartmentsService;
  readonly membersRepo?: MembersRepository;
  readonly membersService?: MembersService;
  readonly permissionsRepo?: PermissionsRepository;
  readonly permissionsService?: PermissionsService;
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
  const auditRepo = overrides.auditRepo ?? new DrizzleAuditRepository(db);
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

type SharedInfra = ReturnType<typeof buildSharedInfra>;

function buildDirectoryServices(infra: SharedInfra, overrides: ContainerOverrides) {
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
  return { authService, departmentsService, membersService };
}

function buildGovernanceServices(infra: SharedInfra, overrides: ContainerOverrides) {
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
  return { permissionsService, auditService };
}

export function createContainer(overrides: ContainerOverrides = {}): ServerContainer {
  const infra = buildSharedInfra(overrides);
  const directory = buildDirectoryServices(infra, overrides);
  const governance = buildGovernanceServices(infra, overrides);

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
