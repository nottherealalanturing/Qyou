import { AdminBootstrapService } from '../src/admin/admin-bootstrap.service.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  sha256,
  tokenFromMail,
  type TestContext,
} from './support/test-app.js';

const NEW_PASSWORD = 'admin-chosen-passphrase-91';

describe('Administrator bootstrap (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let bootstrap: AdminBootstrapService;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
    bootstrap = ctx.app.get(AdminBootstrapService);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
    ctx.mail.sent.length = 0;
  });

  const run = (overrides: Partial<Parameters<AdminBootstrapService['bootstrap']>[0]> = {}) =>
    bootstrap.bootstrap({ email: 'Founder@Example.test', name: 'Founding Admin', ...overrides });

  it('creates a verified administrator whose password nobody knows, and emails a set-password link', async () => {
    const result = await run();
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.emailSent).toBe(true);

    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(admin).toMatchObject({ email: 'founder@example.test', role: 'ADMIN', status: 'ACTIVE' });
    expect(admin.emailVerifiedAt).not.toBeNull();
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);

    // Nobody can log in until the invited administrator sets a password.
    for (const guess of ['password', 'founder@example.test', 'admin-admin-admin', '']) {
      await api.login('founder@example.test', guess || 'x').expect(401);
    }

    expect(ctx.mail.sent).toHaveLength(1);
    const mail = ctx.mail.sent[0]!;
    expect(mail.to).toBe('founder@example.test');
    expect(mail.subject).toMatch(/administrator/i);
    expect(mail.text).toMatch(/\/reset-password#token=/);

    const token = tokenFromMail(ctx.mail, /administrator/i);
    const row = await ctx.prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: admin.id },
    });
    expect(row.tokenHash).toBe(sha256(token)); // only the hash is stored
    const ttlHours = (row.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(23.9);

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.bootstrap' },
    });
    expect(audit.targetId).toBe(admin.id);
    expect(audit.actorUserId).toBeNull();
    expect(audit.metadata).toMatchObject({ via: 'cli', additional: false });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('lets the invited administrator set a password and then use the admin API', async () => {
    await run();
    const token = tokenFromMail(ctx.mail, /administrator/i);
    await api.post('/auth/password-reset/confirm', { token, password: NEW_PASSWORD }).expect(200);

    const login = await api.login('founder@example.test', NEW_PASSWORD).expect(200);
    expect(login.body.user).toMatchObject({ role: 'ADMIN', emailVerified: true });
    const adminToken = login.headers['set-cookie']?.[0]?.split(';')[0]?.split('=')[1] as string;

    const customer = await createUser(api, { verified: true });
    await api
      .patch(
        `/admin/users/${customer.id}/role`,
        { role: 'ASSISTANT' },
        { token: decodeURIComponent(adminToken) },
      )
      .expect(200);
  });

  it('fails closed on repeated execution without changing the existing administrator', async () => {
    const first = await run();
    expect(first.status).toBe('created');
    const before = await ctx.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    ctx.mail.sent.length = 0;

    const second = await run({ email: 'someone-else@example.test', name: 'Another' });
    expect(second).toEqual({ status: 'refused', reason: 'admin_exists' });
    const same = await run();
    expect(same).toEqual({ status: 'refused', reason: 'admin_exists' });

    expect(await ctx.prisma.user.findMany({ orderBy: { createdAt: 'asc' } })).toEqual(before);
    expect(ctx.mail.sent).toHaveLength(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.bootstrap' } })).toBe(1);
  });

  it('adds another administrator only when explicitly allowed, never touching existing ones', async () => {
    await run();
    const founder = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'founder@example.test' },
    });
    const extra = await run({
      email: 'second@example.test',
      name: 'Second Admin',
      allowAdditional: true,
    });
    expect(extra.status).toBe('created');
    expect(await ctx.prisma.user.count({ where: { role: 'ADMIN' } })).toBe(2);
    expect(await ctx.prisma.user.findUniqueOrThrow({ where: { id: founder.id } })).toEqual(founder);
    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: 'admin.bootstrap' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => (a.metadata as { additional: boolean }).additional)).toEqual([
      false,
      true,
    ]);
  });

  it('never promotes or edits an existing account', async () => {
    const customer = await createUser(createApi(), {
      email: 'existing@example.test',
      verified: true,
    });
    const snapshot = await ctx.prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    ctx.mail.sent.length = 0;

    const result = await run({
      email: 'EXISTING@example.test',
      name: 'Hijack',
      allowAdditional: true,
    });
    expect(result).toEqual({ status: 'refused', reason: 'email_in_use' });
    expect(await ctx.prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(
      snapshot,
    );
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it.each([
    ['empty email', { email: '' }],
    ['malformed email', { email: 'not-an-email' }],
    ['blank name', { name: '   ' }],
    ['control characters in name', { name: 'Ad\u0000min' }],
    ['overlong name', { name: 'x'.repeat(81) }],
  ])('rejects invalid input (%s) without creating anything', async (_label, override) => {
    const result = await run(override);
    expect(result.status).toBe('invalid');
    expect(await ctx.prisma.user.count()).toBe(0);
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it('creates exactly one administrator under concurrent runs', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => run()));
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'refused')).toHaveLength(5);
    expect(await ctx.prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    expect(ctx.mail.sent).toHaveLength(1);
  });

  it('still creates the account when email delivery fails, and says so', async () => {
    const spy = vi.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error('smtp down'));
    const result = await run();
    expect(result).toMatchObject({ status: 'created', emailSent: false });
    spy.mockRestore();
    // Recovery path documented in the runbook: the normal "forgot password" flow.
    await api.post('/auth/password-reset/request', { email: 'founder@example.test' }).expect(202);
    await vi.waitFor(() => expect(ctx.mail.sent.some((m) => /reset/i.test(m.subject))).toBe(true));
  });

  it('cannot be reached over HTTP', async () => {
    const user = await createUser(createApi(), { verified: true });
    for (const path of ['/admin/bootstrap', '/auth/bootstrap', '/admin/create', '/admin']) {
      expect((await api.post(path, { email: 'x@example.test', name: 'X' })).status).toBe(404);
      expect(
        (await api.post(path, { email: 'x@example.test', name: 'X' }, { token: user.token }))
          .status,
      ).toBe(404);
    }
    expect(await ctx.prisma.user.count({ where: { role: 'ADMIN' } })).toBe(0);
    void ownerPrisma;
  });

  function createApi() {
    return api;
  }
});
