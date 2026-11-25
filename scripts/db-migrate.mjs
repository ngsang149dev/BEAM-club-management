import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvFiles } from './load-env.mjs';

async function main() {
  loadEnvFiles();
  const useTest = process.argv.includes('--test');
  const connectionString = useTest
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      useTest ? 'TEST_DATABASE_URL is required' : 'DATABASE_URL is required',
    );
  }

  const migrationsDir = path.resolve(process.cwd(), 'db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`Applied migration: ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
