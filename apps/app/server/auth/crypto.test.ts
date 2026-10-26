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
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword('incorrect', first)).toBe(false);
  expect(await verifyPassword(password, 'malformed')).toBe(false);
});

it('uses unpredictable tokens and fixed-length token digests', async () => {
  const first = randomToken();
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).not.toBe(randomToken());
  expect(await digest(first)).toHaveLength(64);
  expect(await secretMatches('first', 'first')).toBe(true);
  expect(await secretMatches('first', 'different')).toBe(false);
});
