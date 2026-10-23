import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files itself.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment (CI, production).
}

// Migrations must run as the table OWNER (MIGRATION_DATABASE_URL); the running API connects as
// the least-privilege runtime role (DATABASE_URL). With no separate owner URL (e.g. `prisma
// generate`, which never connects) the runtime URL is used.
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('Set MIGRATION_DATABASE_URL (preferred) or DATABASE_URL');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
