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
- ⬜ M1.2 Authorization foundation: role decorator/guard, resource-ownership helpers, suspended-user
  handling, admin-only bootstrap path (no self-service ADMIN), audit-log immutability, email
  verification (D-022), session list/"log out everywhere", password change while logged in
- ⬜ M1.3 Service categories, eligible tasks, service locations (seeded real reference data)
- ⬜ M1.4 Assistant profile, onboarding, verification workflow (admin review queue)
- ⬜ M1.5 Search & discovery API (filters/sort) and quote/request models
- ⬜ M1.6 Design system foundation (shadcn/ui + Radix evaluation, tokens) and the polished
  homepage, search results, assistant profile, with loading/empty/error states
- ⬜ M1.7 Playwright e2e baseline

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

## Dependency notes

- Phase 2 depends on Phase 1 identity, locations and assistant verification.
- The booking state machine and payment provider choice must be decided _before_ Phase 2 code.
- Messaging/notifications (Phase 3) will need a realtime transport decision (SSE vs WebSocket) and
  a transactional email outbox (D-020).
- Phase 6 must replace the in-memory rate limiter store before multi-instance deployment (D-017).
- Real payments are blocked on D-012 (owner decisions on provider, fees, refunds, payouts).
