import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    cloudflare({
      remoteBindings: false,
      ...(mode === 'test'
        ? {
            persistState: {
              path:
                process.env['SETTLEMENT_TEST_STATE'] ?? '.cloudflare/e2e-state',
            },
            inspectorPort: false,
          }
        : {}),
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: mode === 'test' ? 5174 : 5173,
    strictPort: true,
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022' },
}));
