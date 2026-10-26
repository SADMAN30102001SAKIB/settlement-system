import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '.cloudflare/e2e-results',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command:
      'pnpm exec cf d1 migrations apply 00000000-0000-4000-8000-000000000001 --mode development --local --persist-to .cloudflare/e2e-state --dir ../../packages/database/migrations && pnpm exec cf dev --mode test',
    url: 'http://127.0.0.1:5174/api/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      ADMIN_SETUP_TOKEN: 'browser-test-only-setup-token-never-for-production',
      CF_SEND_TELEMETRY: 'false',
    },
  },
});
