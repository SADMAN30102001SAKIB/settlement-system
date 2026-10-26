import { createHmac, pbkdf2, timingSafeEqual } from 'node:crypto';

// Production Workers enforce a 100,000-iteration PBKDF2 limit; local workerd does not.
const ITERATIONS = 100_000;
const encoder = new TextEncoder();

function derive(
  password: string,
  salt: string,
  pepper: string,
): Promise<Uint8Array> {
  if (!/^[a-f0-9]{64}$/.test(pepper))
    throw new Error('Password hashing secret is not configured.');
  const input = createHmac('sha256', Buffer.from(pepper, 'hex'))
    .update(password, 'utf8')
    .digest();
  return new Promise((resolve, reject) => {
    pbkdf2(input, salt, ITERATIONS, 32, 'sha256', (error, key) => {
      if (error) reject(error);
      else resolve(new Uint8Array(key));
    });
  });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function randomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function digest(value: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  );
}

export async function secretMatches(
  candidate: string,
  expected: string,
): Promise<boolean> {
  const [left, right] = await Promise.all([
    digest(candidate),
    digest(expected),
  ]);
  return timingSafeEqual(encoder.encode(left), encoder.encode(right));
}

export async function hashPassword(
  password: string,
  pepper: string,
): Promise<string> {
  const salt = randomToken();
  return `pbkdf2-sha256-hmac$${String(ITERATIONS)}$${salt}$${hex(await derive(password, salt, pepper))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  const [algorithm, iterations, salt, expected] = stored.split('$');
  if (
    algorithm !== 'pbkdf2-sha256-hmac' ||
    iterations !== String(ITERATIONS) ||
    salt === undefined ||
    !/^[a-f0-9]{64}$/.test(salt) ||
    expected === undefined ||
    !/^[a-f0-9]{64}$/.test(expected)
  ) {
    return false;
  }
  const actual = hex(await derive(password, salt, pepper));
  return timingSafeEqual(encoder.encode(actual), encoder.encode(expected));
}
