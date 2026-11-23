import {
  type AuthRepository,
  AuthService,
  DrizzleAuthRepository,
} from '@/server/modules/auth';
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
  readonly authService: AuthService;
  dispose(): Promise<void>;
}

export interface ContainerOverrides {
  readonly config?: Config;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly mailer?: Mailer;
  readonly db?: Database;
  readonly transactionRunner?: TransactionRunner;
  readonly authRepo?: AuthRepository;
  readonly authService?: AuthService;
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

export function createContainer(overrides: ContainerOverrides = {}): ServerContainer {
  const config = overrides.config ?? loadConfig();
  const clock = overrides.clock ?? new SystemClock();
  const logger = overrides.logger ?? new StructuredLogger();
  const mailer = overrides.mailer ?? new NoopMailer();
  const { db, dispose } = resolveDatabase(config, overrides.db);
  const transactionRunner =
    overrides.transactionRunner ?? new DrizzleTransactionRunner(db);
  const authRepo = overrides.authRepo ?? new DrizzleAuthRepository(db);
  const authService =
    overrides.authService ??
    new AuthService({ authRepo, clock, config, logger });

  return {
    config,
    clock,
    logger,
    mailer,
    db,
    transactionRunner,
    authService,
    dispose,
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
