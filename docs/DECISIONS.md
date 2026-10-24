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

**D-007 `packages/contracts` still deferred (re-reviewed in M1.3).** M1.3 added the first public
response shapes the web consumes (categories, tasks, cities, locations). They are mirrored by hand in
`apps/web/src/lib/catalog.ts`; drift is guarded because the API e2e tests assert the exact field set
of every public response and the web has unit tests against the same shapes. Revisit (zod schemas in a
shared package, or generated OpenAPI types) when a second consumer appears or the shapes churn; response
schemas are not yet in OpenAPI.

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

**D-021 Enumeration-safe registration is a LAUNCH REQUIREMENT (decided 2026-10-23; scheduled as
M1.8, before Phase 2 and in any case before public launch).** Today registration returns 409 for an
existing email, so anyone can test whether an address has an account (rate-limited at 10/h/IP;
login, password reset and verification are already enumeration-safe). That is acceptable for
development and private testing only. **Required design for M1.8:** `POST /auth/register` always
answers with the same neutral response ("check your email") whether or not the address exists; a new
address gets a verification email and its account is created unverified; an existing address gets
a different email ("someone tried to register with your address; you already have an account — log in
or reset your password") and nothing else changes. Timing must not differ (do the work
asynchronously/equal-cost). This changes the sign-up UX (no instant session; the user confirms by email
or the first login is allowed but flagged unverified — to be decided in M1.8 with the funnel in mind) and
the web register page and tests. It is tracked in ROADMAP → "Launch gates". Authentication behaviour is
**deliberately not changed in M1.3.**

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

**D-033 Reference-data model: cities are places, not venues; one category per location; eligibility
as data with database-enforced rules.** `City` (launch places) and `ServiceLocation` (a real venue,
entered by an administrator) are separate tables, so a city can exist with zero venues and nothing is
ever invented to fill it. A location has exactly one `ServiceCategory` (a branch is a bank); multi-category
venues can be modelled as separate records until a real need appears. `EligibleTask` carries the
delegation rules from PRODUCT.md as **data** (`ELIGIBLE` / `REQUIRES_AUTHORIZATION` / `NOT_DELEGABLE`, with
mandatory authorization notes or a mandatory reason) and the invariants are CHECK constraints (presence or
credentials ⇒ `NOT_DELEGABLE`, etc.) in addition to API validation, so no code path or manual SQL can
contradict them. Non-delegable tasks are deliberately listed so the product can say _why not_ and booking
(Phase 2) can reject them. Slugs are immutable (stable URLs); a location's city, category and slug are
immutable too (restrictions depend on its category); there is **no hard delete** — records are deactivated
or archived, and foreign keys are `RESTRICT`. Location lifecycle is an explicit state machine
(`PENDING_REVIEW→APPROVED|REJECTED`, `APPROVED→ARCHIVED`, `REJECTED→PENDING_REVIEW`, `ARCHIVED→APPROVED`;
other moves 409). The public sees only `APPROVED` locations whose category **and** city are active
(single definition in `publicLocationWhere`); everything else is indistinguishable from "does not exist".
Provenance (who created/approved) lives in the audit log rather than extra columns; a `source` column
(admin / business / community) will be added when business onboarding (Phase 5) and community submissions
(Phase 4) need it.

**D-034 Venue-specific restrictions are rows, and they can only tighten.** `LocationRestriction`
(`PROHIBITED` / `REQUIRES_AUTHORIZATION` / `ADVISORY`, whole-venue or per task, unique per rule with
`NULLS NOT DISTINCT`) is overlaid on a task by a pure, unit-tested function (`applyVenueRestrictions`):
strictest wins and a venue can never loosen a task's own eligibility. The public location page shows the
effective eligibility, the task's own one when stricter, and each venue note.

**D-035 Seed policy: insert-only, real reference data only, no venues.** `pnpm --filter @qyou/api db:seed`
inserts _missing_ cities (Kaduna, Abuja, Kano, Lagos — approximate centre coordinates), 7 categories and 25
tasks with `ON CONFLICT DO NOTHING` in one transaction; it never updates, reactivates or deletes anything
(administrator edits win), writes one `system.reference_data_seeded` audit event only when something changed,
and **seeds no locations, assistants, reviews or wait times** (a unit test forbids business names and
review/wait-time vocabulary in the seed data). The categories and task wording are a _proposal_ for owner
review: they can be edited through the admin API without a deploy, and eligibility text is product policy,
not legal advice about third-party rules (venues set their own, recorded per venue).

**D-036 Public read behaviour: short success-only cache, literal search, capped pages.** Public reference
reads send `Cache-Control: public, max-age=60, stale-while-revalidate=120` via an interceptor that sets it
**only after success** — an e2e test caught that `@Header()` also stamps 404/400 responses, which a shared
cache could then serve for a record that had just been approved. Search text escapes `%`, `_` and `\` (Prisma's
`contains` does not; a test caught `q=%` matching everything). Lists are paginated (`pageSize` ≤ 50, stable
`name, id` ordering); categories and cities are returned whole because they number in the dozens (documented,
not paginated). `ILIKE` over a few hundred rows per city is fine; a trigram index is the upgrade path.

**D-037 Discovery web UI: server-rendered, a plain GET search form, honest states.** Pages fetch the
public API on the server (60 s revalidate) and degrade to explicit _unavailable_ / _empty_ states
(never an exception, never a fake list); the search bar is a native `<form method="get" action="/search">`
that works without JavaScript and produces shareable URLs; URL parameters are parsed defensively and invalid
ones dropped. Copy states exactly what exists ("no locations added yet", "there are no assistants or bookings
on Qyou yet"). No admin web UI yet: administration is API-only in M1.3 (see ROADMAP deferrals).

## Open (need input before the milestone that depends on them)

~~**D-011 Session strategy (M1.1).** Candidates: server-side sessions in PostgreSQL with HttpOnly
cookie (simplest, revocable, works for Next SSR) vs short-lived JWT access + refresh rotation.
Default recommendation: **database-backed sessions + HttpOnly SameSite=Lax cookies**.~~
**Resolved — see D-011 under Accepted.**

**D-038 Verification-provider decision: NO identity or SMS provider is integrated in M1.4.** Inspection
found no provider contract, API key, data-processing agreement or owner approval, so nothing may
receive identity or phone data, and nothing is simulated as if it were real. Identity is a
**manual review** whose _outcome_ is recorded (D-039); SMS is behind an interface that is simulated
only in development and **fails closed** in production (D-040). Candidates the owner should
evaluate (names only — _unverified_ market knowledge, not endorsements; confirm current coverage,
pricing and terms directly before choosing): for identity, Nigeria-focused KYC vendors such as Smile ID,
Dojah, Youverify or Prembly (NIN/BVN/liveness checks) or a global vendor; for SMS/OTP, Termii, Africa's
Talking or Twilio (or WhatsApp/voice OTP). **Selection requirements** (any candidate must meet all):
(1) legal basis and a signed data-processing agreement covering Nigerian data-protection law (NDPA 2023);
(2) data residency/transfer terms in writing; (3) the provider returns a _result_ plus a
reference — Qyou stores only that, never images or ID numbers; (4) signed, replay-protected
webhooks (or polling) with idempotent handling; (5) sandbox with documented test inputs so tests never hit
production; (6) delivery receipts and sender-ID registration for Nigerian carriers (DND/ NCC rules)
for SMS; (7) published uptime, cost per check, and a manual-review fallback; (8) the ability to purge
data on request. Until then the launch gate in ROADMAP stays open.

**D-039 Manual identity review stores outcomes only.** `IdentityCheck` rows hold `result`
(PASSED/FAILED/INCONCLUSIVE), `method = MANUAL_REVIEW`, the reviewing admin, an optional opaque
`evidenceRef` and short notes. Any value containing a run of ≥ 9 digits (after stripping spaces,
dots, hyphens) is rejected so an ID/card/phone number cannot be pasted into those fields; this is a
tripwire, not a guarantee. Raw documents, selfies and ID numbers are never accepted by any endpoint, and
there is no upload feature; evidence stays in whatever secure system the reviewer uses. The latest
outcome is denormalised to `identityOutcome` on the profile and only `PASSED` satisfies
approval. Recording an outcome is allowed only while the application is under review and is audited. A
single reviewer is a **limitation** (no dual control); see ROADMAP deferrals.
Alternatives: store documents in PostgreSQL / ordinary uploads (forbidden by the brief and a data
breach liability), integrate a provider now (no approved provider, D-038).

**D-040 Phone verification: provider interface, simulated only in development, fail-closed in
production.** `SmsService.send(phone, message)`. `SMS_PROVIDER=dev` (default outside production) emails the
message to Mailpit labelled **SIMULATED — no SMS was sent**; `SMS_PROVIDER=none` (the production default,
and the only value production accepts) returns 503 _before_ any code is created, so the user is told
verification is unavailable instead of waiting for a text that will never arrive. Codes are 6 digits
from a CSPRNG, stored only as `HMAC-SHA256(PHONE_CODE_PEPPER, tokenId|phone|code)` (a bare hash of a
6-digit code is brute-forceable from a DB dump), single-use (atomic claim), 10-minute TTL, 5 attempts
via an atomic counter, 60 s resend cooldown, and rate limits of 5 requests/h per user, 3/h per number and
10 verification attempts/15 min per user (plus per-IP caps on the endpoints). Only Nigerian (+234) mobile numbers are accepted; a verified
number is unique across accounts (partial unique index). Verifying a number does not grant any role.
`PHONE_CODE_PEPPER` is required (≥ 32 chars) in production. Limitation: SIM-swap and number-recycling
risk are not mitigated; the dev path is not evidence of delivery.

**D-041 Role invariant: the ASSISTANT role exists if and only if the application is APPROVED.**
Approval and suspension/rejection change the application status and the user role in **one
transaction**, using the existing `AdminUsersService.assignRoleInTransaction` (the same code path as
manual role assignment, so its rules and audit apply). There is no public or self-service route that
grants ASSISTANT, completing a profile grants nothing, and role changes still require a verified-email
user. Approval re-checks every requirement server-side inside the transaction (email, phone, identity PASSED,
completeness) and returns the list of blockers. Alternatives: separate "assistant enabled" flag (two
sources of truth), grant the role at submission (violates the policy).

**D-042 Application state machine and edit locks.** States: DRAFT, SUBMITTED, UNDER_REVIEW,
CHANGES_REQUESTED, APPROVED, REJECTED, SUSPENDED. Allowed: DRAFT→SUBMITTED; CHANGES_REQUESTED→SUBMITTED;
SUBMITTED→UNDER_REVIEW; UNDER_REVIEW→CHANGES_REQUESTED|APPROVED|REJECTED; REJECTED→UNDER_REVIEW
(reconsideration); APPROVED→SUSPENDED; SUSPENDED→APPROVED|REJECTED. Every decision except starting a
review needs a reason (≥ 10 characters, shown to the applicant) and is audited in the same transaction.
Applicants edit freely in DRAFT/CHANGES_REQUESTED; while SUBMITTED/UNDER_REVIEW/REJECTED/SUSPENDED nothing is
editable (so a reviewer never approves content that changes underneath them); once APPROVED only
non-identity fields can change (display name and legal name are locked, because they are what was verified).
Changing offered tasks after approval is allowed but re-validated against the reference data.

**D-043 Private assistant data: separate table, no public path, encryption/retention not yet done.** Legal name
and phone live in `assistant_private_details`, which no public query selects (public output is an
explicit allow-list, covered by a recursive key-scan test). Admin reads of private details are
audited every time (`admin.assistant.private_viewed`). **Not done, tracked as a launch gate:**
application-level encryption at rest for these columns, a retention and erasure policy (including
what happens to rejected applicants), and DSAR tooling. The audit log still holds actor ids and
reasons, never phone numbers or legal names.

**D-044 Eligibility gate and public visibility.** `AssistantEligibilityGuard` (global, after the
verified-email guard) protects future paid-work endpoints declared with `@RequiresAssistantEligibility()`:
active user ∧ role ASSISTANT ∧ email verified ∧ APPROVED ∧ phone verified ∧ identity PASSED ∧ ≥ 1
active city ∧ ≥ 1 effective offered task. `canServeTask(assistant, task, location)` reuses the M1.3
venue-restriction logic so a task a venue forbids is never offered there. Public listing/profile
show an assistant only when fully eligible and expose no ratings, reviews, response times or
counts, since none exist. Offering a non-delegable task is rejected by the API and by a database
trigger. Availability is stored as _preferred windows_ (max 4/day, no overlap, minutes since
midnight, timezone default Africa/Lagos) and displayed with an explicit disclaimer; it never
blocks or guarantees a booking.

**D-012 Payment provider and policies — DEFERRED by the owner on 2026-10-23; required before any real payment implementation (start of Phase 2 payments).** Needs evaluation of current availability and
requirements for Nigeria (candidates: Paystack, Flutterwave) plus **your decisions** on platform
commission %, customer fees, cancellation/refund policy, and whether payouts are automated or
manual at launch. Will not be decided silently.
