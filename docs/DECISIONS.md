# Qyou — Decisions

Format: ID · decision · alternatives · rationale. Status: **Accepted**, **Open** (needs input), or
**Superseded**.

## Accepted

**D-001 Rebuild from scratch, web-only.** Previous repo contents (mobile app, Stellar/Soroban
packages, old backend) were no longer in the working tree at Phase 0 start (only CI + formatter
config remained; history has 600+ commits). Not migrating that architecture; history is the archive.

**D-002 pnpm workspaces (no Turborepo yet).** Alternatives: npm workspaces (previous CI used npm),
Yarn. Why: npm 11.5.1 on the dev machine crashes resolving the Nest 12 tree (`edgesOut` arborist
bug, reproduced twice from clean); pnpm installed the same tree in seconds, has strict dependency
isolation, and handles workspaces well. `packageManager` is pinned in `package.json`. Turborepo
adds nothing at two apps; revisit if build times matter.

**D-003 NestJS 12 (ESM) + Next.js 16 + React 19 + Tailwind 4.** Current stable lines at start
(Oct 2026). API is `"type": "module"` with `nodenext`, so relative imports end in `.js`.

**D-004 TypeScript 6.0.x, not 7.** TS 7 (native compiler) is `latest`, but `typescript-eslint`'s
peer range is `<6.1.0` and Nest/Next tooling targets 6.x. Revisit when the toolchain supports 7.

**D-005 Prisma 7.10 (stable) with driver adapter `@prisma/adapter-pg`.** `prisma@latest` on npm is
an 8.0 release candidate; we stay on the stable 7 line. Prisma 7 specifics: datasource URL lives
in `prisma.config.ts`, client is generated (ESM) into `src/generated/prisma`, `.env` is loaded
manually. UUIDv7 primary keys, `timestamptz`, snake_case table names via `@@map`.

**D-006 Vitest (unit + e2e), oxlint, Prettier.** Matches the Nest 12 scaffold defaults. oxlint
runs from the repo root with `--deny-warnings`; rules that are noise for this stack (React 19
JSX runtime, empty decorated Nest modules) are off. Type-aware lint rules are not enabled yet.

**D-007 `packages/contracts` deferred.** A shared package only when there is genuine value. Plan:
API owns zod schemas + OpenAPI; decide in Phase 1 whether the web consumes generated types
(openapi-typescript) or a shared zod package. `packages/config` exists now (tsconfig bases).

**D-008 PostgreSQL 17 via Docker Compose, host port 5452.** 5432/5433/5442 were occupied by other
local containers. A second database `qyou_test` is created by an init script for e2e tests so
tests never touch dev data.

**D-009 zod for validation (env now; request DTOs in Phase 1).** Alternative: class-validator.
zod gives one schema for runtime validation + types and shares well with the web. A Nest
integration (e.g. `nestjs-zod`) will be evaluated against Nest 12 when the first DTO lands.

**D-010 Replaced all previous GitHub workflows with a single `ci.yml`.** The old workflows
targeted workspaces that no longer exist (`@qyou/mobile`, `@qyou/shared`, `@qyou/stellar`,
Soroban contracts). Recoverable from git history. New CI runs the same gate as `pnpm check` with a
Postgres service.

**D-013 Design system foundation: shadcn/ui-style components on Radix primitives + Tailwind.**
Accessible, unstyled primitives we own, instead of a heavy themed library. Installed in M1.6 when
the first real screens need them. Tokens already exist in `apps/web/src/app/globals.css`
(coral brand, warm neutrals; contrast ratios documented there). System font stack for now to keep
builds hermetic; brand typography decided in M1.6.

**D-014 Honest placeholders.** Until a feature works, the UI does not show a fake version of it
(e.g. the Phase 0 home has no search box). No fabricated data in production paths.

**D-011 Database-backed sessions with opaque tokens (accepted 2026-10-23, implemented M1.1).**
Alternative: stateless JWT access + refresh rotation. Chosen because sessions must be revocable
immediately (password reset, suspension, logout), Next.js server rendering can validate them by
forwarding a cookie, and there is no third-party API consumer yet. Token = 256 random bits;
only its SHA-256 is stored (a DB leak yields no usable sessions). Cost: one DB read per
authenticated request (cached `lastSeenAt` writes are throttled to every 5 min).

**D-015 `@node-rs/argon2` for Argon2id.** Alternative: `argon2` (node-gyp / lifecycle script) or
Node's built-in `scrypt`. `@node-rs/argon2` ships prebuilt binaries (no install script, so it
fits the pnpm `allowBuilds` deny-by-default policy). Parameters follow the OWASP minimum
(m=19456 KiB, t=2, p=1); `needsRehash` upgrades are not implemented yet.

**D-016 In-house zod DTO pipe instead of `nestjs-zod`.** ~40 lines (`createZodDto` + global
pipe) with OpenAPI request schemas from `z.toJSONSchema`. Avoids depending on a third-party
package's Nest 12 / zod 4 support. Response schemas are not yet documented in OpenAPI.

**D-017 Rate limiting: in-house limiter, now PostgreSQL-backed (revised in M1.2).** Needed per-route
IP limits _plus_ per-account/per-(account, IP) failure counters with clear-on-success, which
`@nestjs/throttler`'s model does not express. M1.1 shipped an in-memory sliding window; its
documented flaw (per-process: N instances ⇒ N× the allowed guesses, reset on restart) directly
weakens the password-change and verification endpoints added in M1.2, so it was replaced.
Now: `rate_limit_counters(key sha256, windowStart, count)` with one atomic
`INSERT … ON CONFLICT DO UPDATE … WHERE count < limit` — correct across instances and restarts
with no new infrastructure (tested with three independent connection pools under concurrency).
Trade-offs: fixed windows (up to 2× burst across a boundary), one extra query per limited
request, fails closed if the DB is down. Alternatives considered: Redis (new infra to run and
secure for a modest request rate), sliding-log table (heavier writes). Revisit with Redis only if
limiter load shows up in profiling (Phase 6). `TRUST_PROXY` must still equal the real proxy count.

**D-018 Browser → web origin only (Next `rewrites` proxy for `/api/v1/*`).** Alternative: browser
calls the API origin with `credentials: include` + CORS. The proxy keeps the cookie first-party,
avoids CORS/third-party-cookie issues, allows the `__Host-` cookie prefix, and lets the API's
Origin-based CSRF check use one allow-listed origin. Cost: rewrites are resolved at build time
(`API_BASE_URL` needed for `next build`), and all API traffic transits the web server.

**D-019 CSRF via Origin verification + SameSite=Lax, no token.** OWASP-recognised defence when
all state-changing endpoints are JSON and every browser request carries `Origin`. Revisit if
non-browser cookie clients or cross-site embedding are introduced.

**D-020 Reset/verification tokens in the URL fragment; mail delivery stays fire-and-forget
(deliberately deferred in M1.2).** The fragment never reaches servers/logs/Referer; the pages strip
it from history after reading. Sending mail without awaiting keeps responses (and timing)
identical for unknown accounts; a failed send is logged by error name only. **Why no transactional
outbox yet:** an outbox must persist the message body, and these bodies contain the raw one-time
token — persisting it would break the "store only hashes" rule unless payloads are encrypted at
rest (key management we do not have). Mitigations that make loss tolerable today: every token
email has a user-driven resend (verification: authenticated resend; reset: request again), the
admin bootstrap reports `emailSent: false` explicitly, and tokens are 24 h/30 min. **Revisit:**
Phase 3 notifications, designed as an outbox that stores template + recipient and mints the token
at send time (so no secret is stored) with retries and a dead-letter view.

**D-021 Registration still reveals duplicate emails (409) — re-reviewed and deferred in M1.2.**
Enumeration-safe sign-up (always "check your email") means an email-first flow: no session until
the address is verified. That would hurt the core marketplace funnel (register → immediately book)
and now conflicts with the chosen policy that only _commitments_ require a verified email. What we
have instead: registration is rate-limited (10/h/IP), login and reset are fully enumeration-safe,
and verification links reveal nothing. Residual risk: an attacker can test whether an address has an
account (low severity, rate-limited). **Revisit before public launch / Phase 6 abuse work**, with
options: (a) per-email + CAPTCHA-style friction on duplicates, (b) email-first registration for
high-risk roles only (assistants), (c) full email-first sign-up.

**D-022 Email verification — implemented in M1.2.** Single-use 24 h tokens bound to the address,
hash-only storage, idempotent confirm, concurrency-safe, rate-limited; completing a password reset
also verifies. Policy (what requires verification) is in ARCHITECTURE.md → "Email verification
policy"; accounts remain usable for non-committing actions without it.

**D-023 Local Mailpit on host ports 1052 (SMTP) / 8052 (UI).** 1025/8025 are used by another
local project.

**D-024 Administrators are created by a CLI only; ADMIN is never grantable over HTTP.** Alternatives:
seed via env credentials, an install-time setup page, or admin-grants-admin over the API. Chosen
because any HTTP path to ADMIN is an escalation target. The CLI never handles a password: it
creates a verified account with an unknowable random password and emails a 24 h set-password link
(so no credential passes through argv, env, shell history or logs). Dry-run by default, refuses if
an administrator exists (`--additional`), never promotes/edits an existing account, serialised by
an advisory lock. Cost: needs working SMTP at bootstrap; recovery is the normal "forgot password"
flow. An administrator who loses their mailbox needs another administrator or direct DB access —
there is deliberately no HTTP recovery.

**D-025 Single role per account; roles assigned by an administrator through one service.**
`CUSTOMER` is the only self-service role. ASSISTANT and BUSINESS_STAFF are granted by an
administrator (later driven by onboarding approval flows, which must call the same service) and
require a verified email. Multiple simultaneous roles (e.g. a customer who is also an assistant)
are not modelled; the assistant profile (M1.4) will hang off the user so an assistant still
books as a customer under the same account — revisit if separate permissions per hat are needed.

**D-026 Authorization architecture.** Global guards in a fixed, tested order (CSRF → session →
roles → verified email); decorators declare, guards enforce; fail closed on misconfiguration;
authorization data read from the DB each request (no stale privileges, no cached claims);
resource-level checks are query-scoped in services with "not yours ⇒ 404". Alternatives: CASL /
policy-engine library (not needed for four roles; reconsider if per-resource rules multiply in
Phase 2+), JWT role claims (stale until expiry — rejected with D-011).

**D-027 Changing the password rotates the current session and revokes all others.** Alternative:
keep the current session unchanged. Rotation also invalidates any copy of the current token (the
attacker may have exactly that), at the cost of one new cookie. The current device stays logged in.
"Log out everywhere" revokes all sessions including the current one.

**D-028 Audit immutability by two layers: least-privilege runtime role + triggers; no FK on
`audit_logs`.** Alternatives: triggers only (a superuser-owned API could bypass), separate audit
database/service (more infra), hash-chained rows (tamper-evident but heavier; deferred to Phase 6
together with off-box shipping). Full threat model and limits: ARCHITECTURE.md → "Audit-log
integrity". Consequence: migrations must run as the owner role and the API as `qyou_runtime`, so
the codebase now has two connection strings (D-029).

**D-029 Two database identities: owner (`MIGRATION_DATABASE_URL`) vs runtime (`DATABASE_URL`).**
`prisma.config.ts` prefers the owner URL for the CLI; the API and e2e tests use the runtime role;
test setup uses `TEST_ADMIN_DATABASE_URL`. Roles are cluster-level and created by infra
(`docker/dev-db-roles.sql` locally/CI; template for production in the RUNBOOK); the migration
creates the NOLOGIN group role only if absent so a fresh database still migrates. The local owner
is a superuser (Docker image behaviour); production must use a non-superuser owner.

**D-030 Web CSP: nonce-based, set in `proxy.ts`, relaxed only in development.** Alternatives:
hash-based/static CSP (Next inline scripts change per build), `unsafe-inline` (defeats the point),
report-only first (we could test directly against a production build). Production has no
`unsafe-inline`/`unsafe-eval`; dev adds `unsafe-eval` (React) and `style-src 'unsafe-inline'`
because Next's dev tooling injects un-nonced style elements (observed: empty-string-hash
violations in the browser console). The strict policy is verified against the production build
(`pnpm verify:headers`, CI step, unit tests). All pages must stay dynamic. No CSP reporting yet.

**D-031 Browser automation suite (Playwright) — deferred to M1.7, with interim controls.** A real
browser suite needs a browser download, a test-environment orchestration story (API + web + DB +
Mailpit) and flake management; that is its own milestone and was already planned (M1.7). It would
not have changed any M1.2 security conclusion because the security properties are enforced and
tested server-side. Interim controls added now: jsdom component tests (including regression
tests for real bugs found in the browser), `pnpm verify:headers` against a production build, and
manual browser runs recorded in PROGRESS.md. Trigger to pull forward: first UI-heavy feature
(M1.6) or any CSP-related regression.

**D-032 CI is updated but remains unexecuted.** GitHub Actions cannot run locally and nothing has
been pushed; the workflow was updated for the runtime/owner roles and header verification, its
YAML parses, and every command in it was run locally in the same order. It is **not** evidence
that CI passes. First real run happens when the owner pushes; expect possible environment
differences (Postgres service superuser, `psql` availability, `next start` readiness).

## Open (need input before the milestone that depends on them)

~~**D-011 Session strategy (M1.1).** Candidates: server-side sessions in PostgreSQL with HttpOnly
cookie (simplest, revocable, works for Next SSR) vs short-lived JWT access + refresh rotation.
Default recommendation: **database-backed sessions + HttpOnly SameSite=Lax cookies**.~~
**Resolved — see D-011 under Accepted.**

**D-012 Payment provider and policies — DEFERRED by the owner on 2026-10-23; required before any real payment implementation (start of Phase 2 payments).** Needs evaluation of current availability and
requirements for Nigeria (candidates: Paystack, Flutterwave) plus **your decisions** on platform
commission %, customer fees, cancellation/refund policy, and whether payouts are automated or
manual at launch. Will not be decided silently.
