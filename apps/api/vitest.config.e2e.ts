import { defineConfig } from 'vitest/config';

// End-to-end tests run against a real PostgreSQL database (`qyou_test`), never the dev database.
//  - The app under test connects as the least-privilege RUNTIME role (TEST_DATABASE_URL), exactly
//    like production, so permission-related behaviour (e.g. append-only audit_logs) is real.
//  - Test setup (truncation, migrations) uses the OWNER role (TEST_ADMIN_DATABASE_URL).
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://qyou_runtime:qyou_runtime_dev_password@localhost:5452/qyou_test?schema=public';
const testAdminDatabaseUrl =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgresql://qyou:qyou_dev_password@localhost:5452/qyou_test?schema=public';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    // Pinned so a developer's local .env can never change what the tests exercise.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      TEST_ADMIN_DATABASE_URL: testAdminDatabaseUrl,
      CORS_ORIGINS: 'http://localhost:3000',
      WEB_BASE_URL: 'http://localhost:3000',
      TRUST_PROXY: '0',
      SMS_PROVIDER: 'dev',
      PHONE_CODE_PEPPER: 'e2e-only-pepper-0123456789abcdef0123456789',
    },
  },
});
