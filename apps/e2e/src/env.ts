/**
 * Everything the browser suite needs to know about its environment, in one place.
 *
 * Ports are deliberately NOT 3000/4000 so the suite never collides with (or reuses) a developer's
 * own servers. The web build bakes the API address in (see `build:web`), so these must match it.
 */
export const WEB_PORT = 3100;
export const API_PORT = 4100;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api/v1`;

const PORT = process.env.QYOU_DB_PORT ?? '5452';

/** The table-OWNER connection, used only for fixtures and cleanup. */
export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  `postgresql://qyou:qyou_dev_password@localhost:${PORT}/qyou_test?schema=public`;

/** The least-privilege RUNTIME role the API under test connects as, exactly like production. */
export const RUNTIME_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://qyou_runtime:qyou_runtime_dev_password@localhost:${PORT}/qyou_test?schema=public`;

export const PASSWORD = 'correct-horse-battery-staple';
