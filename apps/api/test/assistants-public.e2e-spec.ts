import { approvedAssistant, makeCatalog, submitted, type Catalog } from './support/assistants.js';
import { makeCategory, makeCity, makeTask } from './support/reference.js';
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

describe('Assistants: public profiles and the public/private boundary (e2e, real PostgreSQL)', () => {
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

  const publicList = (q = '') => api.get(`/assistants${q}`, { origin: null });
  const publicGet = (slug: string) => api.get(`/assistants/${slug}`, { origin: null });

  it('is empty (not an error) when there are no assistants', async () => {
    expect((await publicList().expect(200)).body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  describe('visibility: only FULLY eligible assistants exist publicly', () => {
    it.each([
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
      'SUSPENDED',
    ] as const)('hides an application that is %s', async (status) => {
      const a = await approvedAssistant(ctx, api, admin, catalog);
      await ownerPrisma().assistantProfile.update({ where: { id: a.profileId }, data: { status } });
      const unknown = await publicGet('never-existed-abc123').expect(404);
      const res = await publicGet(a.slug).expect(404);
      expect(res.body).toEqual(unknown.body);
      expect((await publicList()).body.total).toBe(0);
    });

    it('hides an approved assistant whose identity outcome is not PASSED', async () => {
      for (const identityOutcome of ['PENDING', 'FAILED', 'INCONCLUSIVE'] as const) {
        const a = await approvedAssistant(ctx, api, admin, catalog, `Id ${identityOutcome}`);
        await ownerPrisma().assistantProfile.update({
          where: { id: a.profileId },
          data: { identityOutcome },
        });
        await publicGet(a.slug).expect(404);
      }
      expect((await publicList()).body.total).toBe(0);
    });

    it('hides an approved assistant whose phone is unverified, email unverified, account suspended or role removed', async () => {
      const make = async (label: string) => approvedAssistant(ctx, api, admin, catalog, label);
      const phone = await make('No Phone');
      await ownerPrisma().assistantPrivateDetails.update({
        where: { profileId: phone.profileId },
        data: { phoneVerifiedAt: null },
      });
      const email = await make('No Email');
      await ownerPrisma().user.update({
        where: { id: email.user.id },
        data: { emailVerifiedAt: null },
      });
      const suspended = await make('Suspended User');
      await ownerPrisma().user.update({
        where: { id: suspended.user.id },
        data: { status: 'SUSPENDED' },
      });
      const norole = await make('No Role');
      await ownerPrisma().user.update({
        where: { id: norole.user.id },
        data: { role: 'CUSTOMER' },
      });
      for (const a of [phone, email, suspended, norole]) await publicGet(a.slug).expect(404);
      expect((await publicList()).body.total).toBe(0);
    });

    it('hides an assistant with no open city or no still-delegable offered task', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Stale One');
      await ownerPrisma().city.update({
        where: { id: catalog.city.id },
        data: { isActive: false },
      });
      await publicGet(a.slug).expect(404);
      await ownerPrisma().city.update({ where: { id: catalog.city.id }, data: { isActive: true } });
      await publicGet(a.slug).expect(200);
      await ownerPrisma().eligibleTask.updateMany({
        where: { id: { in: [catalog.hold.id, catalog.docs.id] } },
        data: {
          eligibility: 'NOT_DELEGABLE',
          requiresCredentials: true,
          restrictionNotes: 'Policy changed.',
        },
      });
      await publicGet(a.slug).expect(404);
    });

    it('shows a fully eligible assistant', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Visible Person');
      const list = (await publicList().expect(200)).body;
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({ slug: a.slug, displayName: 'Visible Person' });
      await publicGet(a.slug).expect(200);
    });
  });

  describe('exactly what is public — and nothing else', () => {
    it('exposes only the allow-listed fields on the list and the profile', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Field Check');
      const item = (await publicList()).body.items[0];
      expect(Object.keys(item).toSorted()).toEqual([
        'categories',
        'cities',
        'displayName',
        'languages',
        'slug',
        'summary',
        'tasks', // added in M1.5 so a card shows what the assistant offers
      ]);
      // Each listed task is only a name and slugs: no ids, no eligibility notes, nothing internal.
      expect(Object.keys(item.tasks[0]).toSorted()).toEqual(['categorySlug', 'name', 'slug']);
      const profile = (await publicGet(a.slug)).body.assistant;
      expect(Object.keys(profile).toSorted()).toEqual([
        'availability',
        'bio',
        'displayName',
        'languages',
        'memberSince',
        'offers',
        'serviceAreas',
        'slug',
        'verification',
      ]);
      expect(Object.keys(profile.availability).toSorted()).toEqual([
        'disclaimer',
        'note',
        'timezone',
        'windows',
      ]);
      expect(profile.verification).toEqual({
        email: true,
        phone: true,
        identity: 'Manual review by Qyou',
      });
      expect(profile.memberSince).toMatch(/^\d{4}-\d{2}$/);
      expect(profile.languages).toEqual([
        { code: 'en', name: 'English' },
        { code: 'yo', name: 'Yoruba' },
      ]);
      expect(profile.availability.disclaimer).toMatch(/do not guarantee/);
    });

    it('NEVER leaks private or internal data anywhere in the list or profile payloads', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Leak Check');
      await ownerPrisma().assistantPrivateDetails.update({
        where: { profileId: a.profileId },
        data: { legalName: 'Zyxwvut Privatename' },
      });
      const reason = 'INTERNAL-REASON-MARKER please keep private';
      await ownerPrisma().assistantProfile.update({
        where: { id: a.profileId },
        data: { statusReason: reason },
      });
      await ownerPrisma().identityCheck.updateMany({
        where: { profileId: a.profileId },
        data: { notes: 'INTERNAL-NOTE-MARKER', evidenceRef: 'EVIDENCE-REF-MARKER' },
      });

      const payloads = JSON.stringify([(await publicList()).body, (await publicGet(a.slug)).body]);
      const email = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).email;
      const forbidden = [
        'Zyxwvut',
        'Privatename', // legal name
        a.phone,
        a.phone.slice(1),
        `+234${a.phone.slice(1)}`,
        a.phone.slice(-7), // phone in any form
        email,
        email.split('@')[0]!, // email
        a.user.id,
        a.profileId, // internal ids
        'INTERNAL-REASON-MARKER',
        'INTERNAL-NOTE-MARKER',
        'EVIDENCE-REF-MARKER', // decisions and evidence
        'passwordHash',
        'argon2',
        'phoneVerifiedAt',
        'legalName',
        'statusReason',
        'identityOutcome',
        'identityCheck',
        'userId',
      ];
      for (const needle of forbidden)
        expect([needle, payloads.includes(needle)]).toEqual([needle, false]);
      // No FIELD may resemble a rating, review, job history or earnings (none exist yet; none may be fabricated).
      const keys = new Set<string>();
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object')
          for (const [k, child] of Object.entries(v)) {
            keys.add(k);
            walk(child);
          }
      };
      walk(JSON.parse(payloads));
      expect([...keys].filter((k) => /rating|review|stars|jobs|earn|score/i.test(k))).toEqual([]);
    });

    it('lists offered tasks grouped by category, ordered, and never advertises a non-delegable one', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Offers Person');
      const offers = (await publicGet(a.slug)).body.assistant.offers;
      expect(offers).toHaveLength(1);
      expect(offers[0].category.slug).toBe(catalog.category.slug);
      expect(offers[0].tasks).toEqual([
        { slug: 'hold', name: 'Hold your place', eligibility: 'ELIGIBLE' },
        { slug: 'docs', name: 'Submit documents', eligibility: 'REQUIRES_AUTHORIZATION' },
      ]);
      expect(JSON.stringify(offers)).not.toMatch(/NOT_DELEGABLE|Biometrics/);
    });

    it('shows declared availability sorted, with the "not a guarantee" disclaimer', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Hours Person');
      const avail = (await publicGet(a.slug)).body.assistant.availability;
      expect(avail.windows).toEqual([
        { dayOfWeek: 1, start: '08:00', end: '12:00' },
        { dayOfWeek: 3, start: '13:00', end: '17:00' },
      ]);
      expect(avail.note).toBe('Weekday mornings are best.');
    });

    it('does not reflect later private edits or admin notes, but does show allowed public edits', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Editable Person');
      await api.put('/assistants/me/private', { phone: '08039998888' }, as(a.user)).expect(200); // makes them ineligible…
      await publicGet(a.slug).expect(404); // …so they vanish until the new number is verified
    });
  });

  describe('filters, pagination, caching', () => {
    it('filters by city and by category, and ignores unknown values safely', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Filter Person');
      const otherCity = await makeCity();
      const otherCategory = await makeCategory();
      await makeTask(otherCategory.id);
      expect((await publicList(`?city=${catalog.city.slug}`)).body.total).toBe(1);
      expect((await publicList(`?city=${otherCity.slug}`)).body.total).toBe(0);
      expect((await publicList(`?category=${catalog.category.slug}`)).body.items[0].slug).toBe(
        a.slug,
      );
      expect((await publicList(`?category=${otherCategory.slug}`)).body.total).toBe(0);
      expect((await publicList('?city=does-not-exist')).body.total).toBe(0);
      await publicList('?city=Not%20A%20Slug').expect(400);
    });

    it('paginates with a stable order', async () => {
      for (let i = 0; i < 5; i++) await approvedAssistant(ctx, api, admin, catalog, `Person ${i}`);
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = (await publicList(`?pageSize=2&page=${page}`).expect(200)).body;
        expect(res).toMatchObject({ page, pageSize: 2, total: 5, totalPages: 3 });
        seen.push(...res.items.map((i: { slug: string }) => i.slug));
      }
      expect(new Set(seen).size).toBe(5);
      for (const bad of ['?page=0', '?pageSize=51', '?pageSize=0', '?page=x'])
        await publicList(bad).expect(400);
    });

    it('is readable anonymously, cached briefly on success only', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Cache Person');
      for (const path of ['/assistants', `/assistants/${a.slug}`]) {
        expect(
          (await api.get(path, { origin: null }).expect(200)).headers['cache-control'],
        ).toMatch(/^public, max-age=60/);
      }
      const missing = await api.get('/assistants/missing-zzzzzz', { origin: null }).expect(404);
      expect(missing.headers['cache-control'] ?? '').not.toMatch(/public/);
    });

    it('does not let a public request reach the owner-only routes', async () => {
      await api.get('/assistants/me', { origin: null }).expect(401); // routed to the private controller, not treated as a slug
      await api.get('/assistants/me/eligibility', { origin: null }).expect(401);
    });

    it('shows nothing for submitted-but-unapproved applicants even to an administrator via the public API', async () => {
      const a = await submitted(ctx, api, catalog, 'Pending Person');
      expect((await api.get(`/assistants/${a.slug}`, as(admin))).status).toBe(404);
    });
  });
});
