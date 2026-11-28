# Qyou — Roadmap

Status legend: ✅ done · 🔄 in progress · ⬜ not started

## Phase 0 — Repository and architecture foundation ✅

- ✅ M0.1 Monorepo (pnpm workspaces), NestJS API, Next.js web, shared TS config
- ✅ PostgreSQL via Docker Compose, Prisma 7 migrations, baseline `User` model
- ✅ `/health/live` + `/health/ready` (real DB check), OpenAPI at `/docs`
- ✅ Web `/status` page proving web → API → DB
- ✅ Format, lint, typecheck, unit, e2e (real DB), build; CI workflow
- ✅ Docs set (PRODUCT, ARCHITECTURE, DECISIONS, ROADMAP, PROGRESS, RUNBOOK)

## Phase 1 — Identity and marketplace foundation ⬜

Suggested milestone order (each is a small vertical slice with its own tests):

- ✅ **M1.1 Customer auth**: register, login, DB-backed sessions, logout, password reset
  (Mailpit locally), rate limiting, CSRF, audit log, web pages + protected `/account`.
- ✅ **M1.2 Authorization & account security**: roles/verified-email guards, ownership pattern,
  admin role assignment + CLI-only administrator bootstrap, email verification, change password,
  log out everywhere, session list/revoke API, DB-level audit immutability (runtime role +
  triggers), PostgreSQL-backed rate limiter, web CSP.
- ✅ **M1.3 Reference data & discovery**: cities / categories / eligible tasks / locations /
  venue restrictions (migration with CHECK-enforced delegation rules), public read APIs, admin-only
  audited writes, insert-only seed (4 cities, 7 categories, 25 tasks, **no venues**), initial web
  discovery (home, search, category, location pages).
- ✅ **M1.4 Assistant profile, onboarding, verification**: public/private profile split, service
  areas and offered tasks from reference data, availability _preferences_, explicit application
  state machine (draft → submitted → under review → approved / rejected / changes requested,
  suspension), admin review queue with audited decisions, role granted only by the approval
  transaction through the existing role service, phone ownership verification behind a provider
  interface (fail-closed in production), **manual outcome-only identity review** (no provider,
  no documents stored), eligibility gate for future paid work, public assistant directory and
  profile pages. See D-038 – D-044.
- ✅ **M1.5 Eligible assistant discovery, service requests and quotes**: discovery filters (task, language,
  keyword, venue) over the authoritative eligibility rules; customer-owned service requests with an explicit
  lifecycle; assistant quotes (integer kobo); atomic single-quote selection under a row lock with database
  backstops; audited transitions; web pages for both sides. No payment, booking, messaging or notifications.
  See D-045 – D-051.
- ✅ **M1.5.1 Marketplace hardening and repeatable browser tests**: eligibility concurrency protocol (compatible
  locks on every record that can revoke eligibility, D-052); pending-quote cap e2e tests (D-053); cancellation rule
  documented and tested, owner decision open (D-054); Playwright suite for the marketplace journey on real API +
  web build + test PostgreSQL (D-055). The CI job exists but has never run. See PROGRESS.
- ⬜ M1.6 Design system foundation (shadcn/ui + Radix evaluation, tokens) and the polished
  homepage, search results, assistant profile, with loading/empty/error states
- ✅ **M1.8 Enumeration-safe registration (D-021, D-056).** Same 202 body and no session for every address; a new address gets
  a verification email, an existing active account gets a "you already have an account" note, a suspended one gets
  nothing; per-address limit; web "Check your email" panel; API, component and browser tests. Remaining limitations
  (squatting, best-effort timing) are listed in D-056.
- ⬜ M1.7 Playwright auth baseline: the framework and the marketplace journey exist (M1.5.1, D-055); still to add
  register→verify→login→logout→reset, assertions of no CSP violations, and a confirmed green CI run.
  _Deferred from M1.2, see D-031._

## Phase 2 — Complete booking journey ⬜

Service request → quote → booking, explicit state machine (ratified as an ADR before coding),
payment provider interface + test-mode integration with webhook verification and idempotency,
acceptance/assignment, cancellation/timeout/reassignment, customer bookings + assistant job
dashboard, full-lifecycle integration tests.
_Blocked on user decision: payment provider and refund/cancellation policy (D-012)._

## Phase 3 — Live execution and trust ⬜

Timeline, check-ins, messaging, notifications, completion evidence, reviews, disputes/refunds,
assistant safety and quality controls.

## Phase 4 — Queue intelligence ⬜

Locations, community wait reports, freshness/reliability, history/estimation, favourites/alerts.

## Phase 5 — Business queue management ⬜

Business onboarding/staff, queue + counters, virtual tickets, operator controls, ticket ETA,
real-time updates, business metrics.

## Phase 6 — Commercial hardening ⬜

Reconciliation + payouts, ops dashboards/financial reporting, abuse/moderation, security review,
performance tests, production deployment docs, growth features, optional Stellar evaluation.

## Launch gates (must be true before any public launch)

| Gate                                                                                                                                                                                     | Where tracked     | Status            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- |
| Enumeration-safe registration (done in M1.8; limitations in D-056)                                                                                                                       | M1.8, D-056       | ✅                |
| Payment provider chosen; fees/refund/payout policy decided                                                                                                                               | D-012             | ⬜ owner decision |
| First real CI run is green                                                                                                                                                               | D-032             | ⬜ needs a push   |
| Playwright smoke suite in CI (suite exists; CI job never executed)                                                                                                                       | M1.5.1, D-055     | ⬜ needs a push   |
| Non-superuser DB owner, secrets management, `FORCE_HTTPS`, real SMTP                                                                                                                     | Phase 6           | ⬜                |
| Audit-log off-box shipping / tamper evidence                                                                                                                                             | Phase 6, D-028    | ⬜                |
| Customers and assistants are **told** about quotes, acceptance and cancellation (email/push via the outbox, D-020); today they must revisit the site                                     | M1.5, D-020       | ⬜                |
| Payment, fee/commission and currency policy before any quote can become a booking (the `NGN` column is a placeholder)                                                                    | M1.5, D-012/D-048 | ⬜ owner decision |
| Moderation/abuse handling for request and quote text and for repeated cancellations                                                                                                      | M1.5              | ⬜                |
| Approved **identity-verification provider** (or an approved, documented manual process with dual control) and **SMS provider** selected, contracted and configured (D-038, D-039, D-040) | M1.4, D-038–40    | ⬜ owner decision |
| Assistant private details (legal name, phone): encryption at rest + retention/erasure policy (D-043)                                                                                     | M1.4, D-043       | ⬜                |
| Reference data reviewed by the owner (categories, task wording, per-venue restrictions) and real venues entered through the admin API                                                    | M1.3 follow-up    | ⬜ owner/ops task |

## Deferred / tracked items (from M1.1–M1.3 reviews)

| Item                                                                                                                                          | Why deferred                                                        | Planned                    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| Transactional email outbox (retries, dead letters)                                                                                            | would persist raw tokens unless redesigned (D-020)                  | Phase 3                    |
| ~~Enumeration-safe registration (D-021)~~ — done in M1.8 (D-056)                                                                              | delivered                                                           | done                       |
| Admin web UI for reference data (administration is API-only today)                                                                            | M1.3 scope was API + discovery                                      | M1.6 design pass / Phase 6 |
| Venue submissions by businesses or the community (venues come only from administrators)                                                       | needs moderation and provenance design                              | Phase 4–5                  |
| Trigram/full-text search, geo-distance sorting, map                                                                                           | volumes don't justify it yet (D-036)                                | Phase 4                    |
| Shared contracts package or OpenAPI response schemas (D-007)                                                                                  | drift guarded by shape tests                                        | when shapes churn          |
| Playwright auth baseline + CSP assertions (marketplace suite done in M1.5.1, D-055)                                                           | remaining scope of M1.7                                             | M1.7                       |
| First real CI run (D-032)                                                                                                                     | needs a push; nothing pushed                                        | when the owner pushes      |
| Audit tamper-evidence (hash chain), off-box shipping, alerting on trigger/privilege changes                                                   | beyond in-DB controls (D-028)                                       | Phase 6                    |
| Sessions list UI on `/account` (API exists)                                                                                                   | not required by the milestone                                       | with M1.6 design pass      |
| 2FA / login-alert emails / Argon2 rehash-on-login                                                                                             | scope                                                               | Phase 6                    |
| CSP reporting endpoint, Trusted Types                                                                                                         | scope                                                               | Phase 6                    |
| Redis rate limiter                                                                                                                            | only if profiling shows DB load (D-017)                             | Phase 6                    |
| Background expiry of stale requests, request/quote editing, reopening a cancelled request                                                     | derived expiry and cancel-and-repost are sufficient for now (D-046) | with Phase 2 booking       |
| Directed requests ("hire this assistant"), saved assistants, geo-distance matching                                                            | need pricing/availability rules (D-045)                             | Phase 2–4                  |
| Re-check assistant eligibility at booking time (selection is race-safe at commit, D-052, but acceptance does not keep the assistant eligible) | Phase 2 booking must call `canServe` again                          | Phase 2                    |
| ~~Browser-automation coverage of the request/quote journey~~ — done in M1.5.1 (D-055)                                                         | delivered                                                           | done                       |
| Non-superuser DB owner + secret management in production                                                                                      | deployment work                                                     | Phase 6                    |
| Dual control for assistant approval (second admin), approval expiry / periodic re-verification                                                | single owner today; needs a provider/process decision (D-038)       | before launch / Phase 6    |
| Assistant profile photo (needs safe upload pipeline: malware scan, EXIF strip, object storage)                                                | no upload infrastructure yet; initials avatar used                  | Phase 3                    |
| Assistant notification emails on decisions (outbox, D-020)                                                                                    | status is visible in the dashboard                                  | Phase 3                    |
| Admin UI pagination controls beyond 20/page and queue filters by city                                                                         | volume is nil                                                       | with M1.6 design pass      |

## Dependency notes

- Phase 2 depends on Phase 1 identity, locations and assistant verification.
- The booking state machine and payment provider choice must be decided _before_ Phase 2 code.
- Messaging/notifications (Phase 3) will need a realtime transport decision (SSE vs WebSocket) and
  a transactional email outbox (D-020).
- Real payments are blocked on D-012 (owner decisions on provider, fees, refunds, payouts).
