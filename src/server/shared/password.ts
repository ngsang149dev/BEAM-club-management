import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;
const PREFIX = 'scrypt';

// Dev/test seed password (`db/seed.sql` & non-production DEFAULT_INITIAL_PASSWORD fallback).
export const DEV_SEED_PASSWORD = 'BeamDev@2026';

// Static scrypt digest of random unguessable bytes used for timing-safe misses.
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$a212536fb12ae1aa706667c54c6fc4a5$ce8883c887a610da037a82a06b205b149e93fec66ab54c08d3d48ebd91d6f3260cabfc85116d494757306ebea72b60cce553d79c700e386febe10100bbcd7d55';

interface ParsedScryptHash {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly saltHex: string;
  readonly derivedKey: Buffer;
}

function deriveKey(input: {
  readonly password: string;
  readonly salt: string;
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly keyLength: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      input.password,
      input.salt,
      input.keyLength,
      {
        N: input.cost,
        r: input.blockSize,
        p: input.parallelization,
        maxmem: SCRYPT_MAXMEM,
      },
      (error, derived) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derived);
      },
    );
  });
}

function isValidHex(value: string, expectedBytes: number): boolean {
  return (
    value.length === expectedBytes * 2 && /^[0-9a-f]+$/i.test(value)
  );
}

function isValidScryptParams(
  cost: number,
  blockSize: number,
  parallelization: number,
): boolean {
  const validCost = Number.isInteger(cost) && cost >= 1024 && cost <= 65_536;
  const validBlock = Number.isInteger(blockSize) && blockSize >= 1 && blockSize <= 16;
  const validParallel =
    Number.isInteger(parallelization) &&
    parallelization >= 1 &&
    parallelization <= 4;
  return validCost && validBlock && validParallel;
}

function parseScryptHash(storedHash: string): ParsedScryptHash | null {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return null;
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const saltHex = parts[4] ?? '';
  const digestHex = parts[5] ?? '';

  if (!isValidScryptParams(cost, blockSize, parallelization)) {
    return null;
  }

  if (!isValidHex(saltHex, SALT_BYTES) || !isValidHex(digestHex, KEY_LENGTH)) {
    return null;
  }

  return {
    cost,
    blockSize,
    parallelization,
    saltHex,
    derivedKey: Buffer.from(digestHex, 'hex'),
  };
}

export async function hashPassword(password: string): Promise<string> {
  const saltHex = randomBytes(SALT_BYTES).toString('hex');
  const derived = await deriveKey({
    password,
    salt: saltHex,
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P,
    keyLength: KEY_LENGTH,
  });
  return [
    PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    saltHex,
    derived.toString('hex'),
  ].join('$');
}

async function runDummyScrypt(password: string): Promise<false> {
  await deriveKey({
    password: password || 'fallback-input',
    salt: '00000000000000000000000000000000',
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P,
    keyLength: KEY_LENGTH,
  });
  return false;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!password || !storedHash) {
    return runDummyScrypt(password);
  }

  const parsed = parseScryptHash(storedHash);
  if (!parsed) {
    return runDummyScrypt(password);
  }

  const candidate = await deriveKey({
    password,
    salt: parsed.saltHex,
    cost: parsed.cost,
    blockSize: parsed.blockSize,
    parallelization: parsed.parallelization,
    keyLength: parsed.derivedKey.length,
  });

  if (candidate.length !== parsed.derivedKey.length) {
    return false;
  }
  return timingSafeEqual(candidate, parsed.derivedKey);
}
