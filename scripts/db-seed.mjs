import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  formatSafeDbTarget,
  isLocalDatabaseUrl,
  loadEnvFiles,
} from './load-env.mjs';

async function main() {
  loadEnvFiles();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run db:seed when NODE_ENV=production.');
  }

  const useTest = process.argv.includes('--test');
  const allowRemote = process.argv.includes('--allow-remote');
  const connectionString = useTest
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      useTest ? 'TEST_DATABASE_URL is required' : 'DATABASE_URL is required',
    );
  }

  if (!isLocalDatabaseUrl(connectionString) && !allowRemote) {
    throw new Error(
      `Refusing to seed non-local database (${formatSafeDbTarget(connectionString)}) without --allow-remote.`,
    );
  }

  const seedSql = fs.readFileSync(
    path.resolve(process.cwd(), 'db/seed.sql'),
    'utf8',
  );
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(seedSql);
    console.log('Seed applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
