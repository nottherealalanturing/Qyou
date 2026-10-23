import { defineConfig } from 'vitest/config';

// End-to-end tests run against a real PostgreSQL database (`qyou_test`), never the dev database.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
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
      CORS_ORIGINS: 'http://localhost:3000',
      WEB_BASE_URL: 'http://localhost:3000',
      TRUST_PROXY: '0',
    },
  },
});
