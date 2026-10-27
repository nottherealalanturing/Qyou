import { AssistantEligibilityService } from '../src/assistants/assistant-eligibility.service.js';
import { makeCategory, makeCity, makeLocation, makeTask } from './support/reference.js';
import {
  approvedAssistant,
  completeProfile,
  makeCatalog,
  move,
  startApplication,
  type Applicant,
  type Catalog,
} from './support/assistants.js';
import {
  as,
  auditDump,
  auditRows,
  cancelRequest,
  customer,
  inDays,
  openRequest,
  postRequest,
  quoteBody,
  requestBody,
  selectQuote,
  sendQuote,
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

describe('Quotes and quote selection (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;
  let catalog: Catalog;
  let alice: TestUser; // the customer
  let ada: Applicant; // eligible assistant
  let bola: Applicant; // eligible assistant

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
    ada = await approvedAssistant(ctx, api, admin, catalog, 'Ada O.');
    bola = await approvedAssistant(ctx, api, admin, catalog, 'Bola K.');
  });

  const quotesOf = async (requestId: string) =>
    ownerPrisma().quote.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
  const requestRow = (id: string) =>
    ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id } });
  const asJson = (v: unknown) => JSON.stringify(v);

  describe('what an assistant can see', () => {
    it('shows a matching open request without any customer identity', async () => {
      const id = await openRequest(api, alice, catalog);
      const feed = await api.get('/assistants/me/requests', as(ada.user)).expect(200);
      expect(feed.body.total).toBe(1);
      expect(feed.body.items[0]).toMatchObject({
        id,
        status: 'OPEN',
        myQuote: null,
        task: { slug: 'hold' },
      });
      const detail = await api.get(`/assistants/me/requests/${id}`, as(ada.user)).expect(200);
      expect(detail.body.request.description).toMatch(/morning line/);
      for (const body of [feed.body, detail.body]) {
        const json = asJson(body);
        for (const secret of [alice.id, alice.email, 'customerId', 'passwordHash'])
          expect(json).not.toContain(secret);
      }
    });

    it('requires full eligibility to browse: customers, applicants and suspended assistants get 403', async () => {
      await openRequest(api, alice, catalog);
      await api.get('/assistants/me/requests', as(alice)).expect(403);
      const applicant = await startApplication(api);
      await api.get('/assistants/me/requests', as(applicant.user)).expect(403);
      await api.get('/assistants/me/requests', { origin: null }).expect(401);

      await move(api, admin, ada.profileId, 'SUSPENDED', 'Suspended while we investigate.').expect(
        200,
      );
      const res = await api.get('/assistants/me/requests', as(ada.user)).expect(403);
      expect(res.body.code).toBe('ASSISTANT_NOT_ELIGIBLE');
    });

    it('hides requests for cities they do not serve and tasks they do not offer (404 on detail and quote)', async () => {
      const elsewhere = await makeCity();
      const otherTask = await makeTask(catalog.category.id, {
        slug: 'other-task',
        name: 'Other task',
      });
      const inOtherCity = await openRequest(api, alice, catalog, { cityId: elsewhere.id });
      const otherTaskReq = await openRequest(api, alice, catalog, { taskId: otherTask.id });
      const feed = await api.get('/assistants/me/requests', as(ada.user)).expect(200);
      expect(feed.body.total).toBe(0);
      for (const id of [inOtherCity, otherTaskReq]) {
        await api.get(`/assistants/me/requests/${id}`, as(ada.user)).expect(404);
        await sendQuote(api, ada, id).expect(404);
      }
      expect(await ownerPrisma().quote.count()).toBe(0);
    });

    it('does not show an assistant their own request, and refuses to let them quote on it', async () => {
      const id = await openRequest(api, ada.user, catalog);
      expect((await api.get('/assistants/me/requests', as(ada.user)).expect(200)).body.total).toBe(
        0,
      );
      await api.get(`/assistants/me/requests/${id}`, as(ada.user)).expect(404);
      const res = await sendQuote(api, ada, id).expect(403);
      expect(res.body.message).toMatch(/own request/);
      // Another assistant still sees it.
      expect((await api.get('/assistants/me/requests', as(bola.user)).expect(200)).body.total).toBe(
        1,
      );
    });

    it('applies venue rules: prohibited venues are hidden, authorization rules are not blocking', async () => {
      const blocked = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const open = await makeLocation({ cityId: catalog.city.id, categoryId: catalog.category.id });
      const venueRequest = await openRequest(api, alice, catalog, {
        cityId: undefined,
        locationId: blocked.id,
      });
      const okRequest = await openRequest(api, alice, catalog, {
        cityId: undefined,
        locationId: open.id,
      });
      // The venue starts prohibiting the task AFTER the request was posted.
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: blocked.id,
          taskId: catalog.hold.id,
          rule: 'PROHIBITED',
          note: 'Closed to proxies.',
        },
      });
      await ownerPrisma().locationRestriction.create({
        data: { locationId: open.id, rule: 'REQUIRES_AUTHORIZATION', note: 'Letter needed.' },
      });
      const feed = await api.get('/assistants/me/requests', as(ada.user)).expect(200);
      expect(feed.body.items.map((r: { id: string }) => r.id)).toEqual([okRequest]);
      await api.get(`/assistants/me/requests/${venueRequest}`, as(ada.user)).expect(404);
      await sendQuote(api, ada, venueRequest).expect(404);
      await sendQuote(api, ada, okRequest).expect(201);
    });

    it('does not list expired, cancelled or accepted requests', async () => {
      const cancelled = await openRequest(api, alice, catalog);
      await cancelRequest(api, alice, cancelled).expect(200);
      const accepted = await openRequest(api, alice, catalog);
      const q = await sendQuote(api, bola, accepted).expect(201);
      await selectQuote(api, alice, accepted, q.body.quote.id).expect(200);
      const live = await openRequest(api, alice, catalog);
      const feed = await api.get('/assistants/me/requests', as(ada.user)).expect(200);
      expect(feed.body.items.map((r: { id: string }) => r.id)).toEqual([live]);
    });

    it('keeps a request visible to an assistant who already quoted, even after they stop matching', async () => {
      const id = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, id).expect(201);
      await move(api, admin, ada.profileId, 'SUSPENDED', 'Suspended while we investigate.').expect(
        200,
      );
      const detail = await api.get(`/assistants/me/requests/${id}`, as(ada.user)).expect(200);
      expect(detail.body.myQuotes).toHaveLength(1);
      // A different non-matching assistant (no quote) cannot.
      const stranger = await startApplication(api);
      await api.get(`/assistants/me/requests/${id}`, as(stranger.user)).expect(404);
    });

    it('feed membership equals the authoritative canServe decision across every combination', async () => {
      const eligibility = ctx.app.get(AssistantEligibilityService);
      const cityB = await makeCity();
      const cat2 = await makeCategory();
      const taskB = await makeTask(cat2.id, { slug: 'task-b', name: 'Task B' });
      const venueA = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const venueWide = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const venueTask = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      await ownerPrisma().locationRestriction.create({
        data: { locationId: venueWide.id, rule: 'PROHIBITED', note: 'No proxies.' },
      });
      await ownerPrisma().locationRestriction.create({
        data: {
          locationId: venueTask.id,
          taskId: catalog.hold.id,
          rule: 'PROHIBITED',
          note: 'No line holding.',
        },
      });
      await ownerPrisma().locationRestriction.create({
        data: { locationId: venueA.id, rule: 'ADVISORY', note: 'Busy mornings.' },
      });

      // A third assistant who offers only `docs`, serving city A only.
      const carl = await startApplication(api, 'Carl D.');
      await completeProfile(api, carl, catalog);
      await api
        .put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.docs.id] },
          as(carl.user),
        )
        .expect(200);
      await api.post('/assistants/me/phone/code', {}, as(carl.user)).expect(200);
      // (verify + approve through the shared helper path)
      const carlCode = /code is (\d{6})/.exec(ctx.mail.sent.at(-1)!.text)![1]!;
      await api.post('/assistants/me/phone/verify', { code: carlCode }, as(carl.user)).expect(200);
      await api.post('/assistants/me/submit', {}, as(carl.user)).expect(200);
      await move(api, admin, carl.profileId, 'UNDER_REVIEW').expect(200);
      await api
        .post(
          `/admin/assistants/${carl.profileId}/identity-checks`,
          { result: 'PASSED', evidenceRef: 'VID-1' },
          as(admin),
        )
        .expect(201);
      await move(
        api,
        admin,
        carl.profileId,
        'APPROVED',
        'Checked and approved by reviewer.',
      ).expect(200);

      const customers = [alice, await customer(api)];
      const ids: {
        id: string;
        target: { taskId: string; cityId: string; locationId: string | null };
      }[] = [];
      const make = async (
        over: Record<string, unknown>,
        target: { taskId: string; cityId: string; locationId: string | null },
        confirm = false,
      ) => {
        const res = await postRequest(api, customers[ids.length % 2]!, {
          ...requestBody(catalog, over),
          ...(confirm ? { confirmsAuthorization: true } : {}),
        });
        if (res.status === 201) ids.push({ id: res.body.request.id, target });
      };
      await make({}, { taskId: catalog.hold.id, cityId: catalog.city.id, locationId: null });
      await make(
        { taskId: catalog.docs.id },
        { taskId: catalog.docs.id, cityId: catalog.city.id, locationId: null },
        true,
      );
      await make(
        { cityId: cityB.id },
        { taskId: catalog.hold.id, cityId: cityB.id, locationId: null },
      );
      await make(
        { cityId: undefined, locationId: venueA.id },
        { taskId: catalog.hold.id, cityId: catalog.city.id, locationId: venueA.id },
      );
      await make(
        { taskId: catalog.docs.id, cityId: undefined, locationId: venueTask.id },
        { taskId: catalog.docs.id, cityId: catalog.city.id, locationId: venueTask.id },
        true,
      );
      await make(
        { cityId: undefined, locationId: venueTask.id },
        { taskId: catalog.hold.id, cityId: catalog.city.id, locationId: venueTask.id },
      );
      // Created while open, prohibited afterwards (so the API accepted it):
      const lateVenue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      await make(
        { cityId: undefined, locationId: lateVenue.id },
        { taskId: catalog.hold.id, cityId: catalog.city.id, locationId: lateVenue.id },
      );
      await ownerPrisma().locationRestriction.create({
        data: { locationId: lateVenue.id, rule: 'PROHIBITED', note: 'Newly closed.' },
      });
      await make(
        { cityId: undefined, locationId: venueWide.id },
        { taskId: catalog.hold.id, cityId: catalog.city.id, locationId: venueWide.id },
      );
      void taskB;
      expect(ids.length).toBeGreaterThanOrEqual(6);

      for (const assistant of [ada, bola, carl]) {
        const feed = await api
          .get('/assistants/me/requests?pageSize=50', as(assistant.user))
          .expect(200);
        const inFeed = new Set(feed.body.items.map((r: { id: string }) => r.id));
        for (const { id, target } of ids) {
          const row = await requestRow(id);
          if (row.customerId === assistant.user.id) continue;
          const decision = await eligibility.canServe(assistant.user.id, target);
          expect(
            inFeed.has(id),
            `${assistant.user.id} / ${JSON.stringify(target)} allowed=${decision.allowed}`,
          ).toBe(decision.allowed);
        }
      }
    });
  });

  describe('submitting a quote', () => {
    it('stores a PENDING quote, moves the request to QUOTED and audits ids only', async () => {
      const id = await openRequest(api, alice, catalog);
      const res = await sendQuote(api, ada, id, {
        message: 'Private proposal text for Alice.',
      }).expect(201);
      expect(res.body.quote).toMatchObject({
        status: 'PENDING',
        amountKobo: 250_000,
        currency: 'NGN',
      });
      expect((await requestRow(id)).status).toBe('QUOTED');
      const [row] = await auditRows('quote.submitted');
      expect(row).toMatchObject({
        actorUserId: ada.user.id,
        targetType: 'Quote',
        targetId: res.body.quote.id,
      });
      expect(row!.metadata).toEqual({ requestId: id, amountKobo: 250_000 });
      expect(await auditDump()).not.toContain('Private proposal');
    });

    it('is restricted to eligible assistants: customers, anonymous callers and unverified assistants cannot quote', async () => {
      const id = await openRequest(api, alice, catalog);
      await api.post(`/assistants/me/requests/${id}/quotes`, quoteBody(), as(alice)).expect(403);
      await api
        .post(`/assistants/me/requests/${id}/quotes`, quoteBody(), { origin: null })
        .expect(401);
      await ownerPrisma().user.update({
        where: { id: bola.user.id },
        data: { emailVerifiedAt: null },
      });
      await sendQuote(api, bola, id).expect(403);
      expect(await ownerPrisma().quote.count()).toBe(0);
    });

    it('validates amount, currency and message, and refuses client-set status', async () => {
      const id = await openRequest(api, alice, catalog);
      for (const bad of [
        { amountKobo: 1.5 },
        { amountKobo: '2500' },
        { amountKobo: 9_999 },
        { amountKobo: 50_000_001 },
        { amountKobo: -100 },
        { amountKobo: 250_000.0001 },
        { currency: 'USD' },
        { message: 'Call me on 0803 123 4567 instead.' },
        { status: 'ACCEPTED' },
        { assistantId: bola.profileId },
        { requestId: id },
      ]) {
        await sendQuote(api, ada, id, bad).expect(400);
      }
      await sendQuote(api, ada, id, { amountKobo: 10_000, currency: 'NGN', message: null }).expect(
        201,
      );
      expect(await ownerPrisma().quote.count()).toBe(1);
    });

    it('stores money as exact integer kobo', async () => {
      const id = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, id, { amountKobo: 1_234_567 }).expect(201);
      const [q] = await quotesOf(id);
      expect(q!.amountKobo).toBe(1_234_567);
      const view = await api.get(`/service-requests/${id}`, as(alice)).expect(200);
      expect(view.body.quotes[0].amountKobo).toBe(1_234_567);
    });

    it('rejects a duplicate active quote, but allows re-quoting after a withdrawal (max 3 rows)', async () => {
      const id = await openRequest(api, alice, catalog);
      const first = await sendQuote(api, ada, id).expect(201);
      const dup = await sendQuote(api, ada, id, { amountKobo: 300_000 }).expect(409);
      expect(dup.body.message).toMatch(/already have an active quote/);
      await api
        .post(`/assistants/me/quotes/${first.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(200);
      const second = await sendQuote(api, ada, id, { amountKobo: 200_000 }).expect(201);
      await api
        .post(`/assistants/me/quotes/${second.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(200);
      const third = await sendQuote(api, ada, id, { amountKobo: 180_000 }).expect(201);
      await api
        .post(`/assistants/me/quotes/${third.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(200);
      const fourth = await sendQuote(api, ada, id).expect(409);
      expect(fourth.body.message).toMatch(/limit/);
      expect(await ownerPrisma().quote.count({ where: { requestId: id } })).toBe(3);
    });

    it('refuses quotes on closed, accepted, cancelled and expired requests', async () => {
      const cancelled = await openRequest(api, alice, catalog);
      await cancelRequest(api, alice, cancelled).expect(200);
      expect((await sendQuote(api, ada, cancelled).expect(409)).body.message).toMatch(
        /no longer accepting/,
      );

      const accepted = await openRequest(api, alice, catalog);
      const q = await sendQuote(api, bola, accepted).expect(201);
      await selectQuote(api, alice, accepted, q.body.quote.id).expect(200);
      await sendQuote(api, ada, accepted).expect(409);

      const dated = await openRequest(api, alice, catalog, {
        schedule: { kind: 'ON_DATE', date: inDays(1) },
      });
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + 3 * 86_400_000) });
      try {
        expect((await sendQuote(api, ada, dated).expect(409)).body.message).toMatch(
          /no longer accepting/,
        );
        await api.get(`/assistants/me/requests/${dated}`, as(ada.user)).expect(404); // and gone from view
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets two different assistants quote the same request', async () => {
      const id = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, id, { amountKobo: 300_000 }).expect(201);
      await sendQuote(api, bola, id, { amountKobo: 200_000 }).expect(201);
      const view = await api.get(`/service-requests/${id}`, as(alice)).expect(200);
      expect(view.body.request).toMatchObject({ status: 'QUOTED', pendingQuoteCount: 2 });
      expect(view.body.quotes.map((q: { amountKobo: number }) => q.amountKobo).toSorted()).toEqual([
        200_000, 300_000,
      ]);
    });

    it('does not let a suspended assistant quote', async () => {
      const id = await openRequest(api, alice, catalog);
      await move(api, admin, bola.profileId, 'SUSPENDED', 'Suspended while we investigate.').expect(
        200,
      );
      await sendQuote(api, bola, id).expect(403);
    });
  });

  describe('what the customer sees', () => {
    it('shows each quote with public assistant info only, and flags selectable ones', async () => {
      const id = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, id).expect(201);
      const view = await api.get(`/service-requests/${id}`, as(alice)).expect(200);
      const [quote] = view.body.quotes;
      expect(quote).toMatchObject({
        status: 'PENDING',
        selectable: true,
        assistant: { displayName: 'Ada O.', slug: ada.slug },
      });
      const json = asJson(view.body);
      for (const secret of [
        ada.user.id,
        ada.user.email,
        ada.phone,
        'Adaeze',
        'legalName',
        'phone',
        'identity',
        'userId',
      ])
        expect(json).not.toContain(secret);
    });

    it('marks a quote unselectable (and withholds the profile link) once its assistant is no longer eligible', async () => {
      const id = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, id).expect(201);
      await move(api, admin, ada.profileId, 'SUSPENDED', 'Suspended while we investigate.').expect(
        200,
      );
      const view = await api.get(`/service-requests/${id}`, as(alice)).expect(200);
      expect(view.body.quotes[0]).toMatchObject({ selectable: false, assistant: { slug: null } });
    });

    it('keeps request and quote details private from everyone else, including the quoting assistants', async () => {
      const id = await openRequest(api, alice, catalog);
      const q = await sendQuote(api, ada, id).expect(201);
      const mallory = await customer(api);
      await api.get(`/service-requests/${id}`, as(mallory)).expect(404);
      await api.get(`/service-requests/${id}`, as(ada.user)).expect(404); // an assistant is not the owner
      await api.get(`/service-requests/${id}`, as(admin)).expect(403); // admins have no request access at all
      await selectQuote(api, mallory, id, q.body.quote.id).expect(404);
      await selectQuote(api, ada.user, id, q.body.quote.id).expect(404);
      await api
        .post(`/assistants/me/quotes/${q.body.quote.id}/withdraw`, {}, as(mallory))
        .expect(404);
      await api
        .post(`/assistants/me/quotes/${q.body.quote.id}/withdraw`, {}, as(bola.user))
        .expect(404);
      // Other assistants see only their own quotes on a request.
      await sendQuote(api, bola, id, { amountKobo: 120_000 }).expect(201);
      const bolaView = await api.get(`/assistants/me/requests/${id}`, as(bola.user)).expect(200);
      expect(bolaView.body.myQuotes).toHaveLength(1);
      expect(asJson(bolaView.body)).not.toContain('250000');
    });
  });

  describe('selecting a quote', () => {
    it('accepts one quote, marks the others NOT_SELECTED and the request QUOTE_ACCEPTED, atomically and audited', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id, { amountKobo: 300_000 }).expect(201);
      const b = await sendQuote(api, bola, id, { amountKobo: 200_000 }).expect(201);
      const res = await selectQuote(api, alice, id, b.body.quote.id).expect(200);
      expect(res.body.request).toMatchObject({ status: 'QUOTE_ACCEPTED', acceptingQuotes: false });
      expect(res.body.request.acceptedAt).toEqual(expect.any(String));
      const byId = Object.fromEntries(
        res.body.quotes.map((q: { id: string; status: string }) => [q.id, q.status]),
      );
      expect(byId).toEqual({ [a.body.quote.id]: 'NOT_SELECTED', [b.body.quote.id]: 'ACCEPTED' });
      const [row] = await auditRows('quote.accepted');
      expect(row).toMatchObject({ actorUserId: alice.id, targetId: b.body.quote.id });
      expect(row!.metadata).toEqual({ requestId: id, notSelected: 1 });
      // No payment or booking exists after selection: nothing but the request/quote rows changed.
      expect(await ownerPrisma().quote.count({ where: { status: 'ACCEPTED' } })).toBe(1);
    });

    it('cannot select twice, or another quote afterwards, or on a request with no quotes', async () => {
      const id = await openRequest(api, alice, catalog);
      const none = await selectQuote(api, alice, id, '0198a000-0000-7000-8000-000000000000').expect(
        409,
      );
      expect(none.body.message).toMatch(/no quotes yet/);
      const a = await sendQuote(api, ada, id).expect(201);
      const b = await sendQuote(api, bola, id).expect(201);
      await selectQuote(api, alice, id, a.body.quote.id).expect(200);
      expect((await selectQuote(api, alice, id, a.body.quote.id).expect(409)).body.message).toMatch(
        /already been accepted/,
      );
      await selectQuote(api, alice, id, b.body.quote.id).expect(409);
      expect((await quotesOf(id)).map((q) => q.status).toSorted()).toEqual([
        'ACCEPTED',
        'NOT_SELECTED',
      ]);
    });

    it('refuses withdrawn, foreign and unknown quotes', async () => {
      const id = await openRequest(api, alice, catalog);
      const other = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const keep = await sendQuote(api, bola, id).expect(201);
      const foreign = await sendQuote(api, ada, other).expect(201);
      await api
        .post(`/assistants/me/quotes/${a.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(200);
      expect((await selectQuote(api, alice, id, a.body.quote.id).expect(409)).body.message).toMatch(
        /no longer available/,
      );
      await selectQuote(api, alice, id, foreign.body.quote.id).expect(404); // belongs to a different request
      await selectQuote(api, alice, id, '0198a000-0000-7000-8000-000000000000').expect(404);
      await selectQuote(api, alice, id, keep.body.quote.id).expect(200);
    });

    it('refuses to select a quote from an assistant who is no longer eligible', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const b = await sendQuote(api, bola, id).expect(201);
      await move(api, admin, ada.profileId, 'SUSPENDED', 'Suspended while we investigate.').expect(
        200,
      );
      const res = await selectQuote(api, alice, id, a.body.quote.id).expect(409);
      expect(res.body.message).toMatch(/can no longer take this job/);
      expect((await requestRow(id)).status).toBe('QUOTED'); // nothing changed
      await selectQuote(api, alice, id, b.body.quote.id).expect(200);
    });

    it('refuses selection once the request expired', async () => {
      const id = await openRequest(api, alice, catalog, {
        schedule: { kind: 'ON_DATE', date: inDays(1) },
      });
      const q = await sendQuote(api, ada, id).expect(201);
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + 3 * 86_400_000) });
      try {
        expect(
          (await selectQuote(api, alice, id, q.body.quote.id).expect(409)).body.message,
        ).toMatch(/expired/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('survives concurrent selections: exactly one winner, one ACCEPTED row, consistent states (repeated)', async () => {
      for (let round = 0; round < 5; round += 1) {
        const id = await openRequest(api, alice, catalog);
        const a = await sendQuote(api, ada, id, { amountKobo: 300_000 }).expect(201);
        const b = await sendQuote(api, bola, id, { amountKobo: 200_000 }).expect(201);
        const results = await Promise.all([
          selectQuote(api, alice, id, a.body.quote.id),
          selectQuote(api, alice, id, b.body.quote.id),
          selectQuote(api, alice, id, a.body.quote.id),
          selectQuote(api, alice, id, b.body.quote.id),
        ]);
        const statuses = results.map((r) => r.status).toSorted();
        expect(statuses, `round ${round}`).toEqual([200, 409, 409, 409]);
        const quotes = await quotesOf(id);
        expect(quotes.filter((q) => q.status === 'ACCEPTED')).toHaveLength(1);
        expect(quotes.filter((q) => q.status === 'NOT_SELECTED')).toHaveLength(1);
        expect(quotes.filter((q) => q.status === 'PENDING')).toHaveLength(0);
        expect((await requestRow(id)).status).toBe('QUOTE_ACCEPTED');
      }
      expect(await auditRows('quote.accepted')).toHaveLength(5);
    });

    it('survives select racing cancel: the end state is always consistent', async () => {
      for (let round = 0; round < 5; round += 1) {
        const id = await openRequest(api, alice, catalog);
        const a = await sendQuote(api, ada, id).expect(201);
        await Promise.all([
          selectQuote(api, alice, id, a.body.quote.id),
          cancelRequest(api, alice, id, { reason: 'No longer needed, sorry.' }),
        ]);
        const request = await requestRow(id);
        const [quote] = await quotesOf(id);
        // The only possible outcome after the dust settles is a cancelled request with a closed quote,
        // or (if cancel lost) an accepted one; never a cancelled request with a live quote.
        if (request.status === 'CANCELLED') expect(quote!.status).toBe('REQUEST_CLOSED');
        else {
          expect(request.status).toBe('QUOTE_ACCEPTED');
          expect(quote!.status).toBe('ACCEPTED');
        }
      }
    });

    it('survives two submissions racing from the same assistant: one quote', async () => {
      const id = await openRequest(api, alice, catalog);
      const results = await Promise.all([
        sendQuote(api, ada, id),
        sendQuote(api, ada, id),
        sendQuote(api, ada, id),
      ]);
      expect(results.map((r) => r.status).toSorted()).toEqual([201, 409, 409]);
      expect(await ownerPrisma().quote.count({ where: { requestId: id } })).toBe(1);
    });

    it('survives a submission racing a cancellation: no live quote on a cancelled request', async () => {
      for (let round = 0; round < 5; round += 1) {
        const id = await openRequest(api, alice, catalog);
        await Promise.all([sendQuote(api, ada, id), cancelRequest(api, alice, id)]);
        const request = await requestRow(id);
        expect(request.status).toBe('CANCELLED');
        const live = (await quotesOf(id)).filter(
          (q) => q.status === 'PENDING' || q.status === 'ACCEPTED',
        );
        expect(live).toHaveLength(0);
      }
    });
  });

  describe('cancellation and outstanding quotes', () => {
    it('closes every pending quote when the request is cancelled', async () => {
      const id = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, id).expect(201);
      await sendQuote(api, bola, id).expect(201);
      const res = await cancelRequest(api, alice, id).expect(200);
      expect(res.body.quotes.map((q: { status: string }) => q.status)).toEqual([
        'REQUEST_CLOSED',
        'REQUEST_CLOSED',
      ]);
      const [row] = await auditRows('service_request.cancelled');
      expect(row!.metadata).toEqual({ from: 'QUOTED', quotesClosed: 2, hadReason: false });
      // The assistants see their quote closed, and may not withdraw it.
      const mine = await api.get('/assistants/me/quotes', as(ada.user)).expect(200);
      expect(mine.body.items[0]).toMatchObject({
        quote: { status: 'REQUEST_CLOSED' },
        request: { status: 'CANCELLED' },
      });
      await api
        .post(`/assistants/me/quotes/${mine.body.items[0].quote.id}/withdraw`, {}, as(ada.user))
        .expect(409);
    });

    it('treats a blank or whitespace-only reason as no reason, and changes nothing when it is refused', async () => {
      const id = await openRequest(api, alice, catalog);
      const q = await sendQuote(api, ada, id).expect(201);
      await selectQuote(api, alice, id, q.body.quote.id).expect(200);
      for (const reason of ['', '   ', '\n\t ']) {
        const res = await cancelRequest(api, alice, id, { reason }).expect(400);
        expect(res.body.issues.map((i: { path: string }) => i.path)).toContain('reason');
      }
      expect((await requestRow(id)).status).toBe('QUOTE_ACCEPTED');
      expect((await quotesOf(id))[0]!.status).toBe('ACCEPTED');
      expect(await auditRows('service_request.cancelled')).toHaveLength(0);
    });

    it('does not require a reason before acceptance, and stores one when it is given', async () => {
      const bare = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, bare).expect(201);
      const res = await cancelRequest(api, alice, bare).expect(200);
      expect(res.body.request.status).toBe('CANCELLED');
      expect((await requestRow(bare)).closureReason).toBeNull();

      const withReason = await openRequest(api, alice, catalog);
      await cancelRequest(api, alice, withReason, { reason: 'Plans changed.' }).expect(200);
      expect((await requestRow(withReason)).closureReason).toBe('Plans changed.');
    });

    it('needs a reason to cancel after accepting, and then closes the accepted quote too', async () => {
      const id = await openRequest(api, alice, catalog);
      const q = await sendQuote(api, ada, id).expect(201);
      await selectQuote(api, alice, id, q.body.quote.id).expect(200);
      const noReason = await cancelRequest(api, alice, id).expect(400);
      expect(noReason.body.issues[0].path).toBe('reason');
      const res = await cancelRequest(api, alice, id, {
        reason: 'I found another way to do it.',
      }).expect(200);
      expect(res.body.request.status).toBe('CANCELLED');
      expect(res.body.quotes[0].status).toBe('REQUEST_CLOSED');
      expect(await ownerPrisma().quote.count({ where: { status: 'ACCEPTED' } })).toBe(0);
    });
  });

  describe('withdrawing', () => {
    it('returns the request to OPEN when the last pending quote is withdrawn, QUOTED while others remain', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const b = await sendQuote(api, bola, id).expect(201);
      await api
        .post(`/assistants/me/quotes/${a.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(200);
      expect((await requestRow(id)).status).toBe('QUOTED');
      const res = await api
        .post(`/assistants/me/quotes/${b.body.quote.id}/withdraw`, {}, as(bola.user))
        .expect(200);
      expect(res.body.quote.status).toBe('WITHDRAWN');
      expect((await requestRow(id)).status).toBe('OPEN');
      const [row] = await auditRows('quote.withdrawn');
      expect(row).toMatchObject({ actorUserId: ada.user.id, targetId: a.body.quote.id });
    });

    it('is 409 for a quote that is already withdrawn or accepted, and works for a suspended assistant', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const b = await sendQuote(api, bola, id).expect(201);
      await move(api, admin, ada.profileId, 'SUSPENDED', 'Suspended while we investigate.').expect(
        200,
      );
      await api
        .post(`/assistants/me/quotes/${a.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(200);
      await api
        .post(`/assistants/me/quotes/${a.body.quote.id}/withdraw`, {}, as(ada.user))
        .expect(409);
      await selectQuote(api, alice, id, b.body.quote.id).expect(200);
      await api
        .post(`/assistants/me/quotes/${b.body.quote.id}/withdraw`, {}, as(bola.user))
        .expect(409);
    });
  });

  describe('my quotes', () => {
    it('lists only my quotes with their requests, paginated, and never other assistants’ quotes', async () => {
      const first = await openRequest(api, alice, catalog);
      const second = await openRequest(api, alice, catalog);
      await sendQuote(api, ada, first).expect(201);
      await sendQuote(api, ada, second).expect(201);
      await sendQuote(api, bola, second, { amountKobo: 111_000 }).expect(201);
      const page = await api.get('/assistants/me/quotes?pageSize=1', as(ada.user)).expect(200);
      expect(page.body).toMatchObject({ total: 2, totalPages: 2 });
      expect(page.body.items[0].request.id).toBe(second);
      const all = await api.get('/assistants/me/quotes', as(ada.user)).expect(200);
      expect(asJson(all.body)).not.toContain('111000');
      expect(asJson(all.body)).not.toContain(alice.id);
      await api.get('/assistants/me/quotes', as(alice)).expect(200); // a customer simply has none
    });
  });
});
