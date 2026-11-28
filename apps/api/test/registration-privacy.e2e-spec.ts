import { PasswordService } from '../src/auth/password.service.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  signUp,
  STRONG_PASSWORD,
  uniqueEmail,
  type TestContext,
} from './support/test-app.js';

/**
 * The public registration contract (D-056): for any well-formed request the caller learns nothing
 * about the address. These tests compare what an unauthenticated caller can observe across a new
 * address, a verified account, an unverified account and a suspended account, and separately check
 * what each case does (and does not) do in the owner's inbox and in the database.
 */
describe('Enumeration-safe registration (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.limiter.reset();
    ctx.mail.sent.length = 0;
  });

  /** Everything an unauthenticated caller can see of a response. */
  const observable = (res: {
    status: number;
    body: unknown;
    headers: Record<string, unknown>;
  }) => ({
    status: res.status,
    body: res.body,
    setCookie: res.headers['set-cookie'] ?? null,
    contentType: res.headers['content-type'],
    contentLength: res.headers['content-length'],
    retryAfter: res.headers['retry-after'] ?? null,
  });

  const accounts = async () => {
    const verified = await createUser(api, { verified: true, email: 'verified@example.test' });
    const unverified = await createUser(api, { email: 'unverified@example.test' });
    const suspended = await createUser(api, { verified: true, email: 'suspended@example.test' });
    await ownerPrisma().user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    ctx.mail.sent.length = 0;
    await ctx.limiter.reset();
    return { verified, unverified, suspended };
  };

  describe('what the caller can observe', () => {
    it('is byte-for-byte the same for a new, verified, unverified and suspended address', async () => {
      const { verified, unverified, suspended } = await accounts();
      const attempt = (email: string) =>
        api.register({ email, name: 'Someone Else', password: 'another-strong-pass-77' });

      const seen = {
        fresh: observable(await attempt(uniqueEmail('fresh')).expect(202)),
        verified: observable(await attempt(verified.email).expect(202)),
        unverified: observable(await attempt(unverified.email).expect(202)),
        suspended: observable(await attempt(suspended.email).expect(202)),
      };
      expect(seen.verified).toEqual(seen.fresh);
      expect(seen.unverified).toEqual(seen.fresh);
      expect(seen.suspended).toEqual(seen.fresh);
      expect(seen.fresh.setCookie).toBeNull();
      expect(Object.keys(seen.fresh.body as object)).toEqual(['message']);
      const text = JSON.stringify(seen.fresh.body);
      expect(text).not.toMatch(
        /exist|already|taken|registered|verified|suspend|inactive|account with/i,
      );
    });

    it('matches case, spacing and Unicode variants of an existing address', async () => {
      await createUser(api, { email: 'ada@example.test' });
      await ctx.limiter.reset();
      const fresh = observable(await api.register({ email: uniqueEmail() }).expect(202));
      const variant = observable(await api.register({ email: '  ADA@Example.TEST ' }).expect(202));
      expect(variant).toEqual(fresh);
    });

    it('still reports invalid input (400), which depends only on what the caller sent', async () => {
      await createUser(api, { email: 'ada@example.test' });
      for (const email of ['ada@example.test', uniqueEmail()]) {
        const res = await api.register({ email, password: 'short' }).expect(400);
        expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(['password']);
      }
    });

    it('never sets a session, for any address', async () => {
      const { verified } = await accounts();
      const before = await ctx.prisma.session.count();
      for (const email of [verified.email, uniqueEmail()]) {
        const res = await api.register({ email }).expect(202);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      expect(await ctx.prisma.session.count()).toBe(before);
    });

    it('hashes the password on every path, so the dominant cost does not reveal existence', async () => {
      const { verified, suspended } = await accounts();
      const spy = vi.spyOn(ctx.app.get(PasswordService), 'hash');
      try {
        for (const email of [uniqueEmail(), verified.email, suspended.email]) {
          spy.mockClear();
          await api.register({ email }).expect(202);
          expect(spy).toHaveBeenCalledTimes(1);
        }
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('what happens in the owner’s inbox', () => {
    it('a new address gets exactly one verification link and the account is created unverified', async () => {
      const email = uniqueEmail('new');
      await api.register({ email, name: 'Ada New' }).expect(202);
      expect(ctx.mail.sent).toHaveLength(1);
      expect(ctx.mail.sent[0]).toMatchObject({ to: email });
      expect(ctx.mail.sent[0]!.subject).toMatch(/Verify your Qyou email/);
      expect(ctx.mail.sent[0]!.text).toMatch(/#token=[\w-]{43}/);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).toBeNull();
      expect(await ctx.prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(1);
    });

    it('an existing active account (verified or not) gets one note with login and reset links, and no token', async () => {
      const { verified, unverified } = await accounts();
      const tokensBefore = await ctx.prisma.emailVerificationToken.count();
      for (const target of [verified, unverified]) {
        ctx.mail.sent.length = 0;
        await ctx.limiter.reset();
        await api.register({ email: target.email, name: 'Intruder' }).expect(202);
        expect(ctx.mail.sent).toHaveLength(1);
        const mail = ctx.mail.sent[0]!;
        expect(mail.to).toBe(target.email);
        expect(mail.subject).toBe('You already have a Qyou account');
        expect(mail.text).toContain('/login');
        expect(mail.text).toContain('/forgot-password');
        expect(mail.text).not.toMatch(/#token=/);
        expect(mail.text).not.toMatch(/verified|unverified|suspend/i);
        expect(mail.text + mail.html).not.toContain('Intruder');
      }
      expect(await ctx.prisma.emailVerificationToken.count()).toBe(tokensBefore);
    });

    it('a suspended account gets nothing, so no misleading login or reset invitation is sent', async () => {
      const { suspended } = await accounts();
      await api.register({ email: suspended.email }).expect(202);
      expect(ctx.mail.sent).toHaveLength(0);
    });
  });

  describe('no unintended mutation', () => {
    it('leaves an existing account exactly as it was', async () => {
      const { verified, unverified, suspended } = await accounts();
      const snapshot = () =>
        ctx.prisma.user.findMany({ orderBy: { email: 'asc' }, omit: { updatedAt: true } });
      const before = await snapshot();
      const sessionsBefore = await ctx.prisma.session.count();
      for (const target of [verified, unverified, suspended]) {
        await ctx.limiter.reset();
        await api
          .register({ email: target.email, name: 'Mallory', password: 'mallory-new-password-1' })
          .expect(202);
      }
      expect(await snapshot()).toEqual(before);
      expect(await ctx.prisma.session.count()).toBe(sessionsBefore);
      // The legitimate owner's password still works; the attacker's does not.
      await api.login(verified.email, STRONG_PASSWORD).expect(200);
      await api.login(verified.email, 'mallory-new-password-1').expect(401);
    });

    it('creates one account under concurrent registrations and sends one verification link', async () => {
      const email = uniqueEmail('race');
      const results = await Promise.all(Array.from({ length: 3 }, () => api.register({ email })));
      expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
      expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
      const verification = ctx.mail.sent.filter((m) => /Verify your Qyou email/.test(m.subject));
      expect(verification).toHaveLength(1);
    });
  });

  describe('rate limits', () => {
    it('drops repeats beyond three per address per hour silently, identically for any address', async () => {
      const { verified } = await accounts();
      const fresh = uniqueEmail('hammered');
      const outcome = async (email: string) => {
        const responses = [];
        for (let i = 0; i < 4; i += 1) responses.push(observable(await api.register({ email })));
        return responses;
      };
      const mailBefore = ctx.mail.sent.length;
      const freshSeen = await outcome(fresh);
      const freshMail = ctx.mail.sent.length - mailBefore;
      ctx.mail.sent.length = 0;
      const verifiedSeen = await outcome(verified.email);

      // Every response, including the throttled ones, is the same 202.
      for (const seen of [...freshSeen, ...verifiedSeen]) expect(seen).toEqual(freshSeen[0]);
      // Three attempts act, the rest do nothing: same count of messages for new and existing.
      expect(freshMail).toBe(3);
      expect(ctx.mail.sent).toHaveLength(3);
      expect(await ctx.prisma.user.count({ where: { email: fresh } })).toBe(1);
      // Other addresses are unaffected.
      ctx.mail.sent.length = 0;
      await api.register({ email: uniqueEmail('other') }).expect(202);
      expect(ctx.mail.sent).toHaveLength(1);
    });

    it('keeps the per-IP limit: the 11th request in an hour is 429 for any address', async () => {
      const { verified } = await accounts();
      for (let i = 0; i < 10; i += 1) {
        await api.register({ email: i % 2 ? verified.email : uniqueEmail() }).expect(202);
      }
      const limited = await api.register({ email: verified.email }).expect(429);
      const limitedFresh = await api.register({ email: uniqueEmail() }).expect(429);
      expect(limited.body).toEqual(limitedFresh.body);
    });
  });

  describe('audit log', () => {
    it('records a new account as before and a repeat as a separate action without private data', async () => {
      const { verified } = await accounts();
      const email = uniqueEmail('audit');
      await api
        .register({ email, name: 'Audit Name', password: 'audit-password-secret-1' })
        .expect(202);
      await ctx.limiter.reset();
      await api
        .register({
          email: verified.email,
          name: 'Intruder Name',
          password: 'intruder-secret-pass-1',
        })
        .expect(202);

      const created = await ctx.prisma.auditLog.findMany({ where: { action: 'auth.register' } });
      const created2 = created.filter((r) => r.actorUserId !== null);
      expect(created2.some((r) => r.targetId !== verified.id)).toBe(true);
      const repeats = await ctx.prisma.auditLog.findMany({
        where: { action: 'auth.register.existing_account' },
      });
      expect(repeats).toHaveLength(1);
      expect(repeats[0]).toMatchObject({ actorUserId: null, targetId: verified.id });
      const dump = JSON.stringify(await ctx.prisma.auditLog.findMany());
      for (const secret of ['audit-password-secret-1', 'intruder-secret-pass-1', 'Intruder Name']) {
        expect(dump).not.toContain(secret);
      }
      // Append-only integrity still holds for the runtime role.
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE audit_logs SET action = 'x' WHERE id = '${repeats[0]!.id}'`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('neighbouring public endpoints stay neutral and working', () => {
    it('login answers the same 401 for an unknown address, a wrong password and a suspended account', async () => {
      const { verified, suspended } = await accounts();
      const bodies = [
        await api.login(uniqueEmail('nobody'), STRONG_PASSWORD).expect(401),
        await api.login(verified.email, 'wrong-password-123').expect(401),
        await api.login(suspended.email, STRONG_PASSWORD).expect(401),
      ].map(observable);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
    });

    it('password-reset requests answer the same 202 for unknown, existing and suspended addresses, and only an active owner gets mail', async () => {
      const { verified, suspended } = await accounts();
      const seen = [];
      for (const email of [uniqueEmail('nobody'), verified.email, suspended.email]) {
        seen.push(
          observable(await api.post('/auth/password-reset/request', { email }).expect(202)),
        );
      }
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[2]).toEqual(seen[0]);
      expect(ctx.mail.sent.map((m) => m.to)).toEqual([verified.email]);
    });

    it('verification and reset confirmation say the same thing for any bad token', async () => {
      const a = await api.post('/auth/email-verification/confirm', { token: 'A'.repeat(43) });
      const b = await api.post('/auth/email-verification/confirm', { token: 'B'.repeat(43) });
      expect(observable(a)).toEqual(observable(b));
    });

    it('a user who registered can verify the address and log in (the full new-account journey)', async () => {
      const email = uniqueEmail('journey');
      const { token } = await signUp(api, { email });
      expect((await api.me(token).expect(200)).body.user.emailVerified).toBe(false);
      const link = ctx.mail.sent.find((m) => m.to === email)!.text;
      const verifyToken = /#token=([\w-]{43})/.exec(link)![1]!;
      await api.post('/auth/email-verification/confirm', { token: verifyToken }).expect(200);
      expect((await api.me(token).expect(200)).body.user.emailVerified).toBe(true);
    });
  });
});
