import { bindings, defineConfig } from 'cf/config';

import * as entrypoint from './server/index.ts' with { type: 'cf-worker' };

export default defineConfig(({ mode }) => ({
  accountId: 'fbca92db4dd551f67f6e982d4a70a914',
  worker: {
    name: 'settlement-system',
    ...(mode === 'production' ? { domains: ['settlement.autonovaq.com'] } : {}),
    entrypoint,
    compatibilityDate: '2026-10-26',
    compatibilityFlags: ['nodejs_compat'],
    assets: {
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api', '/api/*'],
    },
    env: {
      ADMIN_SETUP_TOKEN: bindings.secret(),
      FILES: bindings.r2({ name: 'settlement-system-files' }),
      DB: bindings.d1({
        name: 'settlement-system-db',
        // Local migrations require a UUID; this ID is never used for deployment.
        id:
          mode === 'development' || mode === 'test'
            ? '00000000-0000-4000-8000-000000000001'
            : '5ca557a6-85f0-4f81-b9fa-974860e539c2',
      }),
    },
    observability: {
      enabled: true,
      headSamplingRate: 1,
      redactQueryString: true,
    },
  },
}));
