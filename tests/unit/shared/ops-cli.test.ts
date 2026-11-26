import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '@/server/shared/password';

interface DbMigrateResult {
  readonly target: string;
  readonly applied: string[];
  readonly skipped: string[];
}

interface MockPgQueryResult<Row = Record<string, unknown>> {
  readonly rows: Row[];
}

interface MockPgClient {
  connect(): Promise<void>;
  query(sql: string, params?: readonly unknown[]): Promise<MockPgQueryResult>;
  end(): Promise<void>;
}

interface DbMigrateModule {
  parseMigrateCliOptions(argv?: readonly string[]): {
    readonly useTest: boolean;
  };
  runDbMigrate(options?: {
    readonly useTest?: boolean;
    readonly connectionString?: string;
    readonly migrationsDir?: string;
    readonly quiet?: boolean;
    readonly writeOut?: (line: string) => void;
    readonly createClient?: (connectionString: string) => MockPgClient;
  }): Promise<DbMigrateResult>;
}

interface BootstrapAdminParsedArgs {
  readonly useTest: boolean;
  readonly studentId?: string;
  readonly email?: string;
  readonly fullName?: string;
  readonly locale?: string;
}

interface ValidatedBootstrapInput {
  readonly studentId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: 'vi' | 'en';
  readonly password: string;
}

interface DbBootstrapAdminResult {
  readonly userId: string;
  readonly created: boolean;
  readonly target: string;
  readonly defaultPermissions: readonly string[];
}

interface DbBootstrapAdminModule {
  parseBootstrapAdminCliArgs(argv?: readonly string[]): BootstrapAdminParsedArgs;
  validateBootstrapAdminInput(params: {
    readonly studentId?: string;
    readonly email?: string;
    readonly fullName?: string;
    readonly locale?: string;
    readonly password?: string;
    readonly allowedEmailDomain?: string;
  }): ValidatedBootstrapInput;
  hashBootstrapPassword(password: string): Promise<string>;
  runDbBootstrapAdmin(options?: {
    readonly useTest?: boolean;
    readonly connectionString?: string;
    readonly studentId?: string;
    readonly email?: string;
    readonly fullName?: string;
    readonly locale?: string;
    readonly password?: string;
    readonly allowedEmailDomain?: string;
    readonly env?: Record<string, string | undefined>;
    readonly quiet?: boolean;
    readonly writeOut?: (line: string) => void;
    readonly createClient?: (connectionString: string) => MockPgClient;
  }): Promise<DbBootstrapAdminResult>;
}

interface SmtpVerifyResult {
  readonly ok: boolean;
  readonly host: string;
  readonly port: number;
  readonly recipient: string;
  readonly locale: 'vi' | 'en';
  readonly subject: string;
}

interface SmtpVerifyModule {
  parseSmtpVerifyCliArgs(argv?: readonly string[]): {
    readonly to?: string;
    readonly locale?: string;
  };
  maskEmailForLog(rawEmail: string): string;
  runSmtpVerify(options?: {
    readonly to?: string;
    readonly locale?: string;
    readonly host?: string;
    readonly port?: number;
    readonly from?: string;
    readonly user?: string;
    readonly pass?: string;
    readonly timeoutMs?: number;
    readonly rejectUnauthorized?: boolean;
    readonly env?: Record<string, string | undefined>;
    readonly quiet?: boolean;
    readonly writeOut?: (line: string) => void;
  }): Promise<SmtpVerifyResult>;
}

async function importScriptModule<T>(relativePath: string): Promise<T> {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return (await import(pathToFileURL(fullPath).href)) as T;
}

interface MockSmtpExchange {
  readonly commands: string[];
  readonly authPayloads: string[];
  readonly dataPayload: string;
}

function createMockSmtpServer(options: {
  readonly ehloCapabilities?: string[];
  readonly rejectRcptWith?: string;
} = {}) {
  const exchanges: MockSmtpExchange[] = [];
  const sockets = new Set<net.Socket>();
  const capabilities = options.ehloCapabilities ?? ['mock.local', 'AUTH PLAIN LOGIN'];

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    const commands: string[] = [];
    const authPayloads: string[] = [];
    let buffer = '';
    let inData = false;
    let dataBuffer = '';

    socket.write('220 mock-smtp.local ESMTP\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const rawLine = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);

        if (inData) {
          if (rawLine === '.') {
            inData = false;
            exchanges.push({ commands, authPayloads, dataPayload: dataBuffer });
            socket.write('250 2.0.0 OK accepted\r\n');
          } else {
            dataBuffer += `${rawLine}\r\n`;
          }
          continue;
        }

        commands.push(rawLine);
        const upper = rawLine.toUpperCase();
        if (upper.startsWith('EHLO ')) {
          for (let i = 0; i < capabilities.length; i += 1) {
            const sep = i === capabilities.length - 1 ? ' ' : '-';
            socket.write(`250${sep}${capabilities[i]}\r\n`);
          }
        } else if (upper.startsWith('AUTH PLAIN ')) {
          authPayloads.push(rawLine.slice('AUTH PLAIN '.length));
          socket.write('235 2.7.0 Authenticated\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          if (options.rejectRcptWith) {
            socket.write(`${options.rejectRcptWith}\r\n`);
          } else {
            socket.write('250 2.1.5 Ok\r\n');
          }
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('502 Unrecognized command\r\n');
        }
      }
    });
  });

  return {
    exchanges,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          resolve(addr.port);
        });
      }),
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('E10-01 Operational CLI Utilities (db-migrate, db-bootstrap-admin, smtp-verify)', () => {
  const tempDirs: string[] = [];
  const smtpServers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (smtpServers.length > 0) {
      await smtpServers.pop()!.close();
    }
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  describe('scripts/db-migrate.mjs', () => {
    it('skips already-recorded schema_migrations versions, applies unapplied SQL in sorted order, and redacts credentials in logs & errors', async () => {
      const migrateMod = await importScriptModule<DbMigrateModule>(
        'scripts/db-migrate.mjs',
      );
      expect(migrateMod.parseMigrateCliOptions(['--', '--test'])).toEqual({
        useTest: true,
      });

      const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-mig-unit-'));
      tempDirs.push(migDir);
      fs.writeFileSync(path.join(migDir, '0002_second.sql'), 'SELECT 2;', 'utf8');
      fs.writeFileSync(path.join(migDir, '0001_first.sql'), 'SELECT 1;', 'utf8');
      fs.writeFileSync(path.join(migDir, '0003_third.sql'), 'SELECT 3;', 'utf8');
      fs.writeFileSync(path.join(migDir, 'README.txt'), 'ignore', 'utf8');

      const executedSql: string[] = [];
      const logs: string[] = [];
      const secretUrl =
        'postgresql://neon_owner:UltraSecretDbPass!@ep-direct.ap-southeast-1.aws.neon.tech:5432/beam_prod?sslmode=require';

      const res = await migrateMod.runDbMigrate({
        connectionString: secretUrl,
        migrationsDir: migDir,
        writeOut: (line) => logs.push(line),
        createClient: () => ({
          async connect() {},
          async query(sql: string) {
            if (sql.includes('to_regclass')) {
              return { rows: [{ table_oid: 'schema_migrations' }] };
            }
            if (sql.includes('FROM "public"."schema_migrations"')) {
              return { rows: [{ version: '0001_first' }] };
            }
            executedSql.push(sql);
            return { rows: [] };
          },
          async end() {},
        }),
      });

      expect(res.applied).toEqual(['0002_second.sql', '0003_third.sql']);
      expect(res.skipped).toEqual(['0001_first.sql']);
      expect(executedSql).toEqual(['SELECT 2;', 'SELECT 3;']);
      expect(res.target).toBe(
        'ep-direct.ap-southeast-1.aws.neon.tech:5432/beam_prod',
      );

      const serializedLogs = logs.join('\n');
      expect(serializedLogs).toContain(
        'ep-direct.ap-southeast-1.aws.neon.tech:5432/beam_prod',
      );
      expect(serializedLogs).not.toContain('UltraSecretDbPass!');
      expect(serializedLogs).not.toContain('neon_owner');
      expect(serializedLogs).not.toContain('postgresql://');

      let caughtMessage = '';
      try {
        await migrateMod.runDbMigrate({
          connectionString: secretUrl,
          migrationsDir: migDir,
          quiet: true,
          createClient: () => ({
            async connect() {
              const agg = new AggregateError([], '');
              Object.assign(agg, { code: 'ECONNREFUSED' });
              throw agg;
            },
            async query() {
              return { rows: [] };
            },
            async end() {},
          }),
        });
      } catch (error) {
        caughtMessage = error instanceof Error ? error.message : String(error);
      }
      expect(caughtMessage).toContain('ECONNREFUSED');
      expect(caughtMessage).not.toContain('UltraSecretDbPass!');
      expect(caughtMessage).not.toContain('postgresql://');
    });
  });

  describe('scripts/db-bootstrap-admin.mjs', () => {
    it('parses CLI flags cleanly and forbids passing --password on the command line', async () => {
      const bootstrapMod = await importScriptModule<DbBootstrapAdminModule>(
        'scripts/db-bootstrap-admin.mjs',
      );

      expect(
        bootstrapMod.parseBootstrapAdminCliArgs([
          '--',
          '--test',
          '--student-id',
          '2231200001',
          '--email=admin@eiu.edu.vn',
          '--full-name',
          'Admin BEAM',
          '--locale',
          'en',
        ]),
      ).toEqual({
        useTest: true,
        studentId: '2231200001',
        email: 'admin@eiu.edu.vn',
        fullName: 'Admin BEAM',
        locale: 'en',
      });

      expect(() =>
        bootstrapMod.parseBootstrapAdminCliArgs([
          '--student-id',
          '2231200001',
          '--password',
          'ExposedSecret123',
        ]),
      ).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/);

      expect(() =>
        bootstrapMod.parseBootstrapAdminCliArgs(['--password=ExposedSecret123']),
      ).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/);
    });

    it('validates studentId, email domain, fullName, and password without echoing sensitive inputs in errors', async () => {
      const bootstrapMod = await importScriptModule<DbBootstrapAdminModule>(
        'scripts/db-bootstrap-admin.mjs',
      );

      const validLower = bootstrapMod.validateBootstrapAdminInput({
        studentId: '  cit223120001  ',
        email: '  First.Admin@EIU.EDU.VN ',
        fullName: '  Nguyen Van A  ',
        locale: 'vi',
        password: 'StrongInitPassword#2026',
        allowedEmailDomain: 'eiu.edu.vn',
      });

      expect(validLower).toEqual({
        studentId: 'cit223120001',
        email: 'first.admin@eiu.edu.vn',
        fullName: 'Nguyen Van A',
        locale: 'vi',
        password: 'StrongInitPassword#2026',
      });

      const validMixedMax = bootstrapMod.validateBootstrapAdminInput({
        studentId: `BeamAdmin-${'x'.repeat(54)}`,
        email: 'ok@eiu.edu.vn',
        fullName: 'Valid Name',
        password: 'StrongInitPassword#2026',
      });
      expect(validMixedMax.studentId).toBe(`BeamAdmin-${'x'.repeat(54)}`);
      expect(validMixedMax.studentId).toHaveLength(64);

      // Invalid studentId (contains spaces or > 64 chars) must not echo raw value
      let badSidMsg = '';
      try {
        bootstrapMod.validateBootstrapAdminInput({
          studentId: 'BAD SID WITH SPACES',
          email: 'ok@eiu.edu.vn',
          fullName: 'Valid Name',
          password: 'StrongInitPassword#2026',
        });
      } catch (error) {
        badSidMsg = error instanceof Error ? error.message : String(error);
      }
      expect(badSidMsg).toMatch(/studentId/i);
      expect(badSidMsg).not.toContain('BAD SID WITH SPACES');

      expect(() =>
        bootstrapMod.validateBootstrapAdminInput({
          studentId: 'X'.repeat(65),
          email: 'ok@eiu.edu.vn',
          fullName: 'Valid Name',
          password: 'StrongInitPassword#2026',
        }),
      ).toThrow(/1\.\.64/);

      // Wrong email domain must reject and never echo the personal email
      let badEmailMsg = '';
      try {
        bootstrapMod.validateBootstrapAdminInput({
          studentId: '2231200099',
          email: 'secret-personal@gmail.com',
          fullName: 'Valid Name',
          password: 'StrongInitPassword#2026',
          allowedEmailDomain: 'eiu.edu.vn',
        });
      } catch (error) {
        badEmailMsg = error instanceof Error ? error.message : String(error);
      }
      expect(badEmailMsg).toContain('eiu.edu.vn');
      expect(badEmailMsg).not.toContain('secret-personal@gmail.com');

      // Password length bounds (8..128) & non-whitespace
      expect(() =>
        bootstrapMod.validateBootstrapAdminInput({
          studentId: '2231200099',
          email: 'ok@eiu.edu.vn',
          fullName: 'Valid Name',
          password: 'short',
        }),
      ).toThrow(/8\.\.128/);

      expect(() =>
        bootstrapMod.validateBootstrapAdminInput({
          studentId: '2231200099',
          email: 'ok@eiu.edu.vn',
          fullName: 'Valid Name',
          password: '        ',
        }),
      ).toThrow(/password/i);
    });

    it('generates scrypt hashes 100% compatible with verifyPassword in src/server/shared/password.ts and redacts PII in logs', async () => {
      const bootstrapMod = await importScriptModule<DbBootstrapAdminModule>(
        'scripts/db-bootstrap-admin.mjs',
      );

      const secretPass = 'ClubBootstrap#2026!';
      const digest = await bootstrapMod.hashBootstrapPassword(secretPass);
      expect(digest).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(await verifyPassword(secretPass, digest)).toBe(true);
      expect(await verifyPassword('WrongPassword#2026', digest)).toBe(false);

      const logs: string[] = [];
      const res = await bootstrapMod.runDbBootstrapAdmin({
        connectionString:
          'postgresql://neon_admin:DbTopSecret88@ep-direct.ap-southeast-1.aws.neon.tech:5432/beam_prod?sslmode=require',
        env: {
          BOOTSTRAP_ADMIN_STUDENT_ID: '2231299999',
          BOOTSTRAP_ADMIN_EMAIL: 'private-founder@eiu.edu.vn',
          BOOTSTRAP_ADMIN_FULL_NAME: 'Secret Founder Name',
          BOOTSTRAP_ADMIN_PASSWORD: secretPass,
          ALLOWED_EMAIL_DOMAIN: 'eiu.edu.vn',
        },
        writeOut: (line) => logs.push(line),
        createClient: () => ({
          async connect() {},
          async query(sql: string) {
            if (sql.includes('FROM "public"."permissions"')) {
              return {
                rows: [
                  { code: 'member.view' },
                  { code: 'task.update_assigned' },
                  { code: 'comment.create' },
                ],
              };
            }
            if (sql.includes('FROM "public"."profiles"')) {
              return { rows: [] };
            }
            if (sql.includes('INSERT INTO "public"."profiles"')) {
              return { rows: [{ id: '11111111-2222-4333-8444-555555555555' }] };
            }
            return { rows: [] };
          },
          async end() {},
        }),
      });

      expect(res.created).toBe(true);
      expect(res.userId).toBe('11111111-2222-4333-8444-555555555555');
      const output = logs.join('\n');
      expect(output).toContain('11111111-2222-4333-8444-555555555555');
      expect(output).not.toContain('2231299999');
      expect(output).not.toContain('private-founder@eiu.edu.vn');
      expect(output).not.toContain('Secret Founder Name');
      expect(output).not.toContain(secretPass);
      expect(output).not.toContain('DbTopSecret88');
      expect(output).not.toContain('postgresql://');

      // Existing profile update must preserve exact studentId and revoke active sessions
      const updateQueries: Array<{ sql: string; params: readonly unknown[] }> = [];
      const updateRes = await bootstrapMod.runDbBootstrapAdmin({
        connectionString: 'postgresql://localhost:5432/beam_test',
        env: {
          BOOTSTRAP_ADMIN_STUDENT_ID: 'BeamAdmin-01',
          BOOTSTRAP_ADMIN_EMAIL: 'private-founder@eiu.edu.vn',
          BOOTSTRAP_ADMIN_FULL_NAME: 'Secret Founder Name',
          BOOTSTRAP_ADMIN_PASSWORD: secretPass,
          ALLOWED_EMAIL_DOMAIN: 'eiu.edu.vn',
        },
        quiet: true,
        createClient: () => ({
          async connect() {},
          async query(sql: string, params: readonly unknown[] = []) {
            updateQueries.push({ sql, params });
            if (sql.includes('FROM "public"."permissions"')) {
              return {
                rows: [
                  { code: 'member.view' },
                  { code: 'task.update_assigned' },
                  { code: 'comment.create' },
                ],
              };
            }
            if (sql.includes('FROM "public"."profiles"')) {
              return {
                rows: [
                  {
                    id: '11111111-2222-4333-8444-555555555555',
                    student_id: 'BeamAdmin-01',
                    purged_at: null,
                  },
                ],
              };
            }
            return { rows: [] };
          },
          async end() {},
        }),
      });

      expect(updateRes.created).toBe(false);
      const sessionRevokeQuery = updateQueries.find((q) =>
        q.sql.includes('UPDATE "public"."sessions"'),
      );
      expect(sessionRevokeQuery).toBeDefined();
      expect(sessionRevokeQuery?.params).toEqual([
        '11111111-2222-4333-8444-555555555555',
      ]);
    });
  });

  describe('scripts/smtp-verify.mjs', () => {
    it('parses --to and --locale flags, validates SMTP config & CRLF injection, sends bilingual verification mail, and redacts credentials & recipient PII', async () => {
      const smtpMod = await importScriptModule<SmtpVerifyModule>(
        'scripts/smtp-verify.mjs',
      );

      expect(
        smtpMod.parseSmtpVerifyCliArgs(['--', '--to', 'admin@eiu.edu.vn']),
      ).toEqual({
        to: 'admin@eiu.edu.vn',
        locale: undefined,
      });
      expect(
        smtpMod.parseSmtpVerifyCliArgs(['--to=lead@eiu.edu.vn', '--locale=en']),
      ).toEqual({
        to: 'lead@eiu.edu.vn',
        locale: 'en',
      });
      expect(smtpMod.maskEmailForLog('president.secret@eiu.edu.vn')).toBe(
        '***@eiu.edu.vn',
      );

      // Missing SMTP_HOST / SMTP_FROM / injected --to rejected without echoing PII
      await expect(
        smtpMod.runSmtpVerify({
          to: 'president.secret@eiu.edu.vn',
          env: {},
          quiet: true,
        }),
      ).rejects.toThrow(/SMTP_HOST/);

      let crlfErr = '';
      try {
        await smtpMod.runSmtpVerify({
          to: 'victim@eiu.edu.vn\r\nBcc: attacker@evil.example',
          host: '127.0.0.1',
          port: 2525,
          from: 'BEAM Club <club@eiu.edu.vn>',
          env: {},
          quiet: true,
        });
      } catch (error) {
        crlfErr = error instanceof Error ? error.message : String(error);
      }
      expect(crlfErr).toMatch(/recipient|email/i);
      expect(crlfErr).not.toContain('victim@eiu.edu.vn');

      // Real TCP exchange over local mock SMTP server
      const mockServer = createMockSmtpServer({
        ehloCapabilities: ['mock.local', 'AUTH PLAIN LOGIN'],
      });
      smtpServers.push(mockServer);
      const port = await mockServer.listen();

      const logs: string[] = [];
      const result = await smtpMod.runSmtpVerify({
        to: 'president.inbox@eiu.edu.vn',
        locale: 'vi',
        host: '127.0.0.1',
        port,
        from: 'BEAM Club <beam-club-bot@eiu.edu.vn>',
        user: 'beam-club-bot@eiu.edu.vn',
        pass: 'abcd1234efgh5678',
        env: {},
        writeOut: (line) => logs.push(line),
      });

      expect(result.ok).toBe(true);
      expect(result.recipient).toBe('***@eiu.edu.vn');
      expect(result.subject).toBe(
        '[BEAM Club] Kiểm tra kết nối SMTP / SMTP Verification',
      );
      expect(mockServer.exchanges).toHaveLength(1);

      const exchange = mockServer.exchanges[0]!;
      expect(exchange.commands).toContain(
        'MAIL FROM:<beam-club-bot@eiu.edu.vn>',
      );
      expect(exchange.commands).toContain(
        'RCPT TO:<president.inbox@eiu.edu.vn>',
      );
      expect(
        Buffer.from(exchange.authPayloads[0]!, 'base64').toString('utf8'),
      ).toBe('\0beam-club-bot@eiu.edu.vn\0abcd1234efgh5678');
      expect(exchange.dataPayload).toContain('Subject: =?UTF-8?B?');
      expect(exchange.dataPayload).toContain('SMTP Verification');

      const logText = logs.join('\n');
      expect(logText).toContain('***@eiu.edu.vn');
      expect(logText).not.toContain('president.inbox@eiu.edu.vn');
      expect(logText).not.toContain('beam-club-bot@eiu.edu.vn');
      expect(logText).not.toContain('abcd1234efgh5678');

      // Even when upstream SMTP server echoes recipient email in 550 rejection, error must mask it
      const rejectServer = createMockSmtpServer({
        rejectRcptWith:
          '550 5.1.1 <president.inbox@eiu.edu.vn>: Recipient address rejected',
      });
      smtpServers.push(rejectServer);
      const rejectPort = await rejectServer.listen();

      let smtpFailMsg = '';
      try {
        await smtpMod.runSmtpVerify({
          to: 'president.inbox@eiu.edu.vn',
          host: '127.0.0.1',
          port: rejectPort,
          from: 'BEAM Club <beam-club-bot@eiu.edu.vn>',
          user: 'beam-club-bot@eiu.edu.vn',
          pass: 'abcd1234efgh5678',
          env: {},
          quiet: true,
        });
      } catch (error) {
        smtpFailMsg = error instanceof Error ? error.message : String(error);
      }
      expect(smtpFailMsg).toContain('550');
      expect(smtpFailMsg).toContain('***@eiu.edu.vn');
      expect(smtpFailMsg).not.toContain('president.inbox@eiu.edu.vn');
      expect(smtpFailMsg).not.toContain('abcd1234efgh5678');
    });
  });
});
