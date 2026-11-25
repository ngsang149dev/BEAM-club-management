import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function loadEnvFiles(): void {
  for (const fileName of ['.env.local', '.env']) {
    const envPath = path.resolve(process.cwd(), fileName);
    if (!fs.existsSync(envPath)) {
      continue;
    }
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      if (trimmed.startsWith('export ')) {
        trimmed = trimmed.slice('export '.length).trimStart();
      }
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function getSystemChromePaths(platform: NodeJS.Platform): string[] {
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
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 =
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    return [
      path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
      path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
      ...(localAppData
        ? [path.join(localAppData, 'Google/Chrome/Application/chrome.exe')]
        : []),
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

function resolveBrowserChannel(): string | undefined {
  const override = process.env.PLAYWRIGHT_CHANNEL?.trim();
  if (override) {
    const normalized = override.toLowerCase();
    return normalized === 'none' || normalized === 'chromium'
      ? undefined
      : override;
  }
  if (process.env.CI) {
    return undefined;
  }
  const hasSystemChrome = getSystemChromePaths(process.platform).some((p) =>
    fs.existsSync(p),
  );
  return hasSystemChrome ? 'chrome' : undefined;
}

function resolvePlaywrightPort(): string {
  const raw = process.env.PLAYWRIGHT_PORT?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (parsed >= 1 && parsed <= 65535) {
      return String(parsed);
    }
  }
  return '3001';
}

loadEnvFiles();

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required to run Playwright E2E tests.');
}

const playwrightPort = resolvePlaywrightPort();
const baseUrl = `http://127.0.0.1:${playwrightPort}`;
const browserChannel = resolveBrowserChannel();

const serverEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') {
    serverEnv[key] = value;
  }
}
serverEnv.DATABASE_URL = testDatabaseUrl;
serverEnv.TEST_DATABASE_URL = testDatabaseUrl;
serverEnv.PORT = playwrightPort;
serverEnv.NEXT_PUBLIC_APP_URL = baseUrl;
if (process.env.PLAYWRIGHT_KEEP_SMTP !== '1') {
  serverEnv.SMTP_HOST = '';
  serverEnv.SMTP_PORT = '';
  serverEnv.SMTP_USER = '';
  serverEnv.SMTP_PASS = '';
  serverEnv.SMTP_FROM = '';
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: baseUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${playwrightPort}`,
    url: `${baseUrl}/login`,
    reuseExistingServer: false,
    timeout: 45_000,
    env: serverEnv,
  },
});
