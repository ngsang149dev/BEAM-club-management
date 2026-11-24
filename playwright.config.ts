import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required to run Playwright E2E tests.');
}

const serverEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') {
    serverEnv[key] = value;
  }
}
serverEnv.DATABASE_URL = testDatabaseUrl;
serverEnv.TEST_DATABASE_URL = testDatabaseUrl;
serverEnv.PORT = '3001';
serverEnv.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3001',
    url: 'http://127.0.0.1:3001/login',
    reuseExistingServer: false,
    timeout: 45_000,
    env: serverEnv,
  },
});
