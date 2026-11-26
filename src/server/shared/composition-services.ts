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
  type BrandingRepository,
  BrandingService,
  DrizzleBrandingRepository,
} from '@/server/modules/branding';
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
import type { Clock } from './clock';
import type { Config } from './config';
import type { Database } from './db';
import type { Logger } from './logger';
import type { Mailer } from './mailer';
import type { TransactionRunner } from './transaction';

export interface DirectoryGovernanceOverrides {
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
  overrides: DirectoryGovernanceOverrides,
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
      departmentsRepo:
        overrides.departmentsRepo ?? new DrizzleDepartmentsRepository(infra.db),
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
  overrides: DirectoryGovernanceOverrides,
) {
  const permissionsService =
    overrides.permissionsService ??
    new PermissionsService({
      permissionsRepo:
        overrides.permissionsRepo ?? new DrizzlePermissionsRepository(infra.db),
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

export function createDefaultAuditRepo(db: Database): AuditRepository {
  return new DrizzleAuditRepository(db);
}
