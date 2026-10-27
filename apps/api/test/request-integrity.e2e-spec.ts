import { approvedAssistant, makeCatalog, type Catalog } from './support/assistants.js';
import { makeCity, makeLocation, makeTask } from './support/reference.js';
import { customer, openRequest, sendQuote } from './support/requests.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './support/test-app.js';

/**
 * These tests go AROUND the API (as the table owner, and as the least-privilege runtime role) to
 * prove the database itself refuses what the application would never do. They are the backstop for
 * bugs and races in application code.
 */
describe('Requests and quotes: database-enforced invariants (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;
  let catalog: Catalog;
  let alice: TestUser;

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
    alice = await customer(api);
  });

  const db = () => ownerPrisma();
  const baseRequest = (over: Record<string, unknown> = {}) => ({
    customerId: alice.id,
    taskId: catalog.hold.id,
    cityId: catalog.city.id,
    description: 'A sufficiently long description of the job.',
    scheduleKind: 'FLEXIBLE' as const,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });

  describe('permissions', () => {
    it('the runtime role can read and write requests and quotes but can never DELETE them', async () => {
      const id = await openRequest(api, alice, catalog);
      const ada = await approvedAssistant(ctx, api, admin, catalog);
      const q = await sendQuote(api, ada, id).expect(201);
      await expect(
        ctx.prisma.$executeRaw`DELETE FROM "quotes" WHERE "id" = ${q.body.quote.id}::uuid`,
      ).rejects.toThrow(/permission denied/i);
      await expect(
        ctx.prisma.$executeRaw`DELETE FROM "service_requests" WHERE "id" = ${id}::uuid`,
      ).rejects.toThrow(/permission denied/i);
      await expect(ctx.prisma.$executeRaw`TRUNCATE "quotes"`).rejects.toThrow(/permission denied/i);
      expect(await db().serviceRequest.count()).toBe(1);
    });

    it('the runtime role cannot disable the guard triggers', async () => {
      await expect(
        ctx.prisma.$executeRawUnsafe('ALTER TABLE "quotes" DISABLE TRIGGER quotes_update_guard'),
      ).rejects.toThrow(/must be owner/i);
    });
  });

  describe('service_requests', () => {
    it('refuses a non-delegable task and a venue that disagrees with the city or category', async () => {
      await expect(
        db().serviceRequest.create({ data: baseRequest({ taskId: catalog.bio.id }) }),
      ).rejects.toThrow(/delegable/);
      const otherCity = await makeCity();
      const venue = await makeLocation({ cityId: otherCity.id, categoryId: catalog.category.id });
      await expect(
        db().serviceRequest.create({ data: baseRequest({ locationId: venue.id }) }),
      ).rejects.toThrow(/venue must be in the request city/);
      const otherCategoryTask = await makeTask(
        (
          await makeLocation({
            cityId: catalog.city.id,
            categoryId: (
              await db().serviceCategory.create({
                data: {
                  slug: 'zz-cat',
                  name: 'ZZ',
                  nameKey: 'zz',
                  description: 'x',
                  iconKey: 'landmark',
                },
              })
            ).id,
          })
        ).categoryId,
        { slug: 'zz-task', name: 'ZZ task' },
      );
      const sameCityVenue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      await expect(
        db().serviceRequest.create({
          data: baseRequest({ taskId: otherCategoryTask.id, locationId: sameCityVenue.id }),
        }),
      ).rejects.toThrow(/venue must be in the request city/);
    });

    it('starts OPEN only and enforces schedule, timestamp and length CHECKs', async () => {
      await expect(
        db().serviceRequest.create({ data: baseRequest({ status: 'QUOTED' }) }),
      ).rejects.toThrow(/starts OPEN/);
      await expect(
        db().serviceRequest.create({ data: baseRequest({ scheduleKind: 'ON_DATE' }) }),
      ).rejects.toThrow(/schedule_consistent/);
      await expect(
        db().serviceRequest.create({
          data: baseRequest({ preferredDate: new Date('2026-12-01') }),
        }),
      ).rejects.toThrow(/schedule_consistent/);
      await expect(
        db().serviceRequest.create({
          data: baseRequest({ expiresAt: new Date(Date.now() - 1000) }),
        }),
      ).rejects.toThrow(/expiry_after_creation/);
      await expect(
        db().serviceRequest.create({ data: baseRequest({ description: 'short' }) }),
      ).rejects.toThrow(/description_length/);
      await expect(
        db().serviceRequest.create({ data: baseRequest({ constraints: '   ' }) }),
      ).rejects.toThrow(/constraints_length/);
      await expect(
        db().serviceRequest.create({ data: baseRequest({ closureReason: 'x' }) }),
      ).rejects.toThrow(/status_timestamps/);
    });

    it('cannot be edited after creation, and only documented transitions are possible', async () => {
      const id = await openRequest(api, alice, catalog);
      const update = (data: Record<string, unknown>) =>
        db().serviceRequest.update({ where: { id }, data });
      await expect(update({ description: 'A rewritten description of the job.' })).rejects.toThrow(
        /cannot be edited/,
      );
      await expect(update({ taskId: catalog.docs.id })).rejects.toThrow(/cannot be edited/);
      await expect(update({ customerId: admin.id })).rejects.toThrow(/cannot be edited/);
      await expect(update({ expiresAt: new Date(Date.now() + 9e9) })).rejects.toThrow(
        /cannot be edited/,
      );
      // OPEN cannot jump straight to QUOTE_ACCEPTED; terminal CANCELLED cannot be reopened.
      await expect(update({ status: 'QUOTE_ACCEPTED', acceptedAt: new Date() })).rejects.toThrow(
        /invalid service request transition/,
      );
      await update({ status: 'CANCELLED', closedAt: new Date() });
      await expect(update({ status: 'OPEN', closedAt: null })).rejects.toThrow(
        /invalid service request transition/,
      );
      await expect(update({ status: 'QUOTED', closedAt: null })).rejects.toThrow(
        /invalid service request transition/,
      );
    });
  });

  describe('quotes', () => {
    const quote = (requestId: string, assistantId: string, over: Record<string, unknown> = {}) => ({
      requestId,
      assistantId,
      amountKobo: 250_000,
      ...over,
    });

    it('refuses a quote by the request’s own customer, on a closed request, or by a non-approved profile', async () => {
      const ada = await approvedAssistant(ctx, api, admin, catalog);
      const id = await openRequest(api, ada.user, catalog); // Ada's own request
      await expect(db().quote.create({ data: quote(id, ada.profileId) })).rejects.toThrow(
        /own request/,
      );

      const bola = await approvedAssistant(ctx, api, admin, catalog, 'Bola K.');
      const closed = await openRequest(api, alice, catalog);
      await db().serviceRequest.update({
        where: { id: closed },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      await expect(db().quote.create({ data: quote(closed, bola.profileId) })).rejects.toThrow(
        /not accepting quotes/,
      );

      const open = await openRequest(api, alice, catalog);
      await db().assistantProfile.update({
        where: { id: bola.profileId },
        data: { status: 'SUSPENDED' },
      });
      await expect(db().quote.create({ data: quote(open, bola.profileId) })).rejects.toThrow(
        /approved assistant/,
      );
    });

    it('allows at most one ACCEPTED quote per request and one active quote per assistant', async () => {
      const ada = await approvedAssistant(ctx, api, admin, catalog);
      const bola = await approvedAssistant(ctx, api, admin, catalog, 'Bola K.');
      const id = await openRequest(api, alice, catalog);
      const first = await db().quote.create({ data: quote(id, ada.profileId) });
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { amountKobo: 1 + 10_000 }) }),
      ).rejects.toThrow(/Unique constraint/i);
      const second = await db().quote.create({ data: quote(id, bola.profileId) });
      await db().quote.update({ where: { id: first.id }, data: { status: 'ACCEPTED' } });
      await expect(
        db().quote.update({ where: { id: second.id }, data: { status: 'ACCEPTED' } }),
      ).rejects.toThrow(/Unique constraint/i);
    });

    it('enforces money and message CHECKs', async () => {
      const ada = await approvedAssistant(ctx, api, admin, catalog);
      const id = await openRequest(api, alice, catalog);
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { amountKobo: 0 }) }),
      ).rejects.toThrow(/amount_positive/);
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { amountKobo: -5 }) }),
      ).rejects.toThrow(/amount_positive/);
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { amountKobo: 2_000_000_001 }) }),
      ).rejects.toThrow();
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { currency: 'USD' }) }),
      ).rejects.toThrow(/currency_ngn/);
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { message: '   ' }) }),
      ).rejects.toThrow(/message_length/);
      await expect(
        db().quote.create({ data: quote(id, ada.profileId, { status: 'ACCEPTED' }) }),
      ).rejects.toThrow(/starts PENDING/);
    });

    it('cannot be edited, and only documented status transitions are possible', async () => {
      const ada = await approvedAssistant(ctx, api, admin, catalog);
      const id = await openRequest(api, alice, catalog);
      const q = await db().quote.create({ data: quote(id, ada.profileId) });
      await expect(
        db().quote.update({ where: { id: q.id }, data: { amountKobo: 1 } }),
      ).rejects.toThrow(/cannot be edited/);
      await expect(
        db().quote.update({ where: { id: q.id }, data: { message: 'changed' } }),
      ).rejects.toThrow(/cannot be edited/);
      await db().quote.update({ where: { id: q.id }, data: { status: 'NOT_SELECTED' } });
      for (const to of ['ACCEPTED', 'PENDING', 'WITHDRAWN'] as const)
        await expect(
          db().quote.update({ where: { id: q.id }, data: { status: to } }),
        ).rejects.toThrow(/invalid quote transition/);
    });

    it('does not let a request or assistant be hard-deleted while quotes reference them (RESTRICT)', async () => {
      const ada = await approvedAssistant(ctx, api, admin, catalog);
      const id = await openRequest(api, alice, catalog);
      await db().quote.create({ data: quote(id, ada.profileId) });
      await expect(db().serviceRequest.delete({ where: { id } })).rejects.toThrow();
      await expect(
        db().assistantProfile.delete({ where: { id: ada.profileId } }),
      ).rejects.toThrow();
      await expect(db().user.delete({ where: { id: alice.id } })).rejects.toThrow();
    });
  });
});
