import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env files itself.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment (CI, production).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
