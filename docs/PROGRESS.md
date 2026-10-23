# Qyou — Progress

_Last updated: 2026-10-23 (end of M1.2 session)._ The code is authoritative; if this file looks
stale, verify against the repository and reconcile.

## Current state

**Phase 0, M1.1 and M1.2 complete.** Commit `5f4699d` holds Phase 0 + M1.1. **All M1.2 work is
uncommitted in the working tree** (commits/pushes need explicit user authorisation). One tracked
file was deliberately deleted: `apps/api/src/common/rate-limit/rate-limiter.spec.ts` (the
in-memory limiter it tested was replaced; the PostgreSQL limiter has `test/rate-limiter.e2e-spec.ts`).

## Completed in M1.2 — authorization and account security

- **Authorization:** global guards in a fixed, tested order (CSRF → session → `@Roles` →
  `@RequireVerifiedEmail`); fail-closed on `@Public`+`@Roles`; roles/verification read from the DB
  per request; resource-ownership pattern (query-scoped, 404 for "not yours") with sessions as the
  worked example; test-only `ProbeController` for decorator combinations.
- **Role model / admin:** `CUSTOMER` is the only self-service role; `PATCH /admin/users/:id/role`
  (admin + verified; never ADMIN, never self/another admin; verified target for privileged roles;
  audited); **CLI-only administrator bootstrap** (`admin:create`) that never handles a password
  (emails a 24 h set-password link), dry-run by default, fail-closed, never promotes accounts.
- **Email verification:** single-use 24 h hash-only tokens bound to the address; sent on
  registration; authenticated resend (3/h/user); public idempotent concurrency-safe confirm;
  reset completion also verifies; policy documented in ARCHITECTURE.md.
- **Password/session management:** change password (current password required, 5 wrong/15 min
  limit, optimistic concurrency, **rotates the current session, revokes all others**), log out
  everywhere, session list + revoke-own API.
- **Audit-log integrity:** least-privilege runtime role (`qyou_runtime` ∈ `qyou_app`:
  INSERT/SELECT only on `audit_logs`) + triggers blocking UPDATE/DELETE/TRUNCATE for every role
  including the owner; no FK from `audit_logs` to users; threat model and limits documented.
- **Rate limiter:** replaced the in-memory limiter with a PostgreSQL-backed one (shared across
  instances, restart-proof, hashed keys).
- **Web:** `/verify-email`, account page sections (verification status/resend, change password,
  log out / log out of all devices), nonce-based **Content Security Policy** via `proxy.ts`,
  `pnpm verify:headers`.
- **Migrations:** `20261023214807_account_security` (emailVerifiedAt, `email_verification_tokens`,
  `rate_limit_counters`, drop audit FK) and `20261023214900_audit_log_immutability` (grants,
  triggers; hand-written).
- **Infra/docs:** `docker/dev-db-roles.sql`, `pnpm db:roles`, `MIGRATION_DATABASE_URL` /
  `TEST_ADMIN_DATABASE_URL`, CI updated; ARCHITECTURE, DECISIONS (D-017/D-020/D-021/D-022 revised,
  D-024…D-032 added), ROADMAP (deferrals table), RUNBOOK (roles, bootstrap, troubleshooting).

## Latest checks (2026-10-23, clean state: node_modules/generated client/dist/.next deleted, `pnpm install --frozen-lockfile`, `pnpm db:roles`, `pnpm db:deploy:test`, then `pnpm check`)

| Check                                                           | Result                      |
| --------------------------------------------------------------- | --------------------------- |
| `pnpm check` (format, lint, typecheck, test, test:e2e, build)   | **exit 0**                  |
| API unit tests (Vitest)                                         | 33 passed (7 files)         |
| API e2e on real PostgreSQL `qyou_test`, as the **runtime role** | 176 passed (11 files)       |
| Web unit + jsdom component tests                                | 53 passed (9 files)         |
| `pnpm lint` (`--deny-warnings`)                                 | clean                       |
| Web production build (includes `Proxy` for CSP)                 | compiled; all pages dynamic |

e2e coverage added in M1.2: anonymous access to every protected route; role matrix
(customer/assistant/business/admin) on probe routes; stale-privilege check; verified-email policy;
escalation attempts (registration role, role fields on other endpoints, nonexistent profile-update
routes, customer/assistant/business → admin API, self-promotion, no HTTP route to ADMIN);
admin role assignment rules + concurrency; session ownership (404 for others); email-verification
lifecycle (invalid/expired/reused/superseded/changed-address/concurrent ×8, resend limits, mail
failure, never in logs); change password (rotation, revocation of all other sessions, wrong
current, lockout, concurrent ×5, CSRF); log out everywhere; admin bootstrap (unusable password,
invite flow, repeat/additional/existing-email refusals, invalid input, concurrent ×6, mail
failure, no HTTP path); **audit immutability against the real DB** (runtime role: UPDATE/DELETE/
TRUNCATE denied via SQL and ORM, cannot ALTER/DROP/disable triggers/SET ROLE, GRANT is a no-op;
owner: triggers reject UPDATE/DELETE/TRUNCATE; user deletion leaves audit rows; no FK);
rate limiter (atomic under concurrency, **one shared limit across three independent connection
pools**, survives restart, hashed keys, window rollover). All M1.1 regression suites still pass.

Runtime verification beyond the suites (all actually performed):

- **Fresh cluster:** all 4 migrations applied to a brand-new throwaway Postgres container with no
  roles (group role created by the migration; re-run idempotent); also applied to the dev DB (via
  `migrate dev`, which replays them in a shadow DB) and a recreated `qyou_test`.
- **Admin CLI against the dev DB + Mailpit:** usage (exit 64), dry run (2), invalid input (1),
  create (0, email delivered), repeat (1, refused), different email (1, refused), existing
  customer with `--additional` (1, refused, not promoted). Then over HTTP: guess-login 401 →
  set password via the emailed link → admin login → assigned ASSISTANT to a verified user →
  granting ADMIN rejected (400) → anonymous 401. In the dev DB the runtime role got
  `permission denied` on UPDATE/DELETE of `audit_logs` and the owner got the trigger's
  `append-only` error.
- **Browser, production build (`next start`) + API + Mailpit:** CSP present, every `<script>`
  nonce'd, React hydrated, console clean; register → unverified banner → emailed link →
  `/verify-email` verified (fragment stripped) → account shows verified; wrong current password
  shows the server's field error; change password succeeds, a second device session got 401
  while this browser stayed signed in; "Log out of all devices" → `/login`, DB showed 0 active
  sessions, audit rows for each step.
- **Browser, dev server (`next dev`):** no new console violations after the dev-only style relaxation
  (see D-030); hydration works.
- `pnpm verify:headers` passed against the production build (6 pages) and **fails** against a
  server without the policy (negative check).

### Defects found and fixed during this milestone

1. `GRANT` by a non-owner is a no-op (PostgreSQL only warns), not an error → test now asserts the
   privileges are unchanged instead of expecting an exception.
2. Migration used `REVOKE … _prisma_migrations` unconditionally, which fails in Prisma's shadow
   database (table absent there) → guarded.
3. `pg_advisory_xact_lock` returns `void`, which `$queryRaw` cannot deserialize → `$executeRaw`.
4. The Next dev tooling injects un-nonced `<style>` elements (empty-string-hash CSP violations) →
   dev-only `style-src 'unsafe-inline'`; production stays nonce-only and is verified separately.
5. Existing tests assumed registration sends no mail / `/me` has no `emailVerified` → updated
   deliberately, not loosened.

## Known issues / limitations (remaining risks)

- **CI has never been run.** The workflow was updated and its YAML parses, and every step was run
  locally, but a real GitHub Actions run has not happened (D-032).
- **No browser automation suite** (D-031): browser flows were verified manually; planned M1.7.
- **Mail is fire-and-forget** (D-020): a transient SMTP failure loses that email; resend exists for
  verification and reset; the outbox is deferred because it would store raw tokens.
- **Registration reveals duplicate emails (409)** (D-021): re-reviewed, deferred with rationale.
- **Audit integrity limits:** a database owner/superuser can still disable the triggers; a
  compromised API can still INSERT false rows; no hash chain/off-box shipping yet (Phase 6).
- **Local owner role is a superuser** (Docker image default); production must use a non-superuser
  owner and keep its URL out of the API (D-029).
- **Rate limiter** uses fixed windows (up to 2× burst at a boundary) and adds a DB round-trip per
  limited request; fails closed if the DB is down (D-017).
- **CSP:** dev uses `unsafe-eval` + `style-src 'unsafe-inline'`; no reporting endpoint, no Trusted
  Types; every page must stay dynamic for nonces; `FORCE_HTTPS` must be set when served over HTTPS.
- Roles: one role per account (D-025); no suspension endpoint yet (status can only be set in the
  DB; suspended users are rejected on every request); no UI for the sessions list (API exists).
- An administrator who loses their mailbox needs a database operator (by design).
- No 2FA, no login-alert emails, no Argon2 rehash-on-login, no email-change feature.
- OpenAPI documents request bodies but not response schemas.
- npm is unusable on this machine for this tree (D-002); use pnpm. Mailpit uses the `latest` tag.

## Next action (exact)

**M1.3 — Service categories, eligible tasks and service locations** (see ROADMAP.md), as a small
vertical slice:

1. Decide the minimal real reference data (owner input welcome: initial categories and which
   Nigerian cities/venue types to seed first; do **not** invent fake businesses or live queue data).
2. Schema + migration (grants follow the new default-privilege rules): `ServiceCategory`,
   `EligibleTask` (with explicit venue-specific restrictions per category/location — the
   "prohibited/delegable" rules from PRODUCT.md), `ServiceLocation` (name, type, city, coordinates,
   source/verification status).
3. Public read API (`@Public`, cached, paginated) for categories/tasks/locations with search by
   city/type; admin-only write endpoints using `@AdminOnly()` and audited.
4. Seed script that loads clearly-labelled real reference data only.
5. e2e tests on the real DB (public reads, admin-only writes, validation, restrictions), web pages
   deferred to M1.6 unless trivially needed.
6. Run the full `pnpm check`, update docs.

Then M1.4 (assistant profile, onboarding, verification) which will call the M1.2 role-assignment
service on approval.

## Decisions awaiting the owner (do not decide silently)

- **D-012 (deferred by owner 2026-10-23):** payment provider, commission %, fees, cancellation and
  refund policy, payout automation — required before any real payment implementation (Phase 2).
- Whether to prioritise enumeration-safe registration (D-021) before launch, or accept the
  rate-limited 409 for the first release.
