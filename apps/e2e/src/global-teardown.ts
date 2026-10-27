import { assertTestDatabase, closeDb, resetDatabase } from './db.js';

/** Leaves the test database empty again so no fixture users or requests outlive the run. */
export default async function globalTeardown(): Promise<void> {
  const name = await assertTestDatabase();
  await resetDatabase();
  await closeDb();
  console.log(`[e2e] emptied test database "${name}" after the run`);
}
