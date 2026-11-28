# Qyou — Architecture

Status: **Phase 0, M1.1 (authentication), M1.2 (authorization & account security) and M1.3 (reference data & discovery) implemented;
everything else is design intent** and is marked as such. When code and this document disagree, the code wins — fix the document.

## Shape

Modular monolith in a pnpm TypeScript monorepo. No microservices.

```
apps/api            NestJS 12 (ESM) REST API, Prisma 7 → PostgreSQL 17     [implemented: health, auth, authz, admin, service-categories, service-locations, seed]
apps/web            Next.js 16 App Router, React 19, Tailwind 4             [implemented: shell, auth/account pages, CSP, discovery pages]
packages/config     Shared tsconfig bases                                   [implemented]
packages/contracts  Shared API schemas/types — only when it earns its keep  [not created; D-007]
docs/               Product, architecture, decisions, roadmap, progress, runbook
docker-compose.yml  Local PostgreSQL (5452; DBs qyou, qyou_test) + Mailpit (SMTP 1052, UI 8052)
docker/             DB init + dev-db-roles.sql (least-privilege runtime role)
```

The browser talks only to the **web origin**: Next.js rewrites `/api/v1/*` to the API
(`API_BASE_URL`), so the session cookie belongs to the web origin and no CORS is involved. Server
Components call the API directly and forward the browser's `Cookie` header. The API publishes
OpenAPI at `/docs` and `/docs/openapi.json`. The web client types will be generated from / validated against that contract
(decision deferred to Phase 1, D-007).

## API internals (implemented)

- `config/env.ts` — zod-validated environment; startup fails fast with a readable list of
  errors. Production additionally requires `SMTP_HOST` and https `WEB_BASE_URL`/`CORS_ORIGINS`.
- `prisma/` — global `PrismaService` (Prisma 7 + `@prisma/adapter-pg`). Generated client is in
  `src/generated/prisma` (git-ignored).
- `health/` — `live` (process) and `ready` (real `SELECT 1`; 503 + body when DB down). `@Public()`.
- `app.guards.ts` — the global guards **in execution order** (see Authorization). Pinned by a test.
- `app.setup.ts` — shared bootstrap used by `main.ts` and the e2e tests: trust-proxy setting,
  Helmet (CSP relaxed for `/docs` only), JSON body limit (16 KiB; default body parser disabled so
  the limit applies — create the app with `APP_OPTIONS`), `cookie-parser`, CORS allow-list,
  global prefix `api/v1`, shutdown hooks, OpenAPI (with cookie-auth scheme).
- `common/zod` — `createZodDto(schema)` + global `ZodValidationPipe`: any `@Body()` typed with a
  DTO class is validated/normalised; 400 responses list `{path, message}` and never echo values.
  `zodBodySchema()` derives the OpenAPI request schema from the same zod schema.
- `common/http` — `AllExceptionsFilter` (generic 500; maps body-parser 413/400; sets
  `Retry-After` on 429; logs unexpected errors by name/code only, never messages).
- `common/rate-limit` — PostgreSQL-backed fixed-window `RateLimiter` (`rate_limit_counters`, one
  atomic `INSERT … ON CONFLICT DO UPDATE … WHERE count < limit`) + `@RateLimit()`/`RateLimitGuard`
  (per client IP). Shared by every API instance and restart-proof; keys are SHA-256-hashed. Fixed
  windows allow up to 2× bursts across a boundary (D-017). Fails closed if the DB is down.
- `audit/` — `AuditService.record()`; inside the caller's transaction when given a `tx`.
- `mail/` — `MailService` abstraction + SMTP implementation (nodemailer). Local: Mailpit.
  Delivery is fire-and-forget from the request (no outbox; deliberate deferral, D-020).
- `authz/` — `@Roles()`, `@RequireVerifiedEmail()`, `@AdminOnly()` and their global guards.
- `admin/` — administrator-only user management (role assignment) and the bootstrap service used
  by the CLI (`src/cli/create-admin.ts`).
- `auth/` — see below.

### Authentication (M1.1, implemented)

| Concern         | Implementation                                                                                                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords       | Argon2id (`@node-rs/argon2`, 19 MiB / t=2 / p=1); policy: 10–128 chars + common-password denylist; unknown-account logins burn an equal-cost dummy verification                                                                                                                                                                    |
| Sessions        | Opaque 256-bit random token in an HttpOnly cookie; **only SHA-256(token) is stored** (`sessions`). Absolute TTL 30 d, idle TTL 7 d, `lastSeenAt` refreshed ≤ every 5 min, revocable (`revokedAt`), suspended users rejected on every request                                                                                       |
| Cookie          | `HttpOnly; SameSite=Lax; Path=/`; production adds `Secure` and the `__Host-` prefix (name `__Host-qyou_session`); dev name `qyou_session`                                                                                                                                                                                          |
| Rotation        | Every login issues a fresh token (registration issues none: D-056); a presented existing session is revoked in the same transaction (anti-fixation). Password reset revokes **all** sessions                                                                                                                                       |
| CSRF            | `CsrfGuard` (global): state-changing request with an `Origin` outside `CORS_ORIGINS` → 403; cookie present but no `Origin` → 403. Plus SameSite=Lax and JSON-only bodies. No token round-trip needed because every browser sends `Origin` on cross-site POSTs                                                                      |
| Authorization   | `SessionAuthGuard` is **global; routes are private unless `@Public()`**. Roles/resource ownership guards arrive in M1.2                                                                                                                                                                                                            |
| Reset flow      | 256-bit single-use token, SHA-256 stored, 30-min TTL, newest link wins (row lock on the user), atomic claim via `UPDATE … WHERE usedAt IS NULL AND expiresAt > now()` so concurrent use yields exactly one success; link uses the URL **fragment** (`/reset-password#token=…`), which is not sent to servers or in Referer         |
| Enumeration     | Reset request: identical 202 body for known/unknown/suspended/over-limit addresses, mail sent asynchronously. Login: identical 401, equal-cost verification. **Registration (D-056): identical 202 `{message}` and no session for new, verified, unverified and suspended addresses**; the difference is only in the owner's inbox |
| Rate limits     | register 10/h/IP + 3 attempts/h/address (new and existing alike, then silently dropped) · login 30/15 min/IP + 5 failures/15 min per (email, IP) + 20 failures/15 min per email · reset-request 10/h/IP + 3 mails/h/address · reset-confirm 10/15 min/IP                                                                           |
| Audit           | `auth.register`, `auth.login.success                                                                                                                                                                                                                                                                                               | failure | blocked`, `auth.logout`, `auth.password_reset.requested | completed` with IP + user agent; never secrets. Failure reasons are internal only |
| Secrets in logs | Nothing logs bodies; the exception filter logs error name/code only; verified by an e2e test that captures stdout/stderr across every flow                                                                                                                                                                                         |

Endpoints (`/api/v1/auth`): `POST register`, `POST login`, `POST logout` (idempotent, public),
`GET me`, `POST password-reset/request`, `POST password-reset/confirm`, and (M1.2)
`POST email-verification/request|confirm`, `POST password/change`, `POST logout-all`,
`GET sessions`, `DELETE sessions/:id`. Admin: `PATCH /api/v1/admin/users/:id/role`.

Web (`apps/web`): `/register`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`,
`/account` (verification status + resend, change password, log out / log out everywhere;
server-validated, redirects to `/login?next=…`; `next` is restricted to same-site paths). The
header reflects session state; an API outage is shown as "unavailable", never as "logged out".

### Authorization (M1.2, implemented)

Authentication ("who are you?") and authorization ("may you?") are separate guards. The global
guards run in this order (`app.guards.ts`, order pinned by `app.guards.spec.ts`):

1. `CsrfGuard` — reject cross-site state-changing requests;
2. `SessionAuthGuard` — authenticate; every route is private unless `@Public()`;
3. `RolesGuard` — `@Roles(...)`; anonymous → **401**, wrong role → **403**;
4. `VerifiedEmailGuard` — `@RequireVerifiedEmail()` → 403 with `code: "EMAIL_NOT_VERIFIED"`.

Rules of the pattern:

- **Decorators declare, guards enforce.** Controllers state `@AdminOnly()` /
  `@Roles('ASSISTANT') @RequireVerifiedEmail()`; no controller parses roles itself.
- **Role and verification are read from the database on every request** (the session lookup
  loads the user), so a role change or suspension takes effect on the very next request.
- **Fail closed:** `@Roles` on a `@Public()` route denies everyone (tested) — it is a bug, not an
  open route. A route without `@Roles` is open to any _authenticated_ user.
- **Resource-level authorization lives in services**, because it needs the loaded resource. The
  pattern: scope the query to the caller and answer "not yours" exactly like "doesn't exist":
  `updateMany({ where: { id, userId: caller.id } })` → count 0 → **404**. Worked example:
  `AccountSecurityService.revokeSession` / `listSessions`. Bookings (Phase 2) must follow it
  (customers: `customerId = caller`; assistants: assigned/offered jobs only; admins explicit).
- Conditional updates (`WHERE role = <value read>`) make role changes safe under concurrency.

**Role model.** One role per account: `CUSTOMER` (default and only value at registration),
`ASSISTANT`, `BUSINESS_STAFF`, `ADMIN`. Clients can never send a role (strict schemas reject
unknown fields; there is no profile-update endpoint). Roles change only by:
`PATCH /admin/users/:id/role` — administrator only (verified), assignable values
`CUSTOMER | ASSISTANT | BUSINESS_STAFF`, never `ADMIN`, never on yourself or another
administrator, target must be verified for non-customer roles, audited with before/after; and
the administrator CLI for creating administrators. (Assistant onboarding/verification in M1.4 and
business onboarding in Phase 5 will drive this same service rather than add new paths.)

**Administrator bootstrap (`pnpm --filter @qyou/api admin:create`).** The only way an `ADMIN` comes
into existence; there is no HTTP path (tested: no route, registration/role schemas reject it).
The operator never supplies or sees a password: the account is created with a random password
nobody knows, email pre-verified, and a single-use 24 h set-password link is emailed to the
administrator. Dry-run by default (`--yes` to act). Fail-closed: refuses if any administrator
exists (`--additional` to add another), refuses if the email belongs to _any_ account (never
promotes/edits users), serialises concurrent runs with an advisory lock, audits `admin.bootstrap`.
It runs with the API's own configuration, so it connects as the runtime role. Procedure and
recovery: RUNBOOK.

### Email verification (M1.2, implemented)

Tokens: 256-bit, single-use, 24 h, SHA-256 stored, bound to the address they were sent to; the
newest link wins. Registration sends one; `POST /auth/email-verification/request` (authenticated,
3/h/user) re-sends; `POST …/confirm` is public (the link is often opened elsewhere) with the token
in the **URL fragment** auto-POSTed by `/verify-email`. Confirm is idempotent (a replayed link on a
verified account → `already_verified`) and concurrency-safe (atomic claim; exactly one `verified`,
the rest `already_verified`). Unknown/expired/malformed/superseded tokens all return the same 400.
Completing a password reset also verifies the address (the mail proves mailbox control).

**Email verification policy — what requires a verified email**

| Requires verified email                                                                                                                                          | Does not                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Any administrator action (`@AdminOnly`)                                                                                                                          | Register, log in/out, view `/account`                |
| Being assigned ASSISTANT / BUSINESS_STAFF (target must be verified)                                                                                              | Change password, log out everywhere, manage sessions |
| _Policy for upcoming features:_ creating bookings/payments, submitting assistant or business onboarding, messaging another user, publishing reviews/wait reports | Browsing, search, viewing public listings            |

Principle: anything that creates a commitment, moves money, or contacts another person requires
`@RequireVerifiedEmail()`; reading public content and managing your own account does not. If an
email-change feature is ever added it must clear `emailVerifiedAt` and issue a new token.

### Account security (M1.2, implemented)

- **Change password** (`POST /auth/password/change`): requires the current password (wrong guesses
  are limited to 5/15 min per user, so a stolen session cannot brute-force it), new password must
  differ and meet policy. **Session policy: every session of the user — including the current one —
  is revoked and the calling device receives a fresh session (token rotation).** The device stays
  logged in; all others, and any copy of the old token, are logged out immediately. The write is
  conditional on the password hash that was verified, so concurrent changes/resets cannot silently
  overwrite each other (409).
- **Log out everywhere** (`POST /auth/logout-all`): revokes every session including this one and
  clears the cookie. Enforced on the next request by the session lookup.
- Password reset (M1.1) is unchanged: revokes all sessions and does not auto-login.

### Audit-log integrity (M1.2, implemented)

**Threat model.** In scope: a bug or compromise _of the API process_ (SQL injection, malicious
dependency, mistaken code path) trying to hide or rewrite security events. Out of scope for
in-database controls: a malicious/compromised **database owner, superuser or infrastructure
administrator**, who can drop triggers, set `session_replication_role = replica`, edit WAL or
restore backups. Those need controls outside the database (see "Limits").

**Layer 1 — least privilege.** The API connects as `qyou_runtime`, a member of group role
`qyou_app`; it is neither owner nor superuser. Migrations (`20261023214900_audit_log_immutability`)
grant `qyou_app` normal DML on tables but **only `INSERT, SELECT` on `audit_logs`** (no UPDATE,
DELETE, TRUNCATE) and nothing on `_prisma_migrations`. Being a non-owner it also cannot ALTER/DROP
the table, disable or drop triggers, `GRANT` itself privileges (a non-owner GRANT is a no-op), or
`SET ROLE`. Default privileges give future tables normal DML; append-only tables must opt out in
their own migration.

**Layer 2 — triggers.** `BEFORE UPDATE OR DELETE` (row) and `BEFORE TRUNCATE` (statement) triggers
raise `insufficient_privilege` for **every** role, including the table owner, so a careless
migration or ad-hoc owner session cannot silently edit history.

**No foreign key.** `audit_logs.actorUserId` is a plain column: deleting a user can neither cascade
into nor "SET NULL" audit rows (which would be an UPDATE the triggers would — correctly — block).

**Atomicity.** Audit rows for state changes are written in the same transaction (`record(event, tx)`),
so history commits or rolls back with the change it describes.

**Limits / residual risk (documented, accepted for now).** (1) Owner/superuser can disable the
triggers — keep the owner credential out of the deployed API (only CI/migration tooling should hold
`MIGRATION_DATABASE_URL`; locally it shares `.env` for convenience), and use a non-superuser owner in production. (2) Rows can still be
_added_ by anything holding INSERT — including a compromised API — so audit rows are evidence of
what the API recorded, not proof against a compromised API. (3) No tamper-evidence (hash chain) or
off-box copy yet. **Phase 6:** ship audit events to external append-only/WORM storage, add a hash
chain or periodic signed checkpoints, and alert on trigger/privilege changes.

### Database roles and connections

| Role                                         | Used by                                                                                       | Privileges                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `qyou` (owner; superuser **locally only**)   | Prisma CLI / migrations / CI test setup (`MIGRATION_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL`) | owns schema objects                               |
| `qyou_app` (NOLOGIN group)                   | holds the runtime grants                                                                      | DML on tables except `audit_logs` (insert/select) |
| `qyou_runtime` (LOGIN, member of `qyou_app`) | the running API and its e2e tests (`DATABASE_URL`)                                            | via `qyou_app` only                               |

`prisma.config.ts` uses `MIGRATION_DATABASE_URL ?? DATABASE_URL`. Production: create both roles
with a real secret (template in RUNBOOK), run migrations with a non-superuser owner.

### Web Content Security Policy (M1.2, implemented)

`apps/web/src/proxy.ts` (Next 16 "proxy", formerly middleware) generates a fresh nonce per request
and sets `Content-Security-Policy` (+ HSTS when `FORCE_HTTPS=true`). Production policy:
`default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'` (**no** `unsafe-inline`,
**no** `unsafe-eval`); `style-src 'self' 'nonce-…'`; `connect-src 'self'` (the API is proxied under
`/api/v1`, so a hijacked script cannot exfiltrate cross-origin); `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. All pages are dynamic (they read the
session cookie), which nonces require. **Development only:** `unsafe-eval` for scripts (React dev
tooling) and `style-src 'unsafe-inline'` (Next's dev tooling injects un-nonced `<style>` elements);
scripts stay nonce-only even in dev. Verified by: unit tests of `buildCsp`; a black-box script
(`pnpm verify:headers`, also a CI step) checking every public page of a _running production build_
for CSP, nonce on every `<script>`, no inline `style=`/handlers, per-request nonce uniqueness and
the token pages' `Referrer-Policy: no-referrer`; and a manual browser run (hydration + full flows,
console clean). Not covered: Trusted Types, CSP reporting endpoint.

### Reference data model (M1.3, implemented — documented before the migration was applied)

Cities, categories, tasks and locations are **reference data**: public to read, writable only by
administrators, every write audited. They contain **no assistants, reviews, wait times or
invented businesses** — locations start empty and are entered (and approved) by administrators.

```
City 1───* ServiceLocation *───1 ServiceCategory 1───* EligibleTask
                  │                                          ▲
                  └──1───* LocationRestriction *──(0..1)─────┘   (null task = whole venue)
```

| Entity                | Purpose                                                                                    | Key fields                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `City`                | A launch city — **not** a venue.                                                           | `slug` (unique, immutable), `name`, `state`, `latitude/longitude` (approximate centre), `timezone`, `isActive`, `sortOrder`                                                                           |
| `ServiceCategory`     | A kind of place people queue at.                                                           | `slug` (unique, immutable), `name` (unique case-insensitively via `nameKey`), `description`, `iconKey`, `isActive`, `sortOrder`                                                                       |
| `EligibleTask`        | One thing an assistant may or may not do within a category, **with explicit eligibility**. | `categoryId`, `slug` (unique per category), `kind` (`QUEUE_HOLDING`/`ERRAND`), `eligibility`, `requiresPersonalPresence`, `requiresCredentials`, `authorizationNotes`, `restrictionNotes`, `isActive` |
| `ServiceLocation`     | A real venue (bank branch, office, clinic…) in a city, entered by an admin.                | `cityId`, `categoryId`, `slug` (unique), `name`, `address`, optional coordinates, `status` (`PENDING_REVIEW`/`APPROVED`/`REJECTED`/`ARCHIVED`), `reviewedByUserId/At`                                 |
| `LocationRestriction` | Venue-specific rule modelled explicitly, never hard-coded in UI copy.                      | `locationId`, optional `taskId` (null ⇒ whole venue), `rule` (`PROHIBITED`/`REQUIRES_AUTHORIZATION`/`ADVISORY`), `note`                                                                               |

**Task eligibility** (the "what may be delegated" rules from PRODUCT.md, as data):

- `ELIGIBLE` — an assistant may do it as described.
- `REQUIRES_AUTHORIZATION` — only with the customer's written authorization/documents;
  `authorizationNotes` (mandatory) says exactly what.
- `NOT_DELEGABLE` — listed on purpose so the product can explain _why not_ and booking (Phase 2) can
  reject it; `restrictionNotes` (mandatory) gives the reason (personal presence, credentials,
  impersonation risk, or a launch-policy exclusion such as handling customers' cash).

**Database-enforced invariants** (CHECK constraints, so no code path or manual SQL can violate
them; also validated in the API for friendly errors): a task that needs the customer's personal
presence or credentials _must_ be `NOT_DELEGABLE`; `REQUIRES_AUTHORIZATION` needs
`authorizationNotes`; `NOT_DELEGABLE` needs `restrictionNotes`; slugs match
`^[a-z0-9]+(-[a-z0-9]+)*$`; coordinates are in range and come as a pair.

**Visibility.** Public reads only ever return: active categories/tasks, active cities, and
locations with `status = APPROVED` **whose category and city are also active**. Anything else is
indistinguishable from "does not exist" (404). Admin endpoints see everything.

**Writes.** Administrator only (`@AdminOnly`, verified email), each in one transaction with its
audit row (`admin.<entity>.created|updated`, changed fields as `{before, after}`). Slugs are
immutable (stable URLs); there is **no hard delete** — records are deactivated/archived — so
history and references stay intact. Duplicates (slug, case-insensitive name) → 409.

**Indexes.** Unique: slugs; `nameKey`; `(categoryId, slug)`; `(locationId, taskId, rule)` with
`NULLS NOT DISTINCT`. Query paths: `service_locations (cityId, status)`, `(categoryId, status)`,
`(status, name)`; `eligible_tasks (categoryId, isActive)`; `service_categories (isActive, sortOrder)`.
Search is `ILIKE` over a few hundred rows per city — a trigram index is the documented upgrade
path when volumes justify it.

**Seed.** `pnpm --filter @qyou/api db:seed` inserts _missing_ categories (7), tasks (25) and the four
launch cities (Kaduna, Abuja, Kano, Lagos) with `ON CONFLICT DO NOTHING` in one transaction. It never
modifies, reactivates or deletes existing rows (administrator edits win), audits once only when something
was created, and seeds **no locations**. Seed data is validated against the same delegation rules at
runtime and in a unit test that also forbids business names and review/wait-time vocabulary.

#### API surface

Public (`@Public`, no authentication, `Cache-Control: public, max-age=60` on success only):

| Endpoint                                               | Returns                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET /service-categories`                              | `{ items }` active categories with `taskCount` and `locationCount` (public venues only)                 |
| `GET /service-categories/:slug`                        | `{ category, tasks }` active tasks with eligibility, notes, flags; 404 if inactive/unknown              |
| `GET /cities`, `GET /cities/:slug`                     | active cities with `locationCount`                                                                      |
| `GET /service-locations?city&category&q&page&pageSize` | `{ items, page, pageSize, total, totalPages }`, approved venues only, `pageSize ≤ 50`, order `name, id` |
| `GET /service-locations/:slug`                         | `{ location, tasks, restrictions }` — each task with `effectiveEligibility` and `venueNotes`            |

Administrator only (`@AdminOnly`: verified admin; CSRF-checked; each write = one transaction + one audit
row `admin.<entity>.created|updated`, changes as `{field: {from, to}}`; a no-op PATCH writes nothing):

| Endpoint                                                                                 | Notes                                                                                                |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET/POST /admin/service-categories`, `GET/PATCH /admin/service-categories/:id`          | slug optional (derived), immutable; duplicate slug or case-insensitive name → 409                    |
| `GET/POST /admin/service-categories/:id/tasks`, `PATCH /admin/eligible-tasks/:id`        | delegation rules validated on the **merged** state; duplicate slug/name within a category → 409      |
| `GET/POST /admin/cities`, `PATCH /admin/cities/:id`                                      | IANA timezone and coordinate ranges validated                                                        |
| `GET/POST /admin/service-locations`, `GET/PATCH /admin/service-locations/:id`            | created `PENDING_REVIEW` unless `APPROVED` given; status state machine; city/category/slug immutable |
| `POST /admin/service-locations/:id/restrictions`, `DELETE …/restrictions/:restrictionId` | task must belong to the venue's category; duplicates → 409                                           |

Error contract: 400 `{message:"Validation failed", issues:[{path,message}]}` (never echoes values), 401/403
as in Authorization, 404 for unknown **or non-public** records (identical bodies), 409 for conflicts.

#### Web discovery (M1.3)

`/` (hero search, categories, launch cities, a plain "what's live today" box), `/search` (filters + cards +
pagination), `/categories/[slug]` (tasks grouped _Available → Needs your authorization → Not available_, with
exactly what to provide or why not), `/locations/[slug]` (venue rules, effective eligibility). Server components
fetch the public API; failures render explicit _unavailable_ states, empty data renders honest empty states
(counts say "no locations yet"). Search is a native GET form (no JavaScript needed). Eligibility is always conveyed with
text and an icon, never colour alone. Booking is not offered anywhere: the pages say so.

#### Tests (M1.3)

`test/reference-data-public|admin|integrity.e2e-spec.ts` against real PostgreSQL as the runtime role: public
visibility rules (inactive/pending/rejected/archived/hidden-by-parent all 404 like unknown), filters, literal
`%`/`_` search, stable pagination, validation limits, cache headers (success only); authorization on **every**
admin endpoint (anonymous, customer/assistant/business, unverified admin, cross-origin); every write audited
exactly once and failed writes never; atomic audit (a failing audit rolls the write back); concurrency (racing
duplicates → exactly one winner); CHECK constraints and `NULLS NOT DISTINCT` exercised with raw SQL as the owner;
`RESTRICT` foreign keys; seed idempotence, non-destructiveness and partial-state repair.

### Assistants: profiles, onboarding and verification (M1.4 — implemented)

An assistant is a user with an `AssistantProfile`. The **role invariant** is: a user has role `ASSISTANT`
**if and only if** their application is `APPROVED`. The role is granted/revoked only by the existing role
service (`AdminUsersService`), inside the same transaction as the status change — a complete profile, a
verified phone or a passed identity check never grants anything by themselves.

```
User 1──0..1 AssistantProfile 1──1 AssistantPrivateDetails   (legal name, phone — PRIVATE)
                    │  1──* AssistantServiceArea ──* City
                    │  1──* AssistantTaskOffer ──* EligibleTask      (never NOT_DELEGABLE; trigger-enforced)
                    │  1──* AssistantAvailabilityWindow              (a declaration, not a guarantee)
                    │  1──* IdentityCheck                            (outcomes only — never documents)
                    └  1──* PhoneVerificationToken                   (HMAC of a 6-digit code)
```

**Public vs private.** `AssistantProfile` holds only intentionally public fields (display name, slug, bio,
languages, status). Everything private lives in `AssistantPrivateDetails` (legal name, phone) and is returned
only to the owner and to administrators reviewing the application (phone masked in lists; every admin read of
the private fields is audited). Public endpoints select from an explicit allow-list of fields and never join
the private table, the user's email, or the user id.

**Application state machine** (`ApplicationStatus`; anything else is 409):

| From                | To                               | Who       | Requirements                                                                                                                  |
| ------------------- | -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DRAFT`             | `SUBMITTED`                      | assistant | email verified; basics, ≥1 city, ≥1 task, ≥1 availability window, legal name + phone present                                  |
| `CHANGES_REQUESTED` | `SUBMITTED`                      | assistant | same as above                                                                                                                 |
| `SUBMITTED`         | `UNDER_REVIEW`                   | admin     | —                                                                                                                             |
| `UNDER_REVIEW`      | `CHANGES_REQUESTED` / `REJECTED` | admin     | reason ≥ 10 chars                                                                                                             |
| `UNDER_REVIEW`      | `APPROVED`                       | admin     | reason; email verified; **phone verified; latest identity outcome `PASSED`**; profile complete; grants `ASSISTANT` atomically |
| `REJECTED`          | `UNDER_REVIEW`                   | admin     | reason (reconsideration)                                                                                                      |
| `APPROVED`          | `SUSPENDED`                      | admin     | reason; revokes `ASSISTANT` atomically                                                                                        |
| `SUSPENDED`         | `APPROVED`                       | admin     | reason; all approval requirements re-checked; re-grants role                                                                  |
| `SUSPENDED`         | `REJECTED`                       | admin     | reason                                                                                                                        |

An admin can never act on their own application. Editing: `DRAFT`/`CHANGES_REQUESTED` everything; `APPROVED`
bio, languages, availability, service areas and offers (display name and legal name locked; changing the phone
clears its verification and makes the assistant ineligible until re-verified); `SUBMITTED`, `UNDER_REVIEW`,
`REJECTED`, `SUSPENDED` read-only (409), so a review cannot race with edits.

**Eligibility for paid work** (`AssistantEligibilityService`, the only definition, also a global
`@RequireAssistantEligibility()` guard for future "accept job" routes): user `ACTIVE` ∧ role `ASSISTANT` ∧
email verified ∧ application `APPROVED` ∧ phone verified ∧ latest identity outcome `PASSED` ∧ ≥1 area ∧ ≥1
offered task. Each failed condition is reported as a reason. A venue-level check (`canServeTask`) reuses
`applyVenueRestrictions`, so a task that is non-delegable _at a venue_ cannot be accepted there.

**Task offers cannot contradict policy.** The API rejects non-delegable or inactive tasks, tasks of inactive
categories and inactive cities; a database trigger independently refuses to insert a `NOT_DELEGABLE` task
into `assistant_task_offers`. If an administrator later makes an offered task non-delegable, public views and
eligibility checks ignore the offer at read time (no stale advertising).

**Identity verification — no provider is configured, so this is an honest manual workflow.** Qyou stores
_outcomes only_: `IdentityCheck(result PASSED|FAILED|INCONCLUSIVE, method MANUAL_REVIEW, evidenceRef, notes,
checkedBy, checkedAt)`. Documents, selfies and ID numbers are **never** uploaded to or stored in PostgreSQL
or the application (no storage exists). The reviewer performs the check out-of-band (e.g. a recorded video
call or in-person check run by Qyou staff under a documented procedure) and records the result plus an opaque
`evidenceRef` pointing to where the evidence is held. The API rejects `notes`/`evidenceRef` that look like
identifiers (≥ 9 consecutive digits ⇒ NIN/BVN/card/phone-like). The UI labels the outcome "Manual review"; it
never says "verified by a provider". Limitations: there is no automated liveness/document authentication, the
quality of the check depends on the human procedure, and `evidenceRef` is only as trustworthy as the
off-system store it points to.

**Phone verification.** `SmsService` is an interface. `SMS_PROVIDER=dev` (non-production only) delivers the
"SMS" as an email to Mailpit, clearly labelled as simulated; `SMS_PROVIDER=none` (the production default)
makes the endpoints answer **503 and create no code** — it never pretends to have sent anything. Codes are 6
digits from a CSPRNG, expire in 10 minutes, are single-use, limited to 5 attempts, and stored only as
`HMAC-SHA256(pepper, tokenId|phone|code)` (a plain hash of a 10⁶ space is reversible). Rate limits: 60 s cooldown,
5 sends/hour per user, 3/hour per phone number, 20/hour per IP; 10 verify attempts / 15 min per user. A verified
phone can belong to only one assistant (partial unique index). Only Nigerian numbers (`+234` + 10 digits) are
accepted at launch. Per-IP caps sit on top: 20 code requests/hour, 30 verification attempts/15 min, 10 applications started/hour.

**Admin workflow.** `GET /admin/assistants` (status filter, paginated, phone masked), `GET /admin/assistants/:id`
(private details visible, audited), `POST …/identity-checks`, `POST …/transitions {to, reason}`; web pages
`/admin/assistants` and `/admin/assistants/[id]`. Every decision stores the reason (shown to the assistant) and
an audit row (`admin.assistant.<status>`; `admin.assistant.identity_check_recorded`;
`admin.assistant.private_viewed`).

**API surface (all under `/api/v1`).**

| Endpoint                                                                        | Access                          | Purpose                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `GET /assistants`, `GET /assistants/:slug`                                      | public, 60 s success-only cache | Eligible assistants only; allow-listed public fields                      |
| `GET /assistants/me`, `GET /assistants/me/eligibility`                          | session, verified email         | Dashboard, checklist, status + reason, eligibility reasons                |
| `POST /assistants/me`                                                           | session, verified email         | Start an application (draft)                                              |
| `PATCH /assistants/me`, `PUT …/services`, `PUT …/availability`, `PUT …/private` | owner, edit scope permitting    | Public profile, offered tasks + cities, preferred times, legal name/phone |
| `POST …/phone/code`, `POST …/phone/verify`                                      | owner                           | Phone ownership (D-040)                                                   |
| `POST …/submit`                                                                 | owner                           | DRAFT/CHANGES_REQUESTED → SUBMITTED                                       |
| `GET /admin/assistants`, `GET /admin/assistants/:id`                            | `@AdminOnly`                    | Queue (masked phone); detail (audited private read)                       |
| `POST /admin/assistants/:id/identity-checks`, `…/transitions`                   | `@AdminOnly`, CSRF              | Record outcome; decisions with reasons                                    |

There is deliberately **no endpoint that grants `ASSISTANT` outside `…/transitions`**, and no endpoint accepts a
status or role in a request body (strict schemas reject unknown keys; covered by tests).

**Security assumptions (M1.4).** (1) A compromised administrator account can approve anyone: approval is
audited and requires a verified-email admin, but there is no dual control yet. (2) The manual identity review is
only as good as the human procedure and the off-system evidence store; Qyou cannot detect forged documents.
(3) SMS OTP proves control of a number at one moment, not identity; SIM-swap/number-recycling are unmitigated.
(4) Private details are protected by access control + audit, not encryption at rest. (5) The `DevSmsService`
output in Mailpit is a development convenience and is not evidence that any SMS was delivered; production
refuses to start with `SMS_PROVIDER=dev` and returns 503 with `none`.

**Tests.** Unit: state machine, eligibility decision, availability validation, phone normalisation/masking,
code hashing, identifier tripwire, SMS services, env validation, guard order. E2E (real PostgreSQL, runtime
role): onboarding (public/private split, edit scopes, validation, non-delegable rejection, trigger),
phone (expiry, single use, attempts, cooldown and rate limits, uniqueness, fail-closed provider), admin (every
endpoint × every role, transitions incl. invalid ones, blockers, role granted/revoked atomically, audit rows,
self-review forbidden, no role-granting by any other route), public (allow-list, hidden when not
eligible), eligibility (suspended/unapproved/unverified, venue restrictions).

**Known limitations (documented, not hidden):** legal name and phone are stored unencrypted in a separate
table (column-level encryption / KMS is Phase 6); no profile photo (no storage); post-approval edits to bio go
live without moderation; the same admin may record an identity check and approve (dual control is recommended
and recorded as a launch gate); retention/deletion of private details after rejection is not yet automated.

### Service requests, quotes and assistant discovery (M1.5 — implemented; design note written before the migration)

**Baseline inspected (HEAD `6527dd8`, clean tree; `pnpm check` exit 0 with 137 API unit / 451 API e2e / 105 web tests).**
Already present from M1.4: public `GET /assistants` (city, category filters) and `/assistants/:slug`, a pure
`decideEligibility` plus `AssistantEligibilityService` (`evaluate`, `canServeTask`), the global
`@RequireAssistantEligibility()` guard, `@Roles`/`@RequireVerifiedEmail`, `AuditService.record(event, tx)`,
Postgres rate limiter, and `applyVenueRestrictions`. M1.5 extends these; it adds no parallel implementation.

**Product shape.** A _customer_ posts a **service request** for one delegable task in one city (optionally at a
real approved venue). Any currently-eligible assistant who offers that task and serves that city (and is not
barred by a venue rule) can see it and send a **quote** (a priced proposal). The customer **selects exactly one**
quote. Nothing is charged: selection ends in status `QUOTE_ACCEPTED`, which is where Phase 2 payment and
booking will start. There are no directed/invited requests, messaging, payments, fees or reviews in M1.5.

**Entities** (all IDs UUIDv7, `timestamptz`, money = integer kobo):

```
User 1──* ServiceRequest *──1 EligibleTask        (Restrict FKs everywhere; no hard deletes)
                    │ *──1 City, *──0..1 ServiceLocation
                    └ 1──* Quote *──1 AssistantProfile
```

- `ServiceRequest`: `customerId`, `taskId`, `cityId` (always set; equals the venue's city when a venue is
  given), `locationId?`, `description` (private, ≤ 1000), `constraints?` (private, ≤ 500), `scheduleKind`
  (`FLEXIBLE` | `ON_DATE`), `preferredDate?` + `preferredPeriod` (`ANY|MORNING|AFTERNOON|EVENING`) — a calendar
  date in the city's timezone, not an instant, so there is no timezone arithmetic in the UI —
  `expiresAt` (server-computed: end of the preferred date, or creation + 14 days for flexible requests),
  `authorizationConfirmedAt?`, `status`, `statusChangedAt`, `acceptedAt?`, `closedAt?`, `closureReason?`.
- `Quote`: `requestId`, `assistantId` (the profile; its `userId` is the owner), `amountKobo` (int), `currency`
  (`NGN` only, DB-checked; a documented placeholder for the unresolved currency policy), `message?`, `status`,
  `statusChangedAt`.
- Statuses never come from a client. There is no generic PATCH.

**Request lifecycle** (`ServiceRequestStatus`; anything else is 409):

| From                                 | To               | Who                           | Notes                                                                                            |
| ------------------------------------ | ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| _(create)_                           | `OPEN`           | customer                      | task delegable, venue/task/city consistent, venue rule not prohibiting, caps/rate limits         |
| `OPEN`                               | `QUOTED`         | system (first quote)          | in the quote transaction                                                                         |
| `QUOTED`                             | `OPEN`           | system (last quote withdrawn) | reversible                                                                                       |
| `QUOTED`                             | `QUOTE_ACCEPTED` | customer                      | one `PENDING` quote becomes `ACCEPTED`, every other `PENDING` becomes `NOT_SELECTED`, atomically |
| `OPEN` / `QUOTED` / `QUOTE_ACCEPTED` | `CANCELLED`      | customer                      | reason required once a quote was accepted; all live quotes become `REQUEST_CLOSED`               |

`EXPIRED` is **derived, not stored**: an `OPEN`/`QUOTED` request whose `expiresAt` has passed accepts no quotes and
cannot have one selected (409), is hidden from assistants' feeds and is shown to its owner as "expired". No
background job rewrites rows (none exists yet). **Reopening is not supported** (safest reversible default:
create a new request); reversibility comes from withdraw-and-requote and `QUOTED → OPEN`. A request cannot be edited
after creation, because quotes were priced against its text; cancel and recreate.

**Quote lifecycle** (`QuoteStatus`): `PENDING → ACCEPTED` (customer select) · `PENDING → NOT_SELECTED` (another
quote was selected) · `PENDING → WITHDRAWN` (assistant) · `PENDING|ACCEPTED → REQUEST_CLOSED` (request cancelled).
An assistant may quote again after withdrawing (a new row; at most 3 quote rows per assistant per request and 20 live
quotes per request).

**Who can do what** (non-owners and non-participants get **404**, never 403, so ids cannot be probed):

| Action                                | Actor                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Create / list / view / cancel request | role `CUSTOMER` or `ASSISTANT`, verified email, **owner only** (an assistant is also a customer under D-025)  |
| View quotes on a request, select one  | the request owner                                                                                             |
| Browse open requests, view one, quote | `@RequireAssistantEligibility()` **and** the request matches (task offered, city served, venue rule), not own |
| View a request after quoting          | the quoting assistant (even if no longer matching), only their own quote                                      |
| Withdraw a quote                      | the quote's owner                                                                                             |

Assistants never see the customer's name, email or any contact data. The description is visible only to matching,
eligible assistants and the owner; it is never in a public response, an audit row or a log. Descriptions that contain
an email address or a 9+ digit run (phone/ID-like) are rejected so contact details are not exchanged around Qyou.

**Concurrency.** Every state-changing request/quote operation runs in one transaction that first takes
`SELECT … FROM service_requests WHERE id = $1 FOR UPDATE`, then re-reads status, expiry and quotes, then writes.
That serialises submit / withdraw / select / cancel per request, so two concurrent selections cannot both win: the
second sees `QUOTE_ACCEPTED` and gets 409. Database backstops (they hold even if application code is wrong):
partial unique index `quotes(requestId) WHERE status = 'ACCEPTED'` (one accepted quote), partial unique index
`quotes(requestId, assistantId) WHERE status IN ('PENDING','ACCEPTED')` (no duplicate active quote), CHECK
constraints on schedule/status/timestamp consistency and `amountKobo > 0`, a trigger that rejects a
non-delegable task or a venue whose city/category contradict the request, and a trigger that rejects a quote by the
request's own customer or on a request that is not `OPEN`/`QUOTED`. Creation takes a row lock on the customer's `users`
row to enforce the "at most 10 live requests" cap without a race.

**Discovery semantics.** `GET /assistants` gains `task` (requires `category`; task slugs are unique only per category),
`language` (one of the declared codes), `q` (case-insensitive literal match on display name and bio, ≤ 80 chars,
wildcards escaped) and `location` (an approved venue: implies its city and category and excludes assistants whose
only offers in that category are prohibited at the venue). Filters combine with AND; "serves the city" and "offers the
task" are independent facts (offers are not per-city). Order stays `approvedAt desc, id asc` — no ranking signal exists.
**Eligibility equivalence:** the list query is a database predicate (`publicAssistantWhere`) kept next to
`decideEligibility`; a test builds an assistant for every way of failing each rule and asserts that membership in the
public list/profile is exactly `evaluate().eligibleForPaidJobs`. Quote submission and selection do not use the
predicate: they call `AssistantEligibilityService` itself (now with an optional transaction client) and the
venue-aware `canServeRequest`.

**Indexes.** `service_requests(customerId, createdAt desc)`, `(status, cityId, taskId, expiresAt)` for the feed,
`quotes(requestId, status)`, `quotes(assistantId, createdAt desc)`, the two partial uniques above.
Runtime role: `SELECT/INSERT/UPDATE`; **`DELETE` is revoked** on both tables.

**Audit** (same transaction as the change; metadata is ids, enums and counts only — never description, constraints,
message or closure text): `service_request.created`, `service_request.cancelled`, `quote.submitted`,
`quote.withdrawn`, `quote.accepted`.

**Privacy.** Public endpoints never join requests or quotes. Request ids are not exposed publicly. Venue names are
public data already (approved venues). The quote price and message are visible to the quoting assistant and the
request owner only.

**API surface (all under `/api/v1`).**

| Endpoint                                                               | Access                                         | Purpose                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /assistants`                                                      | public, 60 s success-only cache                | + `task` (needs `category`), `language`, `q`, `location`; cards list tasks and cities |
| `POST /service-requests`                                               | role CUSTOMER/ASSISTANT, verified email, CSRF  | Create (validates task, city/venue consistency, venue rules, schedule)                |
| `GET /service-requests`, `GET /service-requests/:id`                   | owner only (404 otherwise)                     | My requests (status filter, pagination); one request with every quote                 |
| `POST /service-requests/:id/cancel`                                    | owner, verified email                          | Cancel; reason required once a quote is accepted                                      |
| `POST /service-requests/:id/quotes/:quoteId/select`                    | owner, verified email                          | Accept one quote atomically                                                           |
| `GET /assistants/me/requests`                                          | `@RequireAssistantEligibility()`               | Open requests this assistant may quote on                                             |
| `GET /assistants/me/requests/:id`                                      | matching eligible assistant, or one who quoted | One request (no customer identity); 404 otherwise                                     |
| `POST /assistants/me/requests/:id/quotes`                              | eligible assistant, verified email             | Send a quote                                                                          |
| `GET /assistants/me/quotes`, `POST /assistants/me/quotes/:id/withdraw` | quote owner                                    | My quotes; withdraw a pending quote (works even if no longer eligible)                |

There is no PATCH/PUT/DELETE on requests or quotes and no endpoint accepts a status, an owner id, an expiry or a
total from a client (strict schemas reject unknown keys). Ids in paths are UUIDs (malformed ⇒ 400; well-formed but not
yours ⇒ 404).

**Web pages.** `/assistants` (filters: city, task/category, language, keyword; cards list tasks and areas;
empty/error/pagination states), `/assistants/[slug]` (public profile; "Post a request" per task), `/requests`,
`/requests/new` (prefilled from `category`, `task`, `city`, `location` query parameters), `/requests/[id]`
(quotes cheapest first, confirm-then-accept, cancel), `/assistant/requests`, `/assistant/requests/[id]` (quote form,
withdraw), `/assistant/quotes`. The header wraps on narrow screens (found overflowing at 375 px during the browser run).

**Implementation notes that differ in detail from the design note.** Submitting a quote on a request that expired
returns 409 ("no longer accepting quotes") while its detail/feed entry is already 404; the 404 rule applies to requests
the assistant never could see. The feed predicate encodes venue prohibitions positively (a per-task `OR`, with "no
venue" its own branch) because `NOT IN` against NULL would silently drop rows without a venue. A malformed id is a
400 from the UUID pipe, not a 404.

**Tests added in M1.5.** Unit: schedule/expiry arithmetic (incl. Lagos midnight), request/quote transition tables,
contact-detail tripwire. API e2e on real PostgreSQL with the runtime role: customer-side requests (auth, roles,
validation, venues, caps, ownership, derived expiry, cancellation, audit); quotes and selection (feed visibility,
eligibility, duplicates, self-quote, closed requests, atomic selection, concurrent selection/cancel/duplicate races,
withdrawal, privacy, audit payloads, feed ≡ `canServe`); discovery (every filter, combinations, pagination,
`location`, list ≡ `evaluate` for a control plus 13 ineligible states, public-field scan); database invariants (permissions, triggers,
CHECKs, partial uniques, RESTRICT). Web: money/schedule/search-parameter helpers, form and action components,
summary rendering.

**Known limitations (M1.5).** No payment, booking, messaging or notifications (assistants poll; customers must
revisit). No background expiry (derived at read time). Requests/quotes cannot be edited. A selected quote cannot be
withdrawn by its assistant, only closed by the customer's cancellation. Quote and request text is not moderated.
_(M1.5.1 closed three M1.5 limitations: the eligibility race, the untested pending-quote cap and the missing browser
suite; see the next section. Acceptance is still not a promise that the assistant stays eligible: Phase 2 must
re-check at booking.)_

**Explicitly deferred (unresolved, documented):** payment provider, fees/commission and currency policy (the `NGN`
column is a placeholder, not a decision); booking entity and the payment-driven part of the state machine;
background expiry; reopening; editing requests/quotes; directed requests; messaging and notifications (assistants poll
their feed; emails need the outbox, D-020); ratings (none exist); geo-distance matching; dual-admin approval;
private-data retention and encryption; real SMS and identity providers.

### Marketplace hardening and browser tests (M1.5.1)

**Eligibility concurrency protocol (D-052).** Quote submission and selection decide eligibility from many rows, so the
request lock alone cannot make the decision safe. Records and modes:

| Who                                                                                                                                                          | Lock (in this order)                                                                                     | Mode                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------- |
| `submitQuote`, `selectQuote` (readers)                                                                                                                       | 1. `service_requests` row                                                                                | `FOR UPDATE`        |
|                                                                                                                                                              | 2. `eligible_tasks` + `service_categories` (task of the request), `cities`, `service_locations` (if any) | `FOR SHARE`         |
|                                                                                                                                                              | 3. `users` row of the assistant                                                                          | `FOR SHARE`         |
| Assistant-scoped writers: admin transition (approve/reject/suspend), identity outcome, role assignment, `setServices`, `setPrivateDetails` (phone), `submit` | `users` row of the assistant — **first statement** of the transaction                                    | `FOR NO KEY UPDATE` |
| Venue restriction add/remove                                                                                                                                 | `service_locations` row                                                                                  | `FOR NO KEY UPDATE` |
| City / task / category / venue updates                                                                                                                       | the row itself (the `UPDATE` takes it)                                                                   | implicit            |

Helpers: `apps/api/src/assistants/eligibility-locks.ts` (`lockForEligibilityDecision`, `lockAssistantForChange`,
`lockVenueForChange`). Transactions use PostgreSQL's default `READ COMMITTED`: each statement sees everything committed
so far, so once the locks are held `canServe` reads the latest committed state and nothing that can revoke it can commit
until the decision transaction ends. Readers do not block each other (`SHARE`/`SHARE`), so only work on the same
assistant or catalog row is ordered. Deadlocks: every transaction takes locks in the single order above and each writer
holds at most one lock before writing, so there is no cycle and no retry logic. `lock_timeout` is not set (waits are
short: one transaction). **Guarantee:** a quote is never submitted, and never accepted, on an eligibility state that a
change committed before the decision commits has invalidated. A change that arrives during the decision waits and then
commits after it (accepted-then-suspended is a legal order; booking re-checks). Granting changes (email/phone
verification) take no lock because a stale "ineligible" is the safe direction. Not covered: eligibility changes made by
raw SQL that bypass the application writers (the database trigger only checks `APPROVED` at quote insert).
Tests (`test/eligibility-concurrency.e2e-spec.ts`, 20) hold an owner-role transaction open with one side's lock and
uncommitted change, start the other side through the real HTTP API, wait until PostgreSQL reports it blocked on a lock,
release, and assert both the response and the persisted rows — for suspension, offers, phone revocation, closed city,
deactivated task and venue prohibition against both submit and select, and for each writer against an in-flight
decision; the acceptance review added the role endpoint, identity outcome, submit, task, category and venue-status writers. Disabling the assistant `FOR SHARE` makes 9 of the first 14 fail, and making the writer helper take `FOR SHARE` instead of `FOR NO KEY UPDATE` also makes 9 fail (both mutation-checked and restored). Audit (acceptance review): every writer of an eligibility input was traced; `phone-verification`, email verification, password reset/change and `updateProfile`/`setAvailability` do not revoke eligibility and take no lock by design.

**Pending-quote cap (D-053).** Count and insert run under the request's `FOR UPDATE`; `test/quote-cap.e2e-spec.ts` (7)
uses 25 fully approved assistants through the API: 19→20 accepted, 21st rejected with 409, a withdrawal frees exactly one
slot, concurrent racers never exceed 20, withdraw racing submit stays consistent. Removing the request lock fails the
concurrent cases.

**Cancellation reason (D-054).** Unchanged: required only after a quote was accepted (whitespace = none), enforced by the
API (400 on `reason`), mirrored by the UI label, covered by API, component and browser tests. Owner decision pending.

**Browser suite (D-055).** `apps/e2e` (Playwright 1.64.0, Chromium) drives the real login form against the real API and a
production web build, both started by Playwright's `webServer` on ports 4100/3100, backed by the dedicated `qyou_test`
database. 19 tests: customer discovery → filter → profile → request (with a rejected contact-detail attempt) → two
assistants quote → compare → accept (+ database assertions); assistant feed → quote validation → quote → My quotes →
withdraw → re-quote; anonymous redirects, cross-customer 404s, wrong-city assistant, customer/draft applicant 403,
assistant suspended while the form is open, customer told a suspended assistant can't be chosen; cancelled, accepted,
expired requests (no quotes, no selection); cancellation reason rules in the UI; private-field and competitor-quote
boundaries on pages and API JSON; 375px layout (no horizontal overflow, controls on-screen) and tap-through quote and
accept flows. It is not a visual-regression suite and covers one browser engine.

### Public registration contract (M1.8, D-056)

`POST /auth/register` (public, CSRF-checked, 10/h/IP). Request: `{ email, name, password }` (strict, unchanged validation).
Responses:

| Case                                                                                                                       | Status  | Body                                                                                                                                         | Cookie   |
| -------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Invalid input (shape, password rules, unknown fields)                                                                      | 400     | field issues about the input only                                                                                                            | none     |
| Over the per-IP limit                                                                                                      | 429     | `Retry-After`, same for any address                                                                                                          | none     |
| **Everything else** (new, verified, unverified, suspended, case/Unicode variants, over the per-address limit, a lost race) | **202** | `{ "message": "Thanks. Check your inbox for an email from Qyou with what to do next. It can take a few minutes. Then log in to continue." }` | **none** |

Flow in `AuthService.register`: (1) hash the password (always); (2) per-address limiter `register-address:<email>` (3/h):
over it, return; (3) look the address up; if it exists, audit `auth.register.existing_account` and, for an `ACTIVE` account
only, send the "already have an account" note (login + forgot-password links, no token); (4) otherwise one transaction
creates the unverified customer, its verification token and the `auth.register` audit row, and the verification email is
sent after commit; (5) a unique-violation race is treated as (3). Mail is fire-and-forget and never awaited, so delivery
time does not reach the caller. The web form (`RegisterForm`) shows the API's own sentence in a "Check your email" panel and
has no status-specific branch. Tests: `registration-privacy.e2e-spec.ts` (17, real PostgreSQL), `auth.e2e-spec.ts`,
`register-form.test.tsx` (5) and the Playwright spec `registration.spec.ts` (4). Mutation-checked: making the existing-
address path throw 409 again fails 11 of the 17 API tests. Limitations are listed in D-056.

## Planned backend modules (design intent)

`auth · users · assistants · verification · service-categories · service-locations ·
service-requests · matching · bookings · tracking · messaging · payments · reviews · disputes ·
notifications · favorites · wait-reports · virtual-queues · businesses · admin`

Implemented so far: `auth`, `authz`, `admin`, `assistants` (profiles, onboarding, phone + identity verification workflow), `service-requests` (requests, quotes, selection), `service-categories`, `service-locations`, `seed` (with
`audit`, `mail`, rate limiting as shared infrastructure) and `health`. Rules: one module per cohesive responsibility, not per noun; modules depend on each other through
exported services only; no circular dependencies; business rules live in domain services (not
controllers); create modules when their phase starts, not before. `rewards` (Stellar) is
deferred and sits behind an interface (see Stellar).

## Domain model (design intent — distinct concepts, distinct tables)

| Concept             | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| ServiceRequest      | What the customer needs (task, location, time window)                    |
| Quote               | Proposed cost breakdown for a request/assistant; immutable once accepted |
| Booking             | Accepted commercial engagement; owns the status state machine            |
| Job status / events | Operational progress, stored as append-only events on a booking          |
| Payment             | Money collected/charged (provider reference, idempotency key)            |
| Payout              | Money owed/paid to an assistant                                          |
| WaitReport          | A community observation about a place's wait (never an "official" queue) |
| VirtualQueueTicket  | Participation in a participating business's queue                        |

Money is stored as integer minor units (kobo) with an ISO currency code. Never floats.
IDs are UUIDv7. Timestamps are `timestamptz`.

### Booking state machine — DRAFT (to be ratified as an ADR before Phase 2 code)

Main path:
`requested → quoted → awaiting_payment → confirmed → accepted → assistant_en_route → arrived →
in_progress → awaiting_confirmation → completed`

Branches to specify precisely in Phase 2:

- `requested`/`quoted`: assistant rejects or quote expires → `rejected` / `expired`
- `awaiting_payment`: payment failed → stays `awaiting_payment` (retry) or `expired`; only a
  **verified provider webhook** (never the browser redirect) moves it to `confirmed`
- `confirmed`: assistant does not accept in time → reassignment (back to matching) or `cancelled` + refund
- Any pre-`in_progress` state → `cancelled` with a refund amount determined by the cancellation policy
- `awaiting_confirmation`: customer confirms → `completed`; customer silent past a deadline →
  auto-`completed`; customer objects → `disputed`
- `disputed` → resolved by admin to `completed` (payout), `cancelled` (full refund) or a partial
  refund; every resolution is audited

All transitions are validated server-side by a single transition table; no endpoint accepts an
arbitrary target status. Booking creation and any money movement use DB transactions and
idempotency keys.

## Security boundaries (design intent unless marked)

- Authentication: database-backed sessions for customers/assistants/staff (D-011, implemented).
- Authorization: role checks **and** resource ownership checks, enforced in guards/services on
  the server (implemented for roles, verified email, and sessions; see Authorization). Customers see only their bookings; assistants only jobs offered/assigned to them;
  admin permissions are explicit and audited.
- Audit log for security- and money-relevant actions (`audit_logs`, implemented for auth/admin),
  append-only at the database level (see Audit-log integrity).
- Validation at every API boundary with zod (D-009). Implemented for env and all auth inputs
  (strict objects: unknown fields such as `role` are rejected).
- Payments: provider behind an interface; secrets via environment/secret manager; webhooks
  signature-verified and idempotent; reconcile states, never trust the frontend success page.
- Location: minimal necessary; no background tracking without an explicit user-controlled
  permission; share assistant location with the customer only during an active booking.
- Personal data: collect the minimum; verification **documents are not stored at all** (D-039); legal name/phone are access-controlled and audited but not yet encrypted at rest (D-043).
- Web headers (implemented on API): Helmet defaults; CORS limited to `CORS_ORIGINS`.

## Payments (design intent)

`PaymentProvider` interface (initialise charge, verify webhook, refund, payout where supported).
The provider is **not yet chosen** (D-012). Escrow, split payments and automated payouts are
claimed only if the chosen provider's real API supports the implemented flow; otherwise payouts
are an operational, reconciled process.

## Stellar (isolated, deferred)

No dependency from auth, bookings, payments or queues. If added, it lives in its own module behind
an interface (e.g. `RewardsPort`) fed by domain events, and the product runs with it disabled.
The earlier Stellar/Soroban implementation was removed from the working tree (still in git
history) as part of the rebuild.

## Testing strategy

- Unit: pure logic (config, tokens, password hashing, rate limiter, schemas, filters) with Vitest, no I/O.
- Integration/e2e (API): real PostgreSQL (`qyou_test`), real Nest app via `configureApp`, connected
  as the **least-privilege runtime role** (so permission behaviour is real); setup/truncation uses
  the owner role. A test-only `ProbeController` exposes every decorator combination without adding
  fake endpoints to the product. Concurrency is tested with real parallel requests and, for the
  rate limiter, independent connection pools standing in for multiple API instances.
- Web: unit tests for logic and jsdom component tests (React Testing Library, StrictMode);
  Playwright browser e2e in `apps/e2e` (D-055; see "Marketplace hardening and browser tests (M1.5.1)").
- Gate: `pnpm check` locally and the same steps in `.github/workflows/ci.yml`.
