import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

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

loadEnvFiles();

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
