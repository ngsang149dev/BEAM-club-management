import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

interface PgToolRunner {
  readonly mode: 'host' | 'docker';
  readonly binary: string;
  readonly container?: string;
  readonly majorVersion?: number;
}

interface ResolvePgToolRunnerOptions {
  readonly preferredMajorVersion?: number | null;
  readonly platform?: NodeJS.Platform;
  readonly execFileSyncFn?: (
    file: string,
    args: readonly string[],
    options?: Record<string, unknown>,
  ) => string | Buffer;
}

interface DbCliModule {
  parsePgToolMajorVersion(rawVersionOutput: unknown): number | null;
  getHostPgToolCandidates(
    toolName: string,
    preferredMajorVersion?: number | null,
    platform?: NodeJS.Platform,
  ): string[];
  resolvePgToolRunner(
    toolName: string,
    options?: ResolvePgToolRunnerOptions,
  ): PgToolRunner;
  stripUnsupportedRestorePreambles(
    sqlContent: string,
    targetServerVersionNum?: number | null,
  ): string;
}

async function importDbCliModule(): Promise<DbCliModule> {
  const fullPath = path.resolve(process.cwd(), 'scripts/db-cli.mjs');
  return (await import(pathToFileURL(fullPath).href)) as DbCliModule;
}

function createErrnoError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe('scripts/db-cli.mjs PostgreSQL version & preamble utilities', () => {
  let dbCli: DbCliModule;

  beforeAll(async () => {
    dbCli = await importDbCliModule();
  });

  describe('parsePgToolMajorVersion', () => {
    it('extracts major version from Ubuntu, Debian, macOS, and prerelease PostgreSQL client outputs', () => {
      expect(
        dbCli.parsePgToolMajorVersion(
          'pg_dump (PostgreSQL) 17.4 (Ubuntu 17.4-1.pgdg24.04+2)\n',
        ),
      ).toBe(17);
      expect(dbCli.parsePgToolMajorVersion('psql (PostgreSQL) 16.8')).toBe(16);
      expect(
        dbCli.parsePgToolMajorVersion(
          'pg_dump (PostgreSQL) 15.10 (Homebrew)',
        ),
      ).toBe(15);
      expect(dbCli.parsePgToolMajorVersion('psql (PostgreSQL) 18beta1')).toBe(18);
    });

    it('returns null for unrecognized or non-string inputs', () => {
      expect(dbCli.parsePgToolMajorVersion('')).toBeNull();
      expect(dbCli.parsePgToolMajorVersion('unknown tool 17.4')).toBeNull();
      expect(dbCli.parsePgToolMajorVersion('pg_dump (PostgreSQL) invalid')).toBeNull();
      expect(dbCli.parsePgToolMajorVersion(null)).toBeNull();
      expect(dbCli.parsePgToolMajorVersion(undefined)).toBeNull();
    });
  });

  describe('getHostPgToolCandidates', () => {
    it('places Debian/Ubuntu versioned path before generic PATH binary on linux', () => {
      expect(dbCli.getHostPgToolCandidates('pg_dump', 16, 'linux')).toEqual([
        '/usr/lib/postgresql/16/bin/pg_dump',
        'pg_dump',
      ]);
      expect(dbCli.getHostPgToolCandidates('psql', 16, 'linux')).toEqual([
        '/usr/lib/postgresql/16/bin/psql',
        'psql',
      ]);
    });

    it('places Homebrew Apple Silicon and Intel versioned paths before generic PATH binary on darwin', () => {
      expect(dbCli.getHostPgToolCandidates('pg_dump', 16, 'darwin')).toEqual([
        '/opt/homebrew/opt/postgresql@16/bin/pg_dump',
        '/usr/local/opt/postgresql@16/bin/pg_dump',
        'pg_dump',
      ]);
    });

    it('returns only generic binary name when preferredMajorVersion is omitted or platform has no versioned prefix', () => {
      expect(dbCli.getHostPgToolCandidates('pg_dump', null, 'linux')).toEqual([
        'pg_dump',
      ]);
      expect(dbCli.getHostPgToolCandidates('psql', undefined, 'darwin')).toEqual([
        'psql',
      ]);
      expect(dbCli.getHostPgToolCandidates('pg_dump', 16, 'win32')).toEqual([
        'pg_dump',
      ]);
    });
  });

  describe('resolvePgToolRunner', () => {
    it('prefers matching versioned host binary when available and records majorVersion', () => {
      const runner = dbCli.resolvePgToolRunner('pg_dump', {
        preferredMajorVersion: 16,
        platform: 'linux',
        execFileSyncFn: (file) => {
          if (file === '/usr/lib/postgresql/16/bin/pg_dump') {
            return 'pg_dump (PostgreSQL) 16.8 (Ubuntu 16.8-1.pgdg24.04+1)\n';
          }
          throw new Error(`Unexpected binary probe: ${file}`);
        },
      });

      expect(runner).toEqual({
        mode: 'host',
        binary: '/usr/lib/postgresql/16/bin/pg_dump',
        majorVersion: 16,
      });
    });

    it('falls back to generic PATH binary when versioned binary is missing and records majorVersion', () => {
      const probed: string[] = [];
      const runner = dbCli.resolvePgToolRunner('pg_dump', {
        preferredMajorVersion: 16,
        platform: 'linux',
        execFileSyncFn: (file) => {
          probed.push(file);
          if (file === '/usr/lib/postgresql/16/bin/pg_dump') {
            throw createErrnoError('ENOENT', 'not found');
          }
          if (file === 'pg_dump') {
            return 'pg_dump (PostgreSQL) 17.4 (Ubuntu 17.4-1.pgdg24.04+2)\n';
          }
          throw createErrnoError('ENOENT', 'not found');
        },
      });

      expect(probed).toEqual(['/usr/lib/postgresql/16/bin/pg_dump', 'pg_dump']);
      expect(runner).toEqual({
        mode: 'host',
        binary: 'pg_dump',
        majorVersion: 17,
      });
    });

    it('falls back to beam-postgres Docker container when no host candidate is installed', () => {
      const runner = dbCli.resolvePgToolRunner('psql', {
        preferredMajorVersion: 16,
        platform: 'darwin',
        execFileSyncFn: (file, args) => {
          if (file === 'docker' && args[0] === '--version') {
            return 'Docker version 27.3.1\n';
          }
          if (file === 'docker' && args[0] === 'exec') {
            return 'psql (PostgreSQL) 16.8\n';
          }
          throw createErrnoError('ENOENT', 'not found');
        },
      });

      expect(runner.mode).toBe('docker');
      expect(runner.binary).toBe('psql');
      expect(runner.majorVersion).toBe(16);
    });
  });

  describe('stripUnsupportedRestorePreambles', () => {
    it('strips top-level SET transaction_timeout = 0; with LF and CRLF when targetServerVersionNum < 170000', () => {
      const lfSql = [
        '--',
        '-- PostgreSQL database dump',
        '--',
        'SET statement_timeout = 0;',
        'SET lock_timeout = 0;',
        'SET idle_in_transaction_session_timeout = 0;',
        'SET transaction_timeout = 0;',
        "SET client_encoding = 'UTF8';",
        '',
      ].join('\n');

      const sanitizedLf = dbCli.stripUnsupportedRestorePreambles(lfSql, 160_008);
      expect(sanitizedLf).not.toContain('transaction_timeout');
      expect(sanitizedLf).toBe(
        [
          '--',
          '-- PostgreSQL database dump',
          '--',
          'SET statement_timeout = 0;',
          'SET lock_timeout = 0;',
          'SET idle_in_transaction_session_timeout = 0;',
          "SET client_encoding = 'UTF8';",
          '',
        ].join('\n'),
      );

      const crlfSql = [
        'SET statement_timeout = 0;',
        'SET transaction_timeout = 0;',
        "SET client_encoding = 'UTF8';",
        '',
      ].join('\r\n');

      const sanitizedCrlf = dbCli.stripUnsupportedRestorePreambles(
        crlfSql,
        160_008,
      );
      expect(sanitizedCrlf).toBe(
        [
          'SET statement_timeout = 0;',
          "SET client_encoding = 'UTF8';",
          '',
        ].join('\r\n'),
      );
    });

    it('preserves SET transaction_timeout = 0; inside COPY ... FROM stdin; ... \\. data blocks while stripping top-level occurrences', () => {
      const dumpWithCopyData = [
        'SET statement_timeout = 0;',
        'SET transaction_timeout = 0;',
        "SET client_encoding = 'UTF8';",
        '',
        'COPY public.comments (id, content) FROM stdin;',
        '70000000-0000-4000-8000-000000000001\tSET transaction_timeout = 0;',
        'SET transaction_timeout = 0;',
        '\\.',
        '',
        'SET transaction_timeout = 0;',
        "INSERT INTO public.comments (content) VALUES ('SET transaction_timeout = 0;');",
        '',
      ].join('\n');

      const sanitized = dbCli.stripUnsupportedRestorePreambles(
        dumpWithCopyData,
        160_008,
      );

      expect(sanitized).toBe(
        [
          'SET statement_timeout = 0;',
          "SET client_encoding = 'UTF8';",
          '',
          'COPY public.comments (id, content) FROM stdin;',
          '70000000-0000-4000-8000-000000000001\tSET transaction_timeout = 0;',
          'SET transaction_timeout = 0;',
          '\\.',
          '',
          "INSERT INTO public.comments (content) VALUES ('SET transaction_timeout = 0;');",
          '',
        ].join('\n'),
      );
    });

    it('leaves sqlContent completely unchanged when targetServerVersionNum >= 170000 or null/undefined', () => {
      const original = [
        'SET statement_timeout = 0;',
        'SET transaction_timeout = 0;',
        "SET client_encoding = 'UTF8';",
        '',
      ].join('\n');

      expect(dbCli.stripUnsupportedRestorePreambles(original, 170_000)).toBe(
        original,
      );
      expect(dbCli.stripUnsupportedRestorePreambles(original, 170_004)).toBe(
        original,
      );
      expect(dbCli.stripUnsupportedRestorePreambles(original, null)).toBe(
        original,
      );
      expect(dbCli.stripUnsupportedRestorePreambles(original, undefined)).toBe(
        original,
      );
    });
  });
});
