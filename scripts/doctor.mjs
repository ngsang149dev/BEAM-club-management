import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { formatSafeDbTarget, loadEnvFiles } from './load-env.mjs';

function getSystemChromeCandidates(platform = process.platform) {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(
        os.homedir(),
        'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ),
    ];
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 =
      process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    return [
      path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
      path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
      ...(localAppData
        ? [path.join(localAppData, 'Google/Chrome/Application/chrome.exe')]
        : []),
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

function getPlaywrightCacheDir(platform = process.platform) {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Caches/ms-playwright');
  }
  if (platform === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local');
    return path.join(localAppData, 'ms-playwright');
  }
  return path.join(os.homedir(), '.cache/ms-playwright');
}

function hasCachedPlaywrightBrowsers(cacheDir) {
  if (!cacheDir || !fs.existsSync(cacheDir)) {
    return false;
  }
  try {
    return fs
      .readdirSync(cacheDir)
      .some((entry) => entry.startsWith('chromium'));
  } catch {
    return false;
  }
}

async function checkDatabase(label, connectionString) {
  const target = formatSafeDbTarget(connectionString);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
    const res = await client.query(
      "SELECT to_regclass('public.profiles') AS profiles, to_regclass('public.club_assets') AS club_assets",
    );
    const row = res.rows[0] ?? {};
    if (row.profiles && row.club_assets) {
      return {
        status: 'OK',
        message: `${label} reachable & migrated (${target})`,
      };
    }
    return {
      status: 'WARN',
      message: `${label} reachable at ${target}, but schema tables are missing (run npm run db:migrate${label === 'TEST_DATABASE_URL' ? ' -- --test' : ''})`,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    const detail = code || (error instanceof Error ? error.message : String(error));
    return {
      status: 'FAIL',
      message: `${label} unreachable at ${target} (${detail})`,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function getPostgresRemediationLines(platform = process.platform) {
  if (platform === 'darwin') {
    return [
      '  - Docker Desktop: open -a Docker && npm run db:up',
      '  - Homebrew Postgres 16: brew install postgresql@16 && brew services start postgresql@16',
      '  - Or point DATABASE_URL / TEST_DATABASE_URL in .env.local to your dev PostgreSQL server.',
    ];
  }
  if (platform === 'win32') {
    return [
      '  - Docker Desktop: launch Docker Desktop, then run: npm run db:up',
      '  - Native PostgreSQL: ensure the PostgreSQL Windows service is running on port 5432',
      '  - Or point DATABASE_URL / TEST_DATABASE_URL in .env.local to your dev PostgreSQL server.',
    ];
  }
  return [
    '  - Docker Engine: docker compose up -d (or npm run db:up)',
    '  - Native PostgreSQL: sudo systemctl start postgresql',
    '  - Or point DATABASE_URL / TEST_DATABASE_URL in .env.local to your dev PostgreSQL server.',
  ];
}

export async function runDoctor(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  loadEnvFiles(cwd);

  const results = [];
  const push = (status, message) => results.push({ status, message });

  const majorNode = Number(process.versions.node.split('.')[0]);
  if (majorNode >= 20) {
    push(
      'OK',
      `Platform ${process.platform}/${process.arch} · Node.js v${process.versions.node} (>= 20 required; CI uses v22)`,
    );
  } else {
    push(
      'FAIL',
      `Node.js v${process.versions.node} is too old on ${process.platform}/${process.arch} (>= 20 required)`,
    );
  }

  const envLocalPath = path.resolve(cwd, '.env.local');
  if (fs.existsSync(envLocalPath)) {
    push('OK', '.env.local exists');
  } else {
    push('WARN', '.env.local missing (run npm run setup to create one from .env.example)');
  }

  for (const key of [
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'SESSION_SECRET',
    'CRON_SECRET',
  ]) {
    const val = process.env[key]?.trim();
    if (!val) {
      push('FAIL', `Missing required environment variable: ${key}`);
    } else if (val.startsWith('replace-with-')) {
      push(
        'WARN',
        `${key} still uses a placeholder value from .env.example`,
      );
    } else {
      push('OK', `${key} is configured`);
    }
  }

  let dbFailed = false;
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
    const conn = process.env[key]?.trim();
    if (!conn) continue;
    const dbCheck = await checkDatabase(key, conn);
    push(dbCheck.status, dbCheck.message);
    if (dbCheck.status === 'FAIL') {
      dbFailed = true;
    }
  }

  const explicitChannel = process.env.PLAYWRIGHT_CHANNEL?.trim();
  const systemChrome = getSystemChromeCandidates().find((p) => fs.existsSync(p));
  const pwCacheDir = getPlaywrightCacheDir();
  const hasPwCache = hasCachedPlaywrightBrowsers(pwCacheDir);

  if (explicitChannel) {
    push('OK', `Playwright browser channel override set (${explicitChannel})`);
  } else if (systemChrome) {
    push('OK', `System Chrome found (${systemChrome})`);
  } else if (hasPwCache) {
    push('OK', `Playwright Chromium cache found (${pwCacheDir})`);
  } else {
    push(
      'WARN',
      'Neither Google Chrome nor Playwright Chromium cache found (install Chrome or run npx playwright install chromium for E2E tests)',
    );
  }

  const openApiSchemaPath = path.resolve(
    cwd,
    'src/features/shared/api/schema.d.ts',
  );
  if (fs.existsSync(openApiSchemaPath)) {
    push('OK', 'Generated OpenAPI types exist (src/features/shared/api/schema.d.ts)');
  } else {
    push('WARN', 'Missing generated OpenAPI types (run npm run openapi:generate)');
  }

  for (const entry of results) {
    console.log(`[${entry.status}] ${entry.message}`);
  }

  if (dbFailed) {
    console.log('\nPostgreSQL remediation for this platform:');
    for (const line of getPostgresRemediationLines()) {
      console.log(line);
    }
  }

  const hasFail = results.some((entry) => entry.status === 'FAIL');
  return !hasFail;
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  runDoctor()
    .then((ok) => {
      process.exit(ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
