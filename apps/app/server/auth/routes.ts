import {
  admins,
  loginAttempts,
  sessions,
  settings,
} from '@settlement/database/schema';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { AppEnvironment } from '../environment';
import { newPassword, loginUsername } from '../../shared/access';
import { confirmAdminPassword } from './security';
import {
  digest,
  hashPassword,
  randomToken,
  secretMatches,
  verifyPassword,
} from './crypto';

const COOKIE = 'hexa_session';
const SESSION_SECONDS = 60 * 60 * 12;
const WINDOW = 15 * 60 * 1000;
const credentials = z
  .object({
    username: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

function sessionCookie(context: Context<AppEnvironment>, token: string) {
  setCookie(context, COOKIE, token, {
    httpOnly: true,
    secure: new URL(context.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

export const requireAdmin = createMiddleware<AppEnvironment>(
  async (context, next) => {
    const token = getCookie(context, COOKIE);
    if (token === undefined || !/^[a-f0-9]{64}$/.test(token))
      throw new HTTPException(401, { message: 'Please sign in.' });
    const database = context.get('database')();
    const [session] = await database
      .select({ username: admins.username })
      .from(sessions)
      .innerJoin(admins, eq(admins.id, sessions.adminId))
      .where(
        and(
          eq(sessions.tokenHash, await digest(token)),
          eq(sessions.authVersion, admins.authVersion),
          gt(sessions.expiresAt, Date.now()),
        ),
      )
      .limit(1);
    if (session === undefined)
      throw new HTTPException(401, {
        message: 'Session expired. Please sign in again.',
      });
    context.set('username', session.username);
    await next();
  },
);

export const authRoutes = new Hono<AppEnvironment>()
  .get('/status', async (context) => {
    const [admin] = await context
      .get('database')()
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.id, 1))
      .limit(1);
    const token = getCookie(context, COOKIE);
    let username: string | null = null;
    if (token !== undefined && /^[a-f0-9]{64}$/.test(token)) {
      const [session] = await context
        .get('database')()
        .select({ username: admins.username })
        .from(sessions)
        .innerJoin(admins, eq(admins.id, sessions.adminId))
        .where(
          and(
            eq(sessions.tokenHash, await digest(token)),
            eq(sessions.authVersion, admins.authVersion),
            gt(sessions.expiresAt, Date.now()),
          ),
        )
        .limit(1);
      username = session?.username ?? null;
    }
    return context.json({ initialized: admin !== undefined, username });
  })
  .post('/setup', async (context) => {
    const input = credentials
      .extend({
        password: z.string().min(15).max(128),
        setupToken: z.string().min(32).max(256),
      })
      .parse(await context.req.json<unknown>());
    const expected = context.env.ADMIN_SETUP_TOKEN;
    if (
      typeof expected !== 'string' ||
      expected.length < 32 ||
      expected.startsWith('replace-with-')
    ) {
      throw new HTTPException(503, {
        message:
          'Admin setup is not configured. Set ADMIN_SETUP_TOKEN before creating the admin account.',
      });
    }
    if (!(await secretMatches(input.setupToken, expected))) {
      throw new HTTPException(403, { message: 'Invalid setup token.' });
    }
    const database = context.get('database')();
    const [existing] = await database
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.id, 1))
      .limit(1);
    if (existing !== undefined)
      throw new HTTPException(409, {
        message: 'The admin account already exists.',
      });
    const passwordHash = await hashPassword(
      input.password,
      context.env.PASSWORD_PEPPER,
    );
    const [insertedAdmins] = await database.batch([
      database
        .insert(admins)
        .values({
          id: 1,
          username: input.username,
          passwordHash,
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: admins.id })
        .returning({ id: admins.id }),
      database
        .insert(settings)
        .values({ id: 1, updatedAt: Date.now() })
        .onConflictDoNothing(),
    ]);
    const inserted = insertedAdmins[0];
    if (inserted === undefined)
      throw new HTTPException(409, {
        message: 'The admin account already exists.',
      });
    return context.json({ ok: true }, 201);
  })
  .post('/login', async (context) => {
    const input = credentials.parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const now = Date.now();
    const key = await digest(context.req.header('CF-Connecting-IP') ?? 'local');
    const [attempt] = await database
      .select({
        failures: loginAttempts.failures,
        window: loginAttempts.windowStartedAt,
      })
      .from(loginAttempts)
      .where(eq(loginAttempts.key, key))
      .limit(1);
    if (
      attempt !== undefined &&
      attempt.window > now - WINDOW &&
      attempt.failures >= 5
    ) {
      throw new HTTPException(429, {
        message: 'Too many sign-in attempts. Try again in 15 minutes.',
      });
    }
    const [admin] = await database
      .select({
        username: admins.username,
        hash: admins.passwordHash,
        version: admins.authVersion,
      })
      .from(admins)
      .where(eq(admins.id, 1))
      .limit(1);
    if (admin === undefined)
      throw new HTTPException(403, {
        message: 'An administrator must set up this installation first.',
      });
    const validPassword = await verifyPassword(
      input.password,
      admin.hash,
      context.env.PASSWORD_PEPPER,
    );
    if (
      !validPassword ||
      !(await secretMatches(input.username, admin.username))
    ) {
      await database
        .insert(loginAttempts)
        .values({ key, failures: 1, windowStartedAt: now })
        .onConflictDoUpdate({
          target: loginAttempts.key,
          set: {
            failures: sql`CASE WHEN ${loginAttempts.windowStartedAt} < ${now - WINDOW} THEN 1 ELSE ${loginAttempts.failures} + 1 END`,
            windowStartedAt: sql`CASE WHEN ${loginAttempts.windowStartedAt} < ${now - WINDOW} THEN ${now} ELSE ${loginAttempts.windowStartedAt} END`,
          },
        });
      throw new HTTPException(401, {
        message: 'Incorrect username or password.',
      });
    }
    const token = randomToken();
    await database.batch([
      database.delete(loginAttempts).where(eq(loginAttempts.key, key)),
      database.delete(sessions).where(lt(sessions.expiresAt, now)),
      database.insert(sessions).values({
        tokenHash: await digest(token),
        adminId: 1,
        authVersion: admin.version,
        expiresAt: now + SESSION_SECONDS * 1000,
        createdAt: now,
      }),
    ]);
    sessionCookie(context, token);
    return context.json({ username: admin.username });
  })
  .get('/account', requireAdmin, async (c) => {
    const item = await c.env.DB.prepare(
      'SELECT username,auth_version AS version FROM admins WHERE id=1',
    ).first();
    return c.json({ item });
  })
  .put('/account', requireAdmin, async (c) => {
    const input = z
      .object({
        username: loginUsername,
        currentPassword: z.string().min(1).max(128),
        password: newPassword.optional(),
        version: z.number().int().min(0),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const admin = await confirmAdminPassword(c, input.currentPassword);
    if (admin.version !== input.version)
      throw new HTTPException(409, {
        message: 'Your account changed. Reload this page before trying again.',
      });
    const hash = input.password
      ? await hashPassword(input.password, c.env.PASSWORD_PEPPER)
      : admin.hash;
    const item = await c.env.DB.prepare(
      'UPDATE admins SET username=?,password_hash=?,auth_version=auth_version+1 WHERE id=1 AND auth_version=? AND password_hash=? RETURNING username,auth_version AS version',
    )
      .bind(input.username, hash, admin.version, admin.hash)
      .first<{ username: string; version: number }>();
    if (!item)
      throw new HTTPException(409, {
        message: 'Your account changed. Sign in again before trying again.',
      });
    const token = randomToken(),
      now = Date.now();
    await c
      .get('database')()
      .insert(sessions)
      .values({
        tokenHash: await digest(token),
        adminId: 1,
        authVersion: item.version,
        createdAt: now,
        expiresAt: now + SESSION_SECONDS * 1000,
      });
    sessionCookie(c, token);
    return c.json({ item });
  })
  .get('/me', requireAdmin, (context) =>
    context.json({ username: context.get('username') }),
  )
  .post('/logout', requireAdmin, async (context) => {
    const token = getCookie(context, COOKIE);
    if (token !== undefined)
      await context
        .get('database')()
        .delete(sessions)
        .where(eq(sessions.tokenHash, await digest(token)));
    deleteCookie(context, COOKIE, { path: '/' });
    return context.json({ ok: true });
  });
