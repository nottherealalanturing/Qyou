# Qyou — Architecture

Status: **Phase 0 and M1.1 (authentication) implemented; everything else is design intent** and is
marked as such. When code and this document disagree, the code wins — fix the document.

## Shape

Modular monolith in a pnpm TypeScript monorepo. No microservices.

```
apps/api            NestJS 12 (ESM) REST API, Prisma 7 → PostgreSQL 17     [implemented: health, auth]
apps/web            Next.js 16 App Router, React 19, Tailwind 4             [implemented: shell, /status, auth pages]
packages/config     Shared tsconfig bases                                   [implemented]
packages/contracts  Shared API schemas/types — only when it earns its keep  [not created; D-007]
docs/               Product, architecture, decisions, roadmap, progress, runbook
docker-compose.yml  Local PostgreSQL (5452; DBs qyou, qyou_test) + Mailpit (SMTP 1052, UI 8052)
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
- `app.setup.ts` — shared bootstrap used by `main.ts` and the e2e tests: trust-proxy setting,
  Helmet (CSP relaxed for `/docs` only), JSON body limit (16 KiB; default body parser disabled so
  the limit applies — create the app with `APP_OPTIONS`), `cookie-parser`, CORS allow-list,
  global prefix `api/v1`, shutdown hooks, OpenAPI (with cookie-auth scheme).
- `common/zod` — `createZodDto(schema)` + global `ZodValidationPipe`: any `@Body()` typed with a
  DTO class is validated/normalised; 400 responses list `{path, message}` and never echo values.
  `zodBodySchema()` derives the OpenAPI request schema from the same zod schema.
- `common/http` — `AllExceptionsFilter` (generic 500; maps body-parser 413/400; sets
  `Retry-After` on 429; logs unexpected errors by name/code only, never messages).
- `common/rate-limit` — in-memory sliding-window `RateLimiter` + `@RateLimit()`/`RateLimitGuard`
  (per client IP). **Per-process state**: correct for one API instance; a shared store is needed
  before scaling out (Phase 6, tracked in ROADMAP).
- `audit/` — `AuditService.record()`; inside the caller's transaction when given a `tx`.
- `mail/` — `MailService` abstraction + SMTP implementation (nodemailer). Local: Mailpit.
  Delivery is fire-and-forget from the request (no outbox yet; see limitations).
- `auth/` — see below.

### Authentication (M1.1, implemented)

| Concern         | Implementation                                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords       | Argon2id (`@node-rs/argon2`, 19 MiB / t=2 / p=1); policy: 10–128 chars + common-password denylist; unknown-account logins burn an equal-cost dummy verification                                                                                                                                                            |
| Sessions        | Opaque 256-bit random token in an HttpOnly cookie; **only SHA-256(token) is stored** (`sessions`). Absolute TTL 30 d, idle TTL 7 d, `lastSeenAt` refreshed ≤ every 5 min, revocable (`revokedAt`), suspended users rejected on every request                                                                               |
| Cookie          | `HttpOnly; SameSite=Lax; Path=/`; production adds `Secure` and the `__Host-` prefix (name `__Host-qyou_session`); dev name `qyou_session`                                                                                                                                                                                  |
| Rotation        | Every login/registration issues a fresh token; a presented existing session is revoked in the same transaction (anti-fixation). Password reset revokes **all** sessions                                                                                                                                                    |
| CSRF            | `CsrfGuard` (global): state-changing request with an `Origin` outside `CORS_ORIGINS` → 403; cookie present but no `Origin` → 403. Plus SameSite=Lax and JSON-only bodies. No token round-trip needed because every browser sends `Origin` on cross-site POSTs                                                              |
| Authorization   | `SessionAuthGuard` is **global; routes are private unless `@Public()`**. Roles/resource ownership guards arrive in M1.2                                                                                                                                                                                                    |
| Reset flow      | 256-bit single-use token, SHA-256 stored, 30-min TTL, newest link wins (row lock on the user), atomic claim via `UPDATE … WHERE usedAt IS NULL AND expiresAt > now()` so concurrent use yields exactly one success; link uses the URL **fragment** (`/reset-password#token=…`), which is not sent to servers or in Referer |
| Enumeration     | Reset request: identical 202 body for known/unknown/suspended/over-limit addresses, mail sent asynchronously. Login: identical 401, equal-cost verification. **Registration does reveal duplicates (409)** — accepted trade-off for usability                                                                              |
| Rate limits     | register 10/h/IP · login 30/15 min/IP + 5 failures/15 min per (email, IP) + 20 failures/15 min per email · reset-request 10/h/IP + 3 mails/h/address · reset-confirm 10/15 min/IP                                                                                                                                          |
| Audit           | `auth.register`, `auth.login.success                                                                                                                                                                                                                                                                                       | failure | blocked`, `auth.logout`, `auth.password_reset.requested | completed` with IP + user agent; never secrets. Failure reasons are internal only |
| Secrets in logs | Nothing logs bodies; the exception filter logs error name/code only; verified by an e2e test that captures stdout/stderr across every flow                                                                                                                                                                                 |

Endpoints (`/api/v1/auth`): `POST register`, `POST login`, `POST logout` (idempotent, public),
`GET me`, `POST password-reset/request`, `POST password-reset/confirm`.

Web (`apps/web`): `/register`, `/login`, `/forgot-password`, `/reset-password`, `/account`
(server-validated, redirects to `/login?next=…`; `next` is restricted to same-site paths). The
header reflects session state; an API outage is shown as "unavailable", never as "logged out".

## Planned backend modules (design intent)

`auth · users · assistants · verification · service-categories · service-locations ·
service-requests · matching · bookings · tracking · messaging · payments · reviews · disputes ·
notifications · favorites · wait-reports · virtual-queues · businesses · admin`

Implemented so far: `auth` (with `audit`, `mail`, rate limiting as shared infrastructure) and
`health`. Rules: one module per cohesive responsibility, not per noun; modules depend on each other through
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
  the server. Customers see only their bookings; assistants only jobs offered/assigned to them;
  admin permissions are explicit and audited.
- Audit log for security- and money-relevant actions (`audit_logs`, implemented for auth). It is
  append-only by convention; DB-level immutability (trigger/revoked UPDATE/DELETE) is not yet enforced.
- Validation at every API boundary with zod (D-009). Implemented for env and all auth inputs
  (strict objects: unknown fields such as `role` are rejected).
- Payments: provider behind an interface; secrets via environment/secret manager; webhooks
  signature-verified and idempotent; reconcile states, never trust the frontend success page.
- Location: minimal necessary; no background tracking without an explicit user-controlled
  permission; share assistant location with the customer only during an active booking.
- Personal data: collect the minimum; verification documents stored encrypted with restricted
  access (design in M1.4).
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
- Integration/e2e (API): real PostgreSQL (`qyou_test`), real Nest app via `configureApp`.
- Web: unit tests for logic and jsdom component tests (React Testing Library, StrictMode);
  Playwright browser e2e from M1.7.
- Gate: `pnpm check` locally and the same steps in `.github/workflows/ci.yml`.
