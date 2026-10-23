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

**D-017 In-house in-memory rate limiter instead of `@nestjs/throttler`.** Needed per-route IP
limits _plus_ per-account/per-(account, IP) failure counters with clear-on-success, which the
throttler's model does not express. Known limitation: per-process; replace the store (Redis or
PostgreSQL) before running more than one API instance. `TRUST_PROXY` must equal the real number of
trusted proxies, otherwise IP limits and audit IPs are wrong or spoofable.

**D-018 Browser → web origin only (Next `rewrites` proxy for `/api/v1/*`).** Alternative: browser
calls the API origin with `credentials: include` + CORS. The proxy keeps the cookie first-party,
avoids CORS/third-party-cookie issues, allows the `__Host-` cookie prefix, and lets the API's
Origin-based CSRF check use one allow-listed origin. Cost: rewrites are resolved at build time
(`API_BASE_URL` needed for `next build`), and all API traffic transits the web server.

**D-019 CSRF via Origin verification + SameSite=Lax, no token.** OWASP-recognised defence when
all state-changing endpoints are JSON and every browser request carries `Origin`. Revisit if
non-browser cookie clients or cross-site embedding are introduced.

**D-020 Reset token in the URL fragment, mail delivery fire-and-forget.** Fragment never reaches
servers/logs/Referer; the page strips it from history after reading. Sending mail without awaiting
keeps the response (and timing) identical for unknown accounts; a failed send is logged by error
name only. Trade-off: no retry/outbox — a transient SMTP failure loses that email (the user can
request another). A transactional outbox belongs with the notifications work (Phase 3).

**D-021 Registration reveals duplicate emails (409).** Fully enumeration-safe sign-up needs an
email-first confirmation flow; deferred until email verification exists. Mitigated by the
registration rate limit. Password reset and login are enumeration-safe.

**D-022 Email verification not part of M1.1.** Accounts are usable immediately; `emailVerifiedAt`
is deliberately absent from the schema until the verification flow (needed before payments and
assistant onboarding) is built.

**D-023 Local Mailpit on host ports 1052 (SMTP) / 8052 (UI).** 1025/8025 are used by another
local project.

## Open (need input before the milestone that depends on them)

~~**D-011 Session strategy (M1.1).** Candidates: server-side sessions in PostgreSQL with HttpOnly
cookie (simplest, revocable, works for Next SSR) vs short-lived JWT access + refresh rotation.
Default recommendation: **database-backed sessions + HttpOnly SameSite=Lax cookies**.~~
**Resolved — see D-011 under Accepted.**

**D-012 Payment provider and policies — DEFERRED by the owner on 2026-10-23; required before any real payment implementation (start of Phase 2 payments).** Needs evaluation of current availability and
requirements for Nigeria (candidates: Paystack, Flutterwave) plus **your decisions** on platform
commission %, customer fees, cancellation/refund policy, and whether payouts are automated or
manual at launch. Will not be decided silently.
