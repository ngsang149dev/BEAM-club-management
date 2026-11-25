import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvContent } from './load-env.mjs';

function normalizePort(rawPort) {
  if (rawPort === undefined || rawPort === null) {
    return null;
  }
  const trimmed = String(rawPort).trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const portNum = Number(trimmed);
  if (portNum < 1 || portNum > 65535) {
    return null;
  }
  return String(portNum);
}

function generateSecretHex() {
  return crypto.randomBytes(32).toString('hex');
}

function buildEnvLocalFromExample(exampleContent, postgresPort) {
  const validPort = normalizePort(postgresPort);
  let output = exampleContent
    .replace('replace-with-32-byte-hex-secret', generateSecretHex())
    .replace('replace-with-cron-secret', generateSecretHex());

  if (validPort && validPort !== '5432') {
    output = output
      .split(/\r?\n/)
      .map((line) => {
        if (
          line.startsWith('DATABASE_URL=') ||
          line.startsWith('TEST_DATABASE_URL=')
        ) {
          return line.replace(':5432/', `:${validPort}/`);
        }
        return line;
      })
      .join('\n');
  }

  return output.endsWith('\n') ? output : `${output}\n`;
}

export function ensureLocalEnv(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const postgresPort = options.postgresPort ?? process.env.POSTGRES_PORT;
  const examplePath = path.resolve(cwd, '.env.example');
  const localPath = path.resolve(cwd, '.env.local');

  if (!fs.existsSync(examplePath)) {
    throw new Error('Missing .env.example in repository root.');
  }

  const exampleContent = fs.readFileSync(examplePath, 'utf8');

  if (!fs.existsSync(localPath)) {
    const content = buildEnvLocalFromExample(exampleContent, postgresPort);
    fs.writeFileSync(localPath, content, { encoding: 'utf8', mode: 0o600 });
    console.log(
      'Created .env.local from .env.example with freshly generated local SESSION_SECRET and CRON_SECRET.',
    );
    return { created: true, missingKeys: [] };
  }

  const exampleKeys = Object.keys(parseEnvContent(exampleContent));
  const localEntries = parseEnvContent(fs.readFileSync(localPath, 'utf8'));
  const missingKeys = exampleKeys.filter((key) => !(key in localEntries));

  if (missingKeys.length > 0) {
    console.warn(
      `[WARN] .env.local exists and was preserved, but is missing keys from .env.example: ${missingKeys.join(', ')}`,
    );
  } else {
    console.log('.env.local already exists (preserved).');
  }

  return { created: false, missingKeys };
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    ensureLocalEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
