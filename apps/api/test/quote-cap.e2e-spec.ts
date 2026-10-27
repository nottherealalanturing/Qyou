import { MAX_PENDING_QUOTES_PER_REQUEST } from '../src/service-requests/request-state.js';
import {
  approvedAssistant,
  makeCatalog,
  type Applicant,
  type Catalog,
} from './support/assistants.js';
import { as, customer, openRequest, sendQuote } from './support/requests.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './support/test-app.js';

const CAP = MAX_PENDING_QUOTES_PER_REQUEST;

/**
 * The per-request cap on PENDING quotes, exercised through the real API with real, fully approved
 * assistants (CAP + 5 of them). Assistants are created once for the file; every test uses its own
 * request, so quote rows from one test never count in another.
 */
describe('Pending-quote cap (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let catalog: Catalog;
  let alice: TestUser;
  let assistants: Applicant[];

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
    await resetDatabase();
    catalog = await makeCatalog();
    const admin = await createUser(api, { role: 'ADMIN', verified: true });
    alice = await customer(api);
    assistants = [];
    for (let i = 0; i < CAP + 5; i += 1) {
      await ctx.limiter.reset(); // registration is IP rate limited; this is fixture setup, not the subject
      assistants.push(await approvedAssistant(ctx, api, admin, catalog, `Assistant ${i + 1}`));
    }
  }, 240_000);
  afterAll(() => ctx.close());
  beforeEach(() => ctx.limiter.reset());

  const pendingCount = (requestId: string) =>
    ownerPrisma().quote.count({ where: { requestId, status: 'PENDING' } });

  async function fill(requestId: string, count: number): Promise<void> {
    for (const assistant of assistants.slice(0, count)) {
      await sendQuote(api, assistant, requestId).expect(201);
    }
  }

  it('the cap is the documented 20', () => {
    expect(CAP).toBe(20);
  });

  it('accepts the quote immediately below the limit and the one that reaches it, then rejects the next', async () => {
    const id = await openRequest(api, alice, catalog);
    await fill(id, CAP - 1);
    expect(await pendingCount(id)).toBe(CAP - 1);

    await sendQuote(api, assistants[CAP - 1]!, id).expect(201); // the 20th
    expect(await pendingCount(id)).toBe(CAP);

    const rejected = await sendQuote(api, assistants[CAP]!, id).expect(409);
    expect(rejected.body.message).toMatch(/maximum number of quotes/);
    expect(await pendingCount(id)).toBe(CAP);
    // The rejected assistant has no row at all, and the request is unchanged.
    expect(
      await ownerPrisma().quote.count({
        where: { requestId: id, assistantId: assistants[CAP]!.profileId },
      }),
    ).toBe(0);
    expect((await ownerPrisma().serviceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
      'QUOTED',
    );
  });

  it('an existing assistant can still withdraw at the limit, and the freed slot is usable once', async () => {
    const id = await openRequest(api, alice, catalog);
    await fill(id, CAP);
    await sendQuote(api, assistants[CAP]!, id).expect(409);

    const first = await ownerPrisma().quote.findFirstOrThrow({
      where: { requestId: id, assistantId: assistants[0]!.profileId },
    });
    await api
      .post(`/assistants/me/quotes/${first.id}/withdraw`, {}, as(assistants[0]!.user))
      .expect(200);
    expect(await pendingCount(id)).toBe(CAP - 1); // a withdrawn quote no longer counts

    await sendQuote(api, assistants[CAP]!, id).expect(201); // takes the freed slot
    expect(await pendingCount(id)).toBe(CAP);
    await sendQuote(api, assistants[CAP + 1]!, id).expect(409); // and the cap holds again
    expect(await pendingCount(id)).toBe(CAP);
  });

  it('a withdrawn assistant re-quoting while the request is full is rejected like anyone else', async () => {
    const id = await openRequest(api, alice, catalog);
    await fill(id, CAP);
    const first = await ownerPrisma().quote.findFirstOrThrow({
      where: { requestId: id, assistantId: assistants[0]!.profileId },
    });
    await api
      .post(`/assistants/me/quotes/${first.id}/withdraw`, {}, as(assistants[0]!.user))
      .expect(200);
    await sendQuote(api, assistants[CAP]!, id).expect(201); // someone else takes the slot
    await sendQuote(api, assistants[0]!, id).expect(409); // the withdrawn assistant is now over the cap
    expect(await pendingCount(id)).toBe(CAP);
  });

  it('concurrent attempts at the limit: exactly the remaining slots succeed, the count never exceeds the cap', async () => {
    const id = await openRequest(api, alice, catalog);
    await fill(id, CAP - 2); // two slots left
    const racers = assistants.slice(CAP - 2, CAP + 3); // five assistants race for two slots
    const results = await Promise.all(racers.map((a) => sendQuote(api, a, id)));

    expect(results.map((r) => r.status).toSorted()).toEqual([201, 201, 409, 409, 409]);
    expect(await pendingCount(id)).toBe(CAP);
    // One row per assistant who won; none for the losers.
    const rows = await ownerPrisma().quote.findMany({ where: { requestId: id } });
    expect(new Set(rows.map((r) => r.assistantId)).size).toBe(rows.length);
  });

  it('concurrent attempts when exactly one slot is left: one winner (repeated)', async () => {
    for (let round = 0; round < 3; round += 1) {
      await ctx.limiter.reset(); // per-assistant quote rate limit is not the subject here
      const id = await openRequest(api, alice, catalog);
      await fill(id, CAP - 1);
      const results = await Promise.all(
        assistants.slice(CAP - 1, CAP + 4).map((a) => sendQuote(api, a, id)),
      );
      expect(results.map((r) => r.status).toSorted(), `round ${round}`).toEqual([
        201, 409, 409, 409, 409,
      ]);
      expect(await pendingCount(id), `round ${round}`).toBe(CAP);
    }
  });

  it('a withdrawal racing a full-request submission never leaves more than the cap pending', async () => {
    const id = await openRequest(api, alice, catalog);
    await fill(id, CAP);
    const first = await ownerPrisma().quote.findFirstOrThrow({
      where: { requestId: id, assistantId: assistants[0]!.profileId },
    });
    const [withdraw, submit] = await Promise.all([
      api.post(`/assistants/me/quotes/${first.id}/withdraw`, {}, as(assistants[0]!.user)),
      sendQuote(api, assistants[CAP]!, id),
    ]);
    expect(withdraw.status).toBe(200);
    // Either order is legal: the submission ran first (409, still full) or after the withdrawal (201).
    expect([201, 409]).toContain(submit.status);
    expect(await pendingCount(id)).toBe(submit.status === 201 ? CAP : CAP - 1);
  });
});
