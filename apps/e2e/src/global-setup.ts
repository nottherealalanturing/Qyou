import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertTestDatabase, closeDb, resetDatabase } from './db.js';
import { seedCatalog } from './fixtures.js';
import { CATALOG_FILE } from './state.js';

/**
 * Verifies the target is the dedicated test database, starts every run from an empty one and seeds
 * the ONE shared reference-data catalog. The web app caches the catalog for 60 s (Next data cache,
 * persisted on disk), so it is created once before any page is requested and the cache from earlier
 * runs is discarded; specs add their own users, assistants and requests on top of it.
 */
export default async function globalSetup(): Promise<void> {
  const name = await assertTestDatabase();
  await resetDatabase();
  rmSync(resolve(import.meta.dirname, '../../web/.next-e2e/cache'), {
    recursive: true,
    force: true,
  });
  const catalog = await seedCatalog();
  mkdirSync(dirname(CATALOG_FILE), { recursive: true });
  writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  await closeDb();
  console.log(`[e2e] emptied test database "${name}" and seeded the shared catalog`);
}
