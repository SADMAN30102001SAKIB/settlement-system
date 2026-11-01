import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnvironment } from '../environment';
import { digest, verifyPassword } from './crypto';

const WINDOW = 15 * 60 * 1000;
export async function checkAttempts(
  c: Context<AppEnvironment>,
  scope: string,
  subject = '',
) {
  const keys = await Promise.all([
    digest(`${scope}:ip:${c.req.header('CF-Connecting-IP') ?? 'local'}`),
    digest(`${scope}:account:${subject}`),
  ]);
  const rows = await c.env.DB.prepare(
    'SELECT key, failures, window_started_at AS started FROM login_attempts WHERE key IN (?,?)',
  )
    .bind(...keys)
    .all<{ key: string; failures: number; started: number }>();
  if (
    rows.results.some(
      (row) =>
        row.started > Date.now() - WINDOW &&
        row.failures >= (row.key === keys[0] ? 20 : 5),
    )
  )
    throw new HTTPException(429, {
      message: 'Too many attempts. Try again in 15 minutes.',
    });
  return keys;
}
export async function failedAttempt(
  c: Context<AppEnvironment>,
  keys: string[],
) {
  const now = Date.now();
  await c.env.DB.batch(
    keys.map((key) =>
      c.env.DB.prepare(
        `INSERT INTO login_attempts (key,failures,window_started_at,locked_until) VALUES (?,1,?,0)
    ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN window_started_at<? THEN 1 ELSE failures+1 END,window_started_at=CASE WHEN window_started_at<? THEN excluded.window_started_at ELSE window_started_at END`,
      ).bind(key, now, now - WINDOW, now - WINDOW),
    ),
  );
}
export async function clearAttempts(
  c: Context<AppEnvironment>,
  keys: string[],
) {
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE key IN (?,?)')
    .bind(...keys)
    .run();
}
export async function confirmAdminPassword(
  c: Context<AppEnvironment>,
  password: string,
) {
  const keys = await checkAttempts(c, 'admin-confirm', 'admin');
  const admin = await c.env.DB.prepare(
    'SELECT password_hash AS hash,auth_version AS version,username FROM admins WHERE id=1',
  ).first<{
    hash: string;
    version: number;
    username: string;
  }>();
  if (
    !admin ||
    !(await verifyPassword(password, admin.hash, c.env.PASSWORD_PEPPER))
  ) {
    await failedAttempt(c, keys);
    throw new HTTPException(403, { message: 'Current password is incorrect.' });
  }
  await clearAttempts(c, keys);
  return admin;
}
