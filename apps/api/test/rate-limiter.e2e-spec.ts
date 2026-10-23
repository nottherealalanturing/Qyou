import { createHash } from 'node:crypto';
import { RateLimiter } from '../src/common/rate-limit/rate-limiter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, ownerPrisma, resetDatabase, type TestContext } from './support/test-app.js';

describe('RateLimiter (PostgreSQL-backed, e2e)', () => {
  let ctx: TestContext;
  let limiter: RateLimiter;
  const extraClients: PrismaService[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    limiter = ctx.limiter;
  });
  afterAll(async () => {
    for (const client of extraClients) await client.$disconnect();
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  /** A second, completely independent connection pool + limiter: stands in for another API instance. */
  function secondInstance(): RateLimiter {
    const url = process.env.DATABASE_URL!;
    const prisma = new PrismaService({ get: () => url } as never);
    extraClients.push(prisma);
    return new RateLimiter(prisma);
  }

  it('allows up to the limit, then blocks with a positive retry hint', async () => {
    for (let i = 0; i < 3; i++) expect((await limiter.hit('k', 3, 60_000)).allowed).toBe(true);
    const blocked = await limiter.hit('k', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('does not count blocked attempts', async () => {
    for (let i = 0; i < 6; i++) await limiter.hit('k', 3, 60_000);
    expect(await limiter.count('k', 60_000)).toBe(3);
  });

  it('keeps keys independent; clear() and reset() forget counters', async () => {
    await limiter.hit('a', 1, 60_000);
    expect((await limiter.hit('b', 1, 60_000)).allowed).toBe(true);
    expect((await limiter.hit('a', 1, 60_000)).allowed).toBe(false);
    await limiter.clear('a');
    expect((await limiter.hit('a', 1, 60_000)).allowed).toBe(true);
    await limiter.reset();
    expect(await limiter.count('a', 60_000)).toBe(0);
  });

  it('retryAfterSeconds reports 0 under the limit and the window remainder at the limit', async () => {
    await limiter.hit('k', 2, 60_000);
    expect(await limiter.retryAfterSeconds('k', 2, 60_000)).toBe(0);
    await limiter.hit('k', 2, 60_000);
    const wait = await limiter.retryAfterSeconds('k', 2, 60_000);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it('starts a fresh window when the previous one ends', async () => {
    const windowMs = 1000;
    // Align to the start of a window so the two phases cannot straddle a boundary by accident.
    await new Promise((r) => setTimeout(r, windowMs - (Date.now() % windowMs) + 20));
    expect((await limiter.hit('w', 1, windowMs)).allowed).toBe(true);
    expect((await limiter.hit('w', 1, windowMs)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, windowMs + 50));
    expect((await limiter.hit('w', 1, windowMs)).allowed).toBe(true);
  });

  it('never exceeds the limit under heavy concurrency on one instance', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => limiter.hit('burst', 10, 60_000)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(await limiter.count('burst', 60_000)).toBe(10);
  });

  it('enforces ONE shared limit across independent API instances', async () => {
    const instanceB = secondInstance();
    const instanceC = secondInstance();
    const instances = [limiter, instanceB, instanceC];
    const results = await Promise.all(
      Array.from({ length: 45 }, (_, i) => instances[i % 3]!.hit('shared', 12, 60_000)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(12);
    // Each instance sees the others' hits.
    expect(await instanceB.count('shared', 60_000)).toBe(12);
    expect(await instanceC.retryAfterSeconds('shared', 12, 60_000)).toBeGreaterThan(0);
  });

  it('survives an instance restart (counters are not process memory)', async () => {
    await limiter.hit('persist', 2, 60_000);
    await limiter.hit('persist', 2, 60_000);
    const restarted = secondInstance();
    expect((await restarted.hit('persist', 2, 60_000)).allowed).toBe(false);
  });

  it('stores only hashed keys (no raw emails or IPs at rest)', async () => {
    await limiter.hit('login-fail:203.0.113.9:victim@example.test', 5, 60_000);
    const rows = await ownerPrisma().rateLimitCounter.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe(
      createHash('sha256').update('login-fail:203.0.113.9:victim@example.test').digest('hex'),
    );
    expect(JSON.stringify(rows)).not.toContain('victim@example.test');
    expect(JSON.stringify(rows)).not.toContain('203.0.113.9');
  });

  it('purges day-old windows only', async () => {
    await limiter.hit('fresh', 5, 60_000);
    await ownerPrisma().rateLimitCounter.create({
      data: { key: 'f'.repeat(64), windowStart: new Date(Date.now() - 48 * 3_600_000), count: 3 },
    });
    expect(await limiter.purgeExpired()).toBe(1);
    expect(await ownerPrisma().rateLimitCounter.count()).toBe(1);
  });
});
