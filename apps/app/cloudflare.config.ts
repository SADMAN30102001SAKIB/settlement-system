import { bindings, defineConfig } from 'cf/config';

import * as entrypoint from './server/index.ts' with { type: 'cf-worker' };

export default defineConfig(({ mode }) => ({
  worker: {
    name: 'settlement-system',
    entrypoint,
    compatibilityDate: '2026-10-26',
    compatibilityFlags: ['nodejs_compat'],
    assets: {
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api', '/api/*'],
    },
    env: {
      DB: bindings.d1({
        name: 'settlement-system-db',
        // Local migrations require a UUID; this ID is never used for deployment.
        ...(mode === 'development'
          ? { id: '00000000-0000-4000-8000-000000000001' }
          : {}),
      }),
    },
    observability: {
      enabled: true,
      headSamplingRate: 0.01,
      redactQueryString: true,
    },
  },
}));
