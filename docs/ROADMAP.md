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
- ⬜ M1.3 Service categories, eligible tasks, service locations (seeded real reference data)
- ⬜ M1.4 Assistant profile, onboarding, verification workflow (admin review queue)
- ⬜ M1.5 Search & discovery API (filters/sort) and quote/request models
- ⬜ M1.6 Design system foundation (shadcn/ui + Radix evaluation, tokens) and the polished
  homepage, search results, assistant profile, with loading/empty/error states
- ⬜ M1.7 Playwright e2e baseline (register→verify→login→logout→reset; asserts no CSP violations;
  run in CI). _Deferred from M1.2, see D-031._

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

## Deferred / tracked items (from M1.1–M1.2 reviews)

| Item                                                                                        | Why deferred                                        | Planned                 |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| Transactional email outbox (retries, dead letters)                                          | would persist raw tokens unless redesigned (D-020)  | Phase 3                 |
| Enumeration-safe registration (D-021)                                                       | conflicts with the signup→book funnel; rate-limited | before launch / Phase 6 |
| Playwright browser suite (D-031)                                                            | own milestone                                       | M1.7                    |
| First real CI run (D-032)                                                                   | needs a push; nothing pushed                        | when the owner pushes   |
| Audit tamper-evidence (hash chain), off-box shipping, alerting on trigger/privilege changes | beyond in-DB controls (D-028)                       | Phase 6                 |
| Sessions list UI on `/account` (API exists)                                                 | not required by the milestone                       | with M1.6 design pass   |
| 2FA / login-alert emails / Argon2 rehash-on-login                                           | scope                                               | Phase 6                 |
| CSP reporting endpoint, Trusted Types                                                       | scope                                               | Phase 6                 |
| Redis rate limiter                                                                          | only if profiling shows DB load (D-017)             | Phase 6                 |
| Non-superuser DB owner + secret management in production                                    | deployment work                                     | Phase 6                 |

## Dependency notes

- Phase 2 depends on Phase 1 identity, locations and assistant verification.
- The booking state machine and payment provider choice must be decided _before_ Phase 2 code.
- Messaging/notifications (Phase 3) will need a realtime transport decision (SSE vs WebSocket) and
  a transactional email outbox (D-020).
- Real payments are blocked on D-012 (owner decisions on provider, fees, refunds, payouts).
