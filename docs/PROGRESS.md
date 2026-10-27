# Qyou — Progress

_Last updated: 2026-10-27 (end of M1.5.1 session)._ The code is authoritative; if this file looks
stale, verify against the repository and reconcile.

## Current state

**Phase 0, M1.1–M1.5 and M1.5.1 complete.** Commits: `5f4699d` (Phase 0 + M1.1), `c7979ed` (M1.2), `b7947b5` (M1.3),
`6527dd8` (M1.4). **All M1.5 and M1.5.1 work is uncommitted in the working tree** (commits/pushes need
explicit authorisation); nothing tracked was deleted. No tracked file contains secrets; `.env` files remain git-ignored.

## Completed in M1.5.1 — marketplace correctness and repeatable browser tests

- **Eligibility race fixed (D-052).** Audit finding confirmed first: `submitQuote`/`selectQuote` locked only the request
  row, so a suspension (or any revocation) could commit between the eligibility check and the quote commit. Now both lock
  the catalog rows and the assistant's `users` row `FOR SHARE` after the request lock, and every revoking writer takes
  `FOR NO KEY UPDATE` on that user row first (new `assistants/eligibility-locks.ts`; wired into admin transition, identity
  outcome, role assignment, `setServices`, `setPrivateDetails`, `submit`, venue-restriction add/remove). Catalog updates
  conflict through their own row locks. No schema change, no migration.
- **Race tests (14, deterministic).** `test/eligibility-concurrency.e2e-spec.ts` holds a transaction open with one side's
  lock and uncommitted change, fires the other side through the HTTP API, waits until PostgreSQL reports it blocked, then
  releases and asserts the persisted rows. **Mutation check performed:** with the assistant `FOR SHARE` removed, 9 of the
  14 failed; restored byte-for-byte.
- **Pending-quote cap tests (7).** `test/quote-cap.e2e-spec.ts`: 25 approved assistants; below/at/over the limit,
  withdrawal frees one slot, concurrent racers, withdraw racing submit, persisted pending count ≤ 20 asserted after
  each. **Mutation check:** removing the request `FOR UPDATE` fails both concurrent tests; restored. The implementation
  needed no fix.
- **Cancellation reason (D-054).** The rule (required only after acceptance) is explicitly written in the M1.5 design note
  and was already enforced consistently; kept, +2 API tests (blank/whitespace reason; optional before acceptance) and +1
  component test. **Not ratified as product policy: owner decision open.**
- **Browser suite (D-055).** New workspace `apps/e2e`: Playwright 1.64.0 (pinned) + Chromium, 19 tests in 6 files
  (customer journey, assistant quote/withdraw, access control, closed/expired, privacy, mobile 375px), isolated test
  database with a refusal guard, documented commands (RUNBOOK → Browser tests), `browser` job in CI (never executed).
  Product-code change: `distDir: process.env.NEXT_DIST_DIR || '.next'` in `next.config.ts` only.

### M1.5.1 checks (actually run, 2026-10-27, against `qyou_test` on the local Postgres 17 container)

| Check                                                                        | Result                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint` (`--deny-warnings`), `pnpm typecheck`       | clean                                                                                                   |
| API unit tests                                                               | 162 passed (22 files)                                                                                   |
| API e2e (real PostgreSQL, runtime role)                                      | **559 passed (25 files)** = 536 + 14 concurrency + 7 cap + 2 cancellation tests                         |
| Web unit + component tests                                                   | 133 passed (16 files)                                                                                   |
| `pnpm build`                                                                 | succeeded                                                                                               |
| `verify:headers` on the production build (served on 3200: 3000 was occupied) | passed, 8 pages                                                                                         |
| Clean-database migration check (throwaway Postgres 17 on 5463, then removed) | 7 migrations applied; `migrate status` up to date; `migrate diff` no difference; guard triggers present |
| Browser suite `pnpm e2e` (two consecutive runs, then the final run)          | 19 passed each time (~23 s)                                                                             |

Not done: a full `pnpm check` from a deleted `node_modules`/`dist`/`.next` (the long clean-install gate used in M1.5 was
not repeated; the individual steps above were run on the existing install); no CI run (nothing is pushed).

### Findings worth knowing

- The UI shows "Your request was blocked. Reload the page and try again." for **every** 403, including "you are no longer
  eligible"; accurate wording needs a UI change (not done, noted in D-054).
- API returns **403** (not 404) to an administrator calling customer request endpoints (role gate before ownership);
  no data is exposed either way, but D-050's "404 including for admins" is only literally true for the web pages.
- The web caches the catalog for 60 s on disk (Next data cache): browser fixtures must seed it once before the first page
  load (done in global setup).

## Completed in M1.5 — discovery, service requests and quotes

- **Design note first** (ARCHITECTURE → "Service requests, quotes and assistant discovery"), then migration
  `20261024081356_service_requests_quotes`: `service_requests`, `quotes` + enums; CHECKs, two partial unique indexes
  (one `ACCEPTED` quote per request; one active quote per assistant per request), triggers (immutability,
  transition tables, delegable task/venue consistency, no self-quote, no quote on a closed request), `DELETE`
  revoked from the runtime role.
- **Discovery**: `GET /assistants` gained `task` (with `category`), `language`, `q` and `location`; cards now list
  tasks and areas; `/assistants` has the filter form. Eligibility is unchanged and proven equal to the authoritative
  service by tests (D-049).
- **Requests**: customer-owned, strict input, task/venue/city consistency, venue rules, authorization
  confirmation, date-based scheduling with derived expiry, contact-detail tripwire, live-request cap; owner-only
  reads (404 otherwise); cancel; no edit, no reopen.
- **Quotes**: eligible assistants only, matching task/city/venue, no self-quote, no duplicate active quote, integer
  kobo, withdraw, per-assistant and per-request caps.
- **Selection**: one transaction under a row lock; winner `ACCEPTED`, others `NOT_SELECTED`, request
  `QUOTE_ACCEPTED`; cancellation closes live quotes; every transition audited with ids/enums only.
- **Web**: `/assistants` (filters), profile "Post a request", `/requests`, `/requests/new`, `/requests/[id]`,
  `/assistant/requests`, `/assistant/requests/[id]`, `/assistant/quotes`; header/account/home copy updated; header wraps
  on narrow screens.
- **Docs**: ARCHITECTURE (design note, API, limitations), DECISIONS (D-045…D-051), PRODUCT, ROADMAP, RUNBOOK.

## Latest checks

**Baseline before any change** (HEAD `6527dd8`, clean tree, run on 2026-10-24): `pnpm check` exit 0 — API unit 137,
API e2e 451, web 105.

**After M1.5** (2026-10-24, from a clean state: `node_modules`, generated client, `dist`, `.next`, tsbuildinfo
deleted; `pnpm install --frozen-lockfile`; `pnpm db:roles`; `pnpm db:deploy:test`; then `pnpm check`):

| Check                                                         | Result                |
| ------------------------------------------------------------- | --------------------- |
| `pnpm check` (format, lint, typecheck, test, test:e2e, build) | **exit 0**            |
| API unit tests (Vitest)                                       | 162 passed (22 files) |
| API e2e on real PostgreSQL `qyou_test`, runtime role          | 536 passed (23 files) |
| Web unit + component/rendering tests                          | 132 passed (16 files) |
| `pnpm lint` (`--deny-warnings`)                               | clean                 |
| `pnpm verify:headers` on the production build                 | passed, 8 pages       |

New e2e (85): customer requests 28, quotes and selection 33, discovery 14, database invariants 10. New unit: 25 API,
27 web. One pre-existing e2e assertion (`assistants-public`) pins the public card's exact keys; it now lists the new
`tasks` field and pins that field's shape — a deliberate, reviewed contract change, not a weakened test.

Runtime verification beyond the suites (actually performed):

- **Mutation check**: with `FOR UPDATE` removed from the request lock, the concurrent-selection test failed; restored.
- **Clean-database migrations**: all 7 applied to a throwaway Postgres 17 (roles first); `prisma migrate diff` reports no
  drift; both new tables, 6+3 CHECKs, 4 triggers and both partial unique indexes exist; the runtime role has
  SELECT/INSERT/UPDATE but **no DELETE** on `service_requests` and `quotes` and still cannot UPDATE `audit_logs`.
  Container removed afterwards.
- **Browser, production build + API + dev DB**, fixtures created through the real API: filtered `/assistants`
  (task + city) listing only the matching assistant with task chips; profile → "Post a request" → login redirect that
  preserved the target → prefilled form; a description with a phone number was rejected with the field message and
  nothing stored; a valid request posted; the matching assistant saw it (no customer identity), a non-matching
  assistant got an empty feed and 404 on the id; quote of ₦7,500.50 sent; second request with two competing quotes
  shown cheapest first, accept → confirm → "Quote accepted" with the other "Not selected" and honest "nothing has been
  charged" copy; cancel after accepting without a reason was refused with the API's message. Database and audit rows
  were checked (one `ACCEPTED`, one `NOT_SELECTED`, audit metadata ids/amounts only). Mobile (375 px): the
  header overflowed (scrollWidth 540) → fixed to wrap; re-measured 375 on five pages. **All test data was then deleted**
  (0 users/requests/quotes/audit rows; reference seed kept; audit triggers re-enabled; Mailpit emptied; servers stopped).
- **Not exercised in a browser** (e2e/component tests only): cancel with a reason, expiry, venue-scoped requests,
  withdraw, suspended-assistant states, pagination controls. _(All but pagination are now covered by the M1.5.1
  Playwright suite; the M1.5 run itself was manual.)_

### Defects found and fixed during this milestone

1. Header navigation overflowed at 375 px after adding links (found in the browser, not by any test) → wraps now.
2. Assistant-facing quote status said "Waiting for your decision" (customer wording) → separate assistant labels.
3. Test fixtures: expiry expectation for a quote on an expired request (409, not 404) corrected after reasoning about
   which is right; the register rate limit tripped a 14-assistant test (limiter reset per case); the privacy scan
   flagged legitimate boolean flags (`verification.email/phone`) → key-based scan with value checks for real secrets.
4. A scripted edit with an empty slice corrupted `assistants/[slug]/page.tsx` (found by the formatter); restored from
   git and redone with assertions.
5. Lint: unused/shadowed helpers, conditional `expect`, mock type parameters → fixed, not suppressed.

## Known issues / limitations

**Marketplace limitations (M1.5):**

- **No payments, fees, booking, messaging or notifications.** `QUOTE_ACCEPTED` is a dead end by design; nobody is told
  about a quote or a selection (assistants poll their feed, customers revisit). Currency (`NGN`), amount bounds and
  the absence of fees are placeholders, not decisions (D-012, D-048).
- ~~Eligibility race at selection~~ fixed in M1.5.1 (D-052). Acceptance still does not keep an assistant eligible
  afterwards: Phase 2 must re-check at booking.
- Requests/quotes are not moderated and cannot be edited; expiry is derived at read time (no job); the 20-pending-quote
  cap is covered since M1.5.1; there is no rate limit per customer beyond the IP limits, the live-request cap and the quote caps.
- Discovery has no ranking (none is justified by data), no geo-distance, and the public list can lag up to 60 s.
- Browser coverage is Chromium only, no pixel/visual regression, no pagination controls in the browser; the CI `browser` job has never run.

**Verification and launch blockers (unchanged and still unresolved):** no real identity-verification provider
(manual outcome-only review, single reviewer, D-038/D-039); no SMS provider (production phone verification returns 503,
D-040); no dual-admin approval; legal name/phone not encrypted at rest and no retention/erasure policy (D-043);
payment provider, fees/commission and refund/payout policy (D-012); enumeration-safe registration (M1.8, D-021);
CI has never run, including the new `browser` job (D-032); mail is fire-and-forget (D-020); audit integrity has the documented owner/superuser limits
(D-028); local DB owner is a superuser.

## Next action (exact)

**Owner decisions first (D-054 cancellation-reason policy; D-012 and providers), then M1.6 — Design system foundation and polished core pages** (see ROADMAP), or — if the owner prefers to unblock
Phase 2 first — the **Phase 2 design ADRs**: booking state machine (starting from `QUOTE_ACCEPTED`), payment-provider
shortlist and fee/refund/payout policy (D-012). Recommended order: (1) owner decisions on D-012 and on the
verification/SMS providers; (2) M1.8 enumeration-safe registration; (3) M1.7: extend the existing Playwright suite with
register → verify → login → logout → reset and no-CSP-violation assertions, and get one green CI run; (4) M1.6.

## Decisions awaiting the owner (do not decide silently)

- **D-054 cancellation reason:** keep "required only after a quote was accepted", or always require one (and whether repeated
  cancellations are moderated)?

- **D-012 (deferred by owner):** payment provider, commission %, fees, cancellation/refund policy, payout
  automation — required before any real payment implementation (Phase 2).
- Review and edit the seeded categories/tasks wording (D-035) and decide who enters the first real venues.
- **Identity-verification provider/process and SMS provider** (D-038 lists the selection requirements); who
  approves assistants (dual control?); retention/encryption policy for private details (D-043).
