import { Pool } from 'pg';
import { ADMIN_DATABASE_URL, RUNTIME_DATABASE_URL } from './env.js';

let pool: Pool | undefined;

export function db(): Pool {
  pool ??= new Pool({ connectionString: ADMIN_DATABASE_URL, max: 4 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Refuses to touch anything but a dedicated local test database. Both the owner and the runtime
 * connection strings must point at a LOCAL host and a database whose name ends in `_test`, and the
 * server must confirm the same name. Called before any truncation.
 */
export async function assertTestDatabase(): Promise<string> {
  for (const [label, raw] of [
    ['TEST_ADMIN_DATABASE_URL', ADMIN_DATABASE_URL],
    ['TEST_DATABASE_URL', RUNTIME_DATABASE_URL],
  ] as const) {
    const url = new URL(raw);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !name.endsWith('_test')) {
      throw new Error(
        `Refusing to run: ${label} must point at a local database whose name ends in "_test" (got host "${url.hostname}", database "${name}").`,
      );
    }
  }
  const { rows } = await db().query<{ name: string }>('SELECT current_database() AS name');
  const name = rows[0]?.name ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run: connected database "${name}" is not a test database.`);
  }
  const tables = await db().query(`SELECT to_regclass('public.service_requests') AS t`);
  if (!tables.rows[0]?.t) {
    throw new Error(
      `The test database "${name}" has no marketplace tables. Apply migrations first: pnpm db:roles && pnpm db:deploy:test`,
    );
  }
  return name;
}

/**
 * Empties every application table in the (verified) test database. audit_logs is append-only
 * (triggers block TRUNCATE), so the owner disables its user triggers for this one transaction.
 */
export async function resetDatabase(): Promise<void> {
  await assertTestDatabase();
  const client = await db().connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_logs DISABLE TRIGGER USER');
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    await client.query('ALTER TABLE audit_logs ENABLE TRIGGER USER');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The API rate-limits by IP in the database; fixtures register many users from one address. */
export async function resetRateLimits(): Promise<void> {
  await db().query('DELETE FROM rate_limit_counters');
}
