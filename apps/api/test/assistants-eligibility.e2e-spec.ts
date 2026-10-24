import { AssistantEligibilityService } from '../src/assistants/assistant-eligibility.service.js';
import { ProbeController } from './support/probe.controller.js';
import {
  approvedAssistant,
  completeProfile,
  makeCatalog,
  move,
  requestPhoneCode,
  startApplication,
  submitted,
  uniquePhone,
  type Catalog,
} from './support/assistants.js';
import { makeLocation } from './support/reference.js';
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

describe('Assistants: eligibility for paid jobs (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;
  let catalog: Catalog;
  let eligibility: AssistantEligibilityService;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [ProbeController] });
    api = client(ctx.app);
    eligibility = ctx.app.get(AssistantEligibilityService);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
    ctx.mail.sent.length = 0;
    catalog = await makeCatalog();
    admin = await createUser(api, { role: 'ADMIN', verified: true });
  });

  const reasonsOf = (body: { reasons?: { code: string }[] }) =>
    (body.reasons ?? []).map((r) => r.code);

  describe('the paid-work guard (probe route /probe/paid-job)', () => {
    it('lets a fully approved and verified assistant through', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await api.get('/probe/paid-job', as(a.user)).expect(200);
      await api.get('/probe/paid-job-guard-only', as(a.user)).expect(200);
      expect((await api.get('/assistants/me/eligibility', as(a.user)).expect(200)).body).toEqual({
        eligibleForPaidJobs: true,
        reasons: [],
      });
    });

    it('refuses anonymous callers with 401 (authentication first)', async () => {
      await api.get('/probe/paid-job', { origin: null }).expect(401);
      await api.get('/probe/paid-job-guard-only', { origin: null }).expect(401);
    });

    it('refuses a plain customer on both routes', async () => {
      const user = await createUser(api, { verified: true });
      await api.get('/probe/paid-job', as(user)).expect(403); // role first
      const res = await api.get('/probe/paid-job-guard-only', as(user)).expect(403); // the eligibility guard on its own
      expect(res.body.code).toBe('ASSISTANT_NOT_ELIGIBLE');
      expect(reasonsOf(res.body)).toEqual(
        expect.arrayContaining(['NOT_ASSISTANT_ROLE', 'NO_APPLICATION']),
      );
    });

    it.each([
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
      'SUSPENDED',
    ] as const)(
      'refuses an application that is %s — even with a verified phone, passed identity and the ASSISTANT role',
      async (status) => {
        const a = await approvedAssistant(ctx, api, admin, catalog);
        // Worst case: everything else is perfect and the role is (wrongly) still ASSISTANT.
        await ownerPrisma().assistantProfile.update({
          where: { id: a.profileId },
          data: { status },
        });
        const res = await api.get('/probe/paid-job', as(a.user)).expect(403);
        expect(res.body.code).toBe('ASSISTANT_NOT_ELIGIBLE');
        expect(reasonsOf(res.body)).toEqual(['NOT_APPROVED']);
      },
    );

    it.each([
      [
        'unverified phone',
        async (a: { profileId: string }) =>
          ownerPrisma().assistantPrivateDetails.update({
            where: { profileId: a.profileId },
            data: { phoneVerifiedAt: null },
          }),
        'PHONE_UNVERIFIED',
      ],
      [
        'failed identity',
        async (a: { profileId: string }) =>
          ownerPrisma().assistantProfile.update({
            where: { id: a.profileId },
            data: { identityOutcome: 'FAILED' },
          }),
        'IDENTITY_NOT_PASSED',
      ],
      [
        'inconclusive identity',
        async (a: { profileId: string }) =>
          ownerPrisma().assistantProfile.update({
            where: { id: a.profileId },
            data: { identityOutcome: 'INCONCLUSIVE' },
          }),
        'IDENTITY_NOT_PASSED',
      ],
      [
        'no open service area',
        async () =>
          ownerPrisma().city.update({ where: { id: catalog.city.id }, data: { isActive: false } }),
        'NO_SERVICE_AREA',
      ],
      [
        'no delegable offered task',
        async () =>
          ownerPrisma().eligibleTask.updateMany({
            where: { id: { in: [catalog.hold.id, catalog.docs.id] } },
            data: { isActive: false },
          }),
        'NO_OFFERED_TASKS',
      ],
    ])('refuses an approved assistant with %s', async (_l, breakIt, code) => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await breakIt(a);
      const res = await api.get('/probe/paid-job', as(a.user)).expect(403);
      expect(reasonsOf(res.body)).toEqual([code]);
    });

    it('refuses an assistant whose email or account is no longer in good standing', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await ownerPrisma().user.update({
        where: { id: a.user.id },
        data: { emailVerifiedAt: null },
      });
      expect((await api.get('/probe/paid-job', as(a.user))).status).toBe(403);
      await ownerPrisma().user.update({
        where: { id: a.user.id },
        data: { emailVerifiedAt: new Date(), status: 'SUSPENDED' },
      });
      expect((await api.get('/probe/paid-job', as(a.user))).status).toBe(401); // suspended accounts lose their session
    });

    it('a suspended assistant loses paid-job access immediately (role revoked, status SUSPENDED)', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await api.get('/probe/paid-job', as(a.user)).expect(200);
      await move(
        api,
        admin,
        a.profileId,
        'SUSPENDED',
        'Pending an investigation of a report.',
      ).expect(200);
      expect((await api.get('/probe/paid-job', as(a.user))).status).toBe(403);
      expect(reasonsOf((await api.get('/probe/paid-job-guard-only', as(a.user))).body)).toEqual(
        expect.arrayContaining(['NOT_ASSISTANT_ROLE', 'NOT_APPROVED']),
      );
    });

    it('a submitted-but-unreviewed application grants nothing: complete profile ≠ approval', async () => {
      const a = await submitted(ctx, api, catalog);
      const res = await api.get('/probe/paid-job-guard-only', as(a.user)).expect(403);
      expect(reasonsOf(res.body)).toEqual(
        expect.arrayContaining(['NOT_APPROVED', 'IDENTITY_NOT_PASSED']),
      );
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).role).toBe(
        'CUSTOMER',
      );
    });

    it('reports EVERY unmet condition to the assistant on their own eligibility endpoint', async () => {
      const a = await startApplication(api);
      const body = (await api.get('/assistants/me/eligibility', as(a.user)).expect(200)).body;
      expect(body.eligibleForPaidJobs).toBe(false);
      expect(reasonsOf(body)).toEqual([
        'NOT_ASSISTANT_ROLE',
        'NOT_APPROVED',
        'PHONE_UNVERIFIED',
        'IDENTITY_NOT_PASSED',
        'NO_SERVICE_AREA',
        'NO_OFFERED_TASKS',
      ]);
    });
  });

  describe('editing after approval (limited scope) and the effect on eligibility', () => {
    it('lets an approved assistant update bio, languages, availability and offers, audited', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await api
        .patch('/assistants/me', { bio: `${'Updated bio. '.repeat(6)}` }, as(a.user))
        .expect(200);
      await api
        .put(
          '/assistants/me/availability',
          { windows: [{ dayOfWeek: 5, start: '09:00', end: '11:00' }] },
          as(a.user),
        )
        .expect(200);
      await api
        .put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.hold.id] },
          as(a.user),
        )
        .expect(200);
      expect((await eligibility.evaluate(a.user.id)).eligibleForPaidJobs).toBe(true);
      expect(
        await ctx.prisma.auditLog.count({
          where: {
            action: {
              in: [
                'assistant.profile.updated',
                'assistant.availability.updated',
                'assistant.services.updated',
              ],
            },
            actorUserId: a.user.id,
          },
        }),
      ).toBe(3 + 3); // + the three from onboarding
    });

    it('locks the display name and legal name after approval', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Fixed Name');
      expect(
        (await api.patch('/assistants/me', { displayName: 'New Name' }, as(a.user)).expect(409))
          .body.message,
      ).toMatch(/locked/);
      await api
        .put('/assistants/me/private', { legalName: 'Different Person' }, as(a.user))
        .expect(409);
      await api.patch('/assistants/me', { displayName: 'Fixed Name' }, as(a.user)).expect(200); // unchanged value is fine
    });

    it('changing the phone number makes the assistant INELIGIBLE until the new number is verified', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      expect((await api.get('/probe/paid-job', as(a.user))).status).toBe(200);
      await api.put('/assistants/me/private', { phone: uniquePhone() }, as(a.user)).expect(200);
      const res = await api.get('/probe/paid-job', as(a.user)).expect(403);
      expect(reasonsOf(res.body)).toEqual(['PHONE_UNVERIFIED']);
      await ctx.limiter.reset();
      const code = await requestPhoneCode(ctx, api, a);
      await api.post('/assistants/me/phone/verify', { code }, as(a.user)).expect(200);
      await api.get('/probe/paid-job', as(a.user)).expect(200);
    });

    it('cannot add a non-delegable task after approval either', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await api
        .put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.hold.id, catalog.bio.id] },
          as(a.user),
        )
        .expect(400);
    });

    it('re-submitting is impossible for an approved assistant (no way to un-approve yourself or reset review)', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await api.post('/assistants/me/submit', {}, as(a.user)).expect(409);
      await api.post('/assistants', { displayName: 'Another' }, as(a.user)).expect(404);
      await api.post('/assistants/me', { displayName: 'Another' }, as(a.user)).expect(409);
    });
  });

  describe('canServeTask: reusing task eligibility and venue restrictions', () => {
    async function venue(
      over: { status?: 'APPROVED' | 'PENDING_REVIEW'; categoryId?: string; cityId?: string } = {},
    ) {
      return makeLocation({
        cityId: over.cityId ?? catalog.city.id,
        categoryId: over.categoryId ?? catalog.category.id,
        status: over.status ?? 'APPROVED',
      });
    }

    it('allows an eligible assistant to serve an offered task at an approved venue in their city', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      const location = await venue();
      expect(await eligibility.canServeTask(a.user.id, catalog.hold.id, location.id)).toEqual({
        allowed: true,
      });
      expect(await eligibility.canServeTask(a.user.id, catalog.docs.id, location.id)).toEqual({
        allowed: true,
      }); // needs authorization, still delegable
    });

    it('refuses a task the assistant does not offer, and any task that cannot be delegated', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      const location = await venue();
      expect((await eligibility.canServeTask(a.user.id, catalog.bio.id, location.id)).allowed).toBe(
        false,
      ); // never offered, never delegable
      await api
        .put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.hold.id] },
          as(a.user),
        )
        .expect(200);
      expect(await eligibility.canServeTask(a.user.id, catalog.docs.id, location.id)).toEqual({
        allowed: false,
        reason: 'You do not offer this task',
      });
    });

    it('honours VENUE restrictions: a venue-level prohibition blocks the task there, and only there', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      const strict = await venue();
      const relaxed = await venue();
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: strict.id,
          taskId: catalog.hold.id,
          rule: 'PROHIBITED',
          note: 'No assistants for this at this branch.',
        },
      });
      expect(await eligibility.canServeTask(a.user.id, catalog.hold.id, strict.id)).toEqual({
        allowed: false,
        reason: 'This task cannot be delegated at this location',
      });
      expect((await eligibility.canServeTask(a.user.id, catalog.docs.id, strict.id)).allowed).toBe(
        true,
      );
      expect((await eligibility.canServeTask(a.user.id, catalog.hold.id, relaxed.id)).allowed).toBe(
        true,
      );
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: relaxed.id,
          taskId: null,
          rule: 'PROHIBITED',
          note: 'Venue refuses all third parties.',
        },
      });
      expect((await eligibility.canServeTask(a.user.id, catalog.docs.id, relaxed.id)).allowed).toBe(
        false,
      );
    });

    it('a venue that only REQUIRES AUTHORIZATION or gives advice does not block (it only tightens, never forbids)', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      const location = await venue();
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: location.id,
          taskId: catalog.hold.id,
          rule: 'REQUIRES_AUTHORIZATION',
          note: 'Bring a letter.',
        },
      });
      await ownerPrisma().locationRestriction.create({
        data: { locationId: location.id, taskId: null, rule: 'ADVISORY', note: 'Busy on Mondays.' },
      });
      expect(
        (await eligibility.canServeTask(a.user.id, catalog.hold.id, location.id)).allowed,
      ).toBe(true);
    });

    it('refuses venues that are not public, outside the assistant’s cities, or of another category', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      const pending = await venue({ status: 'PENDING_REVIEW' });
      expect((await eligibility.canServeTask(a.user.id, catalog.hold.id, pending.id)).reason).toBe(
        'This location is not available',
      );
      const { makeCity, makeCategory } = await import('./support/reference.js');
      const elsewhere = await venue({ cityId: (await makeCity()).id });
      expect(
        (await eligibility.canServeTask(a.user.id, catalog.hold.id, elsewhere.id)).reason,
      ).toBe('This location is outside your service areas');
      const otherCategory = await venue({ categoryId: (await makeCategory()).id });
      expect(
        (await eligibility.canServeTask(a.user.id, catalog.hold.id, otherCategory.id)).reason,
      ).toBe('This task is not available at this location');
    });

    it('refuses everything for an ineligible assistant, with the first reason', async () => {
      const a = await submitted(ctx, api, catalog);
      const location = await venue();
      const decision = await eligibility.canServeTask(a.user.id, catalog.hold.id, location.id);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBeTruthy();
      const draft = await startApplication(api, 'Draft Only');
      await completeProfile(api, draft, catalog);
      expect(
        (await eligibility.canServeTask(draft.user.id, catalog.hold.id, location.id)).allowed,
      ).toBe(false);
    });
  });
});
