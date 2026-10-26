import { expect, it } from 'vitest';

import {
  digest,
  hashPassword,
  randomToken,
  secretMatches,
  verifyPassword,
} from './crypto';

it('creates salted password hashes and verifies without storing plaintext', async () => {
  const password = 'a long test password only';
  const pepper = randomToken();
  const first = await hashPassword(password, pepper);
  const second = await hashPassword(password, pepper);
  expect(first).toMatch(
    /^pbkdf2-sha256-hmac\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/,
  );
  expect(first).not.toContain(pepper);
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(await verifyPassword(password, first, pepper)).toBe(true);
  expect(await verifyPassword(password, first, randomToken())).toBe(false);
  expect(await verifyPassword('incorrect', first, pepper)).toBe(false);
  expect(await verifyPassword(password, 'malformed', pepper)).toBe(false);
  await expect(hashPassword(password, '')).rejects.toThrow('not configured');
});

it('uses unpredictable tokens and fixed-length token digests', async () => {
  const first = randomToken();
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).not.toBe(randomToken());
  expect(await digest(first)).toHaveLength(64);
  expect(await secretMatches('first', 'first')).toBe(true);
  expect(await secretMatches('first', 'different')).toBe(false);
});
