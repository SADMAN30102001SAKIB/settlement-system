import { Hono } from 'hono';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnvironment } from '../environment';
import { id } from '../validation';
import { loginUsername, newPassword } from '../../shared/access';
import {
  digest,
  randomToken,
  hashPassword,
  verifyPassword,
} from '../auth/crypto';
import {
  checkAttempts,
  failedAttempt,
  clearAttempts,
  confirmAdminPassword,
} from '../auth/security';

const COOKIE = 'hexa_brand_session';
const SECONDS = 12 * 60 * 60;
const dummyHash = `pbkdf2-sha256-hmac$100000$${'0'.repeat(64)}$${'0'.repeat(64)}`;

async function identity(c: Context<AppEnvironment>) {
  const token = getCookie(c, COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return c.env.DB.prepare(
    `SELECT b.id,b.name FROM brand_sessions s JOIN brand_users u ON u.brand_id=s.brand_id JOIN brands b ON b.id=u.brand_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1 AND s.version=u.version LIMIT 1`,
  )
    .bind(await digest(token), Date.now())
    .first<{ id: string; name: string }>();
}
export const requireBrand = createMiddleware<AppEnvironment>(
  async (c, next) => {
    const brand = await identity(c);
    if (!brand)
      throw new HTTPException(401, {
        message: 'Please sign in to your brand account.',
      });
    c.set('brandId', brand.id);
    await next();
  },
);

export const brandAuthRoutes = new Hono<AppEnvironment>()
  .get('/status', async (c) => c.json({ brand: await identity(c) }))
  .post('/login', async (c) => {
    const input = z
      .object({ username: loginUsername, password: z.string().min(1).max(128) })
      .strict()
      .parse(await c.req.json<unknown>());
    const keys = await checkAttempts(c, 'brand-login', input.username);
    const user = await c.env.DB.prepare(
      'SELECT u.brand_id AS id,u.password_hash AS hash,u.version,u.enabled,b.name FROM brand_users u JOIN brands b ON b.id=u.brand_id WHERE u.username=?',
    )
      .bind(input.username)
      .first<{
        id: string;
        hash: string;
        version: number;
        enabled: number;
        name: string;
      }>();
    const valid = await verifyPassword(
      input.password,
      user?.hash ?? dummyHash,
      c.env.PASSWORD_PEPPER,
    );
    if (!user?.enabled || !valid) {
      await failedAttempt(c, keys);
      throw new HTTPException(401, {
        message: 'Incorrect username or password.',
      });
    }
    const token = randomToken(),
      now = Date.now();
    const inserted = await c.env.DB.prepare(
      'INSERT INTO brand_sessions (token_hash,brand_id,version,expires_at,created_at) SELECT ?,brand_id,version,?,? FROM brand_users WHERE brand_id=? AND version=? AND enabled=1 RETURNING token_hash',
    )
      .bind(
        await digest(token),
        now + SECONDS * 1000,
        now,
        user.id,
        user.version,
      )
      .first();
    if (!inserted)
      throw new HTTPException(401, {
        message: 'Your account changed. Please sign in again.',
      });
    await c.env.DB.prepare('DELETE FROM brand_sessions WHERE expires_at<?')
      .bind(now)
      .run();
    await clearAttempts(c, keys);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Strict',
      path: '/',
      maxAge: SECONDS,
    });
    return c.json({ brand: { id: user.id, name: user.name } });
  })
  .post('/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token && /^[a-f0-9]{64}$/.test(token))
      await c.env.DB.prepare('DELETE FROM brand_sessions WHERE token_hash=?')
        .bind(await digest(token))
        .run();
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

export const brandAccessRoutes = new Hono<AppEnvironment>()
  .get('/:id', async (c) => {
    const key = id.parse(c.req.param('id'));
    const brand = await c.env.DB.prepare('SELECT id FROM brands WHERE id=?')
      .bind(key)
      .first();
    if (!brand) throw new HTTPException(404, { message: 'Brand not found.' });
    const item = await c.env.DB.prepare(
      'SELECT username,enabled,version FROM brand_users WHERE brand_id=?',
    )
      .bind(key)
      .first<{ username: string; enabled: number; version: number }>();
    return c.json({
      item: item
        ? { ...item, enabled: !!item.enabled }
        : { username: '', enabled: true, version: 0 },
    });
  })
  .put('/:id', async (c) => {
    const key = id.parse(c.req.param('id'));
    const input = z
      .object({
        username: loginUsername,
        password: newPassword.optional(),
        enabled: z.boolean(),
        version: z.number().int().min(0),
        currentPassword: z.string().min(1).max(128),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    await confirmAdminPassword(c, input.currentPassword);
    if (
      !(await c.env.DB.prepare('SELECT id FROM brands WHERE id=?')
        .bind(key)
        .first())
    )
      throw new HTTPException(404, { message: 'Brand not found.' });
    const existing = await c.env.DB.prepare(
      'SELECT password_hash AS hash,version FROM brand_users WHERE brand_id=?',
    )
      .bind(key)
      .first<{ hash: string; version: number }>();
    if ((existing?.version ?? 0) !== input.version)
      throw new HTTPException(409, {
        message: 'Brand access changed. Reload access before trying again.',
      });
    if (!existing && !input.password)
      throw new HTTPException(422, {
        message: 'Set a password to create brand access.',
      });
    const hash = input.password
      ? await hashPassword(input.password, c.env.PASSWORD_PEPPER)
      : existing?.hash;
    if (!hash) throw new HTTPException(422, { message: 'Set a password.' });
    const item = existing
      ? await c.env.DB.prepare(
          `UPDATE brand_users SET username=?,password_hash=?,enabled=?,version=version+1,updated_at=? WHERE brand_id=? AND version=? AND NOT EXISTS (SELECT 1 FROM brand_users WHERE username=? AND brand_id<>?) RETURNING username,enabled,version`,
        )
          .bind(
            input.username,
            hash,
            input.enabled ? 1 : 0,
            Date.now(),
            key,
            input.version,
            input.username,
            key,
          )
          .first<{ username: string; enabled: number; version: number }>()
      : await c.env.DB.prepare(
          'INSERT INTO brand_users (brand_id,username,password_hash,enabled,version,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT DO NOTHING RETURNING username,enabled,version',
        )
          .bind(key, input.username, hash, input.enabled ? 1 : 0, Date.now())
          .first<{ username: string; enabled: number; version: number }>();
    if (!item)
      throw new HTTPException(409, {
        message:
          'That username is already assigned, or access changed. Reload access and try again.',
      });
    await c.env.DB.prepare(
      'DELETE FROM brand_sessions WHERE brand_id=? AND version<>?',
    )
      .bind(key, item.version)
      .run();
    return c.json({ item: { ...item, enabled: !!item.enabled } });
  });
