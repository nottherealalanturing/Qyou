import {
  makeCategory,
  makeCity,
  makeLocation,
  makeTask,
  makeVisibleLocation,
} from './support/reference.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
} from './support/test-app.js';

describe('Reference data: public reads (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
  });

  describe('service categories', () => {
    it('returns an honest empty list when nothing exists', async () => {
      const res = await api.get('/service-categories', { origin: null }).expect(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('lists only ACTIVE categories, in sortOrder then name order, with exact public fields', async () => {
      await makeCategory({ slug: 'zeta', name: 'Zeta', sortOrder: 1 });
      await makeCategory({ slug: 'alpha', name: 'Alpha', sortOrder: 2 });
      await makeCategory({ slug: 'beta', name: 'Beta', sortOrder: 2 });
      await makeCategory({ slug: 'hidden', name: 'Hidden', isActive: false });

      const res = await api.get('/service-categories', { origin: null }).expect(200);
      expect(res.body.items.map((c: { slug: string }) => c.slug)).toEqual([
        'zeta',
        'alpha',
        'beta',
      ]);
      expect(Object.keys(res.body.items[0]).toSorted()).toEqual([
        'description',
        'iconKey',
        'id',
        'locationCount',
        'name',
        'slug',
        'taskCount',
      ]);
    });

    it('counts only active tasks and only publicly visible locations', async () => {
      const city = await makeCity();
      const inactiveCity = await makeCity({ isActive: false });
      const category = await makeCategory({ slug: 'banks' });
      await makeTask(category.id);
      await makeTask(category.id);
      await makeTask(category.id, { isActive: false });
      await makeLocation({ cityId: city.id, categoryId: category.id }); // counted
      await makeLocation({ cityId: city.id, categoryId: category.id, status: 'PENDING_REVIEW' });
      await makeLocation({ cityId: city.id, categoryId: category.id, status: 'REJECTED' });
      await makeLocation({ cityId: city.id, categoryId: category.id, status: 'ARCHIVED' });
      await makeLocation({ cityId: inactiveCity.id, categoryId: category.id }); // hidden by inactive city

      const res = await api.get('/service-categories', { origin: null }).expect(200);
      expect(res.body.items[0]).toMatchObject({ slug: 'banks', taskCount: 2, locationCount: 1 });
    });

    it('returns a category with its active tasks and their eligibility rules', async () => {
      const category = await makeCategory({ slug: 'banks' });
      await makeTask(category.id, { slug: 'hold', name: 'Hold', sortOrder: 1 });
      await makeTask(category.id, {
        slug: 'cash',
        name: 'Cash',
        sortOrder: 2,
        eligibility: 'NOT_DELEGABLE',
        restrictionNotes: 'Not offered at launch.',
      });
      await makeTask(category.id, {
        slug: 'docs',
        name: 'Docs',
        sortOrder: 3,
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes: 'Signed letter.',
      });
      await makeTask(category.id, { slug: 'gone', name: 'Gone', isActive: false });

      const res = await api.get('/service-categories/banks', { origin: null }).expect(200);
      expect(res.body.category).toMatchObject({ slug: 'banks', taskCount: 3 });
      expect(res.body.tasks.map((t: { slug: string }) => t.slug)).toEqual(['hold', 'cash', 'docs']);
      expect(res.body.tasks[1]).toMatchObject({
        eligibility: 'NOT_DELEGABLE',
        restrictionNotes: 'Not offered at launch.',
      });
      expect(res.body.tasks[2]).toMatchObject({
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes: 'Signed letter.',
      });
      expect(Object.keys(res.body.tasks[0]).toSorted()).toEqual([
        'authorizationNotes',
        'description',
        'eligibility',
        'id',
        'kind',
        'name',
        'requiresCredentials',
        'requiresPersonalPresence',
        'restrictionNotes',
        'slug',
      ]);
    });

    it('treats inactive and unknown categories identically (404)', async () => {
      await makeCategory({ slug: 'off', isActive: false });
      const inactive = await api.get('/service-categories/off', { origin: null }).expect(404);
      const unknown = await api
        .get('/service-categories/never-existed', { origin: null })
        .expect(404);
      expect(inactive.body).toEqual(unknown.body);
    });
  });

  describe('cities', () => {
    it('lists active cities in order, with locationCount excluding non-public venues', async () => {
      const lagos = await makeCity({ slug: 'lagos', name: 'Lagos', state: 'Lagos', sortOrder: 2 });
      await makeCity({ slug: 'kaduna', name: 'Kaduna', state: 'Kaduna', sortOrder: 1 });
      await makeCity({ slug: 'closed', name: 'Closed', state: 'Closed', isActive: false });
      const category = await makeCategory();
      await makeLocation({ cityId: lagos.id, categoryId: category.id });
      await makeLocation({ cityId: lagos.id, categoryId: category.id, status: 'PENDING_REVIEW' });

      const res = await api.get('/cities', { origin: null }).expect(200);
      expect(res.body.items.map((c: { slug: string }) => c.slug)).toEqual(['kaduna', 'lagos']);
      expect(res.body.items.map((c: { locationCount: number }) => c.locationCount)).toEqual([0, 1]);
      expect(typeof res.body.items[0].latitude).toBe('number');
      expect(Object.keys(res.body.items[0]).toSorted()).toEqual([
        'id',
        'latitude',
        'locationCount',
        'longitude',
        'name',
        'slug',
        'state',
        'timezone',
      ]);
    });

    it('returns a city, and 404 for inactive or unknown ones', async () => {
      await makeCity({ slug: 'abuja', name: 'Abuja', state: 'FCT' });
      await makeCity({ slug: 'closed', name: 'Closed', state: 'Closed', isActive: false });
      await api.get('/cities/abuja', { origin: null }).expect(200);
      await api.get('/cities/closed', { origin: null }).expect(404);
      await api.get('/cities/nowhere', { origin: null }).expect(404);
    });
  });

  describe('service locations (list)', () => {
    it('is empty (not an error) when there are no locations yet', async () => {
      await makeCity();
      await makeCategory();
      const res = await api.get('/service-locations', { origin: null }).expect(200);
      expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
    });

    it('only ever returns APPROVED locations in active categories and cities', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      const offCategory = await makeCategory({ isActive: false });
      const offCity = await makeCity({ isActive: false });
      await makeLocation({ cityId: city.id, categoryId: category.id, name: 'Visible' });
      for (const status of ['PENDING_REVIEW', 'REJECTED', 'ARCHIVED'] as const) {
        await makeLocation({
          cityId: city.id,
          categoryId: category.id,
          name: `Hidden ${status}`,
          status,
        });
      }
      await makeLocation({
        cityId: city.id,
        categoryId: offCategory.id,
        name: 'Hidden by category',
      });
      await makeLocation({ cityId: offCity.id, categoryId: category.id, name: 'Hidden by city' });

      const res = await api.get('/service-locations', { origin: null }).expect(200);
      expect(res.body.items.map((l: { name: string }) => l.name)).toEqual(['Visible']);
      expect(res.body.total).toBe(1);
    });

    it('exposes only public fields', async () => {
      await makeVisibleLocation({ latitude: 6.5, longitude: 3.4 });
      const res = await api.get('/service-locations', { origin: null }).expect(200);
      const item = res.body.items[0];
      expect(Object.keys(item).toSorted()).toEqual([
        'address',
        'category',
        'city',
        'id',
        'latitude',
        'longitude',
        'name',
        'slug',
      ]);
      expect(Object.keys(item.city).toSorted()).toEqual(['name', 'slug', 'state']);
      expect(Object.keys(item.category).toSorted()).toEqual(['iconKey', 'name', 'slug']);
      expect(item).toMatchObject({ latitude: 6.5, longitude: 3.4 });
    });

    it('filters by city, by category, and by name/address text (case-insensitive)', async () => {
      const kaduna = await makeCity({ slug: 'kaduna', name: 'Kaduna', state: 'Kaduna' });
      const lagos = await makeCity({ slug: 'lagos', name: 'Lagos', state: 'Lagos' });
      const banks = await makeCategory({ slug: 'banks', name: 'Banks' });
      const gov = await makeCategory({ slug: 'gov', name: 'Gov' });
      await makeLocation({
        cityId: kaduna.id,
        categoryId: banks.id,
        name: 'Alpha Branch',
        address: '1 Ahmadu Bello Way',
      });
      await makeLocation({
        cityId: lagos.id,
        categoryId: banks.id,
        name: 'Beta Branch',
        address: '2 Marina Road',
      });
      await makeLocation({
        cityId: lagos.id,
        categoryId: gov.id,
        name: 'Gamma Office',
        address: '3 Broad Street',
      });
      const names = (res: { body: { items: { name: string }[] } }) =>
        res.body.items.map((l) => l.name);

      expect(names(await api.get('/service-locations?city=lagos', { origin: null }))).toEqual([
        'Beta Branch',
        'Gamma Office',
      ]);
      expect(names(await api.get('/service-locations?category=banks', { origin: null }))).toEqual([
        'Alpha Branch',
        'Beta Branch',
      ]);
      expect(
        names(await api.get('/service-locations?city=lagos&category=banks', { origin: null })),
      ).toEqual(['Beta Branch']);
      expect(names(await api.get('/service-locations?q=GAMMA', { origin: null }))).toEqual([
        'Gamma Office',
      ]);
      expect(names(await api.get('/service-locations?q=marina', { origin: null }))).toEqual([
        'Beta Branch',
      ]);
      expect(names(await api.get('/service-locations?q=%20%20', { origin: null }))).toHaveLength(3); // blank search is ignored
      expect(names(await api.get('/service-locations?city=nowhere', { origin: null }))).toEqual([]);
    });

    it('treats % and _ in the search as literal characters, not wildcards', async () => {
      await makeVisibleLocation({ name: 'Plain Name' });
      await makeVisibleLocation({ name: '100% Pharmacy' });
      const percent = await api.get('/service-locations?q=%25', { origin: null }).expect(200);
      expect(percent.body.items.map((l: { name: string }) => l.name)).toEqual(['100% Pharmacy']);
      const underscore = await api.get('/service-locations?q=_', { origin: null }).expect(200);
      expect(underscore.body.total).toBe(0);
    });

    it('is safe against SQL-injection-style input', async () => {
      await makeVisibleLocation();
      const res = await api
        .get(`/service-locations?q=${encodeURIComponent("'; DROP TABLE service_locations; --")}`, {
          origin: null,
        })
        .expect(200);
      expect(res.body.total).toBe(0);
      expect(await ctx.prisma.serviceLocation.count()).toBe(1);
    });

    it('paginates with a stable total order, even when names are equal', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      for (let i = 0; i < 5; i++) {
        await makeLocation({ cityId: city.id, categoryId: category.id, name: 'Same Name' });
      }
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await api
          .get(`/service-locations?pageSize=2&page=${page}`, { origin: null })
          .expect(200);
        expect(res.body).toMatchObject({ page, pageSize: 2, total: 5, totalPages: 3 });
        seen.push(...res.body.items.map((l: { id: string }) => l.id));
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5); // no overlap, nothing skipped
      const beyond = await api
        .get('/service-locations?pageSize=2&page=4', { origin: null })
        .expect(200);
      expect(beyond.body).toMatchObject({ items: [], total: 5, totalPages: 3 });
    });

    it.each([
      ['pageSize above the cap', 'pageSize=51'],
      ['pageSize zero', 'pageSize=0'],
      ['page zero', 'page=0'],
      ['non-numeric page', 'page=abc'],
      ['negative page', 'page=-1'],
      ['malformed city slug', 'city=Not%20A%20Slug'],
      ['over-long search', `q=${'x'.repeat(81)}`],
    ])('rejects %s with 400', async (_label, query) => {
      const res = await api.get(`/service-locations?${query}`, { origin: null }).expect(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });

  describe('service locations (detail)', () => {
    it('returns an approved location with its tasks and no internal fields', async () => {
      const { category, location } = await makeVisibleLocation({
        slug: 'main-branch',
        name: 'Main Branch',
      });
      await makeTask(category.id, { slug: 'hold', name: 'Hold', sortOrder: 1 });
      await makeTask(category.id, { slug: 'off', name: 'Off', isActive: false });

      const res = await api
        .get(`/service-locations/${location.slug}`, { origin: null })
        .expect(200);
      expect(res.body.location).toMatchObject({ slug: 'main-branch', name: 'Main Branch' });
      expect(res.body.tasks.map((t: { slug: string }) => t.slug)).toEqual(['hold']);
      expect(res.body.restrictions).toEqual([]);
      expect(res.body.location).not.toHaveProperty('status');
      expect(res.body.location).not.toHaveProperty('cityId');
    });

    it('404s every non-public location exactly like an unknown one', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      const offCategory = await makeCategory({ isActive: false });
      const offCity = await makeCity({ isActive: false });
      const hidden = [
        await makeLocation({ cityId: city.id, categoryId: category.id, status: 'PENDING_REVIEW' }),
        await makeLocation({ cityId: city.id, categoryId: category.id, status: 'REJECTED' }),
        await makeLocation({ cityId: city.id, categoryId: category.id, status: 'ARCHIVED' }),
        await makeLocation({ cityId: city.id, categoryId: offCategory.id }),
        await makeLocation({ cityId: offCity.id, categoryId: category.id }),
      ];
      const unknown = await api
        .get('/service-locations/never-existed', { origin: null })
        .expect(404);
      for (const location of hidden) {
        const res = await api
          .get(`/service-locations/${location.slug}`, { origin: null })
          .expect(404);
        expect(res.body).toEqual(unknown.body);
      }
    });

    it('applies venue-specific restrictions without ever loosening a task', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      const hold = await makeTask(category.id, { slug: 'hold', name: 'Hold', sortOrder: 1 });
      const docs = await makeTask(category.id, {
        slug: 'docs',
        name: 'Docs',
        sortOrder: 2,
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes: 'Letter',
      });
      const bio = await makeTask(category.id, {
        slug: 'bio',
        name: 'Bio',
        sortOrder: 3,
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes: 'In person',
      });
      const location = await makeLocation({
        cityId: city.id,
        categoryId: category.id,
        slug: 'branch',
      });
      const owner = ownerPrisma();
      await owner.locationRestriction.create({
        data: {
          locationId: location.id,
          taskId: hold.id,
          rule: 'REQUIRES_AUTHORIZATION',
          note: 'This branch wants a letter.',
        },
      });
      await owner.locationRestriction.create({
        data: {
          locationId: location.id,
          taskId: docs.id,
          rule: 'PROHIBITED',
          note: 'No third-party drop-offs here.',
        },
      });
      await owner.locationRestriction.create({
        data: {
          locationId: location.id,
          taskId: null,
          rule: 'ADVISORY',
          note: 'Queues are longest on Mondays.',
        },
      });
      await owner.locationRestriction.create({
        data: {
          locationId: location.id,
          taskId: bio.id,
          rule: 'ADVISORY',
          note: 'Irrelevant here.',
        },
      });

      const res = await api.get('/service-locations/branch', { origin: null }).expect(200);
      const bySlug = Object.fromEntries(res.body.tasks.map((t: { slug: string }) => [t.slug, t]));
      expect(bySlug.hold).toMatchObject({
        eligibility: 'ELIGIBLE',
        effectiveEligibility: 'REQUIRES_AUTHORIZATION',
      });
      expect(bySlug.docs).toMatchObject({
        eligibility: 'REQUIRES_AUTHORIZATION',
        effectiveEligibility: 'NOT_DELEGABLE',
      });
      expect(bySlug.bio).toMatchObject({
        eligibility: 'NOT_DELEGABLE',
        effectiveEligibility: 'NOT_DELEGABLE',
      });
      expect(bySlug.hold.venueNotes.map((n: { rule: string }) => n.rule)).toEqual([
        'REQUIRES_AUTHORIZATION',
        'ADVISORY',
      ]);
      expect(res.body.restrictions).toHaveLength(4);
      expect(res.body.restrictions.find((r: { task: unknown }) => r.task === null)).toMatchObject({
        rule: 'ADVISORY',
      });
    });

    it('a venue-wide PROHIBITED rule blocks every task at that venue', async () => {
      const { category, location } = await makeVisibleLocation({ slug: 'closed-to-assistants' });
      await makeTask(category.id, { slug: 'hold' });
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: location.id,
          taskId: null,
          rule: 'PROHIBITED',
          note: 'Assistants are not permitted.',
        },
      });
      const res = await api
        .get('/service-locations/closed-to-assistants', { origin: null })
        .expect(200);
      expect(
        res.body.tasks.every(
          (t: { effectiveEligibility: string }) => t.effectiveEligibility === 'NOT_DELEGABLE',
        ),
      ).toBe(true);
    });
  });

  describe('HTTP behaviour', () => {
    it('is readable anonymously and a session cookie changes nothing', async () => {
      await makeVisibleLocation();
      const user = await createUser(api);
      const anon = await api.get('/service-locations', { origin: null }).expect(200);
      const authed = await api.get('/service-locations', { token: user.token }).expect(200);
      expect(authed.body).toEqual(anon.body);
    });

    it('sends a short public Cache-Control on successful reads only', async () => {
      await makeVisibleLocation({ slug: 'cached' });
      for (const path of [
        '/service-categories',
        '/cities',
        '/service-locations',
        '/service-locations/cached',
      ]) {
        const res = await api.get(path, { origin: null }).expect(200);
        expect([path, res.headers['cache-control']]).toEqual([
          path,
          expect.stringMatching(/^public, max-age=60/),
        ]);
      }
      for (const path of [
        '/service-locations/missing',
        '/service-categories/missing',
        '/cities/missing',
      ]) {
        const res = await api.get(path, { origin: null }).expect(404);
        expect([path, /public/.test(res.headers['cache-control'] ?? '')]).toEqual([path, false]);
      }
      const invalid = await api.get('/service-locations?page=0', { origin: null }).expect(400);
      expect(invalid.headers['cache-control'] ?? '').not.toMatch(/public/);
    });

    it('does not expose write methods publicly', async () => {
      for (const path of ['/service-categories', '/cities', '/service-locations']) {
        const res = await api.post(path, { name: 'x' }, { origin: null });
        expect([404, 401, 403]).toContain(res.status);
      }
    });
  });
});
