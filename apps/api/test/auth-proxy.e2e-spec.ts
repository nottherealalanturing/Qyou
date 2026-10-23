import {
  STRONG_PASSWORD,
  client,
  createTestApp,
  resetDatabase,
  type TestContext,
} from './support/test-app.js';

// ConfigModule validates the environment when AppModule is imported, so this must be set before
// any import of the app runs (vi.hoisted executes first).
vi.hoisted(() => {
  process.env.TRUST_PROXY = '1';
});

describe('Auth: behind a trusted reverse proxy (TRUST_PROXY=1)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.limiter.reset();
  });

  it('limits per forwarded client IP, so one client cannot lock out others', async () => {
    const email = 'proxy@example.test';
    await api.register({ email }, { ip: '198.51.100.1' }).expect(201);
    for (let i = 0; i < 5; i++) {
      await api.login(email, 'wrong-password-123', { ip: '203.0.113.7' }).expect(401);
    }
    await api.login(email, STRONG_PASSWORD, { ip: '203.0.113.7' }).expect(429);
    // A different client IP is not affected by the attacker's failures…
    await api.login(email, STRONG_PASSWORD, { ip: '198.51.100.1' }).expect(200);
  });

  it('still caps total failures per account across many IPs (distributed guessing)', async () => {
    const email = 'distributed@example.test';
    await api.register({ email }, { ip: '198.51.100.2' }).expect(201);
    for (let i = 0; i < 20; i++) {
      await api.login(email, 'wrong-password-123', { ip: `192.0.2.${i + 1}` }).expect(401);
    }
    await api.login(email, STRONG_PASSWORD, { ip: '192.0.2.200' }).expect(429);
  });

  it('records the forwarded client IP in the audit log', async () => {
    await api.register({}, { ip: '198.51.100.55' }).expect(201);
    const row = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.register' } });
    expect(row.ip).toBe('198.51.100.55');
  });
});
