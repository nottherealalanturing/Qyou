import { makeCategory, makeCity, makeLocation, makeTask } from './support/reference.js';
import { makeCatalog, type Catalog } from './support/assistants.js';
import {
  as,
  auditDump,
  auditRows,
  cancelRequest,
  DESCRIPTION,
  inDays,
  openRequest,
  postRequest,
  quoteBody,
  requestBody,
} from './support/requests.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './support/test-app.js';

describe('Service requests: customer side (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
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
    alice = await createUser(api, { verified: true });
  });

  describe('who may post', () => {
    it('rejects anonymous callers (401) and cross-origin posts (403)', async () => {
      await api.post('/service-requests', requestBody(catalog), { origin: null }).expect(401);
      await api
        .post('/service-requests', requestBody(catalog), {
          ...as(alice),
          origin: 'http://evil.example',
        })
        .expect(403);
    });

    it('requires a verified email', async () => {
      const unverified = await createUser(api);
      await postRequest(api, unverified, requestBody(catalog)).expect(403);
    });

    it('is for customers and assistants only (admins and business staff get 403)', async () => {
      for (const role of ['ADMIN', 'BUSINESS_STAFF'] as const) {
        const u = await createUser(api, { role, verified: true });
        await postRequest(api, u, requestBody(catalog)).expect(403);
      }
      const assistantAccount = await createUser(api, { role: 'ASSISTANT', verified: true });
      await postRequest(api, assistantAccount, requestBody(catalog)).expect(201);
    });
  });

  describe('creating a request', () => {
    it('creates an OPEN request owned by the caller and returns no customer identity', async () => {
      const res = await postRequest(api, alice, requestBody(catalog)).expect(201);
      expect(res.body.quotes).toEqual([]);
      expect(res.body.request).toMatchObject({
        status: 'OPEN',
        acceptingQuotes: true,
        description: DESCRIPTION,
        task: { slug: 'hold' },
        city: { slug: catalog.city.slug },
        location: null,
        schedule: { kind: 'FLEXIBLE', date: null, period: 'ANY' },
        authorization: { required: false, confirmed: false, notes: null },
        pendingQuoteCount: 0,
      });
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(alice.id);
      expect(json).not.toContain(alice.email);
      expect(json).not.toContain('customerId');
      const row = await ownerPrisma().serviceRequest.findUniqueOrThrow({
        where: { id: res.body.request.id },
      });
      expect(row.customerId).toBe(alice.id);
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    });

    it('never lets the client set ownership, status, expiry or any other trusted field', async () => {
      for (const extra of [
        { status: 'QUOTE_ACCEPTED' },
        { customerId: alice.id },
        { expiresAt: '2099-01-01T00:00:00Z' },
        { acceptedAt: '2026-01-01T00:00:00Z' },
        { quotes: [] },
      ]) {
        await postRequest(api, alice, requestBody(catalog, extra)).expect(400);
      }
      expect(await ownerPrisma().serviceRequest.count()).toBe(0);
    });

    it('rejects unknown, inactive and non-delegable tasks', async () => {
      const unknown = await postRequest(
        api,
        alice,
        requestBody(catalog, { taskId: '0198a000-0000-7000-8000-000000000000' }),
      ).expect(400);
      expect(unknown.body.issues[0].path).toBe('taskId');
      await postRequest(api, alice, requestBody(catalog, { taskId: catalog.bio.id })).expect(400);
      await ownerPrisma().eligibleTask.update({
        where: { id: catalog.hold.id },
        data: { isActive: false },
      });
      await postRequest(api, alice, requestBody(catalog)).expect(400);
    });

    it('rejects a task whose category is inactive and an inactive or unknown city', async () => {
      const inactive = await makeCity({ isActive: false });
      await postRequest(api, alice, requestBody(catalog, { cityId: inactive.id })).expect(400);
      await postRequest(
        api,
        alice,
        requestBody(catalog, { cityId: '0198a000-0000-7000-8000-000000000000' }),
      ).expect(400);
      await ownerPrisma().serviceCategory.update({
        where: { id: catalog.category.id },
        data: { isActive: false },
      });
      await postRequest(api, alice, requestBody(catalog)).expect(400);
    });

    it('needs a city or a venue', async () => {
      const res = await postRequest(api, alice, requestBody(catalog, { cityId: undefined })).expect(
        400,
      );
      expect(res.body.issues.map((i: { path: string }) => i.path)).toContain('cityId');
    });

    it('requires the customer to confirm authorization for tasks that need it', async () => {
      const body = requestBody(catalog, { taskId: catalog.docs.id });
      const refused = await postRequest(api, alice, body).expect(400);
      expect(refused.body.issues[0].path).toBe('confirmsAuthorization');
      const ok = await postRequest(api, alice, { ...body, confirmsAuthorization: true }).expect(
        201,
      );
      expect(ok.body.request.authorization).toMatchObject({
        required: true,
        confirmed: true,
        notes: 'Signed letter.',
      });
    });

    it('rejects descriptions that are too short or carry contact details', async () => {
      await postRequest(api, alice, requestBody(catalog, { description: 'too short' })).expect(400);
      for (const description of [
        'Hold my place, call me on 0803 123 4567 when ready.',
        'Hold my place and email ada@example.com when done please',
        'Hold my place; details at https://example.com/form please',
      ]) {
        const res = await postRequest(api, alice, requestBody(catalog, { description })).expect(
          400,
        );
        expect(res.body.issues[0].path).toBe('description');
      }
      const res = await postRequest(
        api,
        alice,
        requestBody(catalog, { constraints: 'Text me on +2348031234567' }),
      ).expect(400);
      expect(res.body.issues[0].path).toBe('constraints');
      // The submitted text is never echoed back in an error.
      expect(JSON.stringify(res.body)).not.toContain('2348031234567');
    });

    it('stores constraints and a dated schedule that expires at the end of that day', async () => {
      const date = inDays(3);
      const res = await postRequest(
        api,
        alice,
        requestBody(catalog, {
          constraints: 'Wheelchair accessible entrance only.',
          schedule: { kind: 'ON_DATE', date, period: 'MORNING' },
        }),
      ).expect(201);
      expect(res.body.request).toMatchObject({
        constraints: 'Wheelchair accessible entrance only.',
        schedule: { kind: 'ON_DATE', date, period: 'MORNING' },
      });
      expect(new Date(res.body.request.expiresAt).toISOString()).toBe(`${date}T23:00:00.000Z`); // end of day, Lagos (UTC+1)
    });

    it('validates schedules', async () => {
      for (const schedule of [
        { kind: 'ON_DATE' },
        { kind: 'ON_DATE', date: inDays(-1) },
        { kind: 'ON_DATE', date: inDays(61) },
        { kind: 'ON_DATE', date: '2026-02-30' },
        { kind: 'FLEXIBLE', date: inDays(2) },
        { kind: 'SOMETIME' },
      ]) {
        await postRequest(api, alice, requestBody(catalog, { schedule })).expect(400);
      }
    });

    it('caps live requests per customer at 10', async () => {
      for (let i = 0; i < 10; i += 1) await openRequest(api, alice, catalog);
      const res = await postRequest(api, alice, requestBody(catalog)).expect(409);
      expect(res.body.message).toMatch(/10 active requests/);
      const bob = await createUser(api, { verified: true });
      await postRequest(api, bob, requestBody(catalog)).expect(201);
    });

    it('creates exactly one audit row with ids only, never the description', async () => {
      const id = await openRequest(api, alice, catalog, {
        constraints: 'Please bring a folding stool.',
      });
      const rows = await auditRows('service_request.created');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: alice.id,
        targetType: 'ServiceRequest',
        targetId: id,
      });
      expect(rows[0]!.metadata).toEqual({
        taskId: catalog.hold.id,
        cityId: catalog.city.id,
        locationId: null,
        scheduleKind: 'FLEXIBLE',
      });
      const dump = await auditDump();
      expect(dump).not.toContain('morning line');
      expect(dump).not.toContain('folding stool');
    });

    it('writes nothing, including no audit row, when validation fails', async () => {
      await postRequest(api, alice, requestBody(catalog, { taskId: catalog.bio.id })).expect(400);
      expect(await ownerPrisma().serviceRequest.count()).toBe(0);
      expect(await auditRows('service_request.created')).toHaveLength(0);
    });
  });

  describe('venues', () => {
    it('infers the city from an approved venue and records it', async () => {
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const res = await postRequest(
        api,
        alice,
        requestBody(catalog, { cityId: undefined, locationId: venue.id }),
      ).expect(201);
      expect(res.body.request.location).toEqual({
        slug: venue.slug,
        name: venue.name,
        address: venue.address,
      });
      expect(res.body.request.city.slug).toBe(catalog.city.slug);
    });

    it('rejects venues that are unavailable or inconsistent with the task or city', async () => {
      const pending = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
        status: 'PENDING_REVIEW',
      });
      await postRequest(api, alice, requestBody(catalog, { locationId: pending.id })).expect(400);

      const otherCategory = await makeCategory();
      const elsewhere = await makeLocation({
        cityId: catalog.city.id,
        categoryId: otherCategory.id,
      });
      const wrongCategory = await postRequest(
        api,
        alice,
        requestBody(catalog, { locationId: elsewhere.id }),
      ).expect(400);
      expect(wrongCategory.body.issues[0].path).toBe('locationId');

      const otherCity = await makeCity();
      const venue = await makeLocation({ cityId: otherCity.id, categoryId: catalog.category.id });
      const wrongCity = await postRequest(
        api,
        alice,
        requestBody(catalog, { locationId: venue.id }),
      ).expect(400);
      expect(wrongCity.body.issues[0].path).toBe('cityId');
    });

    it('refuses a task the venue prohibits, and demands confirmation when the venue requires authorization', async () => {
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: venue.id,
          taskId: catalog.hold.id,
          rule: 'PROHIBITED',
          note: 'No line holding here.',
        },
      });
      const refused = await postRequest(
        api,
        alice,
        requestBody(catalog, { locationId: venue.id }),
      ).expect(400);
      expect(refused.body.issues[0].message).toMatch(/cannot be delegated at this venue/);

      // A different task at the same venue is unaffected…
      const other = await makeTask(catalog.category.id, { slug: 'queue-b', name: 'Queue B' });
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: venue.id,
          taskId: other.id,
          rule: 'REQUIRES_AUTHORIZATION',
          note: 'Letter needed.',
        },
      });
      // …but the venue rule tightens it: authorization must be confirmed.
      const body = requestBody(catalog, { taskId: other.id, locationId: venue.id });
      await postRequest(api, alice, body).expect(400);
      await postRequest(api, alice, { ...body, confirmsAuthorization: true }).expect(201);
    });

    it('refuses everything at a venue-wide prohibition', async () => {
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      await ownerPrisma().locationRestriction.create({
        data: { locationId: venue.id, rule: 'PROHIBITED', note: 'Closed to proxies.' },
      });
      await postRequest(api, alice, requestBody(catalog, { locationId: venue.id })).expect(400);
    });
  });

  describe('reading requests', () => {
    it('lists only my requests, newest first, with pagination and status filters', async () => {
      const bob = await createUser(api, { verified: true });
      const first = await openRequest(api, alice, catalog);
      const second = await openRequest(api, alice, catalog);
      const third = await openRequest(api, alice, catalog);
      await openRequest(api, bob, catalog);
      await cancelRequest(api, alice, first).expect(200);

      const page1 = await api.get('/service-requests?pageSize=2', as(alice)).expect(200);
      expect(page1.body).toMatchObject({ total: 3, totalPages: 2, page: 1, pageSize: 2 });
      expect(page1.body.items.map((r: { id: string }) => r.id)).toEqual([third, second]);
      const page2 = await api.get('/service-requests?pageSize=2&page=2', as(alice)).expect(200);
      expect(page2.body.items.map((r: { id: string }) => r.id)).toEqual([first]);

      const cancelled = await api.get('/service-requests?status=CANCELLED', as(alice)).expect(200);
      expect(cancelled.body.items.map((r: { id: string }) => r.id)).toEqual([first]);
      const open = await api.get('/service-requests?status=OPEN', as(alice)).expect(200);
      expect(open.body.total).toBe(2);
      await api.get('/service-requests?status=BOGUS', as(alice)).expect(400);
      await api.get('/service-requests?pageSize=500', as(alice)).expect(400);
    });

    it('returns 404 for someone else’s request and for a missing one, identically', async () => {
      const bob = await createUser(api, { verified: true });
      const id = await openRequest(api, alice, catalog);
      const other = await api.get(`/service-requests/${id}`, as(bob)).expect(404);
      const missing = await api
        .get('/service-requests/0198a000-0000-7000-8000-000000000000', as(bob))
        .expect(404);
      expect(other.body).toEqual(missing.body);
      await api.get('/service-requests/not-a-uuid', as(alice)).expect(400);
      await api.get(`/service-requests/${id}`, { origin: null }).expect(401);
      await api.get(`/service-requests/${id}`, as(alice)).expect(200);
    });

    it('does not let anyone else act on my request: cancel and select are 404 for non-owners', async () => {
      const bob = await createUser(api, { verified: true });
      const id = await openRequest(api, alice, catalog);
      await cancelRequest(api, bob, id).expect(404);
      await api
        .post(
          `/service-requests/${id}/quotes/0198a000-0000-7000-8000-000000000000/select`,
          {},
          as(bob),
        )
        .expect(404);
      expect((await ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
        'OPEN',
      );
    });
  });

  describe('cancelling', () => {
    it('cancels an open request, records when and (optionally) why, and is not repeatable', async () => {
      const id = await openRequest(api, alice, catalog);
      const res = await cancelRequest(api, alice, id, {
        reason: 'Plans changed, no longer needed.',
      }).expect(200);
      expect(res.body.request).toMatchObject({
        status: 'CANCELLED',
        acceptingQuotes: false,
        closureReason: 'Plans changed, no longer needed.',
      });
      expect(res.body.request.closedAt).toEqual(expect.any(String));
      const again = await cancelRequest(api, alice, id).expect(409);
      expect(again.body.message).toMatch(/already cancelled/);
    });

    it('a cancelled request is final: nothing can reopen or change it', async () => {
      const id = await openRequest(api, alice, catalog);
      await cancelRequest(api, alice, id).expect(200);
      await api.patch(`/service-requests/${id}`, { status: 'OPEN' }, as(alice)).expect(404); // no generic update route exists
      await api.put(`/service-requests/${id}`, { status: 'OPEN' }, as(alice)).expect(404);
      expect((await ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
        'CANCELLED',
      );
    });

    it('audits the cancellation without the reason text', async () => {
      const id = await openRequest(api, alice, catalog);
      await cancelRequest(api, alice, id, { reason: 'My secret reason for cancelling.' }).expect(
        200,
      );
      const [row] = await auditRows('service_request.cancelled');
      expect(row).toMatchObject({ actorUserId: alice.id, targetId: id });
      expect(row!.metadata).toEqual({ from: 'OPEN', quotesClosed: 0, hadReason: true });
      expect(await auditDump()).not.toContain('secret reason');
    });

    it('validates the reason', async () => {
      const id = await openRequest(api, alice, catalog);
      await cancelRequest(api, alice, id, { reason: 'x'.repeat(301) }).expect(400);
      await cancelRequest(api, alice, id, { reason: 'ok', status: 'OPEN' }).expect(400);
    });
  });

  describe('expiry is derived from the clock', () => {
    afterEach(() => vi.useRealTimers());

    it('reads as EXPIRED, stops accepting quotes, and drops out of the OPEN filter after its date', async () => {
      const date = inDays(1);
      const id = await openRequest(api, alice, catalog, { schedule: { kind: 'ON_DATE', date } });
      expect(
        (await api.get(`/service-requests/${id}`, as(alice)).expect(200)).body.request.status,
      ).toBe('OPEN');

      vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${date}T23:00:01Z`) }); // just after local midnight
      const view = (await api.get(`/service-requests/${id}`, as(alice)).expect(200)).body.request;
      expect(view).toMatchObject({ status: 'EXPIRED', acceptingQuotes: false });
      expect(
        (await api.get('/service-requests?status=EXPIRED', as(alice)).expect(200)).body.total,
      ).toBe(1);
      expect(
        (await api.get('/service-requests?status=OPEN', as(alice)).expect(200)).body.total,
      ).toBe(0);
      // The stored status is untouched: expiry is presentation, not a background rewrite.
      expect((await ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
        'OPEN',
      );
      // An expired request can still be cancelled by its owner.
      await cancelRequest(api, alice, id).expect(200);
    });
  });

  it('quoteBody helper stays within the documented bounds (guards the shared fixtures)', () => {
    expect(quoteBody().amountKobo).toBeGreaterThanOrEqual(10_000);
    expect(quoteBody().amountKobo).toBeLessThanOrEqual(50_000_000);
  });
});
