# Qyou — Progress

_Last updated: 2026-10-23 (end of M1.1 session)._ The code is authoritative; if this file looks
stale, verify against the repository and reconcile.

## Current state

**Phase 0 complete. Phase 1 milestone M1.1 (customer authentication) complete.**
Nothing is committed (commits/pushes need explicit user authorisation); all work is in the
working tree. Six obsolete workflow files are deleted and staged (`git rm`); everything else is
untracked or modified.

## Completed

### Phase 0 (see ROADMAP.md) — monorepo, NestJS API, Next.js web, Prisma/PostgreSQL, CI, docs.

### M1.1 — Customer authentication

- **Schema (migration `20261023190714_auth_foundation`)**: `users` gains `name`, `passwordHash`,
  `status` (`UserStatus`: ACTIVE/SUSPENDED); new tables `sessions`, `password_reset_tokens`,
  `audit_logs` (token columns are SHA-256 hashes, `CHAR(64)`, unique). The two new `NOT NULL`
  user columns have no default, which is only valid because `users` was empty everywhere
  (Phase 0 was never deployed). Do not reuse that pattern on a populated table.
- **API** (`/api/v1/auth`): `register`, `login`, `logout`, `me`, `password-reset/request`,
  `password-reset/confirm`. Argon2id, DB-backed opaque sessions, rotation, expiry (30 d absolute,
  7 d idle), revocation, CSRF Origin check, rate limits, audit log, global default-deny auth guard
  (`@Public()` opt-out), global zod validation, 16 KiB body limit, generic error filter.
  Full design: ARCHITECTURE.md → "Authentication".
- **Mail**: `MailService` + SMTP/nodemailer; Mailpit added to `docker-compose.yml`
  (SMTP `localhost:1052`, UI `http://localhost:8052`); `pnpm db:up` starts it.
- **Web**: `/register`, `/login`, `/forgot-password`, `/reset-password`, `/account` (protected),
  session-aware header, shared `Button`/`TextField`/`Alert`/`PasswordField` primitives with
  accessible validation (aria-invalid/describedby, focus on first error, live alerts), loading
  and success/error states, mobile-responsive; Next proxies `/api/v1/*` to the API (D-018).
- **Docs**: ARCHITECTURE, DECISIONS (D-011 accepted; D-015…D-023 added; D-012 deferred by owner),
  ROADMAP, RUNBOOK, this file.

## Latest checks (2026-10-23, from a clean state: node_modules/generated client/dist/.next deleted, `pnpm install --frozen-lockfile`)

| Check                                                                    | Result              |
| ------------------------------------------------------------------------ | ------------------- |
| `pnpm check` (format, lint, typecheck, test, test:e2e, build)            | **exit 0**          |
| API unit tests (Vitest)                                                  | 38 passed (7 files) |
| API e2e on real PostgreSQL `qyou_test` (supertest against live listener) | 75 passed (5 files) |
| Web unit + jsdom component tests                                         | 33 passed (5 files) |
| `pnpm lint` (`--deny-warnings`)                                          | clean               |

Runtime verification beyond the test suites:

- **Browser (Next dev server + API + Mailpit), desktop and 375 px mobile**: empty-form validation
  (focus moves to first invalid field) → register → lands on protected `/account` →
  `document.cookie` empty (HttpOnly) → log out → `/account` redirects to
  `/login?next=/account` → forgot-password → loading + success states → email appeared in Mailpit
  → link opened (token stripped from the address bar) → new password set → old password rejected
  with the generic error → new password logs in. Audit rows for each step confirmed in
  PostgreSQL; consumed token reuse → 400; foreign-Origin login → 403; no-cookie `/me` → 401.
- **Production-mode API build**: fails fast without `SMTP_HOST`; issues
  `__Host-qyou_session; Path=/; HttpOnly; Secure; SameSite=Lax` (no `Domain`); rejects `http://`
  Origin. Next proxy forwards `Set-Cookie`, `Origin` and the real client IP (audit row showed the
  client IP, not the proxy's).
- Server logs grepped after the browser session: no passwords, tokens or hashes.
- Web UI flows were exercised on the **dev** server; the production web build compiles and
  prerenders correctly (all auth routes dynamic) but was not driven in a browser.

### Defects found and fixed during this milestone (all by the new tests/runtime checks)

1. Oversized body returned 500 (body-parser error masked by the exception filter) → now 413.
2. Lockout 429 lacked `Retry-After` (thrown from the service, bypassing the guard) → filter sets it.
3. Developer's `.env` (`TRUST_PROXY=1`) leaked into e2e → e2e config now pins its environment.
4. Reset page showed "invalid link" in development: React StrictMode double-ran the effect and
   the second run found the fragment already stripped → token captured once in a ref; jsdom
   regression test added (verified to fail with the bug reintroduced).

## Known issues / limitations

- **Email is not verified** (D-022); accounts work immediately. Needed before payments/assistants.
- **Rate limiter is in-memory, per process** (D-017); not safe for multi-instance deployment.
  `TRUST_PROXY` must match the real proxy count.
- **Mail is fire-and-forget** (D-020): a transient SMTP failure loses that email (logged by error
  name only); no outbox/retry yet.
- **Registration reveals duplicate emails** with 409 (D-021).
- `audit_logs` is append-only by convention only; no DB-level immutability/retention policy.
- No change-password-while-logged-in, no "log out everywhere"/session list UI, no 2FA, no
  Argon2 rehash-on-login, no account lockout notification emails.
- Web has security headers (nosniff, frame deny, referrer policy, permissions policy) but **no CSP**
  yet (Next requires nonce plumbing); OpenAPI documents request bodies but not response schemas.
- `localhost`-only verification: TLS, real SMTP provider and `__Host-` cookie behaviour in a real
  browser over HTTPS were not exercised (only the headers were inspected).
- The GitHub Actions workflow has **never run** (YAML reviewed only). No Playwright browser e2e.
  Coverage is not measured/enforced.
- Mailpit uses the `latest` image tag (dev only).
- npm is unusable on this machine for this tree (D-002); use pnpm.

## Next action (exact)

**M1.2 — Authorization foundation** (see ROADMAP.md), small vertical slice:

1. `Roles(...)` decorator + `RolesGuard` (global, after `SessionAuthGuard`); tests that a
   CUSTOMER gets 403 on an ADMIN-only route and unauthenticated gets 401.
2. Resource-ownership pattern (service-level `assertOwner`/scoped queries) documented in
   ARCHITECTURE.md with a worked example ready for bookings; no self-service role changes.
3. Admin bootstrap that never exposes an HTTP path to become ADMIN (e.g. a CLI/script
   `pnpm --filter @qyou/api admin:create`), audited.
4. Email verification flow (D-022): token table, send on register, `emailVerifiedAt`, endpoint to
   resend (rate-limited, enumeration-safe), and a UI banner on `/account`.
5. Change password while logged in (re-auth with current password, revoke other sessions) and
   "log out everywhere", with UI on `/account`.
6. Make `audit_logs` immutable at the DB level (revoke UPDATE/DELETE via trigger) + e2e test.
7. Run the full `pnpm check`, update docs.

Then M1.3 (service categories, eligible tasks, locations).

## Decisions awaiting the owner (do not decide silently)

- **D-012 (deferred by owner 2026-10-23)**: payment provider, commission %, fees, cancellation and
  refund policy, payout automation — required before any real payment implementation (Phase 2).
