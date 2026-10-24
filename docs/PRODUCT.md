# Qyou — Product

## Vision

Qyou helps people get their time back by hiring trusted people ("assistants") to wait in queues or
perform eligible errands on their behalf. **Hiring an assistant is the primary product.** Queue
intelligence (community wait reports) and virtual queues support it; they are not the headline.

Launch market: Nigeria (NGN, Nigerian locations and context). Web-first (desktop + mobile web).

## Personas

| Persona                | Goal                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| **Customer**           | Delegate a wait or errand to someone trustworthy at a clear price    |
| **Assistant**          | Earn by accepting eligible jobs; build reputation; get paid reliably |
| **Business operator**  | Run a virtual queue, call next, see throughput (Phase 5)             |
| **Admin / operations** | Verify assistants, moderate, resolve disputes, reconcile money       |

## Core journey (the first release prioritises this end to end)

1. Customer describes a task, picks a location and a time.
2. Qyou shows eligible, available assistants and transparent pricing.
3. Customer submits a booking request and completes the configured payment flow.
4. An eligible, verified assistant accepts.
5. Customer tracks progress, gets updates, messages the assistant.
6. Assistant completes the task and provides completion evidence.
7. Booking completes; payment/payout is reconciled; customer can review.
8. Cancellations, incidents, refunds and disputes follow explicit policies.

## Supporting capabilities

Discovery of places/service locations · community wait reports with freshness/reliability ·
virtual queues run by participating businesses · ticket position/ETA · notifications · favourites ·
assistant profiles/reviews/verification · business queue tools · admin tools.

Reported physical queues (community observations) and official virtual queues (business-operated)
must always be visually and semantically distinct.

## Scope rules (safety / legitimacy)

Initially supported: **eligible queue assistance and authorised errands only.**
Prohibited: impersonation, unauthorised account access, tasks needing the customer's personal
presence or credentials that cannot be legitimately delegated. Venue-specific restrictions are
modelled explicitly (per service location / category), not hard-coded in UI copy.

## Commercial model

Commission on completed bookings with transparent pricing: assistant service fee + platform
commission + optional disclosed customer fees; payment-processing cost, refunds, cancellations and
dispute outcomes are first-class. Subscriptions, urgent premiums and virtual-queue SaaS are future
streams. Stellar-based rewards/receipts are optional and isolated; the marketplace works without it.

## MVP scope = Phases 1–3 (see ROADMAP.md)

### MVP acceptance criteria (high level)

- A customer can register, search assistants/tasks by location, request a quote, pay (provider test
  mode), and track a booking to completion, then review.
- An assistant can onboard, be verified by an admin, set availability, accept/reject jobs, check in,
  provide completion evidence and see earnings.
- Every booking status change is validated server-side against the state machine.
- Authorisation is enforced server-side per role and per resource.
- No fake payment success, fake verification, fabricated reviews or fabricated live queue data in
  production paths.

Per-milestone acceptance criteria live in ROADMAP.md and are checked off in PROGRESS.md.

## Launch requirements (not optional)

These are accepted gaps for development/private testing and **must be closed before public launch**
(tracked as gates in ROADMAP.md):

- **Enumeration-safe registration** — signing up must not reveal whether an email already has an account.
- Real payment provider with decided fees, refund/cancellation and payout policy.
- Reference data (categories, task wording, per-venue restrictions) reviewed by the owner, and real venues
  entered by administrators — Qyou never launches with invented businesses, reviews or wait times.
- A green CI run, a browser smoke suite, production database roles/secrets, and HTTPS settings.
