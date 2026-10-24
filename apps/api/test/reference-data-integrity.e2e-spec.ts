import { SeedService } from '../src/seed/seed.service.js';
import { SEED_CATEGORIES, SEED_CITIES } from '../src/seed/reference-data.js';
import { makeCategory, makeCity, makeLocation, makeTask } from './support/reference.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
} from './support/test-app.js';

/** Runs SQL as the owner and returns the database's error text (or 'NO ERROR'). */
async function sqlError(sql: string, ...params: unknown[]): Promise<string> {
  try {
    await ownerPrisma().$executeRawUnsafe(sql, ...params);
    return 'NO ERROR';
  } catch (error) {
    const e = error as { message?: string; meta?: unknown };
    return `${e.message ?? ''} ${JSON.stringify(e.meta ?? {})}`;
  }
}

describe('Reference data: database constraints and seed (e2e, real PostgreSQL)', () => {
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

  describe('CHECK constraints hold even when the API is bypassed (raw SQL as the owner)', () => {
    async function insertTask(columns: Record<string, string | boolean | null>) {
      const category = await makeCategory();
      const base: Record<string, string | boolean | null> = {
        id: crypto.randomUUID(),
        categoryId: category.id,
        slug: `t-${crypto.randomUUID().slice(0, 8)}`,
        name: 'T',
        nameKey: `t-${crypto.randomUUID()}`,
        description: 'd',
        kind: 'QUEUE_HOLDING',
        eligibility: 'ELIGIBLE',
        ...columns,
      };
      const names = Object.keys(base)
        .map((k) => `"${k}"`)
        .join(', ');
      const marks = Object.keys(base)
        .map(
          (_, i) =>
            `$${i + 1}${['kind', 'eligibility'].includes(Object.keys(base)[i] as string) ? `::"${Object.keys(base)[i] === 'kind' ? 'TaskKind' : 'TaskEligibility'}"` : Object.keys(base)[i] === 'id' || Object.keys(base)[i] === 'categoryId' ? '::uuid' : ''}`,
        )
        .join(', ');
      return sqlError(
        `INSERT INTO eligible_tasks (${names}, "updatedAt") VALUES (${marks}, now())`,
        ...Object.values(base),
      );
    }

    it('rejects a task needing presence or credentials unless it is NOT_DELEGABLE', async () => {
      expect(await insertTask({ requiresPersonalPresence: true })).toMatch(
        /eligible_tasks_presence_credentials_not_delegable/,
      );
      expect(await insertTask({ requiresCredentials: true })).toMatch(
        /eligible_tasks_presence_credentials_not_delegable/,
      );
      expect(
        await insertTask({
          requiresCredentials: true,
          eligibility: 'REQUIRES_AUTHORIZATION',
          authorizationNotes: 'x',
        }),
      ).toMatch(/presence_credentials/);
      expect(
        await insertTask({
          requiresPersonalPresence: true,
          eligibility: 'NOT_DELEGABLE',
          restrictionNotes: 'why',
        }),
      ).toBe('NO ERROR');
    });

    it('requires notes for REQUIRES_AUTHORIZATION and a reason for NOT_DELEGABLE', async () => {
      expect(await insertTask({ eligibility: 'REQUIRES_AUTHORIZATION' })).toMatch(
        /authorization_needs_notes/,
      );
      expect(
        await insertTask({ eligibility: 'REQUIRES_AUTHORIZATION', authorizationNotes: '   ' }),
      ).toMatch(/authorization_needs_notes/);
      expect(await insertTask({ eligibility: 'NOT_DELEGABLE' })).toMatch(
        /not_delegable_needs_reason/,
      );
      expect(await insertTask({ eligibility: 'NOT_DELEGABLE', restrictionNotes: ' ' })).toMatch(
        /not_delegable_needs_reason/,
      );
      expect(
        await insertTask({ eligibility: 'REQUIRES_AUTHORIZATION', authorizationNotes: 'Letter' }),
      ).toBe('NO ERROR');
    });

    it('rejects an UPDATE that would break the rules on an existing task', async () => {
      const category = await makeCategory();
      const task = await makeTask(category.id);
      expect(
        await sqlError(
          `UPDATE eligible_tasks SET "requiresCredentials" = true WHERE id = $1::uuid`,
          task.id,
        ),
      ).toMatch(/presence_credentials/);
      expect(
        await sqlError(
          `UPDATE eligible_tasks SET "eligibility" = 'NOT_DELEGABLE' WHERE id = $1::uuid`,
          task.id,
        ),
      ).toMatch(/needs_reason/);
    });

    it('enforces slug format on every slug column', async () => {
      for (const [table, extra] of [
        ['cities', `"name","state","latitude","longitude"`],
        ['service_categories', `"name","nameKey","description","iconKey"`],
      ] as const) {
        const values = table === 'cities' ? `'N','S',1,1` : `'N','n','d','i'`;
        for (const bad of ['Upper', 'has space', '-lead', 'trail-', 'dou--ble', 'under_score']) {
          expect(
            await sqlError(
              `INSERT INTO ${table} ("id","slug",${extra},"updatedAt") VALUES (gen_random_uuid(), '${bad}', ${values}, now())`,
            ),
            `${table}:${bad}`,
          ).toMatch(/slug_format/);
        }
      }
    });

    it('enforces coordinate ranges and pairs', async () => {
      expect(
        await sqlError(
          `INSERT INTO cities ("id","slug","name","state","latitude","longitude","updatedAt") VALUES (gen_random_uuid(),'bad-lat','N','S',95,1,now())`,
        ),
      ).toMatch(/cities_coordinates_range/);
      const city = await makeCity();
      const category = await makeCategory();
      const insert = (lat: string, lng: string) =>
        sqlError(
          `INSERT INTO service_locations ("id","cityId","categoryId","slug","name","address","latitude","longitude","updatedAt") VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'loc-${Math.random().toString(36).slice(2, 8)}','N','A',${lat},${lng},now())`,
          city.id,
          category.id,
        );
      expect(await insert('10', 'NULL')).toMatch(/coordinates_pair/);
      expect(await insert('NULL', '10')).toMatch(/coordinates_pair/);
      expect(await insert('10', '200')).toMatch(/coordinates_range/);
      expect(await insert('NULL', 'NULL')).toBe('NO ERROR');
      expect(await insert('10', '10')).toBe('NO ERROR');
    });

    it('treats a venue-wide restriction as unique per rule (NULLS NOT DISTINCT)', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      const location = await makeLocation({ cityId: city.id, categoryId: category.id });
      const insert = (rule: string, note: string) =>
        sqlError(
          `INSERT INTO location_restrictions ("id","locationId","taskId","rule","note") VALUES (gen_random_uuid(),$1::uuid,NULL,$2::"RestrictionRule",$3)`,
          location.id,
          rule,
          note,
        );
      expect(await insert('ADVISORY', 'first')).toBe('NO ERROR');
      expect(await insert('ADVISORY', 'second')).toMatch(
        /duplicate key value violates unique constraint/,
      );
      expect(await insert('PROHIBITED', 'a different rule is fine')).toBe('NO ERROR');
    });

    it('rejects blank restriction notes (a rule with no other violation, so only the CHECK can fire)', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      const location = await makeLocation({ cityId: city.id, categoryId: category.id });
      const result = await sqlError(
        `INSERT INTO location_restrictions ("id","locationId","taskId","rule","note") VALUES (gen_random_uuid(),$1::uuid,NULL,'ADVISORY'::"RestrictionRule",$2)`,
        location.id,
        '   ',
      );
      expect(result).toMatch(/location_restrictions_note_not_blank/);
    });
  });

  describe('referential integrity: nothing referenced can be deleted away (no cascading data loss)', () => {
    it('blocks deleting a city or category that still has locations, even for the app role', async () => {
      const city = await makeCity();
      const category = await makeCategory();
      await makeLocation({ cityId: city.id, categoryId: category.id });
      await expect(ctx.prisma.city.delete({ where: { id: city.id } })).rejects.toThrow();
      await expect(
        ctx.prisma.serviceCategory.delete({ where: { id: category.id } }),
      ).rejects.toThrow();
      expect(await ctx.prisma.serviceLocation.count()).toBe(1);
    });

    it('blocks deleting a category that still has tasks', async () => {
      const category = await makeCategory();
      await makeTask(category.id);
      await expect(
        ctx.prisma.serviceCategory.delete({ where: { id: category.id } }),
      ).rejects.toThrow();
    });
  });

  describe('the seed', () => {
    const expectedTasks = SEED_CATEGORIES.reduce((n, c) => n + c.tasks.length, 0);

    it('creates the launch cities, categories and tasks — and no locations', async () => {
      const report = await ctx.app.get(SeedService).seedReferenceData();
      expect(report).toEqual({
        citiesCreated: 4,
        categoriesCreated: SEED_CATEGORIES.length,
        tasksCreated: expectedTasks,
      });

      expect(
        (await ctx.prisma.city.findMany({ orderBy: { sortOrder: 'asc' } })).map((c) => c.slug),
      ).toEqual(['kaduna', 'abuja', 'kano', 'lagos']);
      expect(await ctx.prisma.serviceLocation.count()).toBe(0);
      expect(await ctx.prisma.locationRestriction.count()).toBe(0);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'system.reference_data_seeded' },
      });
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata).toEqual(report);
    });

    it('is idempotent: a second run creates nothing and writes no audit row', async () => {
      const seed = ctx.app.get(SeedService);
      await seed.seedReferenceData();
      const counts = async () => [
        await ctx.prisma.city.count(),
        await ctx.prisma.serviceCategory.count(),
        await ctx.prisma.eligibleTask.count(),
        await ctx.prisma.auditLog.count({ where: { action: 'system.reference_data_seeded' } }),
      ];
      const first = await counts();
      expect(await seed.seedReferenceData()).toEqual({
        citiesCreated: 0,
        categoriesCreated: 0,
        tasksCreated: 0,
      });
      expect(await counts()).toEqual(first);
    });

    it('never overwrites administrator edits or reactivates what was deactivated', async () => {
      const seed = ctx.app.get(SeedService);
      await seed.seedReferenceData();
      const bank = await ctx.prisma.serviceCategory.findUniqueOrThrow({
        where: { slug: 'banks-and-payments' },
      });
      const lagos = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'lagos' } });
      const task = await ctx.prisma.eligibleTask.findFirstOrThrow({
        where: { categoryId: bank.id, slug: 'hold-place-in-line' },
      });
      await ctx.prisma.serviceCategory.update({
        where: { id: bank.id },
        data: { name: 'Banks (edited)', nameKey: 'banks (edited)', isActive: false },
      });
      await ctx.prisma.city.update({
        where: { id: lagos.id },
        data: { isActive: false, sortOrder: 99 },
      });
      await ctx.prisma.eligibleTask.update({
        where: { id: task.id },
        data: { description: 'Edited by an admin.', isActive: false },
      });

      expect(await seed.seedReferenceData()).toEqual({
        citiesCreated: 0,
        categoriesCreated: 0,
        tasksCreated: 0,
      });
      expect(
        await ctx.prisma.serviceCategory.findUniqueOrThrow({ where: { id: bank.id } }),
      ).toMatchObject({ name: 'Banks (edited)', isActive: false });
      expect(await ctx.prisma.city.findUniqueOrThrow({ where: { id: lagos.id } })).toMatchObject({
        isActive: false,
        sortOrder: 99,
      });
      expect(
        await ctx.prisma.eligibleTask.findUniqueOrThrow({ where: { id: task.id } }),
      ).toMatchObject({ description: 'Edited by an admin.', isActive: false });
    });

    it('only fills in what is missing (partial state)', async () => {
      const seed = ctx.app.get(SeedService);
      await seed.seedReferenceData();
      await ownerPrisma().eligibleTask.deleteMany({ where: { slug: 'collect-queue-ticket' } });
      await ownerPrisma().city.delete({ where: { slug: 'kano' } });
      expect(await seed.seedReferenceData()).toEqual({
        citiesCreated: 1,
        categoriesCreated: 0,
        tasksCreated: 1,
      });
    });

    it('produces data the public API serves honestly: categories and cities, zero venues', async () => {
      await ctx.app.get(SeedService).seedReferenceData();
      const categories = (await api.get('/service-categories', { origin: null }).expect(200)).body
        .items;
      expect(categories).toHaveLength(SEED_CATEGORIES.length);
      expect(
        categories.every(
          (c: { locationCount: number; taskCount: number }) =>
            c.locationCount === 0 && c.taskCount > 0,
        ),
      ).toBe(true);
      const cities = (await api.get('/cities', { origin: null }).expect(200)).body.items;
      expect(cities.map((c: { slug: string }) => c.slug)).toEqual([
        'kaduna',
        'abuja',
        'kano',
        'lagos',
      ]);
      expect(cities.every((c: { locationCount: number }) => c.locationCount === 0)).toBe(true);
      expect(
        (await api.get('/service-locations', { origin: null }).expect(200)).body,
      ).toMatchObject({ items: [], total: 0 });
      expect(SEED_CITIES).toHaveLength(4);
    });

    it('seeded tasks expose the NOT_DELEGABLE rules and reasons to the public', async () => {
      await ctx.app.get(SeedService).seedReferenceData();
      const { tasks } = (
        await api.get('/service-categories/government-services', { origin: null }).expect(200)
      ).body;
      const biometric = tasks.find(
        (t: { slug: string }) => t.slug === 'biometric-or-identity-capture',
      );
      expect(biometric).toMatchObject({
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
      });
      expect(biometric.restrictionNotes).toMatch(/in person/i);
      const portal = tasks.find(
        (t: { slug: string }) => t.slug === 'operate-your-online-portal-account',
      );
      expect(portal).toMatchObject({ eligibility: 'NOT_DELEGABLE', requiresCredentials: true });
    });

    it('lets an administrator build on the seed: add a venue, approve it, see it publicly', async () => {
      await ctx.app.get(SeedService).seedReferenceData();
      const admin = await createUser(api, { role: 'ADMIN', verified: true });
      const kaduna = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'kaduna' } });
      const banks = await ctx.prisma.serviceCategory.findUniqueOrThrow({
        where: { slug: 'banks-and-payments' },
      });
      const created = await api
        .post(
          '/admin/service-locations',
          {
            cityId: kaduna.id,
            categoryId: banks.id,
            name: 'Example Test Branch',
            address: '1 Example Road',
            status: 'APPROVED',
          },
          { token: admin.token },
        )
        .expect(201);
      expect(created.body.location.slug).toBe('example-test-branch-kaduna');
      const city = (await api.get('/cities/kaduna', { origin: null }).expect(200)).body.city;
      expect(city.locationCount).toBe(1);
      const detail = (
        await api.get('/service-locations/example-test-branch-kaduna', { origin: null }).expect(200)
      ).body;
      expect(detail.tasks.length).toBeGreaterThan(0);
    });
  });
});
