# Qyou — Progress

_Last updated: 2026-10-24 (end of M1.4 session)._ The code is authoritative; if this file looks
stale, verify against the repository and reconcile.

## Current state

**Phase 0, M1.1, M1.2, M1.3 and M1.4 complete.** Commits: `5f4699d` (Phase 0 + M1.1), `c7979ed` (M1.2),
`b7947b5` (M1.3). **All M1.4 work is uncommitted in the working tree** (commits/pushes need explicit
authorisation); nothing tracked was deleted. No tracked file contains secrets; `.env` files remain git-ignored.

## Completed in M1.4 — assistant profiles, onboarding and verification

- **Design first** (ARCHITECTURE → "Assistants"), then migration `20261024073316_assistants`: `assistant_profiles`,
  `assistant_private_details`, `assistant_service_areas`, `assistant_task_offers`,
  `assistant_availability_windows`, `phone_verification_tokens`, `identity_checks` + enums; hand-written CHECKs,
  a partial unique index (one verified phone per number) and a trigger refusing `NOT_DELEGABLE` task offers.
- **Public/private split**: legal name and phone live in a separate table no public query selects; public
  output is an allow-list (recursive key-scan test); admin reads of private fields are audited.
- **State machine** (draft → submitted → under review → approved / rejected / changes requested; suspension)
  with reasons, edit locks, and audit rows in the same transaction (D-042).
- **Role invariant** (D-041): `ASSISTANT` ⇔ `APPROVED`, granted/revoked only through
  `AdminUsersService.assignRoleInTransaction` in the approval transaction. No other route grants it.
- **Phone verification** behind an `SmsService` interface (D-040): simulated via Mailpit in development,
  **fails closed (503, no code created)** in production; HMAC'd codes, expiry, single use, attempt caps, cooldown,
  per-user/number/IP limits, unique verified numbers.
- **Identity**: _manual review, outcomes only_ (D-038, D-039). No provider, no documents, no ID numbers stored.
- **Eligibility** (D-044): one definition + global guard for future paid-work routes; reuses venue restrictions.
- **Web**: `/assistant` dashboard (checklist, forms, phone verification, submit, status/reason),
  `/assistants` directory and `/assistants/[slug]` profile (public fields only), `/admin/assistants` queue and
  review page. Footer/home copy updated to say assistants are listed but booking is not live.
- **Docs**: ARCHITECTURE, DECISIONS (D-038…D-044), ROADMAP, PRODUCT (verification policy), RUNBOOK (env vars,
  review workflow, troubleshooting), `.env.example`.

## Latest checks

**Baseline before any change** (commit `b7947b5`, clean tree): API unit 57, API e2e 276, web 79.

**After M1.4** (2026-10-24, from a clean state: `node_modules`, generated client, `dist`, `.next`, tsbuildinfo
deleted; `pnpm install --frozen-lockfile`; `pnpm db:roles`; `pnpm db:deploy:test`; then `pnpm check`):

| Check                                                         | Result                |
| ------------------------------------------------------------- | --------------------- |
| `pnpm check` (format, lint, typecheck, test, test:e2e, build) | **exit 0**            |
| API unit tests (Vitest)                                       | 137 passed (19 files) |
| API e2e on real PostgreSQL `qyou_test`, runtime role          | 451 passed (19 files) |
| Web unit + component/rendering tests                          | 105 passed (14 files) |
| `pnpm lint` (`--deny-warnings`)                               | clean                 |
| `pnpm verify:headers` on a production build                   | passed, 8 pages       |

New e2e (175): onboarding 55, phone 26, admin 44, public 21, eligibility 29.

Runtime verification beyond the suites (actually performed):

- **Migrations on a clean database**: all 6 applied to a brand-new throwaway Postgres 17 (roles first, from
  `docker/dev-db-roles.sql`); `prisma migrate diff` reports no drift; 13 CHECKs on the new tables, the trigger and
  the partial unique index exist, runtime role has DML on the new tables and still **cannot UPDATE/DELETE
  `audit_logs`**. Container removed afterwards.
- **Browser, production build + API + dev DB + Mailpit**: applicant registered, verified email from Mailpit,
  started an application, completed profile/tasks/times/private details, verified a phone with the simulated
  code from Mailpit, submitted; admin opened the application (audited), started review, **approval was refused
  with "The identity review has not passed"**, recorded a Passed outcome, approved; DB showed role `ASSISTANT`,
  status `APPROVED`, and audit rows for every step; the public API/profile showed only allow-listed fields (no
  legal name, email, phone, evidence; no horizontal overflow at 375 px). **All test data was then deleted**
  (0 users, 0 audit rows; reference seed kept; audit triggers re-enabled; Mailpit emptied).
- **Not exercised in the browser** (covered only by e2e): changes-requested, rejection, suspension/reinstatement.

### Defects found and fixed during this milestone

1. Stale API build served pre-M1.4 code after the CLI rebuilt `dist` → restarted (process issue, no code defect).
2. `Requirements` interface not exported (TS4053) → exported.
3. Several scripted edits were silent no-ops after Prettier reformatting; found by inspection and re-applied.
4. A public-leak test matched harmless wording ("Manual review by Qyou") → replaced by a recursive key scan.
5. The per-number phone rate-limit test was convoluted and weak → rewritten with a pre-filled limiter.
6. Browser run: public profile showed "manual review by qyou" (an over-eager `toLowerCase()`) → fixed.
7. Browser run: the "Cannot approve yet" blocker stayed visible after the identity outcome made it false → blockers
   are now tied to the requirements they were computed from (regression test added). A first version used an effect
   and was rejected by lint (`set-state-in-effect`); the render-derived version is what ships.
8. Footer still said assistants were not live → updated.

## Known issues / limitations

**Verification limitations (the important ones):**

- **No identity-verification provider is integrated.** "Passed" means an administrator recorded the outcome of a
  manual check done outside Qyou. Qyou cannot validate documents, detect forgery or check liveness, and the opaque
  evidence reference is only as trustworthy as wherever it points. Single reviewer, no dual control; any verified
  administrator can approve anyone (audited).
- **No SMS provider exists.** Locally the code arrives by email in Mailpit (labelled SIMULATED). In production,
  phone verification returns 503, so **no real assistant can complete it until a provider is chosen** (D-038,
  D-040). A verified number proves control at one moment only (SIM-swap/recycling not mitigated).
- Legal name and phone are **not encrypted at rest** and have no retention/erasure policy yet (D-043).
- No profile photos (no safe upload pipeline); no notification emails on decisions; approval never expires.
- Changes after approval to bio/tasks/times go live without moderation.
- Not exercised in a browser: changes-requested, rejection and suspension flows (e2e only).

**Carried over:**

- **Enumeration-safe registration is not implemented yet (launch requirement, M1.8).**
- **No real venues, bookings, reviews or wait times exist** — by design; assistants appear only once a real person
  has been approved.
- Category names, task wording and eligibility text are a proposal needing owner review.
- Search is `ILIKE`; public data is cached up to 60 s; response shapes are mirrored by hand in the web app (D-007).
- CI has **never run** (D-032); no Playwright suite (D-031); mail is fire-and-forget (D-020); audit integrity has the
  documented owner/superuser limits (D-028); local DB owner is a superuser.

## Next action (exact)

**M1.5 — Search & discovery API (filters/sort) and quote/request models**, as a small vertical slice:

1. Assistant search by city, category/task and language over the _eligible_ set (reuse
   `publicAssistantWhere`/`canServeTask`), stable pagination and sort (no invented ranking signals: ratings and
   response times do not exist).
2. `ServiceRequest` and `Quote` models and state design (ADR before code), integer kobo money, no payments yet.
3. Owner decisions needed first (below): who may approve assistants and how identity is checked at launch.
4. e2e tests, docs, full `pnpm check`, clean-DB migration test.

**Before Phase 2 (booking) starts:** M1.8 enumeration-safe registration (D-021) and the owner decisions D-012.

## Decisions awaiting the owner (do not decide silently)

- **D-012 (deferred by owner):** payment provider, commission %, fees, cancellation/refund policy, payout
  automation — required before any real payment implementation (Phase 2).
- Review and edit the seeded categories/tasks wording (D-035) and decide who enters the first real venues.
- **Identity-verification provider/process and SMS provider** (D-038 lists the selection requirements); who
  approves assistants (dual control?); retention/encryption policy for private details (D-043).
