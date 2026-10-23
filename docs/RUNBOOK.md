# Qyou — Runbook

## Prerequisites

- Node.js ≥ 22.12 (`.nvmrc` pins 24)
- pnpm 11 (`corepack enable` or `npm i -g pnpm@11`) — **use pnpm, not npm** (see DECISIONS D-002)
- Docker (for local PostgreSQL)

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # already present locally if bootstrapped
cp apps/web/.env.example apps/web/.env.local
pnpm db:up                                    # PostgreSQL 17 :5452 (+ qyou_test DB), Mailpit :1052/:8052
pnpm db:roles                                 # least-privilege runtime role (idempotent; see below)
pnpm db:migrate                               # apply/create dev migrations (as the owner role)
pnpm db:deploy:test                           # apply migrations to qyou_test (as the owner role)
```

**Existing local volume from before M1.2?** The init script that creates the runtime role only
runs on a brand-new volume, so run `pnpm db:roles` once (safe to repeat), then update your
`apps/api/.env` from `.env.example` (`DATABASE_URL` now uses `qyou_runtime`; the owner URL moves to
`MIGRATION_DATABASE_URL`) and run `pnpm db:migrate` / `pnpm db:deploy:test`.

## Run

```bash
pnpm dev            # API :4000 and web :3000 together
pnpm dev:api        # API only      — http://localhost:4000/docs (OpenAPI UI)
pnpm dev:web        # web only      — http://localhost:3000 (/register, /login, /account, /status)
```

Local email: password-reset mail lands in **Mailpit** — inbox UI http://localhost:8052 (API:
`GET http://localhost:8052/api/v1/messages`). Nothing is delivered to real addresses.

Manual auth walkthrough: open `/register` → create an account (you land on `/account`) → _Log out_
→ `/forgot-password` → open the email in Mailpit → follow the link (token is in the URL
fragment) → choose a new password → `/login`. Each reset link works once and expires in 30 min.

Email verification works the same way: registering sends a verification email (Mailpit); the
link opens `/verify-email#token=…` and verifies automatically. `/account` shows the status and a
resend button.

Health: `GET /api/v1/health/live` (process) and `/api/v1/health/ready` (PostgreSQL reachable; 503
when down).

## Checks

| Command               | What it does                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`   | Prettier                                                                                                                                                |
| `pnpm lint`           | oxlint, warnings are errors                                                                                                                             |
| `pnpm typecheck`      | `tsc --noEmit` in both apps (generates Prisma client / Next types)                                                                                      |
| `pnpm test`           | Unit tests (Vitest), no database needed                                                                                                                 |
| `pnpm test:e2e`       | API e2e against the real `qyou_test` database (needs `db:up`)                                                                                           |
| `pnpm build`          | Production builds                                                                                                                                       |
| `pnpm verify:headers` | Black-box CSP/security-header check of a **running production web build** (`pnpm --filter @qyou/web build && pnpm --filter @qyou/web start`, then this) |
| `pnpm check`          | All of the above, in CI order                                                                                                                           |

## Database & migrations

- Schema: `apps/api/prisma/schema.prisma`; Prisma config: `apps/api/prisma.config.ts`
  (Prisma 7; the config loads `.env` itself and uses `MIGRATION_DATABASE_URL`, falling back to
  `DATABASE_URL`).
- **Two database identities (D-029).** Migrations run as the table **owner**
  (`MIGRATION_DATABASE_URL`, local `qyou`); the API and e2e tests connect as the least-privilege
  **runtime** role (`DATABASE_URL`, local `qyou_runtime`). The runtime role cannot alter tables,
  disable triggers, or UPDATE/DELETE/TRUNCATE `audit_logs`. In a deployed environment never put the owner URL into the
  running API's environment (locally `.env` holds both for convenience; the API ignores it).
- Create a migration: edit the schema, then
  `pnpm --filter @qyou/api exec prisma migrate dev --name <what_changed>` (as owner). Hand-written
  SQL migrations (grants, triggers) are fine; new append-only tables must `REVOKE` and add
  triggers in their own migration (default privileges grant normal DML to the runtime role).
- Apply in CI/production: `pnpm db:deploy` with the owner URL. Never run `migrate dev` or
  `migrate reset` against anything but a local database.
- The generated client lives in `apps/api/src/generated/` (git-ignored). It is regenerated
  automatically by `build`, `typecheck`, `test`, `test:e2e`; manually with
  `pnpm --filter @qyou/api db:generate`.
- Reset local data: `pnpm db:down && docker volume rm qyou_qyou_pgdata && pnpm db:up`
  (re-run migrations afterwards; the init scripts recreate `qyou_test` and the roles).
- Emptying tables locally (tests do this): `audit_logs` rejects TRUNCATE/DELETE for everyone, so as
  the owner wrap it: `BEGIN; ALTER TABLE audit_logs DISABLE TRIGGER USER; TRUNCATE …; ALTER TABLE
audit_logs ENABLE TRIGGER USER; COMMIT;`. Never do this outside a local/test database.

### Production database roles (template)

Run once per cluster as a database administrator; use a real secret and keep it in your secret
manager. The owner should be a **non-superuser** role that only your migration tooling can use.

```sql
CREATE ROLE qyou_app NOLOGIN;
CREATE ROLE qyou_runtime LOGIN PASSWORD '<secret from your secret manager>' IN ROLE qyou_app
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- then run `prisma migrate deploy` as the owner: it grants qyou_app its table privileges
-- and installs the audit_logs triggers.
```

## Administrator bootstrap

The only way to create an administrator (there is no HTTP path). The operator never supplies a
password: the administrator receives a one-time, 24 h set-password link by email.

```bash
# 1. Dry run: prints what would happen, changes nothing (exit code 2).
pnpm --filter @qyou/api admin:create --email you@company.com --name "Your Name"

# 2. Do it.
pnpm --filter @qyou/api admin:create --email you@company.com --name "Your Name" --yes
```

Requirements: the API environment (`DATABASE_URL` as the **runtime** role, `SMTP_*`, `WEB_BASE_URL`)
and the code built (`admin:create` builds first). The administrator then opens the emailed link,
chooses a password, and logs in; their email is already verified.

| Exit code | Meaning                                    |
| --------- | ------------------------------------------ |
| 0         | Created (check the "email sent" line)      |
| 1         | Refused or failed; **nothing was changed** |
| 2         | Dry run (no `--yes`)                       |
| 64        | Bad usage                                  |

Safety behaviour: refuses if any administrator exists (add `--additional` to create another);
refuses if the email already belongs to **any** account (existing accounts are never promoted —
use a different address); concurrent runs are serialised, so at most one succeeds. Every creation
is audited as `admin.bootstrap` (with the operating-system username). Granting `ADMIN` over HTTP is
impossible by design.

Recovery: if the output says the email could not be sent, the account still exists — have the
administrator use **Forgot password** on the login page. If the invite expired, same. If the only
administrator is locked out of their mailbox, a database operator must intervene (by design).

## Environment variables (API)

| Variable                  | Default                          | Notes                                                                                                                                                                                        |
| ------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`                    | `production` ⇒ `Secure` `__Host-` cookie, extra validation                                                                                                                                   |
| `PORT`                    | `4000`                           |                                                                                                                                                                                              |
| `CORS_ORIGINS`            | `http://localhost:3000`          | Comma-separated. **Also the CSRF Origin allow-list**; https only in production                                                                                                               |
| `DATABASE_URL`            | _(required)_                     | `postgresql://…` as the **runtime** role; startup fails fast if absent                                                                                                                       |
| `MIGRATION_DATABASE_URL`  | _(optional)_                     | Owner role for the Prisma CLI only (`migrate`, `generate`). **Not read by the API.** Locally it shares `.env` for convenience; in a deployed environment the API process must not receive it |
| `WEB_BASE_URL`            | `http://localhost:3000`          | Used to build links in emails; https in production                                                                                                                                           |
| `TRUST_PROXY`             | `0`                              | Number of trusted reverse proxies. `1` for local dev (Next proxy) and typical single-proxy deploys. Wrong values break rate limiting / audit IPs                                             |
| `SMTP_HOST`               | _(none)_                         | Required in production. Local: `localhost`                                                                                                                                                   |
| `SMTP_PORT`               | `587`                            | Local Mailpit: `1052`                                                                                                                                                                        |
| `SMTP_SECURE`             | `false`                          | `true` for implicit TLS (port 465)                                                                                                                                                           |
| `SMTP_USER/PASS`          | _(none)_                         | Optional SMTP auth                                                                                                                                                                           |
| `MAIL_FROM`               | `Qyou <no-reply@qyou.local>`     |                                                                                                                                                                                              |
| `TEST_DATABASE_URL`       | local `qyou_test` (runtime role) | Used only by `test:e2e`                                                                                                                                                                      |
| `TEST_ADMIN_DATABASE_URL` | local `qyou_test` (owner role)   | Used by `db:deploy:test` and e2e setup (truncation, DB-level assertions)                                                                                                                     |

The e2e config pins `NODE_ENV`, `CORS_ORIGINS`, `WEB_BASE_URL`, `TRUST_PROXY` so a developer's
local `.env` cannot change what tests exercise.

Web: `FORCE_HTTPS=true` (runtime) adds `upgrade-insecure-requests` to the CSP and HSTS — set it only when the site is really served over HTTPS (never for a plain-HTTP local production run). The CSP itself is always on.

Web: `API_BASE_URL` (default `http://localhost:4000/api/v1`) — used for the `/api/v1/*` rewrite
(**resolved at `next build` time**, so set it for builds too) and for server-side API calls.

Production notes: terminate TLS in front of both apps; set `TRUST_PROXY` to the real hop count;
rate limits are PostgreSQL-backed and safe across instances (D-017); SMTP must be a real provider; set `FORCE_HTTPS=true` on the web app; use a non-superuser DB owner and keep its URL out of the API environment.

## Troubleshooting

- **`npm install` fails with `Cannot read properties of null (reading 'edgesOut')`** — npm 11.5.1
  bug on this machine; use pnpm.
- **`ERR_PNPM_IGNORED_BUILDS`** — a dependency needs lifecycle scripts; decide allow/deny in
  `pnpm-workspace.yaml` → `allowBuilds`.
- **Port 5452 in use** — set `QYOU_DB_PORT` before `pnpm db:up` and update `DATABASE_URL`.
- **API exits with "Invalid environment configuration"** — the message lists each bad variable.
- **`/status` shows API Unreachable** — start the API (`pnpm dev:api`) and check `API_BASE_URL`.
- **e2e: connection refused** — `pnpm db:up` and `pnpm db:deploy:test`.
- **Reset link says "invalid or has expired" straight away** — links are single-use and last 30
  minutes; requesting a new one invalidates older ones. Pasting a `…#token=…` URL while already on
  `/reset-password` only changes the fragment (no reload): open it in a new tab.
- **429 on login/register while testing** — limits live in PostgreSQL and survive restarts; wait for the window (see `Retry-After`) or clear `rate_limit_counters` locally.
- **Logged-in state lost after API restart** — sessions live in PostgreSQL and survive restarts;
  if it happens, the cookie name changed (`NODE_ENV=production` uses `__Host-qyou_session`).
- **Auth works via curl but the browser gets 403 "Cross-site request blocked"** — the page's
  origin is not in `CORS_ORIGINS`.
- **e2e: "Refusing to truncate non-test database"** — `TEST_DATABASE_URL`/`DATABASE_URL` does not
  point at a database whose name ends in `_test`.
- **`permission denied for table audit_logs` / `audit_logs is append-only`** — working as designed:
  nothing (the API, the owner) may update or delete audit rows. Only INSERT/SELECT. See
  ARCHITECTURE → Audit-log integrity.
- **`must be owner of table …` when migrating** — you ran Prisma with the runtime URL. Use
  `MIGRATION_DATABASE_URL` (owner).
- **`role "qyou_runtime" does not exist` / API can't connect after pulling M1.2** — run
  `pnpm db:roles`, then update `apps/api/.env` from `.env.example`.
- **e2e: `TEST_ADMIN_DATABASE_URL is not set`** — run e2e through `pnpm test:e2e`, which loads
  the pinned test environment (`vitest.config.e2e.ts`).
- **Browser console shows CSP violations in `next dev`** — dev relaxes only styles/eval (see
  ARCHITECTURE → CSP). Violations in a _production_ build are bugs: run `pnpm verify:headers`
  against `next start`.
- **Verification link says invalid** — links are single-use, last 24 h, and a newer request
  invalidates older links; log in and use _Send verification email_ on `/account`.
- **Rate limits** are stored in PostgreSQL (`rate_limit_counters`), so restarting the API does not
  clear them. To clear locally: `DELETE FROM rate_limit_counters` (as any role with DML).
