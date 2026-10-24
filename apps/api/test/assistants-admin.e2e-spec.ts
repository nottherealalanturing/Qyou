import { AdminUsersService } from '../src/admin/admin-users.service.js';
import { Logger } from '@nestjs/common';
import { allowedTransition } from '../src/assistants/application-state.js';
import type { ApplicationStatus } from '../src/generated/prisma/client.js';
import {
  approvedAssistant,
  completeProfile,
  makeCatalog,
  move,
  recordIdentity,
  startApplication,
  submitted,
  verifyPhone,
  type Catalog,
} from './support/assistants.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './support/test-app.js';

const as = (u: { token: string }) => ({ token: u.token });
const ZERO = '00000000-0000-4000-8000-000000000000';
const ALL: ApplicationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
];
const REASON = 'Reviewed against the onboarding policy.';

describe('Assistants: administrator review (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;
  let catalog: Catalog;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
    ctx.mail.sent.length = 0;
    catalog = await makeCatalog();
    admin = await createUser(api, { role: 'ADMIN', verified: true });
  });

  const profile = (id: string) =>
    ctx.prisma.assistantProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
  const adminAudits = (action: string) =>
    ctx.prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  /** Forces an application into a given status directly (setup only). */
  const force = (id: string, status: ApplicationStatus) =>
    ownerPrisma().assistantProfile.update({ where: { id }, data: { status } });

  describe('authorization', () => {
    async function target() {
      const applicant = await submitted(ctx, api, catalog);
      return applicant.profileId;
    }
    const routes = (id: string) =>
      [
        ['get', '/admin/assistants'],
        ['get', `/admin/assistants/${id}`],
        ['post', `/admin/assistants/${id}/identity-checks`, { result: 'PASSED' }],
        ['post', `/admin/assistants/${id}/transitions`, { to: 'UNDER_REVIEW' }],
      ] as const;
    const call = (
      route: readonly [string, string, object?],
      opts: { token?: string; origin?: string | null },
    ) => (route[0] === 'get' ? api.get(route[1], opts) : api.post(route[1], route[2] ?? {}, opts));

    it('rejects anonymous callers with 401', async () => {
      const id = await target();
      for (const route of routes(id))
        expect([route[1], (await call(route, { origin: null })).status]).toEqual([route[1], 401]);
    });

    it.each(['CUSTOMER', 'BUSINESS_STAFF'] as const)(
      'rejects a verified %s with 403 and changes nothing',
      async (role) => {
        const id = await target();
        const user = await createUser(api, { role, verified: true });
        for (const route of routes(id))
          expect([route[1], (await call(route, as(user))).status]).toEqual([route[1], 403]);
        expect((await profile(id)).status).toBe('SUBMITTED');
        expect(await ctx.prisma.identityCheck.count()).toBe(0);
      },
    );

    it('rejects an APPROVED assistant (having the role does not grant admin powers)', async () => {
      const other = await approvedAssistant(ctx, api, admin, catalog, 'Reviewer Wannabe');
      const id = await target();
      for (const route of routes(id))
        expect([route[1], (await call(route, as(other.user))).status]).toEqual([route[1], 403]);
      expect((await profile(id)).status).toBe('SUBMITTED');
    });

    it('rejects an administrator whose email is not verified, and cross-origin writes', async () => {
      const id = await target();
      const unverified = await createUser(api, { role: 'ADMIN', verified: false });
      for (const route of routes(id))
        expect((await call(route, as(unverified))).body.code).toBe('EMAIL_NOT_VERIFIED');
      for (const route of routes(id).filter((r) => r[0] === 'post')) {
        expect(
          (await call(route, { token: admin.token, origin: 'https://evil.example' })).status,
        ).toBe(403);
      }
      expect((await profile(id)).status).toBe('SUBMITTED');
    });

    it('a user cannot approve their own application, even if they later become an administrator', async () => {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await ownerPrisma().user.update({ where: { id: a.user.id }, data: { role: 'ADMIN' } });
      expect((await move(api, a.user, a.profileId, 'APPROVED', REASON)).status).toBe(403);
      expect((await recordIdentity(api, a.user, a.profileId)).status).toBe(403);
      expect((await profile(a.profileId)).status).toBe('UNDER_REVIEW');
    });

    it('there is no public or customer endpoint that grants the ASSISTANT role', async () => {
      const spec = (await api.raw().get('/docs/openapi.json').expect(200)).body.paths as Record<
        string,
        Record<string, unknown>
      >;
      const writers = Object.entries(spec)
        .filter(([path]) => !path.includes('/probe/') && /assistants/.test(path))
        .flatMap(([path, methods]) =>
          Object.keys(methods)
            .filter((m) => m !== 'get')
            .map((m) => `${m.toUpperCase()} ${path}`),
        );
      // Everything that can write under /assistants is either the owner's own-application API or admin-only.
      for (const w of writers) expect(w).toMatch(/\/api\/v1\/(assistants\/me|admin\/assistants)/);
      const user = await createUser(api, { verified: true });
      for (const [method, path] of [
        ['patch', '/users/me'],
        ['post', '/assistants/me/role'],
        ['post', '/assistants/me/approve'],
        ['put', '/assistants/me'],
      ] as const) {
        expect((await api[method](path, { role: 'ASSISTANT' }, as(user))).status).toBe(404);
      }
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(
        'CUSTOMER',
      );
    });
  });

  describe('review queue and detail', () => {
    it('lists applications without any private details, filtered by status and paginated', async () => {
      const a = await submitted(ctx, api, catalog, 'Alpha Applicant');
      await startApplication(api, 'Beta Draft');
      const all = (await api.get('/admin/assistants', as(admin)).expect(200)).body;
      expect(all).toMatchObject({ total: 2, page: 1 });
      const submittedOnly = (
        await api.get('/admin/assistants?status=SUBMITTED', as(admin)).expect(200)
      ).body;
      expect(submittedOnly.items).toHaveLength(1);
      expect(submittedOnly.items[0]).toMatchObject({
        id: a.profileId,
        displayName: 'Alpha Applicant',
        status: 'SUBMITTED',
        phoneVerified: true,
        emailVerified: true,
        identityOutcome: 'PENDING',
      });
      const text = JSON.stringify(all);
      expect(text).not.toMatch(/Adaeze|\+234|8031|@example\.test|legalName|phone"/);
      expect((await api.get('/admin/assistants?pageSize=1', as(admin))).body).toMatchObject({
        totalPages: 2,
      });
      await api.get('/admin/assistants?status=NOPE', as(admin)).expect(400);
      await api.get('/admin/assistants?pageSize=500', as(admin)).expect(400);
    });

    it('detail shows the review facts, and EVERY read of private data is audited', async () => {
      const a = await submitted(ctx, api, catalog);
      const before = (await adminAudits('admin.assistant.private_viewed')).length;
      const res = (await api.get(`/admin/assistants/${a.profileId}`, as(admin)).expect(200)).body;
      expect(res.private).toEqual({
        legalName: 'Adaeze Obi',
        phone: `+234${a.phone.slice(1)}`,
        phoneVerified: true,
      });
      expect(res.applicant).toMatchObject({ role: 'CUSTOMER', accountStatus: 'ACTIVE' });
      expect(res.requirements).toMatchObject({
        emailVerified: true,
        phoneVerified: true,
        identityPassed: false,
        profileComplete: true,
      });
      expect(res.allowedTransitions).toEqual(['UNDER_REVIEW']);
      expect(res.identityChecks).toEqual([]);
      const audits = await adminAudits('admin.assistant.private_viewed');
      expect(audits).toHaveLength(before + 1);
      expect(audits.at(-1)).toMatchObject({ actorUserId: admin.id, targetId: a.profileId });
      expect(JSON.stringify(audits)).not.toMatch(/Adaeze|\+234/);
      await api.get(`/admin/assistants/${ZERO}`, as(admin)).expect(404);
      await api.get('/admin/assistants/not-a-uuid', as(admin)).expect(400);
    });
  });

  describe('identity outcomes (manual review — outcomes only, never documents)', () => {
    async function underReview() {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      return a;
    }

    it('records an outcome, updates the profile, and audits without the notes', async () => {
      const a = await underReview();
      const res = await recordIdentity(api, admin, a.profileId, 'PASSED', {
        evidenceRef: 'VID-2026-1042',
        notes: 'Passport checked on a video call.',
      }).expect(201);
      expect(res.body).toMatchObject({ result: 'PASSED', method: 'MANUAL_REVIEW' });
      expect((await profile(a.profileId)).identityOutcome).toBe('PASSED');
      const audit = (await adminAudits('admin.assistant.identity_check_recorded')).at(-1)!;
      expect(audit.metadata).toEqual({
        result: 'PASSED',
        method: 'MANUAL_REVIEW',
        hasEvidenceRef: true,
      });
      expect(JSON.stringify(audit)).not.toMatch(/Passport|VID-2026/);
      const detail = (await api.get(`/admin/assistants/${a.profileId}`, as(admin))).body;
      expect(detail.identityChecks[0]).toMatchObject({
        result: 'PASSED',
        method: 'MANUAL_REVIEW',
        evidenceRef: 'VID-2026-1042',
        checkedBy: 'Test User',
      });
    });

    it('the latest outcome wins, and the full history is kept', async () => {
      const a = await underReview();
      await recordIdentity(api, admin, a.profileId, 'FAILED', { notes: 'Name mismatch.' }).expect(
        201,
      );
      expect((await profile(a.profileId)).identityOutcome).toBe('FAILED');
      await recordIdentity(api, admin, a.profileId, 'PASSED').expect(201);
      expect((await profile(a.profileId)).identityOutcome).toBe('PASSED');
      expect(await ctx.prisma.identityCheck.count({ where: { profileId: a.profileId } })).toBe(2);
    });

    it('can only be recorded while the application is under review', async () => {
      const a = await submitted(ctx, api, catalog);
      for (const status of [
        'SUBMITTED',
        'APPROVED',
        'REJECTED',
        'SUSPENDED',
        'DRAFT',
        'CHANGES_REQUESTED',
      ] as const) {
        await force(a.profileId, status);
        expect([status, (await recordIdentity(api, admin, a.profileId)).status]).toEqual([
          status,
          409,
        ]);
      }
      expect(await ctx.prisma.identityCheck.count()).toBe(0);
      expect((await profile(a.profileId)).identityOutcome).toBe('PENDING');
    });

    it.each([
      ['an ID-number-shaped note', { notes: 'NIN 12345678901' }],
      ['a card-number-shaped reference', { evidenceRef: '4111 1111 1111 1111' }],
      ['a phone-number-shaped reference', { evidenceRef: '08031234567' }],
      ['a spaced BVN', { notes: 'bvn 222-333-444-55' }],
      ['an over-long note', { notes: 'x'.repeat(501) }],
      ['an over-long reference', { evidenceRef: 'x'.repeat(121) }],
      ['PENDING as a result', { result: 'PENDING' }],
      ['an unknown result', { result: 'VERIFIED_BY_PROVIDER' }],
      ['a document upload field', { documentUrl: 'https://example.test/id.jpg' }],
      ['an image field', { selfie: 'data:image/png;base64,AAAA' }],
      ['an ID number field', { idNumber: '12345678901' }],
    ])('refuses %s, recording nothing', async (_l, extra) => {
      const a = await underReview();
      const res = await recordIdentity(api, admin, a.profileId, 'PASSED', extra);
      expect(res.status).toBe(400);
      expect(await ctx.prisma.identityCheck.count()).toBe(0);
      expect((await profile(a.profileId)).identityOutcome).toBe('PENDING');
    });

    it('the database refuses a recorded check with a PENDING result', async () => {
      const a = await underReview();
      await expect(
        ownerPrisma().identityCheck.create({
          data: { profileId: a.profileId, result: 'PENDING', checkedByUserId: admin.id },
        }),
      ).rejects.toThrow();
    });

    it('does not approve anything by itself', async () => {
      const a = await underReview();
      await recordIdentity(api, admin, a.profileId).expect(201);
      const p = await profile(a.profileId);
      expect(p.status).toBe('UNDER_REVIEW');
      expect(p.user.role).toBe('CUSTOMER');
    });
  });

  describe('the application state machine', () => {
    it('accepts exactly the legal admin transitions and answers 409 for every other pair', async () => {
      const a = await submitted(ctx, api, catalog);
      for (const from of ALL) {
        for (const to of [
          'UNDER_REVIEW',
          'CHANGES_REQUESTED',
          'APPROVED',
          'REJECTED',
          'SUSPENDED',
        ] as const) {
          await force(a.profileId, from);
          if (allowedTransition(from, to) === 'admin') continue; // covered by the dedicated tests below
          const res = await move(api, admin, a.profileId, to, REASON);
          expect([from, to, res.status]).toEqual([from, to, 409]);
          expect((await profile(a.profileId)).status).toBe(from); // unchanged
        }
      }
      expect(await adminAudits('admin.assistant.approved')).toHaveLength(0);
    });

    it('starts a review without a reason, but demands one (≥10 chars) for every decision', async () => {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      for (const to of ['CHANGES_REQUESTED', 'REJECTED', 'APPROVED'] as const) {
        const none = await move(api, admin, a.profileId, to);
        expect([to, none.status, none.body.issues?.[0]?.path]).toEqual([to, 400, 'reason']);
        expect((await move(api, admin, a.profileId, to, 'too short')).status).toBe(400);
      }
      expect((await profile(a.profileId)).status).toBe('UNDER_REVIEW');
    });

    it('refuses reasons that contain identity numbers, and unknown fields or statuses', async () => {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      expect(
        (await move(api, admin, a.profileId, 'REJECTED', 'Rejected: NIN 12345678901 did not match'))
          .status,
      ).toBe(400);
      expect((await move(api, admin, a.profileId, 'DRAFT', REASON)).status).toBe(400);
      expect(
        (
          await api.post(
            `/admin/assistants/${a.profileId}/transitions`,
            { to: 'REJECTED', reason: REASON, role: 'ASSISTANT' },
            as(admin),
          )
        ).status,
      ).toBe(400);
      expect((await profile(a.profileId)).status).toBe('UNDER_REVIEW');
    });

    it('requests changes with a reason the applicant can read, then they can resubmit', async () => {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await move(
        api,
        admin,
        a.profileId,
        'CHANGES_REQUESTED',
        'Please clarify the languages you speak.',
      ).expect(200);
      const dash = (await api.get('/assistants/me', as(a.user))).body;
      expect(dash.application).toMatchObject({
        status: 'CHANGES_REQUESTED',
        statusReason: 'Please clarify the languages you speak.',
      });
      expect((await adminAudits('admin.assistant.changes_requested')).at(-1)!.metadata).toEqual({
        from: 'UNDER_REVIEW',
        to: 'CHANGES_REQUESTED',
        reason: 'Please clarify the languages you speak.',
      });
    });

    it('rejects an application (no role is ever granted) and allows a reasoned reconsideration', async () => {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await move(api, admin, a.profileId, 'REJECTED', 'Identity could not be confirmed.').expect(
        200,
      );
      let p = await profile(a.profileId);
      expect(p).toMatchObject({
        status: 'REJECTED',
        statusReason: 'Identity could not be confirmed.',
      });
      expect(p.user.role).toBe('CUSTOMER');
      await api.patch('/assistants/me', { bio: 'x'.repeat(60) }, as(a.user)).expect(409); // locked
      await move(
        api,
        admin,
        a.profileId,
        'UNDER_REVIEW',
        'Reconsidering after new information.',
      ).expect(200);
      p = await profile(a.profileId);
      expect(p.status).toBe('UNDER_REVIEW');
    });

    it('lets concurrent administrators race without double-deciding', async () => {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await recordIdentity(api, admin, a.profileId).expect(201);
      const admin2 = await createUser(api, { role: 'ADMIN', verified: true });
      const results = await Promise.all(
        [admin, admin2, admin, admin2].map((who) =>
          move(api, who, a.profileId, 'APPROVED', REASON),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) expect(r.status).toBe(409);
      expect(await adminAudits('admin.assistant.approved')).toHaveLength(1);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.role_changed' } })).toBe(1);
    });
  });

  describe('approval', () => {
    async function readyForDecision() {
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      return a;
    }
    const approve = (id: string) => move(api, admin, id, 'APPROVED', REASON);

    it('is blocked until the identity review PASSED, with every blocker listed — and nothing changes', async () => {
      const a = await readyForDecision();
      const res = await approve(a.profileId).expect(409);
      expect(res.body.blockers).toEqual(['The identity review has not passed']);
      for (const outcome of ['FAILED', 'INCONCLUSIVE'] as const) {
        await recordIdentity(api, admin, a.profileId, outcome).expect(201);
        expect((await approve(a.profileId)).body.blockers).toEqual([
          'The identity review has not passed',
        ]);
      }
      const p = await profile(a.profileId);
      expect(p.status).toBe('UNDER_REVIEW');
      expect(p.user.role).toBe('CUSTOMER');
      expect(await adminAudits('admin.assistant.approved')).toHaveLength(0);
    });

    it('is blocked without a verified phone (the applicant submitted without one)', async () => {
      const a = await startApplication(api);
      await completeProfile(api, a, catalog);
      await api.post('/assistants/me/submit', {}, as(a.user)).expect(200);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await recordIdentity(api, admin, a.profileId).expect(201);
      expect((await approve(a.profileId)).body.blockers).toEqual([
        'The applicant has not verified their mobile number',
      ]);
      await verifyPhone(ctx, api, a);
      await approve(a.profileId).expect(200);
    });

    it('is blocked if the email is not verified, or the account type cannot be an assistant', async () => {
      const a = await readyForDecision();
      await recordIdentity(api, admin, a.profileId).expect(201);
      await ownerPrisma().user.update({
        where: { id: a.user.id },
        data: { emailVerifiedAt: null },
      });
      expect((await approve(a.profileId)).body.blockers).toContain(
        'The applicant has not verified their email address',
      );
      await ownerPrisma().user.update({
        where: { id: a.user.id },
        data: { emailVerifiedAt: new Date(), role: 'BUSINESS_STAFF' },
      });
      expect((await approve(a.profileId)).body.blockers).toContain(
        'This account type cannot be an assistant',
      );
      expect((await profile(a.profileId)).status).toBe('UNDER_REVIEW');
    });

    it('is blocked if the profile became incomplete (e.g. every offered task was made non-delegable)', async () => {
      const a = await readyForDecision();
      await recordIdentity(api, admin, a.profileId).expect(201);
      await ownerPrisma().eligibleTask.updateMany({
        where: { id: { in: [catalog.hold.id, catalog.docs.id] } },
        data: { isActive: false },
      });
      expect((await approve(a.profileId)).body.blockers).toContain(
        'Choose at least one task you can do',
      );
    });

    it('approves, grants ASSISTANT atomically through the role service, and audits both', async () => {
      const a = await readyForDecision();
      await recordIdentity(api, admin, a.profileId).expect(201);
      const res = await approve(a.profileId).expect(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', statusReason: REASON });
      const p = await profile(a.profileId);
      expect(p.user.role).toBe('ASSISTANT');
      expect(p.approvedAt).not.toBeNull();
      expect((await adminAudits('admin.assistant.approved')).at(-1)!.metadata).toEqual({
        from: 'UNDER_REVIEW',
        to: 'APPROVED',
        reason: REASON,
      });
      const roleAudit = (await adminAudits('admin.role_changed')).at(-1)!;
      expect(roleAudit).toMatchObject({
        actorUserId: admin.id,
        targetId: a.user.id,
        metadata: { from: 'CUSTOMER', to: 'ASSISTANT' },
      });
      expect((await api.me(a.user.token).expect(200)).body.user.role).toBe('ASSISTANT'); // effective on the next request
    });

    it('is ALL-OR-NOTHING: if the role grant fails, the status change and audit roll back', async () => {
      const a = await readyForDecision();
      await recordIdentity(api, admin, a.profileId).expect(201);
      const roles = ctx.app.get(AdminUsersService);
      const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const spy = vi
        .spyOn(roles, 'assignRoleInTransaction')
        .mockRejectedValueOnce(new Error('role store unavailable'));
      const res = await approve(a.profileId);
      spy.mockRestore();
      quiet.mockRestore();
      expect(res.status).toBe(500);
      const p = await profile(a.profileId);
      expect(p.status).toBe('UNDER_REVIEW');
      expect(p.approvedAt).toBeNull();
      expect(p.user.role).toBe('CUSTOMER');
      expect(await adminAudits('admin.assistant.approved')).toHaveLength(0);
      await approve(a.profileId).expect(200); // and a retry works
    });

    it('goes through the SAME role rules as the admin role endpoint (never around them)', async () => {
      const a = await readyForDecision();
      await recordIdentity(api, admin, a.profileId).expect(201);
      const spy = vi.spyOn(ctx.app.get(AdminUsersService), 'assignRoleInTransaction');
      await approve(a.profileId).expect(200);
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: admin.id }),
        a.user.id,
        'ASSISTANT',
        expect.anything(),
      );
      spy.mockRestore();
    });
  });

  describe('suspension and reinstatement', () => {
    it('suspends an approved assistant: role revoked atomically, hidden publicly, with a reason', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Suspend Me');
      expect((await api.get(`/assistants/${a.slug}`, { origin: null })).status).toBe(200);
      const res = await move(
        api,
        admin,
        a.profileId,
        'SUSPENDED',
        'Two customer complaints under investigation.',
      ).expect(200);
      expect(res.body.status).toBe('SUSPENDED');
      const p = await profile(a.profileId);
      expect(p.user.role).toBe('CUSTOMER');
      expect(p.statusReason).toBe('Two customer complaints under investigation.');
      expect((await api.get(`/assistants/${a.slug}`, { origin: null })).status).toBe(404);
      expect((await adminAudits('admin.role_changed')).at(-1)!.metadata).toEqual({
        from: 'ASSISTANT',
        to: 'CUSTOMER',
      });
      expect((await adminAudits('admin.assistant.suspended')).at(-1)!.metadata).toMatchObject({
        from: 'APPROVED',
        to: 'SUSPENDED',
      });
      expect((await api.get('/assistants/me', as(a.user))).body.application.status).toBe(
        'SUSPENDED',
      );
    });

    it('requires a reason to suspend', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      expect((await move(api, admin, a.profileId, 'SUSPENDED')).status).toBe(400);
      expect((await profile(a.profileId)).status).toBe('APPROVED');
    });

    it('reinstates only if every approval requirement STILL holds, then re-grants the role', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await move(api, admin, a.profileId, 'SUSPENDED', 'Pending investigation of a report.').expect(
        200,
      );
      await ownerPrisma().assistantPrivateDetails.update({
        where: { profileId: a.profileId },
        data: { phoneVerifiedAt: null },
      });
      const blocked = await move(
        api,
        admin,
        a.profileId,
        'APPROVED',
        'Investigation closed, reinstating.',
      ).expect(409);
      expect(blocked.body.blockers).toEqual(['The applicant has not verified their mobile number']);
      expect((await profile(a.profileId)).user.role).toBe('CUSTOMER');
      await ownerPrisma().assistantPrivateDetails.update({
        where: { profileId: a.profileId },
        data: { phoneVerifiedAt: new Date() },
      });
      await move(api, admin, a.profileId, 'APPROVED', 'Investigation closed, reinstating.').expect(
        200,
      );
      expect((await profile(a.profileId)).user.role).toBe('ASSISTANT');
      expect((await api.get(`/assistants/${a.slug}`, { origin: null })).status).toBe(200);
    });

    it('can end a suspension by rejecting', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await move(api, admin, a.profileId, 'SUSPENDED', 'Serious policy violation found.').expect(
        200,
      );
      await move(api, admin, a.profileId, 'REJECTED', 'Terminated after the investigation.').expect(
        200,
      );
      expect((await profile(a.profileId)).user.role).toBe('CUSTOMER');
    });
  });

  describe('invariants and audit completeness', () => {
    it('the ASSISTANT role exists if and only if the application is APPROVED — through a whole lifecycle', async () => {
      const a = await submitted(ctx, api, catalog, 'Lifecycle One');
      const b = await submitted(ctx, api, catalog, 'Lifecycle Two');
      const check = async () => {
        const profiles = await ctx.prisma.assistantProfile.findMany({ include: { user: true } });
        for (const p of profiles)
          expect([p.displayName, p.user.role === 'ASSISTANT']).toEqual([
            p.displayName,
            p.status === 'APPROVED',
          ]);
        const assistants = await ctx.prisma.user.findMany({
          where: { role: 'ASSISTANT' },
          include: { assistantProfile: true },
        });
        for (const u of assistants) expect(u.assistantProfile?.status).toBe('APPROVED');
      };
      await check();
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await recordIdentity(api, admin, a.profileId).expect(201);
      await check();
      await move(api, admin, a.profileId, 'APPROVED', REASON).expect(200);
      await check();
      await move(api, admin, b.profileId, 'UNDER_REVIEW').expect(200);
      await move(api, admin, b.profileId, 'REJECTED', 'Does not meet the requirements.').expect(
        200,
      );
      await check();
      await move(api, admin, a.profileId, 'SUSPENDED', 'Temporary suspension for review.').expect(
        200,
      );
      await check();
      await move(api, admin, a.profileId, 'APPROVED', 'Suspension lifted after review.').expect(
        200,
      );
      await check();
      expect(await ctx.prisma.user.count({ where: { role: 'ASSISTANT' } })).toBe(1);
    });

    it('every successful admin action writes exactly one audit row, and failed ones write none', async () => {
      const a = await submitted(ctx, api, catalog);
      const count = () =>
        ctx.prisma.auditLog.count({ where: { action: { startsWith: 'admin.assistant.' } } });
      const start = await count();
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200); // 1
      await recordIdentity(api, admin, a.profileId).expect(201); // 2
      await move(api, admin, a.profileId, 'APPROVED', REASON).expect(200); // 3
      expect(await count()).toBe(start + 3);
      await move(api, admin, a.profileId, 'DRAFT', REASON); // 400
      await move(api, admin, a.profileId, 'UNDER_REVIEW', REASON); // 409
      await move(api, admin, a.profileId, 'SUSPENDED'); // 400 (no reason)
      await recordIdentity(api, admin, a.profileId); // 409 (not under review)
      await move(api, admin, ZERO, 'APPROVED', REASON).expect(404);
      expect(await count()).toBe(start + 3);
      for (const row of await ctx.prisma.auditLog.findMany({
        where: { action: { startsWith: 'admin.assistant.' } },
      })) {
        expect(row.actorUserId).toBe(admin.id);
        expect(row.targetId).toBe(a.profileId);
        expect(JSON.stringify(row)).not.toMatch(/Adaeze|\+234|VID-2026|Checked by/);
      }
    });
  });
});
