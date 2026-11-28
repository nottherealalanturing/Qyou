import type { Prisma } from '../src/generated/prisma/client.js';
import {
  lockAssistantForChange,
  lockForEligibilityDecision,
  lockVenueForChange,
} from '../src/assistants/eligibility-locks.js';
import { makeLocation } from './support/reference.js';
import {
  approvedAssistant,
  completeProfile,
  makeCatalog,
  move,
  recordIdentity,
  startApplication,
  submitted,
  verifyPhone,
  type Applicant,
  type Catalog,
} from './support/assistants.js';
import {
  as,
  auditRows,
  customer,
  openRequest,
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

/**
 * D-052: a quote cannot be submitted, and a quote cannot be accepted, on an eligibility state that a
 * concurrent change has already invalidated.
 *
 * The tests are deterministic: a separate owner-role transaction is held OPEN with the lock one side
 * of the protocol takes (and, for writers, with its uncommitted change), the other side is started
 * through the real HTTP API, we wait until PostgreSQL reports it blocked on a lock, and only then
 * release. The persisted outcome is asserted, not just the response. They fail if either side stops
 * taking its lock: without it the request neither blocks nor sees the (then uncommitted) change and
 * would succeed.
 */
describe('Eligibility concurrency protocol (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let admin: TestUser;
  let catalog: Catalog;
  let alice: TestUser;
  let ada: Applicant;
  let bola: Applicant;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
    catalog = await makeCatalog();
    admin = await createUser(api, { role: 'ADMIN', verified: true });
    alice = await customer(api);
    ada = await approvedAssistant(ctx, api, admin, catalog, 'Ada O.');
    bola = await approvedAssistant(ctx, api, admin, catalog, 'Bola K.');
  });

  /** An owner transaction that runs `setup`, then stays open (locks held) until `release()`. */
  function holdOpen(setup: (tx: Prisma.TransactionClient) => Promise<void>) {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const readyPromise = new Promise<void>((resolve) => (ready = resolve));
    const done = ownerPrisma().$transaction(
      async (tx) => {
        await setup(tx);
        ready();
        await gate;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    return {
      started: Promise.race([readyPromise, done]),
      release,
      done,
    };
  }

  async function waitUntilBlocked(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const rows = await ownerPrisma().$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((rows[0]?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('The request never blocked on a lock: the protocol is not being followed');
  }

  /** Runs `fire` while `held` keeps its locks; proves `fire` blocks, then releases and returns its result. */
  async function raceAgainst<T extends { status: number }>(
    held: ReturnType<typeof holdOpen>,
    fire: () => PromiseLike<T>,
  ): Promise<T> {
    await held.started;
    let settled = false;
    const pending = Promise.resolve(fire()).then((r) => {
      settled = true;
      return r;
    });
    await waitUntilBlocked();
    expect(settled, 'the operation must wait for the open transaction').toBe(false);
    held.release();
    await held.done;
    return pending;
  }

  const targetOf = async (requestId: string) => {
    const r = await ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    return { taskId: r.taskId, cityId: r.cityId, locationId: r.locationId };
  };
  const quotesOf = (requestId: string) =>
    ownerPrisma().quote.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
  const requestRow = (id: string) =>
    ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id } });

  const suspendInTx = (who: Applicant) => async (tx: Prisma.TransactionClient) => {
    await lockAssistantForChange(tx, who.user.id);
    await tx.assistantProfile.update({
      where: { id: who.profileId },
      data: { status: 'SUSPENDED' },
    });
    await tx.user.update({ where: { id: who.user.id }, data: { role: 'CUSTOMER' } });
  };

  describe('a decision waits for an in-flight, uncommitted change that would invalidate it', () => {
    it('selection waits for a suspension and then refuses the suspended assistant', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const b = await sendQuote(api, bola, id).expect(201);

      const res = await raceAgainst(holdOpen(suspendInTx(ada)), () =>
        selectQuote(api, alice, id, a.body.quote.id),
      );

      expect(res.status).toBe(409);
      const quotes = await quotesOf(id);
      expect(quotes.map((q) => q.status).toSorted()).toEqual(['PENDING', 'PENDING']);
      expect((await requestRow(id)).status).toBe('QUOTED');
      expect(await auditRows('quote.accepted')).toHaveLength(0);
      // The other, still-eligible assistant can be selected afterwards.
      await selectQuote(api, alice, id, b.body.quote.id).expect(200);
    });

    it('quote submission waits for a suspension and stores nothing', async () => {
      const id = await openRequest(api, alice, catalog);
      const res = await raceAgainst(holdOpen(suspendInTx(bola)), () => sendQuote(api, bola, id));

      expect(res.status).toBe(404);
      expect(await quotesOf(id)).toHaveLength(0);
      expect((await requestRow(id)).status).toBe('OPEN');
      expect(await auditRows('quote.submitted')).toHaveLength(0);
    });

    it('quote submission waits for the assistant dropping the task from their offers', async () => {
      const id = await openRequest(api, alice, catalog);
      const res = await raceAgainst(
        holdOpen(async (tx) => {
          await lockAssistantForChange(tx, ada.user.id);
          await tx.assistantTaskOffer.deleteMany({ where: { profileId: ada.profileId } });
        }),
        () => sendQuote(api, ada, id),
      );
      expect(res.status).toBe(404);
      expect(await quotesOf(id)).toHaveLength(0);
    });

    it('selection waits for a phone change that revokes phone verification', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const res = await raceAgainst(
        holdOpen(async (tx) => {
          await lockAssistantForChange(tx, ada.user.id);
          await tx.assistantPrivateDetails.update({
            where: { profileId: ada.profileId },
            data: { phoneVerifiedAt: null },
          });
        }),
        () => selectQuote(api, alice, id, a.body.quote.id),
      );
      expect(res.status).toBe(409);
      expect((await quotesOf(id))[0]!.status).toBe('PENDING');
      expect((await requestRow(id)).status).toBe('QUOTED');
    });

    it('quote submission waits for the city being closed (catalog row lock)', async () => {
      const id = await openRequest(api, alice, catalog);
      const res = await raceAgainst(
        holdOpen(async (tx) => {
          await tx.city.update({ where: { id: catalog.city.id }, data: { isActive: false } });
        }),
        () => sendQuote(api, ada, id),
      );
      expect(res.status).toBe(404);
      expect(await quotesOf(id)).toHaveLength(0);
    });

    it('selection waits for the task being deactivated (catalog row lock)', async () => {
      const id = await openRequest(api, alice, catalog);
      const a = await sendQuote(api, ada, id).expect(201);
      const res = await raceAgainst(
        holdOpen(async (tx) => {
          await tx.eligibleTask.update({
            where: { id: catalog.hold.id },
            data: { isActive: false },
          });
        }),
        () => selectQuote(api, alice, id, a.body.quote.id),
      );
      expect(res.status).toBe(409);
      expect((await requestRow(id)).status).toBe('QUOTED');
    });

    it('quote submission waits for a venue prohibition', async () => {
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const id = await openRequest(api, alice, catalog, {
        cityId: undefined,
        locationId: venue.id,
      });
      const res = await raceAgainst(
        holdOpen(async (tx) => {
          await lockVenueForChange(tx, venue.id);
          await tx.locationRestriction.create({
            data: { locationId: venue.id, taskId: null, rule: 'PROHIBITED', note: 'Closed.' },
          });
        }),
        () => sendQuote(api, ada, id),
      );
      expect(res.status).toBe(404);
      expect(await quotesOf(id)).toHaveLength(0);
    });
  });

  describe('every revoking mutation waits for an in-flight decision (writers take the compatible lock)', () => {
    /** Holds the reader-side locks of a decision on ada for a fresh request. */
    async function decisionOnAda() {
      const id = await openRequest(api, alice, catalog);
      const target = await targetOf(id);
      return holdOpen((tx) => lockForEligibilityDecision(tx, ada.user.id, target));
    }

    it('the admin suspension endpoint', async () => {
      const res = await raceAgainst(await decisionOnAda(), () =>
        move(api, admin, ada.profileId, 'SUSPENDED', 'Suspended while we investigate.'),
      );
      expect(res.status).toBe(200);
      const profile = await ownerPrisma().assistantProfile.findUniqueOrThrow({
        where: { id: ada.profileId },
      });
      expect(profile.status).toBe('SUSPENDED');
    });

    it('the assistant changing their offered tasks', async () => {
      const res = await raceAgainst(await decisionOnAda(), () =>
        api.put(
          '/assistants/me/services',
          { cityIds: [catalog.city.id], taskIds: [catalog.docs.id] },
          as(ada.user),
        ),
      );
      expect(res.status).toBe(200);
      expect(
        await ownerPrisma().assistantTaskOffer.count({ where: { profileId: ada.profileId } }),
      ).toBe(1);
    });

    it('the assistant changing their phone number', async () => {
      const res = await raceAgainst(await decisionOnAda(), () =>
        api.put('/assistants/me/private', { phone: '08031112223' }, as(ada.user)),
      );
      expect(res.status).toBe(200);
      const details = await ownerPrisma().assistantPrivateDetails.findUniqueOrThrow({
        where: { profileId: ada.profileId },
      });
      expect(details.phoneVerifiedAt).toBeNull();
    });

    it('closing a city (catalog row)', async () => {
      const id = await openRequest(api, alice, catalog);
      const target = await targetOf(id);
      const held = holdOpen((tx) => lockForEligibilityDecision(tx, ada.user.id, target));
      const res = await raceAgainst(held, () =>
        api.patch(`/admin/cities/${catalog.city.id}`, { isActive: false }, as(admin)),
      );
      expect(res.status).toBe(200);
    });

    it('adding a venue restriction', async () => {
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const id = await openRequest(api, alice, catalog, {
        cityId: undefined,
        locationId: venue.id,
      });
      const target = await targetOf(id);
      const held = holdOpen((tx) => lockForEligibilityDecision(tx, ada.user.id, target));
      const res = await raceAgainst(held, () =>
        api.post(
          `/admin/service-locations/${venue.id}/restrictions`,
          { rule: 'PROHIBITED', note: 'Closed to proxies.' },
          as(admin),
        ),
      );
      expect(res.status).toBe(201);
    });
  });

  describe('the remaining writers of eligibility inputs also wait for an in-flight decision', () => {
    /** Holds the reader-side locks of a decision on `userId` for a fresh request. */
    async function decisionOn(userId: string) {
      const id = await openRequest(api, alice, catalog);
      const target = await targetOf(id);
      return holdOpen((tx) => lockForEligibilityDecision(tx, userId, target));
    }

    it('the admin role endpoint', async () => {
      const res = await raceAgainst(await decisionOn(ada.user.id), () =>
        api.patch(`/admin/users/${ada.user.id}/role`, { role: 'CUSTOMER' }, as(admin)),
      );
      expect(res.status).toBe(200);
      expect(
        (await ownerPrisma().user.findUniqueOrThrow({ where: { id: ada.user.id } })).role,
      ).toBe('CUSTOMER');
    });

    it('recording an identity outcome', async () => {
      const applicant = await submitted(ctx, api, catalog, 'Gina Review');
      await move(api, admin, applicant.profileId, 'UNDER_REVIEW').expect(200);
      const res = await raceAgainst(await decisionOn(applicant.user.id), () =>
        recordIdentity(api, admin, applicant.profileId, 'FAILED'),
      );
      expect(res.status).toBe(201);
      const profile = await ownerPrisma().assistantProfile.findUniqueOrThrow({
        where: { id: applicant.profileId },
      });
      expect(profile.identityOutcome).toBe('FAILED');
    });

    it('submitting an application', async () => {
      const applicant = await startApplication(api, 'Hana Draft');
      await completeProfile(api, applicant, catalog);
      await verifyPhone(ctx, api, applicant);
      const res = await raceAgainst(await decisionOn(applicant.user.id), () =>
        api.post('/assistants/me/submit', {}, as(applicant.user)),
      );
      expect(res.status).toBe(200);
      const profile = await ownerPrisma().assistantProfile.findUniqueOrThrow({
        where: { id: applicant.profileId },
      });
      expect(profile.status).toBe('SUBMITTED');
    });

    const catalogDecision = async () => {
      const id = await openRequest(api, alice, catalog);
      const target = await targetOf(id);
      return holdOpen((tx) => lockForEligibilityDecision(tx, ada.user.id, target));
    };

    it('deactivating the task', async () => {
      const res = await raceAgainst(await catalogDecision(), () =>
        api.patch(`/admin/eligible-tasks/${catalog.hold.id}`, { isActive: false }, as(admin)),
      );
      expect(res.status).toBe(200);
    });

    it('deactivating the category', async () => {
      const res = await raceAgainst(await catalogDecision(), () =>
        api.patch(
          `/admin/service-categories/${catalog.category.id}`,
          { isActive: false },
          as(admin),
        ),
      );
      expect(res.status).toBe(200);
    });

    it('archiving the venue', async () => {
      const venue = await makeLocation({
        cityId: catalog.city.id,
        categoryId: catalog.category.id,
      });
      const id = await openRequest(api, alice, catalog, {
        cityId: undefined,
        locationId: venue.id,
      });
      const target = await targetOf(id);
      const held = holdOpen((tx) => lockForEligibilityDecision(tx, ada.user.id, target));
      const res = await raceAgainst(held, () =>
        api.patch(`/admin/service-locations/${venue.id}`, { status: 'ARCHIVED' }, as(admin)),
      );
      expect(res.status).toBe(200);
    });
  });

  describe('decisions on unrelated assistants are not serialised', () => {
    it('two decisions on different assistants proceed while a third assistant is being changed', async () => {
      const carla = await approvedAssistant(ctx, api, admin, catalog, 'Carla E.');
      const id = await openRequest(api, alice, catalog);
      const held = holdOpen(suspendInTx(carla));
      await held.started;
      // Carla's in-flight change must not delay Ada and Bola quoting on the same request.
      await sendQuote(api, ada, id).expect(201);
      await sendQuote(api, bola, id).expect(201);
      held.release();
      await held.done;
      expect(await quotesOf(id)).toHaveLength(2);
    });
  });

  describe('real concurrent traffic: no deadlock, no inconsistent final state', () => {
    it('selection, quoting, suspension and service edits racing on the same assistants', async () => {
      for (let round = 0; round < 4; round += 1) {
        const id = await openRequest(api, alice, catalog);
        const a = await sendQuote(api, ada, id).expect(201);
        const results = await Promise.all([
          selectQuote(api, alice, id, a.body.quote.id),
          sendQuote(api, bola, id),
          api.put(
            '/assistants/me/services',
            { cityIds: [catalog.city.id], taskIds: [catalog.hold.id, catalog.docs.id] },
            as(bola.user),
          ),
          round === 0
            ? move(api, admin, bola.profileId, 'SUSPENDED', 'Suspended while we investigate.')
            : api.get('/assistants/me/requests', as(ada.user)),
        ]);
        for (const r of results) expect(r.status, `round ${round}`).toBeLessThan(500);
        const quotes = await quotesOf(id);
        expect(quotes.filter((q) => q.status === 'ACCEPTED').length).toBeLessThanOrEqual(1);
        const request = await requestRow(id);
        const accepted = quotes.filter((q) => q.status === 'ACCEPTED').length;
        expect(request.status === 'QUOTE_ACCEPTED').toBe(accepted === 1);
        if (round === 0) {
          await ownerPrisma().assistantProfile.update({
            where: { id: bola.profileId },
            data: { status: 'APPROVED' },
          });
          await ownerPrisma().user.update({
            where: { id: bola.user.id },
            data: { role: 'ASSISTANT' },
          });
        }
      }
    });
  });
});
