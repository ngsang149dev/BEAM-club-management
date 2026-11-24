import { describe, expect, it } from 'vitest';
import {
  DEV_SEED_PASSWORD,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from '@/server/shared/password';

describe('password hashing and verification', () => {
  it('hashes with unique random salt and verifies matching passwords', async () => {
    const firstHash = await hashPassword('BeamSecret#2026');
    const secondHash = await hashPassword('BeamSecret#2026');

    expect(firstHash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(secondHash).not.toBe(firstHash);

    await expect(verifyPassword('BeamSecret#2026', firstHash)).resolves.toBe(true);
    await expect(verifyPassword('BeamSecret#2026', secondHash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPassword#1', firstHash)).resolves.toBe(false);
  });

  it('rejects null, empty, malformed hashes and dummy hash timing-safely', async () => {
    await expect(verifyPassword('anything123', null)).resolves.toBe(false);
    await expect(verifyPassword('', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPassword(DEV_SEED_PASSWORD, 'not-a-valid-hash')).resolves.toBe(
      false,
    );
    await expect(verifyPassword(DEV_SEED_PASSWORD, 'scrypt$bad$8$1$00$00')).resolves.toBe(
      false,
    );
    await expect(verifyPassword(DEV_SEED_PASSWORD, DUMMY_PASSWORD_HASH)).resolves.toBe(
      false,
    );
  });
});
