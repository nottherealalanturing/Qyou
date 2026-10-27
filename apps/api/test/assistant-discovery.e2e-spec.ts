import { AssistantEligibilityService } from '../src/assistants/assistant-eligibility.service.js';
import {
  approvedAssistant,
  makeCatalog,
  move,
  startApplication,
  submitted,
  type Applicant,
  type Catalog,
} from './support/assistants.js';
import { makeCategory, makeCity, makeLocation, makeTask } from './support/reference.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './support/test-app.js';

interface Card {
  slug: string;
  displayName: string;
  tasks: { slug: string; name: string; categorySlug: string }[];
  cities: { slug: string }[];
}

describe('Assistant discovery: filters and eligibility equivalence (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;
  let catalog: Catalog;
  let eligibility: AssistantEligibilityService;

  beforeAll(async () => {
    ctx = await createTestApp();
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

  const list = async (query = '') =>
    (await api.get(`/assistants${query}`, { origin: null }).expect(200)).body as {
      items: Card[];
      total: number;
      totalPages: number;
      page: number;
    };
  const slugs = async (query = '') =>
    (await list(query)).items.map((i) => i.displayName).toSorted();

  /** Directly sets what an approved assistant serves/offers/speaks (test setup, as the DB owner). */
  async function configure(
    a: Applicant,
    over: { cityIds?: string[]; taskIds?: string[]; languages?: string[]; bio?: string },
  ) {
    const db = ownerPrisma();
    if (over.cityIds) {
      await db.assistantServiceArea.deleteMany({ where: { profileId: a.profileId } });
      await db.assistantServiceArea.createMany({
        data: over.cityIds.map((cityId) => ({ profileId: a.profileId, cityId })),
      });
    }
    if (over.taskIds) {
      await db.assistantTaskOffer.deleteMany({ where: { profileId: a.profileId } });
      await db.assistantTaskOffer.createMany({
        data: over.taskIds.map((taskId) => ({ profileId: a.profileId, taskId })),
      });
    }
    if (over.languages || over.bio)
      await db.assistantProfile.update({
        where: { id: a.profileId },
        data: {
          ...(over.languages ? { languages: over.languages } : {}),
          ...(over.bio ? { bio: over.bio } : {}),
        },
      });
  }

  describe('filters', () => {
    let cityB: Awaited<ReturnType<typeof makeCity>>;
    let cat2: Awaited<ReturnType<typeof makeCategory>>;
    let bank: Awaited<ReturnType<typeof makeTask>>;
    let ada: Applicant;
    let bola: Applicant;
    let chidi: Applicant;

    beforeEach(async () => {
      cityB = await makeCity();
      cat2 = await makeCategory();
      bank = await makeTask(cat2.id, { slug: 'bank-line', name: 'Bank line' });
      ada = await approvedAssistant(ctx, api, admin, catalog, 'Ada O.');
      bola = await approvedAssistant(ctx, api, admin, catalog, 'Bola K.');
      chidi = await approvedAssistant(ctx, api, admin, catalog, 'Chidi N.');
      // Ada: city A, hold+docs, en+yo.   Bola: city B, hold, ha.   Chidi: both cities, bank task only, en.
      await configure(ada, {
        languages: ['en', 'yo'],
        bio: 'Careful and punctual, based near the airport.',
      });
      await configure(bola, {
        cityIds: [cityB.id],
        taskIds: [catalog.hold.id],
        languages: ['ha'],
        bio: 'Fast and friendly. 100% reliable_service.',
      });
      await configure(chidi, {
        cityIds: [catalog.city.id, cityB.id],
        taskIds: [bank.id],
        languages: ['en'],
        bio: 'Experienced with bank branches.',
      });
    });

    it('lists everyone with no filters, with tasks and areas on each card', async () => {
      const body = await list();
      expect(body.total).toBe(3);
      const adaCard = body.items.find((i) => i.displayName === 'Ada O.')!;
      expect(adaCard.tasks.map((t) => t.slug).toSorted()).toEqual(['docs', 'hold']);
      expect(adaCard.cities).toEqual([
        { slug: catalog.city.slug, name: catalog.city.name, state: catalog.city.state },
      ]);
    });

    it('filters by city', async () => {
      expect(await slugs(`?city=${catalog.city.slug}`)).toEqual(['Ada O.', 'Chidi N.']);
      expect(await slugs(`?city=${cityB.slug}`)).toEqual(['Bola K.', 'Chidi N.']);
      expect(await slugs('?city=nowhere')).toEqual([]);
    });

    it('filters by category and by task (a task needs its category)', async () => {
      expect(await slugs(`?category=${catalog.category.slug}`)).toEqual(['Ada O.', 'Bola K.']);
      expect(await slugs(`?category=${cat2.slug}`)).toEqual(['Chidi N.']);
      expect(await slugs(`?category=${catalog.category.slug}&task=hold`)).toEqual([
        'Ada O.',
        'Bola K.',
      ]);
      expect(await slugs(`?category=${catalog.category.slug}&task=docs`)).toEqual(['Ada O.']);
      expect(await slugs(`?category=${cat2.slug}&task=bank-line`)).toEqual(['Chidi N.']);
      expect(await slugs(`?category=${cat2.slug}&task=hold`)).toEqual([]); // right slug, wrong category
      const res = await api.get('/assistants?task=hold', { origin: null }).expect(400);
      expect(res.body.issues[0].path).toBe('task');
    });

    it('filters by language', async () => {
      expect(await slugs('?language=yo')).toEqual(['Ada O.']);
      expect(await slugs('?language=en')).toEqual(['Ada O.', 'Chidi N.']);
      expect(await slugs('?language=ha')).toEqual(['Bola K.']);
      await api.get('/assistants?language=klingon', { origin: null }).expect(400);
    });

    it('searches display name and bio literally and case-insensitively, escaping wildcards', async () => {
      expect(await slugs('?q=bola')).toEqual(['Bola K.']);
      expect(await slugs('?q=AIRPORT')).toEqual(['Ada O.']);
      expect(await slugs('?q=bank%20branches')).toEqual(['Chidi N.']);
      expect(await slugs('?q=%25')).toEqual(['Bola K.']); // a literal "%", present only in Bola's bio
      expect(await slugs('?q=_')).toEqual(['Bola K.']); // a literal underscore, not "any character"
      expect(await slugs('?q=zzz-nothing')).toEqual([]);
      await api.get(`/assistants?q=${'x'.repeat(81)}`, { origin: null }).expect(400);
    });

    it('combines every filter with AND', async () => {
      expect(
        await slugs(
          `?city=${cityB.slug}&category=${catalog.category.slug}&task=hold&language=ha&q=friendly`,
        ),
      ).toEqual(['Bola K.']);
      expect(
        await slugs(
          `?city=${catalog.city.slug}&category=${catalog.category.slug}&task=hold&language=ha`,
        ),
      ).toEqual([]);
      expect(await slugs(`?city=${catalog.city.slug}&language=en&category=${cat2.slug}`)).toEqual([
        'Chidi N.',
      ]);
    });

    it('treats "serves the city" and "offers the task" as independent facts', async () => {
      // Chidi serves both cities and offers the bank task: he matches it in either city.
      expect(
        await slugs(`?city=${catalog.city.slug}&category=${cat2.slug}&task=bank-line`),
      ).toEqual(['Chidi N.']);
      expect(await slugs(`?city=${cityB.slug}&category=${cat2.slug}&task=bank-line`)).toEqual([
        'Chidi N.',
      ]);
    });

    it('paginates stably with correct totals and an empty page beyond the end', async () => {
      const page1 = await list('?pageSize=2');
      const page2 = await list('?pageSize=2&page=2');
      expect(page1).toMatchObject({ total: 3, totalPages: 2, page: 1 });
      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      const all = [...page1.items, ...page2.items].map((i) => i.slug);
      expect(new Set(all).size).toBe(3);
      expect((await list('?pageSize=2&page=9')).items).toEqual([]);
      await api.get('/assistants?pageSize=51', { origin: null }).expect(400);
      await api.get('/assistants?page=0', { origin: null }).expect(400);
    });

    it('returns an honest empty result for filters nobody matches', async () => {
      const body = await list(`?city=${catalog.city.slug}&language=ff`);
      expect(body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });
  });

  describe('venue search', () => {
    it('implies the venue’s city and category and drops tasks the venue prohibits', async () => {
      const ada = await approvedAssistant(ctx, api, admin, catalog, 'Ada O.'); // hold + docs
      const bola = await approvedAssistant(ctx, api, admin, catalog, 'Bola K.');
      await ownerPrisma().assistantTaskOffer.deleteMany({
        where: { profileId: bola.profileId, taskId: catalog.docs.id },
      }); // Bola: hold only
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      expect(await slugs(`?location=${venue.slug}`)).toEqual(['Ada O.', 'Bola K.']);

      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: venue.id,
          taskId: catalog.hold.id,
          rule: 'PROHIBITED',
          note: 'No line holding.',
        },
      });
      // Ada still offers `docs` there; Bola offers only the prohibited task.
      expect(await slugs(`?location=${venue.slug}`)).toEqual(['Ada O.']);
      expect(
        await slugs(`?location=${venue.slug}&category=${catalog.category.slug}&task=hold`),
      ).toEqual([]);

      await ownerPrisma().locationRestriction.create({
        data: { locationId: venue.id, rule: 'PROHIBITED', note: 'Closed to proxies.' },
      });
      expect(await slugs(`?location=${venue.slug}`)).toEqual([]);
      void ada;
    });

    it('is empty for unknown, unapproved or conflicting venues', async () => {
      await approvedAssistant(ctx, api, admin, catalog, 'Ada O.');
      const pending = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
        status: 'PENDING_REVIEW',
      });
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const elsewhere = await makeCity();
      expect(await slugs('?location=no-such-venue')).toEqual([]);
      expect(await slugs(`?location=${pending.slug}`)).toEqual([]);
      expect(await slugs(`?location=${venue.slug}&city=${elsewhere.slug}`)).toEqual([]);
      expect(await slugs(`?location=${venue.slug}&city=${catalog.city.slug}`)).toEqual(['Ada O.']);
    });
  });

  describe('eligibility equivalence: the public list is exactly the set the authoritative service calls eligible', () => {
    it('matches decideEligibility for an assistant failing each rule individually', async () => {
      const db = ownerPrisma();
      type Case = { name: string; make: () => Promise<Applicant> };
      const approved = (name: string) => approvedAssistant(ctx, api, admin, catalog, name);
      const cases: Case[] = [
        { name: 'fully eligible', make: () => approved('Eligible E.') },
        {
          name: 'suspended application',
          make: async () => {
            const a = await approved('Suspended S.');
            await move(
              api,
              admin,
              a.profileId,
              'SUSPENDED',
              'Suspended while we investigate.',
            ).expect(200);
            return a;
          },
        },
        {
          name: 'rejected application',
          make: async () => {
            const a = await submitted(ctx, api, catalog, 'Rejected R.');
            await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
            await move(api, admin, a.profileId, 'REJECTED', 'Could not confirm details.').expect(
              200,
            );
            return a;
          },
        },
        {
          name: 'under review',
          make: async () => {
            const a = await submitted(ctx, api, catalog, 'Review U.');
            await move(api, admin, a.profileId, 'UNDER_REVIEW').expect(200);
            return a;
          },
        },
        { name: 'submitted', make: () => submitted(ctx, api, catalog, 'Submitted B.') },
        { name: 'draft', make: () => startApplication(api, 'Draft D.') },
        {
          name: 'phone not verified',
          make: async () => {
            const a = await approved('Phone P.');
            await db.assistantPrivateDetails.update({
              where: { profileId: a.profileId },
              data: { phoneVerifiedAt: null },
            });
            return a;
          },
        },
        {
          name: 'identity failed',
          make: async () => {
            const a = await approved('Failed F.');
            await db.assistantProfile.update({
              where: { id: a.profileId },
              data: { identityOutcome: 'FAILED' },
            });
            return a;
          },
        },
        {
          name: 'identity pending',
          make: async () => {
            const a = await approved('Pending Q.');
            await db.assistantProfile.update({
              where: { id: a.profileId },
              data: { identityOutcome: 'PENDING' },
            });
            return a;
          },
        },
        {
          name: 'email not verified',
          make: async () => {
            const a = await approved('Email M.');
            await db.user.update({ where: { id: a.user.id }, data: { emailVerifiedAt: null } });
            return a;
          },
        },
        {
          name: 'user suspended',
          make: async () => {
            const a = await approved('Banned X.');
            await db.user.update({ where: { id: a.user.id }, data: { status: 'SUSPENDED' } });
            return a;
          },
        },
        {
          name: 'role is not ASSISTANT',
          make: async () => {
            const a = await approved('Role Y.');
            await db.user.update({ where: { id: a.user.id }, data: { role: 'CUSTOMER' } });
            return a;
          },
        },
        {
          name: 'no active service area',
          make: async () => {
            const a = await approved('Area A.');
            const dead = await makeCity({ isActive: false });
            await db.assistantServiceArea.deleteMany({ where: { profileId: a.profileId } });
            await db.assistantServiceArea.create({
              data: { profileId: a.profileId, cityId: dead.id },
            });
            return a;
          },
        },
        {
          name: 'no effective offer (tasks inactive)',
          make: async () => {
            const a = await approved('Offer O.');
            await db.eligibleTask.updateMany({
              where: { id: { in: [catalog.hold.id, catalog.docs.id] } },
              data: { isActive: false },
            });
            return a;
          },
        },
      ];

      const made: { name: string; a: Applicant }[] = [];
      for (const c of cases) {
        // Each case gets its own catalog so a shared mutation (inactive tasks) cannot bleed into the next.
        catalog = await makeCatalog();
        await ctx.limiter.reset();
        made.push({ name: c.name, a: await c.make() });
      }

      const listed = new Set((await list('?pageSize=50')).items.map((i) => i.slug));
      let eligibleCount = 0;
      for (const { name, a } of made) {
        const decision = await eligibility.evaluate(a.user.id);
        const onList = listed.has(a.slug);
        const profileStatus = (await api.get(`/assistants/${a.slug}`, { origin: null })).status;
        expect(
          onList,
          `${name}: list vs evaluate (${decision.reasons.map((r) => r.code).join(',') || 'eligible'})`,
        ).toBe(decision.eligibleForPaidJobs);
        expect(profileStatus === 200, `${name}: profile page vs evaluate`).toBe(
          decision.eligibleForPaidJobs,
        );
        if (decision.eligibleForPaidJobs) eligibleCount += 1;
      }
      expect(eligibleCount).toBe(1); // only the control case is eligible; the others each fail exactly one rule
      expect(listed.size).toBe(1);
    });
  });

  describe('public output', () => {
    it('never exposes private or internal fields on cards or profiles', async () => {
      const a = await approvedAssistant(ctx, api, admin, catalog, 'Ada O.');
      const card = (await list()).items[0];
      const profile = (await api.get(`/assistants/${a.slug}`, { origin: null }).expect(200)).body;
      const forbiddenKeys = new Set([
        'id',
        'userId',
        'legalName',
        'phoneE164',
        'evidenceRef',
        'notes',
        'statusReason',
        'status',
        'identityOutcome',
        'passwordHash',
      ]);
      const keys = (v: unknown): string[] =>
        v && typeof v === 'object'
          ? Object.entries(v).flatMap(([k, val]) => [k, ...keys(val)])
          : [];
      for (const doc of [card, profile]) {
        const text = JSON.stringify(doc);
        for (const secret of [a.user.email, a.user.id, a.phone, 'Adaeze'])
          expect(text).not.toContain(secret);
        expect(keys(doc).filter((k) => forbiddenKeys.has(k))).toEqual([]);
        // No invented reputation data while nothing backs it.
        expect(
          keys(doc).filter((k) => /rating|review|badge|responseTime|completion/i.test(k)),
        ).toEqual([]);
      }
    });

    it('lists no unapproved assistant even when a filter matches them exactly', async () => {
      const a = await submitted(ctx, api, catalog, 'Submitted S.');
      void a;
      expect(
        await slugs(
          `?city=${catalog.city.slug}&category=${catalog.category.slug}&task=hold&language=en&q=submitted`,
        ),
      ).toEqual([]);
    });
  });
});
