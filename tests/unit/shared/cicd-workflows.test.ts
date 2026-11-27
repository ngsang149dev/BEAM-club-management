import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function extractYamlSection(content: string, sectionHeader: string, nextHeaders: readonly string[]): string {
  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line.trimEnd() === sectionHeader);
  if (startIdx < 0) {
    throw new Error(`Missing YAML section "${sectionHeader}"`);
  }
  const endIdx = lines.findIndex(
    (line, idx) => idx > startIdx && nextHeaders.some((header) => line.trimEnd() === header),
  );
  return lines.slice(startIdx, endIdx > 0 ? endIdx : lines.length).join('\n');
}

describe('CI/CD GitHub Actions workflows and Vercel config invariants', () => {
  it('configures .github/workflows/ci.yml as a reusable least-privilege verification gate', () => {
    const ciYaml = readRepoFile('.github/workflows/ci.yml');

    expect(ciYaml).toContain('pull_request:');
    expect(ciYaml).toContain('workflow_call:');
    expect(ciYaml).toContain('permissions:\n  contents: read');
    expect(ciYaml).toContain('SESSION_TTL_MINUTES: "30"');

    const requiredCommands = [
      'npm run db:migrate -- --test',
      'npm run db:seed -- --test',
      'npm run typecheck',
      'npm run lint',
      'npm run arch:check',
      'npm run openapi:check',
      'npm run test:unit',
      'npm run test:integration',
      'npm run db:restore:verify -- --test',
      'npm run build',
    ];
    for (const cmd of requiredCommands) {
      expect(ciYaml).toContain(cmd);
    }
  });

  it('configures .github/workflows/deploy.yml with Verify -> Neon Migrate -> Vercel Prebuilt Prod order and zero-seed guard', () => {
    const deployYaml = readRepoFile('.github/workflows/deploy.yml');

    expect(deployYaml).toContain('push:\n    branches: [main]');
    expect(deployYaml).toContain('workflow_dispatch:');
    expect(deployYaml).toContain('permissions:\n  contents: read');
    expect(deployYaml).toContain('cancel-in-progress: false');
    expect(deployYaml).toContain('uses: ./.github/workflows/ci.yml');

    const migrateJob = extractYamlSection(deployYaml, '  migrate-neon:', ['  deploy-vercel:']);
    expect(migrateJob).toContain('needs: [verify]');
    expect(migrateJob).toContain('environment: production');
    expect(migrateJob).toContain('secrets.NEON_DIRECT_DATABASE_URL');
    expect(migrateJob).toContain('NODE_ENV: production');
    expect(migrateJob).toContain('run: npm run db:migrate');
    expect(migrateJob).toContain('configured=false');
    expect(migrateJob).not.toContain('db:seed');
    expect(migrateJob).not.toContain('db:backup');
    expect(migrateJob).not.toContain('db:restore');

    const vercelJob = extractYamlSection(deployYaml, '  deploy-vercel:', []);
    expect(vercelJob).toContain('needs: [verify, migrate-neon]');
    expect(vercelJob).toContain('environment: production');
    expect(vercelJob).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
    expect(vercelJob).toContain('VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}');
    expect(vercelJob).toContain('VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}');
    expect(vercelJob).not.toContain('--token');
    expect(vercelJob).not.toContain('vercel@latest');
    expect(vercelJob).toContain('vercel@${VERCEL_CLI_VERSION}');
    expect(vercelJob).toContain('vercel pull --yes --environment=production');
    expect(vercelJob).toContain('vercel build --prod');
    expect(vercelJob).toContain('vercel deploy --prebuilt --prod --yes');
    expect(vercelJob).toContain('/api/v1/branding');
    expect(vercelJob).toContain('configured=false');
  });

  it('keeps vercel.json and daily-cron.yml aligned with Singapore sin1 and daily internal cron paths', () => {
    const vercelConfig = JSON.parse(readRepoFile('vercel.json')) as {
      readonly regions: readonly string[];
      readonly crons: readonly { readonly path: string; readonly schedule: string }[];
    };
    expect(vercelConfig.regions).toEqual(['sin1']);
    expect(vercelConfig.crons).toEqual([
      { path: '/api/v1/internal/cron/reminders', schedule: '0 0 * * *' },
      { path: '/api/v1/internal/cron/archive-purge', schedule: '5 0 * * *' },
    ]);

    const cronYaml = readRepoFile('.github/workflows/daily-cron.yml');
    expect(cronYaml).toContain("cron: '0 0 * * *'");
    expect(cronYaml).toContain("cron: '5 0 * * *'");
    expect(cronYaml).toContain('/api/v1/internal/cron/reminders');
    expect(cronYaml).toContain('/api/v1/internal/cron/archive-purge');
  });
});
