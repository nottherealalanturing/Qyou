import { AuditService } from '../src/audit/audit.service.js';
import { Logger } from '@nestjs/common';
import { makeCategory, makeCity, makeLocation, makeTask } from './support/reference.js';
import {
  client,
  createTestApp,
  createUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './support/test-app.js';

const ZERO = '00000000-0000-4000-8000-000000000000';

describe('Reference data: administration (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
    admin = await createUser(api, { role: 'ADMIN', verified: true });
  });

  const adminAudits = () =>
    ctx.prisma.auditLog.count({ where: { action: { startsWith: 'admin.' } } });
  const lastAudit = (action: string) =>
    ctx.prisma.auditLog.findFirstOrThrow({ where: { action }, orderBy: { createdAt: 'desc' } });
  const as = (user: TestUser) => ({ token: user.token });

  const categoryBody = (over: Record<string, unknown> = {}) => ({
    name: 'Banks & payments',
    description: 'Bank branches.',
    iconKey: 'bank',
    ...over,
  });
  const taskBody = (over: Record<string, unknown> = {}) => ({
    name: 'Hold your place',
    description: 'Wait in line.',
    kind: 'QUEUE_HOLDING',
    eligibility: 'ELIGIBLE',
    ...over,
  });
  async function newCategory(over: Record<string, unknown> = {}) {
    return (await api.post('/admin/service-categories', categoryBody(over), as(admin)).expect(201))
      .body.category;
  }
  async function newCity(over: Record<string, unknown> = {}) {
    return (
      await api
        .post(
          '/admin/cities',
          { name: 'Kaduna', state: 'Kaduna', latitude: 10.5105, longitude: 7.4165, ...over },
          as(admin),
        )
        .expect(201)
    ).body.city;
  }

  describe('authorization: every admin endpoint', () => {
    // [method, path, body]. Each must reject everyone except a verified administrator.
    function endpoints(ids: {
      category: string;
      task: string;
      city: string;
      location: string;
      restriction: string;
    }) {
      return [
        ['get', '/admin/service-categories'],
        ['get', `/admin/service-categories/${ids.category}`],
        ['post', '/admin/service-categories', categoryBody({ name: 'Nope' })],
        ['patch', `/admin/service-categories/${ids.category}`, { name: 'Nope' }],
        ['get', `/admin/service-categories/${ids.category}/tasks`],
        ['post', `/admin/service-categories/${ids.category}/tasks`, taskBody({ name: 'Nope' })],
        ['patch', `/admin/eligible-tasks/${ids.task}`, { name: 'Nope' }],
        ['get', '/admin/cities'],
        ['post', '/admin/cities', { name: 'Nope', state: 'Nope', latitude: 1, longitude: 1 }],
        ['patch', `/admin/cities/${ids.city}`, { name: 'Nope' }],
        ['get', '/admin/service-locations'],
        ['get', `/admin/service-locations/${ids.location}`],
        [
          'post',
          '/admin/service-locations',
          { cityId: ids.city, categoryId: ids.category, name: 'Nope', address: 'Nope' },
        ],
        ['patch', `/admin/service-locations/${ids.location}`, { name: 'Nope' }],
        [
          'post',
          `/admin/service-locations/${ids.location}/restrictions`,
          { rule: 'ADVISORY', note: 'Nope' },
        ],
        ['delete', `/admin/service-locations/${ids.location}/restrictions/${ids.restriction}`],
      ] as const;
    }

    async function fixtures() {
      const city = await makeCity();
      const category = await makeCategory();
      const task = await makeTask(category.id);
      const location = await makeLocation({ cityId: city.id, categoryId: category.id });
      const restriction = await ctx.prisma.locationRestriction.create({
        data: { locationId: location.id, rule: 'ADVISORY', note: 'Seed rule' },
      });
      return {
        category: category.id,
        task: task.id,
        city: city.id,
        location: location.id,
        restriction: restriction.id,
      };
    }

    async function call(
      route: readonly [string, string, unknown?],
      opts: { token?: string; origin?: string | null },
    ) {
      const [method, path, body] = route;
      if (method === 'get') return api.get(path, opts);
      if (method === 'delete') return api.del(path, opts);
      return api[method as 'post' | 'patch'](path, body, opts);
    }

    it('rejects anonymous callers with 401 and changes nothing', async () => {
      const ids = await fixtures();
      const before = await ctx.prisma.auditLog.count();
      for (const route of endpoints(ids)) {
        const res = await call(route, { origin: null });
        expect([route[0], route[1], res.status]).toEqual([route[0], route[1], 401]);
      }
      expect(await ctx.prisma.auditLog.count()).toBe(before);
    });

    it.each(['CUSTOMER', 'ASSISTANT', 'BUSINESS_STAFF'] as const)(
      'rejects a verified %s with 403 and changes nothing',
      async (role) => {
        const ids = await fixtures();
        const user = await createUser(api, { role, verified: true });
        const before = {
          audits: await adminAudits(),
          categories: await ctx.prisma.serviceCategory.count(),
          cities: await ctx.prisma.city.count(),
        };
        for (const route of endpoints(ids)) {
          const res = await call(route, as(user));
          expect([route[0], route[1], res.status]).toEqual([route[0], route[1], 403]);
        }
        expect(await adminAudits()).toBe(before.audits);
        expect(await ctx.prisma.serviceCategory.count()).toBe(before.categories);
        expect(await ctx.prisma.city.count()).toBe(before.cities);
      },
    );

    it('rejects an administrator with an UNVERIFIED email (403 EMAIL_NOT_VERIFIED)', async () => {
      const ids = await fixtures();
      const unverified = await createUser(api, { role: 'ADMIN', verified: false });
      for (const route of endpoints(ids)) {
        const res = await call(route, as(unverified));
        expect([route[0], route[1], res.status, res.body.code]).toEqual([
          route[0],
          route[1],
          403,
          'EMAIL_NOT_VERIFIED',
        ]);
      }
    });

    it('rejects cross-origin state-changing requests even from an administrator (CSRF)', async () => {
      const ids = await fixtures();
      const before = await adminAudits();
      for (const route of endpoints(ids).filter((r) => r[0] !== 'get')) {
        const res = await call(route, { token: admin.token, origin: 'https://evil.example' });
        expect([route[0], route[1], res.status]).toEqual([route[0], route[1], 403]);
      }
      expect(await adminAudits()).toBe(before);
    });

    it('lets a verified administrator through (smoke)', async () => {
      const ids = await fixtures();
      for (const path of [
        '/admin/service-categories',
        '/admin/cities',
        '/admin/service-locations',
      ]) {
        await api.get(path, as(admin)).expect(200);
      }
      await api.get(`/admin/service-locations/${ids.location}`, as(admin)).expect(200);
    });
  });

  describe('categories', () => {
    it('creates a category, derives the slug, normalises the name and audits it', async () => {
      const res = await api
        .post(
          '/admin/service-categories',
          categoryBody({ name: '  Banks   & Payments ' }),
          as(admin),
        )
        .expect(201);
      expect(res.body.category).toMatchObject({
        slug: 'banks-and-payments',
        name: 'Banks & Payments',
        isActive: true,
        sortOrder: 0,
        taskCount: 0,
        locationCount: 0,
      });
      const stored = await ctx.prisma.serviceCategory.findUniqueOrThrow({
        where: { slug: 'banks-and-payments' },
      });
      expect(stored.nameKey).toBe('banks & payments');

      const audit = await lastAudit('admin.service_category.created');
      expect(audit).toMatchObject({
        actorUserId: admin.id,
        targetType: 'service_category',
        targetId: stored.id,
      });
      expect(audit.metadata).toMatchObject({ slug: 'banks-and-payments', isActive: true });
      expect(audit.ip).toBeTruthy();
    });

    it('accepts an explicit slug and rejects invalid ones', async () => {
      await newCategory({ name: 'Custom', slug: 'my-slug' });
      for (const slug of ['Bad Slug', 'a', '-x', 'x--y', 'UPPER', 'a_b']) {
        const res = await api
          .post('/admin/service-categories', categoryBody({ name: `N ${slug}`, slug }), as(admin))
          .expect(400);
        expect(res.body.issues.map((i: { path: string }) => i.path)).toContain('slug');
      }
      const noLetters = await api
        .post('/admin/service-categories', categoryBody({ name: '日本語 カテゴリ' }), as(admin))
        .expect(400);
      expect(noLetters.body.issues).toEqual([expect.objectContaining({ path: 'slug' })]);
    });

    it('rejects duplicate slug or case/whitespace-variant name with 409, writing nothing', async () => {
      await newCategory({ name: 'Banks', slug: 'banks' });
      const before = {
        audits: await adminAudits(),
        rows: await ctx.prisma.serviceCategory.count(),
      };
      await api
        .post(
          '/admin/service-categories',
          categoryBody({ name: 'Other', slug: 'banks' }),
          as(admin),
        )
        .expect(409);
      await api
        .post('/admin/service-categories', categoryBody({ name: '  BANKS ' }), as(admin))
        .expect(409);
      expect(await adminAudits()).toBe(before.audits);
      expect(await ctx.prisma.serviceCategory.count()).toBe(before.rows);
    });

    it.each([
      ['missing name', { name: undefined }],
      ['name too long', { name: 'x'.repeat(81) }],
      ['control characters in name', { name: 'Ba\u0000nks' }],
      ['missing description', { description: undefined }],
      ['description too long', { description: 'x'.repeat(501) }],
      ['bad icon key', { iconKey: 'Not An Icon!' }],
      ['negative sortOrder', { sortOrder: -1 }],
      ['non-integer sortOrder', { sortOrder: 1.5 }],
      ['non-boolean isActive', { isActive: 'yes' }],
      ['unknown field', { role: 'ADMIN' }],
    ])('rejects %s with 400 and writes nothing', async (_label, over) => {
      const res = await api
        .post('/admin/service-categories', categoryBody(over), as(admin))
        .expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(await ctx.prisma.serviceCategory.count()).toBe(0);
      expect(await adminAudits()).toBe(0);
    });

    it('updates fields, audits real changes only, and keeps the slug immutable', async () => {
      const cat = await newCategory({ name: 'Banks', slug: 'banks' });
      const res = await api
        .patch(
          `/admin/service-categories/${cat.id}`,
          { name: 'Banks & Cash', description: 'New text.', isActive: false },
          as(admin),
        )
        .expect(200);
      expect(res.body.category).toMatchObject({
        slug: 'banks',
        name: 'Banks & Cash',
        isActive: false,
      });
      expect(
        (await ctx.prisma.serviceCategory.findUniqueOrThrow({ where: { id: cat.id } })).nameKey,
      ).toBe('banks & cash');

      const audit = await lastAudit('admin.service_category.updated');
      expect(audit.metadata).toMatchObject({
        slug: 'banks',
        changes: {
          name: { from: 'Banks', to: 'Banks & Cash' },
          description: { from: 'Bank branches.', to: 'New text.' },
          isActive: { from: true, to: false },
        },
      });
      await api
        .patch(`/admin/service-categories/${cat.id}`, { slug: 'renamed' }, as(admin))
        .expect(400);
    });

    it('treats a PATCH that changes nothing as a no-op: 200, no write, no audit entry', async () => {
      const cat = await newCategory();
      const before = await adminAudits();
      const updatedAt = (
        await ctx.prisma.serviceCategory.findUniqueOrThrow({ where: { id: cat.id } })
      ).updatedAt;
      await api
        .patch(`/admin/service-categories/${cat.id}`, { name: cat.name, isActive: true }, as(admin))
        .expect(200);
      expect(await adminAudits()).toBe(before);
      expect(
        (await ctx.prisma.serviceCategory.findUniqueOrThrow({ where: { id: cat.id } })).updatedAt,
      ).toEqual(updatedAt);
    });

    it('rejects an empty PATCH, a rename onto an existing name (409), and unknown ids', async () => {
      const a = await newCategory({ name: 'Alpha' });
      await newCategory({ name: 'Beta' });
      await api.patch(`/admin/service-categories/${a.id}`, {}, as(admin)).expect(400);
      await api
        .patch(`/admin/service-categories/${a.id}`, { name: ' beta ' }, as(admin))
        .expect(409);
      await api.patch(`/admin/service-categories/${ZERO}`, { name: 'X1' }, as(admin)).expect(404);
      await api
        .patch('/admin/service-categories/not-a-uuid', { name: 'X1' }, as(admin))
        .expect(400);
    });

    it('deactivating hides it (and its tasks and venues) from the public, reactivating restores it', async () => {
      const cat = await newCategory({ name: 'Banks', slug: 'banks' });
      await api
        .post(`/admin/service-categories/${cat.id}/tasks`, taskBody(), as(admin))
        .expect(201);
      await api.get('/service-categories/banks', { origin: null }).expect(200);
      await api
        .patch(`/admin/service-categories/${cat.id}`, { isActive: false }, as(admin))
        .expect(200);
      await api.get('/service-categories/banks', { origin: null }).expect(404);
      expect((await api.get('/service-categories', { origin: null })).body.items).toEqual([]);
      // Admins still see it, flagged inactive.
      const listed = (await api.get('/admin/service-categories', as(admin)).expect(200)).body.items;
      expect(listed).toEqual([
        expect.objectContaining({ slug: 'banks', isActive: false, taskCount: 1 }),
      ]);
      expect(
        (await api.get('/admin/service-categories?includeInactive=false', as(admin))).body.items,
      ).toEqual([]);
      await api
        .patch(`/admin/service-categories/${cat.id}`, { isActive: true }, as(admin))
        .expect(200);
      await api.get('/service-categories/banks', { origin: null }).expect(200);
    });
  });

  describe('eligible tasks: delegation rules', () => {
    it('creates tasks of each eligibility with the right notes, and audits them', async () => {
      const cat = await newCategory();
      const path = `/admin/service-categories/${cat.id}/tasks`;
      await api.post(path, taskBody({ name: 'Plain' }), as(admin)).expect(201);
      await api
        .post(
          path,
          taskBody({
            name: 'Docs',
            eligibility: 'REQUIRES_AUTHORIZATION',
            authorizationNotes: 'Signed letter.',
          }),
          as(admin),
        )
        .expect(201);
      const nd = await api
        .post(
          path,
          taskBody({
            name: 'Biometrics',
            eligibility: 'NOT_DELEGABLE',
            requiresPersonalPresence: true,
            restrictionNotes: 'In person only.',
          }),
          as(admin),
        )
        .expect(201);
      expect(nd.body.task).toMatchObject({
        slug: 'biometrics',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
      });
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'admin.eligible_task.created' } }),
      ).toBe(3);
      expect((await lastAudit('admin.eligible_task.created')).metadata).toMatchObject({
        eligibility: 'NOT_DELEGABLE',
        categorySlug: cat.slug,
      });
    });

    it.each([
      ['personal presence on an ELIGIBLE task', { requiresPersonalPresence: true }, 'eligibility'],
      ['credentials on an ELIGIBLE task', { requiresCredentials: true }, 'eligibility'],
      [
        'presence on a REQUIRES_AUTHORIZATION task',
        {
          eligibility: 'REQUIRES_AUTHORIZATION',
          authorizationNotes: 'x',
          requiresPersonalPresence: true,
        },
        'eligibility',
      ],
      [
        'REQUIRES_AUTHORIZATION without notes',
        { eligibility: 'REQUIRES_AUTHORIZATION' },
        'authorizationNotes',
      ],
      [
        'REQUIRES_AUTHORIZATION with blank notes',
        { eligibility: 'REQUIRES_AUTHORIZATION', authorizationNotes: '   ' },
        'authorizationNotes',
      ],
      ['NOT_DELEGABLE without a reason', { eligibility: 'NOT_DELEGABLE' }, 'restrictionNotes'],
      ['unknown eligibility', { eligibility: 'MAYBE' }, 'eligibility'],
      ['unknown kind', { kind: 'DANCE' }, 'kind'],
    ])('rejects %s with a field-level error, writing nothing', async (_label, over, path) => {
      const cat = await newCategory();
      const res = await api
        .post(`/admin/service-categories/${cat.id}/tasks`, taskBody(over), as(admin))
        .expect(400);
      expect(res.body.issues.map((i: { path: string }) => i.path)).toContain(path);
      expect(await ctx.prisma.eligibleTask.count()).toBe(0);
    });

    it('allows the same task slug in different categories but not within one (409)', async () => {
      const a = await newCategory({ name: 'Alpha' });
      const b = await newCategory({ name: 'Beta' });
      await api.post(`/admin/service-categories/${a.id}/tasks`, taskBody(), as(admin)).expect(201);
      await api.post(`/admin/service-categories/${b.id}/tasks`, taskBody(), as(admin)).expect(201);
      await api.post(`/admin/service-categories/${a.id}/tasks`, taskBody(), as(admin)).expect(409);
      await api
        .post(
          `/admin/service-categories/${a.id}/tasks`,
          taskBody({ name: 'Other', slug: 'hold-your-place' }),
          as(admin),
        )
        .expect(409);
    });

    it('returns 404 for an unknown category', async () => {
      await api.post(`/admin/service-categories/${ZERO}/tasks`, taskBody(), as(admin)).expect(404);
      await api.get(`/admin/service-categories/${ZERO}/tasks`, as(admin)).expect(404);
    });

    it('validates the MERGED state on update: you cannot sneak a task into an invalid combination', async () => {
      const cat = await newCategory();
      const task = (
        await api
          .post(`/admin/service-categories/${cat.id}/tasks`, taskBody(), as(admin))
          .expect(201)
      ).body.task;
      const patch = (body: Record<string, unknown>) =>
        api.patch(`/admin/eligible-tasks/${task.id}`, body, as(admin));

      await patch({ requiresCredentials: true }).expect(400); // still ELIGIBLE
      await patch({ eligibility: 'NOT_DELEGABLE' }).expect(400); // no reason
      await patch({ eligibility: 'REQUIRES_AUTHORIZATION' }).expect(400); // no notes
      const ok = await patch({
        eligibility: 'NOT_DELEGABLE',
        requiresCredentials: true,
        restrictionNotes: 'Never share credentials.',
      }).expect(200);
      expect(ok.body.task).toMatchObject({
        eligibility: 'NOT_DELEGABLE',
        requiresCredentials: true,
      });
      // Now loosening must also fail: still requires credentials.
      await patch({ eligibility: 'ELIGIBLE' }).expect(400);
      const audit = await lastAudit('admin.eligible_task.updated');
      expect(audit.metadata).toMatchObject({
        changes: { eligibility: { from: 'ELIGIBLE', to: 'NOT_DELEGABLE' } },
      });
    });

    it('deactivating a task hides it publicly; unknown task is 404; no-op patch is not audited', async () => {
      const cat = await newCategory({ name: 'Banks', slug: 'banks' });
      const task = (
        await api
          .post(`/admin/service-categories/${cat.id}/tasks`, taskBody(), as(admin))
          .expect(201)
      ).body.task;
      expect(
        (await api.get('/service-categories/banks', { origin: null })).body.tasks,
      ).toHaveLength(1);
      await api
        .patch(`/admin/eligible-tasks/${task.id}`, { isActive: false }, as(admin))
        .expect(200);
      expect(
        (await api.get('/service-categories/banks', { origin: null })).body.tasks,
      ).toHaveLength(0);
      const before = await adminAudits();
      await api
        .patch(`/admin/eligible-tasks/${task.id}`, { isActive: false }, as(admin))
        .expect(200);
      expect(await adminAudits()).toBe(before);
      await api.patch(`/admin/eligible-tasks/${ZERO}`, { isActive: true }, as(admin)).expect(404);
    });
  });

  describe('cities', () => {
    it('creates, audits, rejects duplicates, and validates coordinates and timezone', async () => {
      const city = await newCity();
      expect(city).toMatchObject({
        slug: 'kaduna',
        state: 'Kaduna',
        timezone: 'Africa/Lagos',
        latitude: 10.5105,
        longitude: 7.4165,
        locationCount: 0,
      });
      expect((await lastAudit('admin.city.created')).metadata).toMatchObject({ slug: 'kaduna' });

      await api
        .post(
          '/admin/cities',
          { name: 'Kaduna', state: 'Kaduna', latitude: 1, longitude: 1 },
          as(admin),
        )
        .expect(409); // slug and name+state
      await api
        .post(
          '/admin/cities',
          { name: 'Zaria', slug: 'kaduna', state: 'Kaduna', latitude: 1, longitude: 1 },
          as(admin),
        )
        .expect(409);
      await newCity({ name: 'Kaduna', state: 'Other State', slug: 'kaduna-other' }); // same name, other state: fine

      for (const bad of [
        { latitude: 91 },
        { latitude: -91 },
        { longitude: 181 },
        { latitude: '10' },
        { timezone: 'Mars/Base' },
        { state: '' },
      ]) {
        await api
          .post(
            '/admin/cities',
            { name: 'Badville', state: 'Bad', latitude: 1, longitude: 1, ...bad },
            as(admin),
          )
          .expect(400);
      }
    });

    it('updates, audits changes, deactivates (hiding it publicly) and keeps the slug immutable', async () => {
      const city = await newCity();
      await api
        .patch(`/admin/cities/${city.id}`, { latitude: 10.5, sortOrder: 7 }, as(admin))
        .expect(200);
      expect((await lastAudit('admin.city.updated')).metadata).toMatchObject({
        changes: { latitude: { from: 10.5105, to: 10.5 }, sortOrder: { from: 0, to: 7 } },
      });
      await api.get('/cities/kaduna', { origin: null }).expect(200);
      await api.patch(`/admin/cities/${city.id}`, { isActive: false }, as(admin)).expect(200);
      await api.get('/cities/kaduna', { origin: null }).expect(404);
      await api.patch(`/admin/cities/${city.id}`, { slug: 'x1' }, as(admin)).expect(400);
      await api.patch(`/admin/cities/${ZERO}`, { name: 'Nowhere' }, as(admin)).expect(404);
    });
  });

  describe('locations', () => {
    async function setup() {
      const city = await newCity();
      const category = await newCategory();
      return {
        city,
        category,
        body: (over: Record<string, unknown> = {}) => ({
          cityId: city.id,
          categoryId: category.id,
          name: 'Main Branch',
          address: '1 Ahmadu Bello Way',
          ...over,
        }),
      };
    }

    it('creates a location in review by default, deriving the slug from name + city', async () => {
      const { body } = await setup();
      const res = await api.post('/admin/service-locations', body(), as(admin)).expect(201);
      expect(res.body.location).toMatchObject({
        slug: 'main-branch-kaduna',
        status: 'PENDING_REVIEW',
        latitude: null,
        longitude: null,
      });
      expect((await lastAudit('admin.service_location.created')).metadata).toMatchObject({
        slug: 'main-branch-kaduna',
        city: 'kaduna',
        status: 'PENDING_REVIEW',
      });
      // Not public until approved.
      await api.get('/service-locations/main-branch-kaduna', { origin: null }).expect(404);
      expect((await api.get('/service-locations', { origin: null })).body.total).toBe(0);
    });

    it('can be created already APPROVED, with coordinates, and is then public', async () => {
      const { body } = await setup();
      await api
        .post(
          '/admin/service-locations',
          body({ status: 'APPROVED', latitude: 10.52, longitude: 7.44 }),
          as(admin),
        )
        .expect(201);
      const res = await api
        .get('/service-locations/main-branch-kaduna', { origin: null })
        .expect(200);
      expect(res.body.location).toMatchObject({ latitude: 10.52, longitude: 7.44 });
    });

    it('rejects unknown city/category, bad status, half coordinates and over-long fields', async () => {
      const { body } = await setup();
      const refs = await api
        .post('/admin/service-locations', body({ cityId: ZERO, categoryId: ZERO }), as(admin))
        .expect(400);
      expect(refs.body.issues.map((i: { path: string }) => i.path).toSorted()).toEqual([
        'categoryId',
        'cityId',
      ]);
      for (const over of [
        { status: 'REJECTED' },
        { status: 'ARCHIVED' },
        { status: 'nope' },
        { latitude: 10 },
        { longitude: 7 },
        { latitude: 200, longitude: 7 },
        { name: 'x'.repeat(121) },
        { address: 'x'.repeat(251) },
        { address: '' },
        { cityId: 'nope' },
        { extra: 1 },
      ]) {
        await api.post('/admin/service-locations', body(over), as(admin)).expect(400);
      }
      expect(await ctx.prisma.serviceLocation.count()).toBe(0);
    });

    it('rejects a duplicate slug with 409 and leaves exactly one row', async () => {
      const { body } = await setup();
      await api.post('/admin/service-locations', body(), as(admin)).expect(201);
      const before = await adminAudits();
      await api.post('/admin/service-locations', body(), as(admin)).expect(409);
      await api
        .post(
          '/admin/service-locations',
          body({ name: 'Other', slug: 'main-branch-kaduna' }),
          as(admin),
        )
        .expect(409);
      expect(await ctx.prisma.serviceLocation.count()).toBe(1);
      expect(await adminAudits()).toBe(before);
      // The same name with an explicit slug is a different, legitimate record (e.g. a second branch).
      await api
        .post('/admin/service-locations', body({ slug: 'main-branch-annex' }), as(admin))
        .expect(201);
    });

    it('follows the explicit status lifecycle and audits every transition', async () => {
      const { body } = await setup();
      const id = (await api.post('/admin/service-locations', body(), as(admin)).expect(201)).body
        .location.id;
      const move = (status: string) =>
        api.patch(`/admin/service-locations/${id}`, { status }, as(admin));

      await move('ARCHIVED').expect(409); // PENDING → ARCHIVED is not allowed
      await move('REJECTED').expect(200);
      await move('APPROVED').expect(409); // REJECTED must go back through review
      await move('PENDING_REVIEW').expect(200);
      await move('APPROVED').expect(200);
      await api.get('/service-locations/main-branch-kaduna', { origin: null }).expect(200);
      await move('PENDING_REVIEW').expect(409); // APPROVED → PENDING is not allowed
      await move('ARCHIVED').expect(200);
      await api.get('/service-locations/main-branch-kaduna', { origin: null }).expect(404); // archived = gone
      await move('APPROVED').expect(200); // reopen
      await api.get('/service-locations/main-branch-kaduna', { origin: null }).expect(200);

      const transitions = (
        await ctx.prisma.auditLog.findMany({
          where: { action: 'admin.service_location.updated' },
          orderBy: { createdAt: 'asc' },
        })
      ).map(
        (a) => (a.metadata as { changes: { status: { from: string; to: string } } }).changes.status,
      );
      expect(transitions).toEqual([
        { from: 'PENDING_REVIEW', to: 'REJECTED' },
        { from: 'REJECTED', to: 'PENDING_REVIEW' },
        { from: 'PENDING_REVIEW', to: 'APPROVED' },
        { from: 'APPROVED', to: 'ARCHIVED' },
        { from: 'ARCHIVED', to: 'APPROVED' },
      ]);
    });

    it('keeps city, category and slug immutable, and validates coordinates as a pair on the merged state', async () => {
      const { body, city, category } = await setup();
      const id = (
        await api
          .post('/admin/service-locations', body({ latitude: 10.5, longitude: 7.4 }), as(admin))
          .expect(201)
      ).body.location.id;
      for (const over of [{ cityId: city.id }, { categoryId: category.id }, { slug: 'new-slug' }]) {
        await api.patch(`/admin/service-locations/${id}`, over, as(admin)).expect(400);
      }
      await api.patch(`/admin/service-locations/${id}`, { latitude: null }, as(admin)).expect(400); // would leave a lone longitude
      await api
        .patch(`/admin/service-locations/${id}`, { latitude: null, longitude: null }, as(admin))
        .expect(200);
      await api.patch(`/admin/service-locations/${id}`, { latitude: 10.6 }, as(admin)).expect(400);
      await api
        .patch(
          `/admin/service-locations/${id}`,
          { name: 'Renamed Branch', address: '2 New Road', latitude: 10.6, longitude: 7.5 },
          as(admin),
        )
        .expect(200);
      expect(
        (await api.get(`/admin/service-locations/${id}`, as(admin))).body.location,
      ).toMatchObject({ name: 'Renamed Branch', slug: 'main-branch-kaduna', latitude: 10.6 });
    });

    it('treats % and _ in the admin search literally, like the public search', async () => {
      const { body } = await setup();
      await api
        .post('/admin/service-locations', body({ name: 'Plain Name', slug: 'plain' }), as(admin))
        .expect(201);
      await api
        .post(
          '/admin/service-locations',
          body({ name: '100% Pharmacy', slug: 'pharmacy' }),
          as(admin),
        )
        .expect(201);
      const percent = (await api.get('/admin/service-locations?q=%25', as(admin)).expect(200)).body;
      expect(percent.items.map((l: { name: string }) => l.name)).toEqual(['100% Pharmacy']);
      expect(
        (await api.get('/admin/service-locations?q=_', as(admin)).expect(200)).body.total,
      ).toBe(0);
    });

    it('lists every status for admins with filters and pagination; 404 for unknown ids', async () => {
      const { body } = await setup();
      for (let i = 0; i < 3; i++)
        await api
          .post(
            '/admin/service-locations',
            body({ name: `Branch ${i}`, slug: `b-${i}` }),
            as(admin),
          )
          .expect(201);
      await api.patch(
        `/admin/service-locations/${(await ctx.prisma.serviceLocation.findFirstOrThrow({ where: { slug: 'b-0' } })).id}`,
        { status: 'APPROVED' },
        as(admin),
      );
      const all = (await api.get('/admin/service-locations?pageSize=2', as(admin)).expect(200))
        .body;
      expect(all).toMatchObject({ total: 3, totalPages: 2 });
      expect(all.items[0]).toHaveProperty('status');
      expect(
        (await api.get('/admin/service-locations?status=PENDING_REVIEW', as(admin))).body.total,
      ).toBe(2);
      expect(
        (await api.get('/admin/service-locations?status=NOPE', as(admin)).expect(400)).body.message,
      ).toBe('Validation failed');
      await api.get(`/admin/service-locations/${ZERO}`, as(admin)).expect(404);
    });
  });

  describe('venue restrictions', () => {
    async function venue() {
      const city = await makeCity();
      const category = await makeCategory();
      const other = await makeCategory();
      const task = await makeTask(category.id, { slug: 'hold' });
      const foreignTask = await makeTask(other.id, { slug: 'foreign' });
      const location = await makeLocation({
        cityId: city.id,
        categoryId: category.id,
        slug: 'venue',
      });
      return {
        task,
        foreignTask,
        location,
        path: `/admin/service-locations/${location.id}/restrictions`,
      };
    }

    it('adds venue-wide and task-specific restrictions, audits them, and shows them publicly', async () => {
      const { task, path } = await venue();
      const wide = await api
        .post(path, { rule: 'ADVISORY', note: 'Go early.' }, as(admin))
        .expect(201);
      await api
        .post(
          path,
          { taskId: task.id, rule: 'PROHIBITED', note: 'No assistants for this.' },
          as(admin),
        )
        .expect(201);
      expect(wide.body.restriction).toMatchObject({ taskId: null, rule: 'ADVISORY' });
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'admin.location_restriction.created' },
        }),
      ).toBe(2);
      const pub = await api.get('/service-locations/venue', { origin: null }).expect(200);
      expect(pub.body.restrictions).toHaveLength(2);
      expect(pub.body.tasks[0]).toMatchObject({
        slug: 'hold',
        effectiveEligibility: 'NOT_DELEGABLE',
      });
    });

    it('rejects tasks from another category, unknown tasks, blank notes and bad rules', async () => {
      const { foreignTask, path } = await venue();
      await api
        .post(path, { taskId: foreignTask.id, rule: 'ADVISORY', note: 'x' }, as(admin))
        .expect(400);
      await api.post(path, { taskId: ZERO, rule: 'ADVISORY', note: 'x' }, as(admin)).expect(400);
      await api.post(path, { rule: 'ADVISORY', note: '   ' }, as(admin)).expect(400);
      await api.post(path, { rule: 'FORBID', note: 'x' }, as(admin)).expect(400);
      await api.post(path, { rule: 'ADVISORY', note: 'x'.repeat(501) }, as(admin)).expect(400);
      await api
        .post(
          `/admin/service-locations/${ZERO}/restrictions`,
          { rule: 'ADVISORY', note: 'x' },
          as(admin),
        )
        .expect(404);
      expect(await ctx.prisma.locationRestriction.count()).toBe(0);
    });

    it('rejects duplicate rules per venue/task — including venue-wide ones (NULLS NOT DISTINCT)', async () => {
      const { task, path } = await venue();
      await api.post(path, { rule: 'ADVISORY', note: 'one' }, as(admin)).expect(201);
      await api.post(path, { rule: 'ADVISORY', note: 'two' }, as(admin)).expect(409);
      await api
        .post(path, { rule: 'PROHIBITED', note: 'different rule is fine' }, as(admin))
        .expect(201);
      await api
        .post(path, { taskId: task.id, rule: 'ADVISORY', note: 'task scoped' }, as(admin))
        .expect(201);
      await api
        .post(path, { taskId: task.id, rule: 'ADVISORY', note: 'dup' }, as(admin))
        .expect(409);
    });

    it('deletes a restriction (audited), then 404s; cannot delete via another venue', async () => {
      const { location, path } = await venue();
      const id = (await api.post(path, { rule: 'ADVISORY', note: 'temp' }, as(admin)).expect(201))
        .body.restriction.id;
      const city = await makeCity();
      const category = await makeCategory();
      const elsewhere = await makeLocation({ cityId: city.id, categoryId: category.id });
      await api
        .del(`/admin/service-locations/${elsewhere.id}/restrictions/${id}`, as(admin))
        .expect(404);
      await api.del(`${path}/${id}`, as(admin)).expect(204);
      await api.del(`${path}/${id}`, as(admin)).expect(404);
      expect((await lastAudit('admin.location_restriction.deleted')).metadata).toMatchObject({
        locationSlug: 'venue',
        rule: 'ADVISORY',
      });
      expect(
        (await api.get(`/admin/service-locations/${location.id}`, as(admin))).body.restrictions,
      ).toEqual([]);
    });
  });

  describe('audit completeness and integrity', () => {
    it('writes exactly one audit row per successful admin write — and none for failed ones', async () => {
      const start = await adminAudits();
      const category = await newCategory({ name: 'Banks' }); // 1
      const task = (
        await api
          .post(`/admin/service-categories/${category.id}/tasks`, taskBody(), as(admin))
          .expect(201)
      ).body.task; // 2
      const city = await newCity(); // 3
      const location = (
        await api
          .post(
            '/admin/service-locations',
            { cityId: city.id, categoryId: category.id, name: 'Branch', address: 'Road' },
            as(admin),
          )
          .expect(201)
      ).body.location; // 4
      const restriction = (
        await api
          .post(
            `/admin/service-locations/${location.id}/restrictions`,
            { taskId: task.id, rule: 'ADVISORY', note: 'n' },
            as(admin),
          )
          .expect(201)
      ).body.restriction; // 5
      await api
        .patch(`/admin/service-categories/${category.id}`, { sortOrder: 4 }, as(admin))
        .expect(200); // 6
      await api.patch(`/admin/eligible-tasks/${task.id}`, { sortOrder: 4 }, as(admin)).expect(200); // 7
      await api.patch(`/admin/cities/${city.id}`, { sortOrder: 4 }, as(admin)).expect(200); // 8
      await api
        .patch(`/admin/service-locations/${location.id}`, { name: 'Branch 2' }, as(admin))
        .expect(200); // 9
      await api
        .del(`/admin/service-locations/${location.id}/restrictions/${restriction.id}`, as(admin))
        .expect(204); // 10
      expect(await adminAudits()).toBe(start + 10);

      // Failed writes: validation, conflict, not-found, forbidden — none audited.
      await api
        .post('/admin/service-categories', categoryBody({ name: 'Banks' }), as(admin))
        .expect(409);
      await api
        .post('/admin/service-categories', categoryBody({ iconKey: '!!' }), as(admin))
        .expect(400);
      await api.patch(`/admin/cities/${ZERO}`, { name: 'Nowhere' }, as(admin)).expect(404);
      await api
        .patch(`/admin/service-locations/${location.id}`, { status: 'ARCHIVED' }, as(admin))
        .expect(409);
      expect(await adminAudits()).toBe(start + 10);

      const rows = await ctx.prisma.auditLog.findMany({
        where: { action: { startsWith: 'admin.' } },
      });
      for (const row of rows) {
        expect(row.actorUserId).toBe(admin.id);
        expect(row.targetId).toBeTruthy();
        expect(row.targetType).toBeTruthy();
      }
    });

    it('commits the write and its audit row atomically: if auditing fails, nothing is written', async () => {
      const audit = ctx.app.get(AuditService);
      const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const spy = vi
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('audit store unavailable'));
      const res = await api.post(
        '/admin/service-categories',
        categoryBody({ name: 'Atomic' }),
        as(admin),
      );
      spy.mockRestore();
      quiet.mockRestore();
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Something went wrong. Please try again.');
      expect(await ctx.prisma.serviceCategory.count({ where: { slug: 'atomic' } })).toBe(0);
    });

    it('never stores or returns secrets in audit metadata', async () => {
      const cat = await newCategory({ name: 'Plain' });
      await api
        .patch(`/admin/service-categories/${cat.id}`, { description: 'Updated' }, as(admin))
        .expect(200);
      const rows = JSON.stringify(
        await ctx.prisma.auditLog.findMany({
          where: { action: { startsWith: 'admin.service_category' } },
        }),
      );
      expect(rows).not.toMatch(/password|token|passwordHash|cookie/i);
    });
  });

  describe('concurrency', () => {
    it('creates exactly one category when many identical requests race', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          api.post('/admin/service-categories', categoryBody({ name: 'Racing' }), as(admin)),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(7);
      expect(await ctx.prisma.serviceCategory.count()).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'admin.service_category.created' } }),
      ).toBe(1);
    });

    it('stores one venue-wide restriction when requests race, and a consistent status after racing transitions', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      const location = await makeLocation({
        cityId: city.id,
        categoryId: category.id,
        status: 'PENDING_REVIEW',
      });
      const adds = await Promise.all(
        Array.from({ length: 6 }, () =>
          api.post(
            `/admin/service-locations/${location.id}/restrictions`,
            { rule: 'ADVISORY', note: 'race' },
            as(admin),
          ),
        ),
      );
      expect(adds.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await ctx.prisma.locationRestriction.count()).toBe(1);

      const moves = await Promise.all(
        ['APPROVED', 'REJECTED', 'APPROVED', 'REJECTED'].map((status) =>
          api.patch(`/admin/service-locations/${location.id}`, { status }, as(admin)),
        ),
      );
      for (const r of moves) expect([200, 409]).toContain(r.status);
      const final = (
        await ctx.prisma.serviceLocation.findUniqueOrThrow({ where: { id: location.id } })
      ).status;
      expect(['APPROVED', 'REJECTED']).toContain(final);
    });
  });
});
