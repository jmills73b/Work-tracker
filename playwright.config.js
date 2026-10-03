import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  // workers: 1, not just fullyParallel: false. The latter only serialises tests within a
  // file; separate files would still get separate workers racing on one local D1.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // A real local Worker and a fresh local D1, never --remote: it cannot touch production
  // and needs no Cloudflare credentials.
  webServer: {
    command:
      'rm -rf .wrangler/state' +
      ' && npx wrangler d1 migrations apply work-tracker --local' +
      ' && npx wrangler dev --local --port 8787',
    url: 'http://localhost:8787/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
