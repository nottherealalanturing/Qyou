import {
  PROFILE_BIO,
  completeProfile,
  makeCatalog,
  move,
  startApplication,
  submitted,
  verifyPhone,
  type Catalog,
} from './support/assistants.js';
import { makeCategory, makeCity, makeTask } from './support/reference.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
} from './support/test-app.js';

const as = (u: { token: string }) => ({ token: u.token });

describe('Assistants: onboarding and profile (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
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
  });

  describe('starting an application', () => {
    it('requires authentication', async () => {
      await api.get('/assistants/me', { origin: null }).expect(401);
      await api.post('/assistants/me', { displayName: 'Ada' }, { origin: null }).expect(401);
    });

    it('lets an unverified user SEE the requirements, but not write (email verification is required)', async () => {
      const user = await createUser(api, { verified: false });
      const dash = (await api.get('/assistants/me', as(user)).expect(200)).body;
      expect(dash.application).toBeNull();
      expect(dash.onboarding.steps[0]).toMatchObject({ key: 'email', done: false });
      const res = await api.post('/assistants/me', { displayName: 'Ada O.' }, as(user)).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(await ctx.prisma.assistantProfile.count()).toBe(0);
    });

    it('creates a DRAFT profile with an unguessable, immutable slug and an empty private record', async () => {
      const user = await createUser(api, { verified: true });
      const res = await api
        .post('/assistants/me', { displayName: '  Ada   Obi ' }, as(user))
        .expect(201);
      expect(res.body.application).toMatchObject({
        status: 'DRAFT',
        editScope: 'full',
        canSubmit: false,
      });
      expect(res.body.profile.displayName).toBe('Ada Obi');
      expect(res.body.profile.slug).toMatch(/^ada-obi-[0-9a-f]{6}$/);
      expect(res.body.profile.publicUrl).toBeNull(); // not public until approved
      const stored = await ctx.prisma.assistantProfile.findUniqueOrThrow({
        where: { userId: user.id },
        include: { privateDetails: true },
      });
      expect(stored.privateDetails).toMatchObject({
        legalName: null,
        phoneE164: null,
        phoneVerifiedAt: null,
      });
      expect(stored.identityOutcome).toBe('PENDING');
      expect(
        (
          await ctx.prisma.auditLog.findFirstOrThrow({
            where: { action: 'assistant.application.created' },
          })
        ).actorUserId,
      ).toBe(user.id);
    });

    it('does not create a second application for the same user (409), even concurrently', async () => {
      const user = await createUser(api, { verified: true });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          api.post('/assistants/me', { displayName: 'Ada' }, as(user)),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await ctx.prisma.assistantProfile.count()).toBe(1);
    });

    it.each(['ADMIN', 'BUSINESS_STAFF'] as const)(
      'refuses a %s account (one role per account)',
      async (role) => {
        const user = await createUser(api, { verified: true, role });
        await api.post('/assistants/me', { displayName: 'Nope' }, as(user)).expect(403);
        expect(await ctx.prisma.assistantProfile.count()).toBe(0);
      },
    );

    it.each([
      ['empty name', { displayName: '   ' }],
      ['one-letter name', { displayName: 'A' }],
      ['over-long name', { displayName: 'x'.repeat(61) }],
      ['control characters', { displayName: 'Ad\u0000a' }],
      [
        'unknown fields (cannot choose status/role/slug)',
        { displayName: 'Ada', status: 'APPROVED', role: 'ASSISTANT', slug: 'x' },
      ],
    ])('rejects %s', async (_l, body) => {
      const user = await createUser(api, { verified: true });
      await api.post('/assistants/me', body, as(user)).expect(400);
    });

    it('blocks cross-origin creation (CSRF)', async () => {
      const user = await createUser(api, { verified: true });
      await api
        .post(
          '/assistants/me',
          { displayName: 'Ada' },
          { token: user.token, origin: 'https://evil.example' },
        )
        .expect(403);
    });
  });

  describe('profile fields', () => {
    it('updates public fields and audits field NAMES only', async () => {
      const a = await startApplication(api);
      const res = await api
        .patch(
          '/assistants/me',
          {
            displayName: 'Ada Obi',
            bio: PROFILE_BIO,
            languages: ['en', 'ha', 'en'],
            availabilityNote: 'Mornings',
          },
          as(a.user),
        )
        .expect(200);
      expect(res.body.profile).toMatchObject({
        displayName: 'Ada Obi',
        bio: PROFILE_BIO,
        languages: ['en', 'ha'],
        availabilityNote: 'Mornings',
      });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'assistant.profile.updated' },
      });
      expect(audit.metadata).toEqual({
        fields: expect.arrayContaining(['displayName', 'bio', 'languages', 'availabilityNote']),
      });
      expect(JSON.stringify(audit.metadata)).not.toContain(PROFILE_BIO);
    });

    it('treats an unchanged update as a no-op (no audit row)', async () => {
      const a = await startApplication(api, 'Ada O.');
      await api.patch('/assistants/me', { displayName: 'Ada O.' }, as(a.user)).expect(200);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'assistant.profile.updated' } }),
      ).toBe(0);
    });

    it.each([
      ['unknown language', { languages: ['klingon'] }],
      [
        'too many languages',
        { languages: ['en', 'ha', 'yo', 'ig', 'pcm', 'ff', 'fr', 'ar', 'en2'] },
      ],
      ['over-long bio', { bio: 'x'.repeat(601) }],
      ['control characters in bio', { bio: 'hello\u0007' }],
      ['over-long availability note', { availabilityNote: 'x'.repeat(201) }],
      ['empty body', {}],
      ['attempt to set status', { status: 'APPROVED' }],
      ['attempt to set identity outcome', { identityOutcome: 'PASSED' }],
      ['attempt to set slug', { slug: 'mine' }],
      ['attempt to set role', { role: 'ADMIN' }],
    ])('rejects %s', async (_l, body) => {
      const a = await startApplication(api);
      await api.patch('/assistants/me', body, as(a.user)).expect(400);
    });

    it('404s for a user who has not applied', async () => {
      const user = await createUser(api, { verified: true });
      await api.patch('/assistants/me', { bio: 'x' }, as(user)).expect(404);
    });
  });

  describe('service areas and task offers (reference-data rules)', () => {
    it('stores cities and delegable tasks, replacing the previous selection, and derives categories', async () => {
      const a = await startApplication(api);
      const res = await api
        .put(
          '/assistants/me/services',
          {
            cityIds: [catalog.city.id],
            taskIds: [catalog.hold.id, catalog.docs.id, catalog.hold.id],
          },
          as(a.user),
        )
        .expect(200);
      expect(res.body.services.cities.map((c: { id: string }) => c.id)).toEqual([catalog.city.id]);
      expect(res.body.services.tasks.map((t: { slug: string }) => t.slug).toSorted()).toEqual([
        'docs',
        'hold',
      ]);
      const replaced = await api
        .put('/assistants/me/services', { cityIds: [], taskIds: [catalog.hold.id] }, as(a.user))
        .expect(200);
      expect(replaced.body.services.cities).toEqual([]);
      expect(replaced.body.services.tasks).toHaveLength(1);
    });

    it('refuses to advertise a NON-DELEGABLE task (API)', async () => {
      const a = await startApplication(api);
      const res = await api
        .put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.hold.id, catalog.bio.id] },
          as(a.user),
        )
        .expect(400);
      expect(res.body.issues[0]).toMatchObject({ path: 'taskIds' });
      expect(res.body.issues[0].message).toMatch(/cannot be delegated/);
      expect(await ctx.prisma.assistantTaskOffer.count()).toBe(0); // nothing partially saved
    });

    it('refuses inactive tasks, tasks of inactive categories, inactive cities and unknown ids', async () => {
      const a = await startApplication(api);
      const offCategory = await makeCategory({ isActive: false });
      const inCategory = await makeTask(offCategory.id);
      const offTask = await makeTask(catalog.category.id, { isActive: false });
      const offCity = await makeCity({ isActive: false });
      const bad: [string, object][] = [
        ['inactive task', { cityIds: [], taskIds: [offTask.id] }],
        ['task of an inactive category', { cityIds: [], taskIds: [inCategory.id] }],
        ['inactive city', { cityIds: [offCity.id], taskIds: [] }],
        ['unknown city', { cityIds: ['00000000-0000-4000-8000-000000000000'], taskIds: [] }],
        ['unknown task', { cityIds: [], taskIds: ['00000000-0000-4000-8000-000000000000'] }],
        ['not UUIDs', { cityIds: ['x'], taskIds: [] }],
        ['unknown field', { cityIds: [], taskIds: [], extra: 1 }],
      ];
      for (const [, body] of bad)
        await api.put('/assistants/me/services', body, as(a.user)).expect(400);
    });

    it('the DATABASE refuses a non-delegable offer even if the API is bypassed', async () => {
      const a = await startApplication(api);
      await expect(
        ownerPrisma().assistantTaskOffer.create({
          data: { profileId: a.profileId, taskId: catalog.bio.id },
        }),
      ).rejects.toThrow(/non-delegable|check_violation/i);
      await expect(
        ctx.prisma.assistantTaskOffer.create({
          data: { profileId: a.profileId, taskId: catalog.bio.id },
        }),
      ).rejects.toThrow(/non-delegable|check_violation/i);
      // …and making an already-offered task non-delegable later cannot be used to sneak it in via UPDATE.
      await ownerPrisma().assistantTaskOffer.create({
        data: { profileId: a.profileId, taskId: catalog.hold.id },
      });
      await expect(
        ownerPrisma().assistantTaskOffer.update({
          where: { profileId_taskId: { profileId: a.profileId, taskId: catalog.hold.id } },
          data: { taskId: catalog.bio.id },
        }),
      ).rejects.toThrow();
    });

    it('flags (and never advertises) an offer whose task an administrator later made non-delegable', async () => {
      const a = await startApplication(api);
      await api
        .put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.hold.id] },
          as(a.user),
        )
        .expect(200);
      await ownerPrisma().eligibleTask.update({
        where: { id: catalog.hold.id },
        data: {
          eligibility: 'NOT_DELEGABLE',
          requiresCredentials: true,
          restrictionNotes: 'Policy changed.',
        },
      });
      const dash = (await api.get('/assistants/me', as(a.user)).expect(200)).body;
      expect(dash.services.tasks[0]).toMatchObject({ slug: 'hold', stillOffered: false });
    });
  });

  describe('availability (a declaration, not a guarantee)', () => {
    it('stores a weekly declaration, replaces it, returns sorted windows and the disclaimer', async () => {
      const a = await startApplication(api);
      const res = await api
        .put(
          '/assistants/me/availability',
          {
            windows: [
              { dayOfWeek: 3, start: '13:00', end: '17:00' },
              { dayOfWeek: 1, start: '08:00', end: '12:00' },
            ],
            note: 'Not on public holidays',
          },
          as(a.user),
        )
        .expect(200);
      expect(res.body.availability.windows).toEqual([
        { dayOfWeek: 1, start: '08:00', end: '12:00' },
        { dayOfWeek: 3, start: '13:00', end: '17:00' },
      ]);
      expect(res.body.availability.note).toBe('Not on public holidays');
      expect(res.body.availability.disclaimer).toMatch(/do not guarantee/);
      const cleared = await api
        .put('/assistants/me/availability', { windows: [] }, as(a.user))
        .expect(200);
      expect(cleared.body.availability.windows).toEqual([]);
    });

    it.each([
      [
        'overlap',
        [
          { dayOfWeek: 1, start: '08:00', end: '12:00' },
          { dayOfWeek: 1, start: '11:00', end: '14:00' },
        ],
      ],
      ['reversed range', [{ dayOfWeek: 1, start: '12:00', end: '08:00' }]],
      ['empty range', [{ dayOfWeek: 1, start: '08:00', end: '08:00' }]],
      ['bad time format', [{ dayOfWeek: 1, start: '8am', end: '12:00' }]],
      ['day out of range', [{ dayOfWeek: 7, start: '08:00', end: '12:00' }]],
      ['negative day', [{ dayOfWeek: -1, start: '08:00', end: '12:00' }]],
      ['unknown field', [{ dayOfWeek: 1, start: '08:00', end: '12:00', guaranteed: true }]],
    ])('rejects %s and keeps the previous declaration', async (_l, windows) => {
      const a = await startApplication(api);
      await api
        .put(
          '/assistants/me/availability',
          { windows: [{ dayOfWeek: 2, start: '09:00', end: '10:00' }] },
          as(a.user),
        )
        .expect(200);
      await api.put('/assistants/me/availability', { windows }, as(a.user)).expect(400);
      expect(
        await ctx.prisma.assistantAvailabilityWindow.count({ where: { profileId: a.profileId } }),
      ).toBe(1);
    });

    it('the database independently rejects invalid windows', async () => {
      const a = await startApplication(api);
      for (const [day, start, end] of [
        [1, 600, 600],
        [1, 700, 600],
        [1, -1, 60],
        [1, 0, 1441],
        [9, 0, 60],
      ] as const) {
        await expect(
          ownerPrisma().assistantAvailabilityWindow.create({
            data: { profileId: a.profileId, dayOfWeek: day, startMinute: start, endMinute: end },
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe('private details', () => {
    it('stores the legal name and a normalised Nigerian number, returns them only to the owner, and audits no values', async () => {
      const a = await startApplication(api);
      const res = await api
        .put(
          '/assistants/me/private',
          { legalName: '  Adaeze   Obi ', phone: '0803 123 4567' },
          as(a.user),
        )
        .expect(200);
      expect(res.body.private).toEqual({
        legalName: 'Adaeze Obi',
        phone: '+2348031234567',
        phoneVerified: false,
      });
      expect(res.body.profile).not.toHaveProperty('legalName');
      const audits = JSON.stringify(
        await ctx.prisma.auditLog.findMany({ where: { action: 'assistant.private.updated' } }),
      );
      expect(audits).not.toMatch(/Adaeze|8031234567/);
      expect(audits).toContain('legalName');
    });

    it.each([
      ['foreign number', '+14155550123'],
      ['too short', '0803123'],
      ['landline-style', '0123456789'],
      ['letters', 'call me maybe'],
      ['injection', "0803123456'; DROP TABLE users;--"],
    ])('rejects a %s', async (_l, phone) => {
      const a = await startApplication(api);
      const res = await api.put('/assistants/me/private', { phone }, as(a.user)).expect(400);
      expect(res.body.issues[0].path).toBe('phone');
    });

    it('rejects an empty body and unknown fields (e.g. smuggling a verified flag)', async () => {
      const a = await startApplication(api);
      await api.put('/assistants/me/private', {}, as(a.user)).expect(400);
      await api
        .put(
          '/assistants/me/private',
          { phone: '08031234567', phoneVerifiedAt: new Date().toISOString() },
          as(a.user),
        )
        .expect(400);
      await api
        .put('/assistants/me/private', { phone: '08031234567', phoneVerified: true }, as(a.user))
        .expect(400);
    });

    it('the database enforces the phone format and one verified owner per number', async () => {
      const a = await startApplication(api);
      const b = await startApplication(api);
      await expect(
        ownerPrisma().assistantPrivateDetails.update({
          where: { profileId: a.profileId },
          data: { phoneE164: '+14155550123' },
        }),
      ).rejects.toThrow();
      await ownerPrisma().assistantPrivateDetails.update({
        where: { profileId: a.profileId },
        data: { phoneE164: '+2348031112222', phoneVerifiedAt: new Date() },
      });
      await ownerPrisma().assistantPrivateDetails.update({
        where: { profileId: b.profileId },
        data: { phoneE164: '+2348031112222' },
      }); // unverified duplicates are fine
      await expect(
        ownerPrisma().assistantPrivateDetails.update({
          where: { profileId: b.profileId },
          data: { phoneVerifiedAt: new Date() },
        }),
      ).rejects.toThrow();
    });
  });

  describe('onboarding checklist and submission', () => {
    it('reports progress step by step', async () => {
      const a = await startApplication(api);
      const done = (res: { body: { onboarding: { steps: { key: string; done: boolean }[] } } }) =>
        Object.fromEntries(res.body.onboarding.steps.map((s) => [s.key, s.done]));
      let dash = await api.get('/assistants/me', as(a.user));
      expect(done(dash)).toMatchObject({
        email: true,
        profile: false,
        services: false,
        availability: false,
        private: false,
        phone: false,
        submit: false,
        identity: false,
        approval: false,
      });
      await completeProfile(api, a, catalog);
      dash = await api.get('/assistants/me', as(a.user));
      expect(done(dash)).toMatchObject({
        profile: true,
        services: true,
        availability: true,
        private: true,
        phone: false,
        submit: false,
      });
      expect(dash.body.application).toMatchObject({ canSubmit: true, missing: [] });
      await verifyPhone(ctx, api, a);
      dash = await api.get('/assistants/me', as(a.user));
      expect(done(dash).phone).toBe(true);
    });

    it('refuses to submit an incomplete profile and lists exactly what is missing', async () => {
      const a = await startApplication(api);
      const res = await api.post('/assistants/me/submit', {}, as(a.user)).expect(400);
      expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual([
        'bio',
        'languages',
        'serviceAreas',
        'tasks',
        'availability',
        'legalName',
        'phone',
      ]);
      expect(
        (await ctx.prisma.assistantProfile.findUniqueOrThrow({ where: { id: a.profileId } }))
          .status,
      ).toBe('DRAFT');
    });

    it('submits a complete profile (phone verification is NOT required to submit, only to be approved)', async () => {
      const a = await startApplication(api);
      await completeProfile(api, a, catalog);
      const res = await api.post('/assistants/me/submit', {}, as(a.user)).expect(200);
      expect(res.body.application).toMatchObject({
        status: 'SUBMITTED',
        editScope: 'none',
        canSubmit: false,
      });
      expect(
        (
          await ctx.prisma.auditLog.findFirstOrThrow({
            where: { action: 'assistant.application.submitted' },
          })
        ).metadata,
      ).toEqual({ from: 'DRAFT' });
      await api.post('/assistants/me/submit', {}, as(a.user)).expect(409);
    });

    it('does not let two concurrent submits both succeed', async () => {
      const a = await startApplication(api);
      await completeProfile(api, a, catalog);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => api.post('/assistants/me/submit', {}, as(a.user))),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'assistant.application.submitted' } }),
      ).toBe(1);
    });

    it('locks every edit while the application is submitted or under review', async () => {
      const admin = await createUser(api, { role: 'ADMIN', verified: true });
      const a = await submitted(ctx, api, catalog);
      const attempts = async (label: string) => {
        for (const [method, path, body] of [
          [
            'patch',
            '/assistants/me',
            { bio: 'A new bio that is long enough to count as a real biography here.' },
          ],
          ['put', '/assistants/me/services', { cityIds: [], taskIds: [] }],
          ['put', '/assistants/me/availability', { windows: [] }],
          ['put', '/assistants/me/private', { legalName: 'Someone Else' }],
        ] as const) {
          const res = await api[method](path, body, as(a.user));
          expect([label, path, res.status]).toEqual([label, path, 409]);
        }
        expect(
          await ctx.prisma.assistantAvailabilityWindow.count({ where: { profileId: a.profileId } }),
        ).toBe(2);
      };
      await attempts('SUBMITTED');
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await attempts('UNDER_REVIEW');
    });

    it('reopens editing after changes are requested, then allows resubmission', async () => {
      const admin = await createUser(api, { role: 'ADMIN', verified: true });
      const a = await submitted(ctx, api, catalog);
      await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
      await move(
        api,
        admin,
        a.profileId,
        'CHANGES_REQUESTED',
        'Please add more detail to your bio.',
      ).expect(200);
      const dash = (await api.get('/assistants/me', as(a.user)).expect(200)).body;
      expect(dash.application).toMatchObject({
        status: 'CHANGES_REQUESTED',
        statusReason: 'Please add more detail to your bio.',
        editScope: 'full',
      });
      await api
        .patch(
          '/assistants/me',
          { bio: `${PROFILE_BIO} I also speak Yoruba and Pidgin fluently.` },
          as(a.user),
        )
        .expect(200);
      await api.post('/assistants/me/submit', {}, as(a.user)).expect(200);
      expect(
        (await ctx.prisma.assistantProfile.findUniqueOrThrow({ where: { id: a.profileId } }))
          .status,
      ).toBe('SUBMITTED');
    });
  });

  describe('ownership', () => {
    it('every user only ever sees and changes their own application', async () => {
      const a = await startApplication(api, 'Alpha One');
      const b = await startApplication(api, 'Beta Two');
      await completeProfile(api, a, catalog, { legalName: 'Alpha Private' });
      const bView = (await api.get('/assistants/me', as(b.user)).expect(200)).body;
      expect(bView.profile.displayName).toBe('Beta Two');
      expect(JSON.stringify(bView)).not.toMatch(/Alpha|8031/);
      await api.patch('/assistants/me', { displayName: 'Beta Renamed' }, as(b.user)).expect(200);
      expect(
        (await ctx.prisma.assistantProfile.findUniqueOrThrow({ where: { id: a.profileId } }))
          .displayName,
      ).toBe('Alpha One');
      // There is no id in any /assistants/me URL, so there is nothing to tamper with; admin routes need ADMIN:
      await api.get(`/admin/assistants/${a.profileId}`, as(b.user)).expect(403);
    });
  });

  it('keeps recording identity out of the applicant’s hands (they cannot set an outcome or phone-verified flag)', async () => {
    const a = await startApplication(api);
    await api
      .post(`/admin/assistants/${a.profileId}/identity-checks`, { result: 'PASSED' }, as(a.user))
      .expect(403);
    await api.post('/assistants/me/identity-checks', { result: 'PASSED' }, as(a.user)).expect(404);
    expect(
      (await ctx.prisma.assistantProfile.findUniqueOrThrow({ where: { id: a.profileId } }))
        .identityOutcome,
    ).toBe('PENDING');
  });
});
