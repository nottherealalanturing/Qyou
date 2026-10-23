import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next's tsconfig uses `jsx: preserve`; tests transform JSX themselves.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { globals: true, include: ['src/**/*.test.{ts,tsx}'] },
});
