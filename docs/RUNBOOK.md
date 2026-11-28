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

Manual auth walkthrough: open `/register` → create an account (you see "Check your email"; registration never signs you in, D-056) → _Log in_ → `/account` → _Log out_
→ `/forgot-password` → open the email in Mailpit → follow the link (token is in the URL
fragment) → choose a new password → `/login`. Each reset link works once and expires in 30 min.

Email verification works the same way: registering sends a verification email (Mailpit); the
link opens `/verify-email#token=…` and verifies automatically. `/account` shows the status and a
resend button.

Health: `GET /api/v1/health/live` (process) and `/api/v1/health/ready` (PostgreSQL reachable; 503
when down).

## Reference data: seed and administration

```bash
pnpm --filter @qyou/api db:seed       # 4 cities, 7 categories, 25 tasks; idempotent, never overwrites; NO venues
```

The seed connects as the **runtime** role (`DATABASE_URL`) and needs the migrations applied first. Running it
again prints `0 … created (already up to date)`. Edits and deactivations made by administrators are preserved.

Everything else is managed through the admin API as a verified administrator (log in first; the examples use
the session cookie and the `Origin` header the browser would send):

```bash
# list categories / cities / locations (all statuses)
curl -b cookies.txt localhost:4000/api/v1/admin/service-categories
# add a REAL venue you have verified (it starts PENDING_REVIEW unless you pass "status":"APPROVED")
curl -b cookies.txt -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -X POST localhost:4000/api/v1/admin/service-locations \
  -d '{"cityId":"<city id>","categoryId":"<category id>","name":"<venue name>","address":"<address>"}'
# approve it (PENDING_REVIEW -> APPROVED), then it appears publicly within ~60 s
curl -b cookies.txt -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -X PATCH localhost:4000/api/v1/admin/service-locations/<id> -d '{"status":"APPROVED"}'
```

Rules to remember: never enter a venue you have not verified (Qyou does not launch with invented businesses);
city, category and slug of a location cannot change (create a new one and archive the old); records are
deactivated or archived, never deleted; a venue's own restrictions can only make a task stricter. Every change
shows up in `audit_logs` (`admin.service_location.updated` etc.). OpenAPI lists all endpoints at `/docs`.
Public reads are cached for 60 s, so a change can take up to a minute to appear.

## Checks

| Command               | What it does                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`   | Prettier                                                                                                                                                                                          |
| `pnpm lint`           | oxlint, warnings are errors                                                                                                                                                                       |
| `pnpm typecheck`      | `tsc --noEmit` in both apps (generates Prisma client / Next types)                                                                                                                                |
| `pnpm test`           | Unit tests (Vitest), no database needed                                                                                                                                                           |
| `pnpm test:e2e`       | API e2e against the real `qyou_test` database (needs `db:up`)                                                                                                                                     |
| `pnpm build`          | Production builds                                                                                                                                                                                 |
| `pnpm verify:headers` | Black-box CSP/security-header check of a **running production web build** (`pnpm --filter @qyou/web build && pnpm --filter @qyou/web start`, then this; covers `/`, `/search` and the auth pages) |
| `pnpm check`          | All of the above, in CI order                                                                                                                                                                     |

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
| `SMS_PROVIDER`            | `dev` (non-prod) / `none` (prod) | `dev` emails the "SMS" to Mailpit labelled SIMULATED; **refused in production**. `none` ⇒ phone verification answers 503 (no code created). No real provider exists yet (D-038)              |
| `PHONE_CODE_PEPPER`       | dev-only constant                | HMAC key for phone codes; **required in production**, ≥ 32 random characters; rotating it invalidates outstanding codes (they last 10 min)                                                   |
| `TEST_DATABASE_URL`       | local `qyou_test` (runtime role) | Used only by `test:e2e`                                                                                                                                                                      |
| `TEST_ADMIN_DATABASE_URL` | local `qyou_test` (owner role)   | Used by `db:deploy:test` and e2e setup (truncation, DB-level assertions)                                                                                                                     |

The e2e config pins `NODE_ENV`, `CORS_ORIGINS`, `WEB_BASE_URL`, `TRUST_PROXY` so a developer's
local `.env` cannot change what tests exercise.

Web: `FORCE_HTTPS=true` (runtime) adds `upgrade-insecure-requests` to the CSP and HSTS — set it only when the site is really served over HTTPS (never for a plain-HTTP local production run). The CSP itself is always on.

Web: `API_BASE_URL` (default `http://localhost:4000/api/v1`) — used for the `/api/v1/*` rewrite
(**resolved at `next build` time**, so set it for builds too) and for server-side API calls.

Production notes: terminate TLS in front of both apps; set `TRUST_PROXY` to the real hop count;
rate limits are PostgreSQL-backed and safe across instances (D-017); SMTP must be a real provider; set `FORCE_HTTPS=true` on the web app; use a non-superuser DB owner and keep its URL out of the API environment.

## Assistant applications: review workflow and local testing

Roles: only an **administrator** (verified email) can review. Nobody can review their own application.

1. Applicant registers, verifies email, opens `/assistant`, starts an application, completes the profile,
   offered tasks, preferred times and private details (legal name, mobile), verifies the mobile
   with the code, and submits.
2. **Local SMS:** with `SMS_PROVIDER=dev` the code is emailed to Mailpit (http://localhost:8052) with a
   "SIMULATED — no SMS was sent" banner. In production there is no delivery path until a provider is approved
   (D-038): the endpoints return 503 and applicants cannot complete phone verification — plan for that
   before opening applications.
3. Admin opens `/admin/assistants`, opens the application (this read is audited), performs the identity check
   **outside Qyou** under your documented procedure, then records only the outcome (Passed / Failed /
   Inconclusive) and an opaque reference. Never paste ID numbers, photos or documents; digit runs of 9+ are
   rejected as a tripwire, not a guarantee.
4. Admin decides (reason of 10+ characters, shown to the applicant): request changes, reject, or approve.
   Approval is refused with a list of blockers unless email + phone are verified, the latest identity outcome is
   Passed, and the profile is complete. Approval grants the `ASSISTANT` role in the same transaction; suspension
   or rejection removes it and hides the public profile immediately (≤ 60 s cache).
5. Evidence: audit rows `admin.assistant.*`, `admin.role_changed`, `assistant.*` in `audit_logs`.

Local reset of assistant test data (owner role; audit rows are append-only, so triggers must be disabled — dev only):
`ALTER TABLE audit_logs DISABLE TRIGGER USER; DELETE FROM … ; ALTER TABLE audit_logs ENABLE TRIGGER USER;`
Never do this against any shared or production database.

## Requests and quotes: local testing and operations (M1.5)

No new environment variables. To exercise the journey locally you need: the reference seed (`pnpm db:seed`), an
administrator (see Administrator bootstrap), at least one **approved** assistant (see the assistant review workflow
above: apply → verify phone via the simulated code in Mailpit → admin records a Passed identity outcome → admin
approves), and a separate verified customer account (a customer cannot be the assistant). Then:

1. Customer: `/assistants` (filter) → profile → **Post a request**, or `/requests/new`.
2. Assistant: `/assistant/requests` shows requests matching what they offer and the cities they serve; open one and
   send a quote. The assistant never sees the customer's identity.
3. Customer: `/requests/<id>` lists quotes (cheapest first). **Accept** one (confirmation step); the rest become
   "not selected". Nothing is charged and there is no booking.
4. Either side can see the result; the customer can cancel (reason required after accepting).

Operational facts: the public assistant list is cached for up to 60 s (API and web), so a newly approved assistant
or a change in what they offer appears within about a minute; requests, quotes and feeds are never cached. Expiry
is computed when a request is read (no job runs): an `OPEN`/`QUOTED` row past `expiresAt` is shown as Expired.
Requests and quotes cannot be deleted by the application (the runtime role has no `DELETE` on them); to clean a
**local** database, as the owner role: `ALTER TABLE quotes DISABLE TRIGGER USER; ALTER TABLE service_requests
DISABLE TRIGGER USER; DELETE FROM quotes; DELETE FROM service_requests; …re-enable both…` — never on a shared database.

## Browser tests (Playwright, M1.5.1)

What it is: `apps/e2e`, Playwright 1.64.0 (version-pinned) driving Chromium against the real API, a production web build
and the dedicated **`qyou_test`** database (D-055). It starts its own servers on **ports 4100 (API) and 3100 (web)**, so it
does not touch a dev server on 3000/4000, and it never reuses a server that is already running.

One-time setup (needs the Postgres container, `pnpm db:up`):

```bash
pnpm install
pnpm db:roles
pnpm db:deploy:test
pnpm e2e:browsers
```

Then, from the repository root:

```bash
pnpm e2e:build
pnpm e2e
```

- `pnpm e2e:build` builds the API (`dist/`) and the web app into `apps/web/.next-e2e` with the test API address baked in
  (Next resolves rewrites at build time). Re-run it after changing API or web code; a stale build is the usual cause of
  "my change isn't tested".
- `pnpm e2e` runs every test. One file: `pnpm --filter @qyou/e2e exec playwright test tests/privacy.spec.ts`; watch it:
  `pnpm --filter @qyou/e2e e2e:headed`; after a failure open the trace: `pnpm --filter @qyou/e2e exec playwright show-trace
apps/e2e/test-results/<test>/trace.zip` (screenshots and an `error-context.md` snapshot are kept there too).
- Data and cleanup: global setup **refuses to run unless both `TEST_ADMIN_DATABASE_URL` and `TEST_DATABASE_URL` point at a
  local host and a database ending in `_test`** (defaults match `docker-compose.yml` on port 5452, or `QYOU_DB_PORT`),
  checks the marketplace tables exist, empties every application table, removes the Next data cache, and seeds one shared
  catalog (City A/B, one category, three tasks, one venue). Each spec creates its own users through the real API (email
  marked verified in the database), onboards assistants through the real review workflow (phone ownership set in the
  database: no SMS), and signs in through the real login form. Teardown empties the database again. Nothing depends on a
  personal account, Mailpit, SMS or any external service. It shares `qyou_test` with `pnpm test:e2e`, so do not run both at once.
- CI: the `browser` job in `.github/workflows/ci.yml` does the same on a Postgres service. **It has not been executed on
  GitHub** (D-032): treat it as configuration until a real run is green.
- Limits: Chromium only; layout is asserted by measurement (no horizontal overflow, controls inside a 375px screen), not
  by pixel comparison; the server clock can't be faked from a browser, so expired requests are inserted already expired.

## Registration behaviour and testing (M1.8, D-056)

`POST /auth/register` answers **202 with the same sentence and no cookie** for every well-formed request, whether the address is
new or already registered, so the only way to know what happened is the inbox (Mailpit locally, `http://localhost:8052`):
a new address gets "Verify your Qyou email address"; an existing active account gets "You already have a Qyou account"
(login and forgot-password links); a suspended account gets nothing. After registering, log in (login works before the
address is verified). Per-address limit: after 3 attempts in an hour for the same address, further attempts are dropped
silently (same 202, no mail, no account) — if a developer "never receives the email", this is why; clear it locally with
`DELETE FROM rate_limit_counters`. Per-IP limit: 10/hour (429). Test helpers: `signUp(api)` (API e2e) registers and logs in;
the browser fixtures do the same through the API.

Commands: `pnpm --filter @qyou/api exec vitest run --config vitest.config.e2e.ts test/registration-privacy.e2e-spec.ts`
(needs the test database), `pnpm --filter @qyou/web test`, and `pnpm e2e` (Playwright; `tests/registration.spec.ts`).

## Running the CI workflow safely (not done yet)

`.github/workflows/ci.yml` (jobs `check` and `browser`) has never executed. Do **not** treat it as passing. Its triggers are
`push` to `main` and `pull_request`. The local branch and `origin/main` (`Qyoue/Qyou`) **share history up to `cf19ac5`**
(an earlier version of this section wrongly called them unrelated). Since then the local branch rebuilt the project and
removed the Stellar-era code, while `origin/main` kept developing that code (31 commits by 2026-11-28), so a merge
conflicts widely (97 conflicts in a trial `git merge-tree` that day). GitHub does not run `pull_request` workflows for a
pull request with merge conflicts. How to reconcile the two lines is an owner/maintainer decision.
Safe options, none performed: (a) push the local branch to a **new, empty private repository** and let CI run on its
`main`; (b) push a topic branch to `origin` and open a draft pull request, and read only the `CI` workflow's `check` and
`browser` jobs; (c) add `workflow_dispatch:` to the workflow (a small, separate change) and run it manually. Expect first-run
differences (Postgres service role setup, `psql` on the runner, Chromium system libraries, ports 3100/4100). Record the
run URL in PROGRESS only after a run actually succeeds.

## Troubleshooting

- **`pnpm e2e`: "Refusing to run: … must point at a local database whose name ends in "\_test""** — the guard in
  `apps/e2e/src/db.ts`; fix `TEST_ADMIN_DATABASE_URL`/`TEST_DATABASE_URL`.
- **`pnpm e2e`: "has no marketplace tables"** — run `pnpm db:roles && pnpm db:deploy:test`.
- **`pnpm e2e`: "http://localhost:3100 is already used" / the API port is** — a previous run is still alive; stop it
  (`lsof -nP -iTCP:3100 -iTCP:4100 -sTCP:LISTEN`). The suite never reuses a running server on purpose.
- **Browser test sees an old UI or a missing city** — rebuild with `pnpm e2e:build`; the web caches the catalog for 60 s
  (global setup clears the cache and seeds the catalog before any page is requested).

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
- **A location I created isn't visible** — it must be `APPROVED`, and its category and city must be active;
  hidden records return 404 exactly like unknown ones. Allow up to 60 s for the public cache.
- **`409` creating a category/city/location** — slug or (case-insensitive) name already exists; slugs are
  immutable, so pick a different one or edit the existing record.
- **`400` saving a task** — the delegation rules: a task needing personal presence or credentials must be
  `NOT_DELEGABLE`; `REQUIRES_AUTHORIZATION` needs `authorizationNotes`; `NOT_DELEGABLE` needs `restrictionNotes`.
- **`409` changing a location's status** — only `PENDING_REVIEW→APPROVED|REJECTED`, `APPROVED→ARCHIVED`,
  `REJECTED→PENDING_REVIEW`, `ARCHIVED→APPROVED` are allowed.
- **Home page shows "We couldn't load the categories"** — the web app can't reach the API (`API_BASE_URL`) or the
  API/DB is down; run `pnpm db:seed` if the API is up but categories are empty.
- **Phone code request returns 503 "unavailable"** — `SMS_PROVIDER=none` (production default). Use `dev` locally;
  production needs an approved provider (D-038).
- **API refuses to start: `SMS_PROVIDER=dev … not allowed in production` / `PHONE_CODE_PEPPER is required`** — set
  `SMS_PROVIDER=none` (or the future provider) and a random ≥ 32-character pepper.
- **Approve returns 409 with blockers** — read the listed requirements (phone, identity outcome, completeness);
  there is no override by design.
- **Applicant cannot edit their application** — it is locked while submitted/under review/rejected/suspended; after
  approval only non-identity fields are editable (D-042).
- **403 "You cannot review your own application"** — another administrator must review it.
- **Posting a request returns 400 on `description`/`constraints`** — it contains an email address, a link or a run of
  nine or more digits (phone/ID-like). Remove it; this is intentional.
- **Posting returns 400 on `taskId`** — the task is inactive, not delegable, or prohibited at the chosen venue;
  tasks that need authorization also need `confirmsAuthorization: true`.
- **409 "You already have 10 active requests"** — cancel one first (expired requests do not count).
- **An assistant gets 404 for a request they expect to see** — they must be fully eligible, offer that exact task,
  serve its city, and the venue (if any) must not prohibit it; the request must be open and unexpired. 404 is
  deliberate for anything an assistant may not see.
- **An assistant gets 403 "ASSISTANT_NOT_ELIGIBLE" on `/assistants/me/requests`** — see `GET /assistants/me/eligibility`
  for the unmet conditions.
- **Customer sees "can't accept" on a quote** — that assistant is no longer eligible (e.g. suspended); choose another
  quote.
- **409 "A quote has already been accepted"** — selection is single-winner; a concurrent second attempt gets this.
