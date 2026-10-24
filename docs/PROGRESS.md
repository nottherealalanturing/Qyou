# Qyou — Progress

_Last updated: 2026-10-23 (end of M1.3 session)._ The code is authoritative; if this file looks
stale, verify against the repository and reconcile.

## Current state

**Phase 0, M1.1, M1.2 and M1.3 complete.** Commits: `5f4699d` (Phase 0 + M1.1), `c7979ed` (M1.2).
**All M1.3 work is uncommitted in the working tree** (commits/pushes need explicit authorisation);
nothing tracked was deleted. No tracked file contains secrets; `.env` files remain git-ignored.

## Completed in M1.3 — reference data and discovery

- **Schema documented first** (ARCHITECTURE → "Reference data model"), then migration
  `20261023223410_reference_data`: `cities`, `service_categories`, `eligible_tasks`,
  `service_locations`, `location_restrictions` + enums. Hand-written, database-enforced invariants:
  task presence/credentials ⇒ `NOT_DELEGABLE`; `REQUIRES_AUTHORIZATION` needs notes; `NOT_DELEGABLE`
  needs a reason; slug formats; coordinate ranges/pairs; non-blank notes; unique restriction per rule
  with `NULLS NOT DISTINCT`. Foreign keys are `RESTRICT` (no cascading loss). No new grants needed
  (default privileges from M1.2 gave the runtime role DML; verified).
- **Cities are not venues**: four launch cities exist with **zero** venues; nothing is invented.
- **Public API** (`@Public`, 60 s success-only cache): categories, category detail with tasks, cities,
  paginated/filterable locations (city, category, search), location detail with per-venue effective
  eligibility.
- **Admin API** (`@AdminOnly`, CSRF, audited in the same transaction): categories, tasks, cities, locations
  (explicit status state machine), venue restrictions. Slugs and a location's city/category are immutable;
  no hard delete; no-op PATCH writes and audits nothing.
- **Seed** (`pnpm --filter @qyou/api db:seed`): 4 cities (Kaduna, Abuja, Kano, Lagos), 7 categories, 25
  tasks (including explicitly non-delegable ones with reasons); insert-only, idempotent, no venues.
- **Web discovery**: `/`, `/search`, `/categories/[slug]`, `/locations/[slug]`, 404 page, footer; Airbnb-style
  cards, native GET search form, grouped eligibility, honest empty/unavailable states, mobile header fix.
- **Registration decision recorded**: enumeration-safe registration is a **launch requirement** (D-021),
  scheduled as **M1.8** and listed under ROADMAP "Launch gates". Authentication behaviour was **not changed**.
- **Docs**: ARCHITECTURE (model, API surface, web, tests), DECISIONS (D-007/D-021 revised, D-033…D-037),
  ROADMAP (M1.3 ✅, M1.8, launch gates, deferrals), PRODUCT (launch requirements), RUNBOOK (seed, admin API
  usage, troubleshooting).

## Latest checks

**Baseline before any change** (commit `c7979ed`, clean tree): `pnpm check` exit 0 — 33 API unit, 176 API
e2e, 53 web tests.

**After M1.3** (2026-10-23, from a clean state: `node_modules`, generated client, `dist`, `.next` deleted;
`pnpm install --frozen-lockfile`; `pnpm db:roles`; `pnpm db:deploy:test`; then `pnpm check`):

| Check                                                         | Result                |
| ------------------------------------------------------------- | --------------------- |
| `pnpm check` (format, lint, typecheck, test, test:e2e, build) | **exit 0**            |
| API unit tests (Vitest)                                       | 57 passed (12 files)  |
| API e2e on real PostgreSQL `qyou_test`, runtime role          | 276 passed (14 files) |
| Web unit + component/rendering tests                          | 79 passed (12 files)  |
| `pnpm lint` (`--deny-warnings`)                               | clean                 |

New e2e (100 tests): `reference-data-public` (28), `reference-data-admin` (56), `reference-data-integrity`
(16). They cover public reads and visibility (inactive/pending/rejected/archived/hidden-by-parent all 404
like unknown), filters, literal `%`/`_` search, stable pagination and validation limits, cache headers on
success only; **every admin endpoint** against anonymous, customer/assistant/business, unverified-admin and
cross-origin callers; admin writes, validation, duplicates (409), merged-state delegation rules, the status
state machine, restrictions (incl. venue-wide duplicates); audit exactly once per successful write and never
for failures, plus atomicity (a failing audit rolls the write back); concurrency (racing duplicates → one
winner); CHECK constraints and `RESTRICT` exercised with raw SQL; seed idempotence, non-destructiveness and
partial-state repair.

Runtime verification beyond the suites (actually performed):

- **Migrations on a clean database**: all 5 applied to a brand-new throwaway Postgres (roles created first
  from `docker/dev-db-roles.sql`, as infra would): all 11 tables present, 4 CHECKs on `eligible_tasks`,
  `NULLS NOT DISTINCT` index, runtime role has DML on the new tables, `audit_logs` still insert-only, and a
  task with `requiresCredentials=true, ELIGIBLE` was **rejected by the database**; re-deploy idempotent.
  On the existing databases: dev (`migrate dev`, "in sync") and the long-lived `qyou_test` (`deploy`).
- **Seed CLI** run for real against the dev DB twice (created 4/7/25, then 0/0/0) and against the clean DB as
  the runtime role.
- **Browser, production build + API + dev DB**: home (hero, search, 7 category cards "no locations yet", 4
  cities "No locations added yet", "what's live today"), category page (tasks grouped Available / Needs
  authorization with what to provide / Not available with why), search empty state, then — after adding
  **clearly-labelled QA venues via the real admin API** — 13 venues in Kaduna with cards, page 2, a search
  typed into the form (`venue 07` → 1 result, empty city/type params ignored), a venue page whose venue rule
  moved a task from _Available_ to _Needs authorization_, and the mobile layout (which exposed and then
  verified a header-wrapping fix). **All QA data was then deleted** from the dev DB (0 users/venues remain;
  seeded reference data kept; audit triggers re-enabled).
- `pnpm verify:headers` passes for all 7 pages (now including `/search`) of the production build.

### Defects found and fixed during this milestone

1. `@Header('Cache-Control')` also stamped **404/400 responses** (a shared cache could serve a stale "not
   found" for a just-approved venue) → success-only interceptor; test added.
2. Prisma `contains` does **not escape LIKE wildcards** (`q=%` matched everything) → `escapeLike`; tests for
   public and admin search. A silent no-op in my first fix for the admin search was caught by lint (unused
   import) and then covered by its own test.
3. Test-builder misuse and a meaningless placeholder assertion were found and removed; a weak constraint test
   that could pass for the wrong reason was tightened.
4. Mobile header links wrapped onto two lines → shorter label, `whitespace-nowrap` on buttons.
5. Redundant "Kaduna, Kaduna" and repeated venue-wide advisories under every task → fixed with a tested helper.

## Known issues / limitations

- **Enumeration-safe registration is not implemented yet (launch requirement, M1.8).** Registration still
  returns 409 for existing emails.
- **No real venues, assistants, reviews or wait times exist** — by design. Venues must be entered by
  administrators through the API after verification; until then every category/city shows zero locations.
- **Category names, task wording and eligibility text are my proposal** and need owner review (policy text,
  not legal advice about third-party rules). They can be edited via the admin API.
- **No admin web UI**: administration is API-only. Venue submissions by businesses/community don't exist.
- **Search is `ILIKE`** (fine for hundreds of rows per city); no full-text/trigram, no geo sorting, no map.
- **Public data is cached up to 60 s** (API header + web revalidate): a change can take about a minute to show.
- City coordinates are approximate centres; a location has exactly one category.
- Public response shapes are mirrored by hand in the web app (guarded by shape tests; D-007); OpenAPI lists
  request bodies but not response schemas.
- Still true from M1.2: CI has **never run** (D-032); no Playwright suite (D-031); mail is fire-and-forget
  (D-020); audit integrity has the documented owner/superuser limits (D-028); local DB owner is a superuser.

## Next action (exact)

**M1.4 — Assistant profile, onboarding and verification** (see ROADMAP.md), as a small vertical slice:

1. Decide with the owner the minimum real verification evidence at launch (ID type, selfie/liveness or not,
   references, who reviews) — **no fake identity verification** (PRODUCT.md); the design must not store raw ID
   documents until storage/encryption/retention is decided (see M1.2 audit/privacy notes).
2. Schema + migration: `AssistantProfile` (1:1 with user; bio, languages, service cities/categories drawn from
   the M1.3 reference tables, status `DRAFT→SUBMITTED→APPROVED|REJECTED|SUSPENDED`), `VerificationSubmission`
   (+ reviewer notes), with append-only audit of every decision.
3. Customer-side endpoints (own profile only — ownership pattern from M1.2): create/update draft, submit.
   Admin endpoints (`@AdminOnly`): review queue, approve/reject — **approval calls the existing role-assignment
   service** to grant `ASSISTANT` (requires verified email); no other path grants the role.
4. e2e tests (ownership, state machine, escalation attempts, audit); web onboarding form deferred to the M1.6
   design pass unless needed to prove the flow.
5. Full `pnpm check`, clean-DB migration test, docs.

**Before Phase 2 (booking) starts:** M1.8 enumeration-safe registration (D-021) and the owner decisions D-012.

## Decisions awaiting the owner (do not decide silently)

- **D-012 (deferred by owner):** payment provider, commission %, fees, cancellation/refund policy, payout
  automation — required before any real payment implementation (Phase 2).
- Review and edit the seeded categories/tasks wording (D-035) and decide who enters the first real venues.
- Minimum assistant verification evidence for M1.4 (see above).
