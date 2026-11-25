import fs from 'node:fs';
import path from 'node:path';

const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
]);

export function parseEnvContent(content) {
  const entries = {};
  for (const rawLine of content.split(/\r?\n/)) {
    let trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('export ')) {
      trimmed = trimmed.slice('export '.length).trimStart();
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

export function loadEnvFiles(cwd = process.cwd()) {
  const loadedFrom = [];
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.resolve(cwd, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    loadedFrom.push(fileName);
  }
  return loadedFrom;
}

export function isLocalDatabaseUrl(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(connectionString);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOCAL_DB_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function formatSafeDbTarget(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const port = parsed.port || '5432';
    const dbName = parsed.pathname.replace(/^\//, '') || '(default)';
    return `${parsed.hostname}:${port}/${dbName}`;
  } catch {
    return '(invalid database URL)';
  }
}
