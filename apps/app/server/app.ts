import { createDatabase } from '@settlement/database';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

import { authRoutes, requireAdmin } from './auth/routes';
import { catalogRoutes } from './catalog/routes';
import type { AppEnvironment } from './environment';
import { settlementRoutes } from './settlements/routes';
import { paymentRoutes } from './payments/routes';
import { advertisingRoutes } from './advertising/routes';
import { businessRoutes } from './business/routes';
import { fileRoutes } from './files/routes';

export const app = new Hono<AppEnvironment>()
  .use('/api/*', secureHeaders())
  .use(
    '/api/*',
    bodyLimit({
      maxSize: 3_100_000,
      onError: (context) =>
        context.json({ error: 'Request is too large.' }, 413),
    }),
  )
  .use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.set('database', () => createDatabase(context.env.DB));
    await next();
  })
  .use('/api/*', async (context, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
      const origin = context.req.header('Origin');
      if (origin !== new URL(context.req.url).origin)
        throw new HTTPException(403, {
          message: 'Cross-origin requests are not allowed.',
        });
      if (
        !(
          /^\/api\/manage\/files\/(proof|watermark|signature)$/.test(
            context.req.path,
          ) && context.req.method === 'POST'
        ) &&
        !context.req
          .header('Content-Type')
          ?.toLowerCase()
          .startsWith('application/json')
      )
        throw new HTTPException(415, { message: 'Expected JSON request.' });
    }
    await next();
  })
  .get('/api/health', (context) => context.json({ status: 'ok' } as const))
  .route('/api/auth', authRoutes)
  .use('/api/manage/*', requireAdmin)
  .route('/api/manage', catalogRoutes)
  .route('/api/manage/settlements', settlementRoutes)
  .route('/api/manage/payments', paymentRoutes)
  .route('/api/manage/advertising', advertisingRoutes)
  .route('/api/manage/business', businessRoutes)
  .route('/api/manage/files', fileRoutes)
  .notFound((context) => context.json({ error: 'Not found' }, 404))
  .onError((error, context) => {
    if (error instanceof HTTPException)
      return context.json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return context.json(
        { error: error.issues[0]?.message ?? 'Invalid input.' },
        422,
      );
    if (error instanceof SyntaxError)
      return context.json({ error: 'Invalid JSON.' }, 400);
    console.error(
      JSON.stringify({ event: 'request_failed', name: error.name }),
    );
    return context.json({ error: 'Internal server error' }, 500);
  });
