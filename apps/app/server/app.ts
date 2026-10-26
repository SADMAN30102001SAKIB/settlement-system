import { createDatabase } from '@settlement/database';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

interface AppEnvironment {
  Bindings: Env;
  Variables: { database: () => ReturnType<typeof createDatabase> };
}

export const app = new Hono<AppEnvironment>()
  .use('/api/*', secureHeaders())
  .use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.set('database', () => createDatabase(context.env.DB));
    await next();
  })
  .get('/api/health', (context) => context.json({ status: 'ok' } as const))
  .notFound((context) => context.json({ error: 'Not found' }, 404))
  .onError((error, context) => {
    console.error(
      JSON.stringify({ event: 'request_failed', name: error.name }),
    );
    return context.json({ error: 'Internal server error' }, 500);
  });
