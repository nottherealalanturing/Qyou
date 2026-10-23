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
pnpm db:up                                    # PostgreSQL 17 :5452 (+ qyou_test DB) and Mailpit :1052/:8052
pnpm db:migrate                               # apply/create dev migrations
pnpm db:deploy:test                           # apply migrations to the qyou_test database
```

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

Health: `GET /api/v1/health/live` (process) and `/api/v1/health/ready` (PostgreSQL reachable; 503
when down).

## Checks

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `pnpm format:check` | Prettier                                                           |
| `pnpm lint`         | oxlint, warnings are errors                                        |
| `pnpm typecheck`    | `tsc --noEmit` in both apps (generates Prisma client / Next types) |
| `pnpm test`         | Unit tests (Vitest), no database needed                            |
| `pnpm test:e2e`     | API e2e against the real `qyou_test` database (needs `db:up`)      |
| `pnpm build`        | Production builds                                                  |
| `pnpm check`        | All of the above, in CI order                                      |

## Database & migrations

- Schema: `apps/api/prisma/schema.prisma`; Prisma config: `apps/api/prisma.config.ts`
  (Prisma 7 reads `DATABASE_URL` from env; the config loads `.env` itself).
- Create a migration: edit the schema, then `pnpm --filter @qyou/api exec prisma migrate dev --name <what_changed>`.
- Apply in CI/production: `pnpm db:deploy`. Never run `migrate dev` or `migrate reset` against
  anything but a local database.
- The generated client lives in `apps/api/src/generated/` (git-ignored). It is regenerated
  automatically by `build`, `typecheck`, `test`, `test:e2e`; manually with
  `pnpm --filter @qyou/api db:generate`.
- Reset local data: `pnpm db:down && docker volume rm qyou_qyou_pgdata && pnpm db:up`
  (re-run migrations afterwards; the init script recreates `qyou_test`).

## Environment variables (API)

| Variable            | Default                      | Notes                                                                                                                                            |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`          | `development`                | `production` ⇒ `Secure` `__Host-` cookie, extra validation                                                                                       |
| `PORT`              | `4000`                       |                                                                                                                                                  |
| `CORS_ORIGINS`      | `http://localhost:3000`      | Comma-separated. **Also the CSRF Origin allow-list**; https only in production                                                                   |
| `DATABASE_URL`      | _(required)_                 | `postgresql://…`; startup fails fast if absent                                                                                                   |
| `WEB_BASE_URL`      | `http://localhost:3000`      | Used to build links in emails; https in production                                                                                               |
| `TRUST_PROXY`       | `0`                          | Number of trusted reverse proxies. `1` for local dev (Next proxy) and typical single-proxy deploys. Wrong values break rate limiting / audit IPs |
| `SMTP_HOST`         | _(none)_                     | Required in production. Local: `localhost`                                                                                                       |
| `SMTP_PORT`         | `587`                        | Local Mailpit: `1052`                                                                                                                            |
| `SMTP_SECURE`       | `false`                      | `true` for implicit TLS (port 465)                                                                                                               |
| `SMTP_USER/PASS`    | _(none)_                     | Optional SMTP auth                                                                                                                               |
| `MAIL_FROM`         | `Qyou <no-reply@qyou.local>` |                                                                                                                                                  |
| `TEST_DATABASE_URL` | local `qyou_test`            | Used only by `test:e2e` / `db:deploy:test`                                                                                                       |

The e2e config pins `NODE_ENV`, `CORS_ORIGINS`, `WEB_BASE_URL`, `TRUST_PROXY` so a developer's
local `.env` cannot change what tests exercise.

Web: `API_BASE_URL` (default `http://localhost:4000/api/v1`) — used for the `/api/v1/*` rewrite
(**resolved at `next build` time**, so set it for builds too) and for server-side API calls.

Production notes: terminate TLS in front of both apps; set `TRUST_PROXY` to the real hop count;
the rate limiter is in-memory (single instance only, see D-017); SMTP must be a real provider.

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
- **429 on login/register while testing** — limits are in-memory; restart the API to clear them.
- **Logged-in state lost after API restart** — sessions live in PostgreSQL and survive restarts;
  if it happens, the cookie name changed (`NODE_ENV=production` uses `__Host-qyou_session`).
- **Auth works via curl but the browser gets 403 "Cross-site request blocked"** — the page's
  origin is not in `CORS_ORIGINS`.
- **e2e: "Refusing to truncate non-test database"** — `TEST_DATABASE_URL`/`DATABASE_URL` does not
  point at a database whose name ends in `_test`.
