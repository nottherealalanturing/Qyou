import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, RUNTIME_DATABASE_URL, WEB_PORT, WEB_URL } from './src/env.js';

/**
 * Real-browser end-to-end tests of the marketplace against a real API, web build and PostgreSQL.
 *
 *   pnpm e2e:build    # once, and after code changes: API build + web build for these ports
 *   pnpm e2e          # global setup verifies and empties the TEST database, starts both servers, runs
 *
 * One worker: the suite shares a single test database and an IP-based rate limiter.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './src/global-setup.ts',
  globalTeardown: './src/global-teardown.ts',
  outputDir: './test-results',
  use: {
    baseURL: WEB_URL,
    locale: 'en-GB',
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      command: 'node dist/main.js',
      cwd: '../api',
      url: `${API_URL}/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: RUNTIME_DATABASE_URL,
        CORS_ORIGINS: WEB_URL,
        WEB_BASE_URL: WEB_URL,
        TRUST_PROXY: '0',
        SMS_PROVIDER: 'none',
      },
    },
    {
      name: 'web',
      command: `pnpm exec next start --port ${WEB_PORT}`,
      cwd: '../web',
      url: `${WEB_URL}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        API_BASE_URL: `${API_URL}`,
      },
    },
  ],
});
