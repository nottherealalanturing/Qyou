import { Logger } from '@nestjs/common';
import {
  STRONG_PASSWORD,
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  sessionTokenFrom,
  sha256,
  tokenFromMail,
  type TestContext,
} from './support/test-app.js';

const VERIFY = /verify/i;
const INVALID = 'This verification link is invalid or has expired.';

describe('Email verification (e2e, real PostgreSQL)', () => {
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
    ctx.mail.sent.length = 0;
  });

  /** Registers a user and returns it with the token from its verification email. */
  async function registerWithToken() {
    const user = await createUser(api);
    await vi.waitFor(() =>
      expect(ctx.mail.sent.some((m) => VERIFY.test(m.subject) && m.to === user.email)).toBe(true),
    );
    return { user, token: tokenFromMail(ctx.mail, VERIFY, user.email) };
  }
  const confirm = (token: string, opts = {}) =>
    api.post('/auth/email-verification/confirm', { token }, opts);

  describe('issuing', () => {
    it('sends a link with the token in the URL fragment on registration, storing only its hash', async () => {
      const { user, token } = await registerWithToken();
      const mail = ctx.mail.sent.find((m) => m.to === user.email && VERIFY.test(m.subject))!;
      expect(mail.text).toMatch(/http:\/\/localhost:3000\/verify-email#token=/);
      expect(mail.html).toContain('/verify-email#token=');
      expect(mail.text).not.toMatch(/\?token=/);

      const rows = await ctx.prisma.emailVerificationToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(rows[0]!.email).toBe(user.email);
      const ttlHours = (rows[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(ttlHours).toBeGreaterThan(23.9);
      expect(ttlHours).toBeLessThanOrEqual(24);
    });

    it('starts unverified and reports it on /me', async () => {
      const { user } = await registerWithToken();
      expect((await api.me(user.token).expect(200)).body.user.emailVerified).toBe(false);
    });
  });

  describe('confirming', () => {
    it('verifies the address, audits it, and works without a session', async () => {
      const { user, token } = await registerWithToken();
      const res = await confirm(token).expect(200); // no cookie: opened in another browser
      expect(res.body).toEqual({ status: 'verified' });
      expect((await api.me(user.token).expect(200)).body.user.emailVerified).toBe(true);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.email_verified' },
      });
      expect(audit.actorUserId).toBe(user.id);
      expect(audit.metadata).toEqual({ via: 'verification_link' });
    });

    it('is idempotent: replaying a used link reports already_verified and changes nothing', async () => {
      const { user, token } = await registerWithToken();
      await confirm(token).expect(200);
      const first = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailVerifiedAt;
      const again = await confirm(token).expect(200);
      expect(again.body).toEqual({ status: 'already_verified' });
      const second = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailVerifiedAt;
      expect(second).toEqual(first);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.email_verified' } })).toBe(1);
    });

    it('gives the same 400 for unknown, malformed and expired tokens', async () => {
      const { token } = await registerWithToken();
      const unknown = await confirm('Z'.repeat(43)).expect(400);
      expect(unknown.body.message).toBe(INVALID);

      const malformed = await confirm('short').expect(400);
      expect(malformed.body.message).toBe('Validation failed');

      await ctx.prisma.emailVerificationToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await confirm(token).expect(400);
      expect(expired.body).toEqual(unknown.body);
    });

    it('does not verify anything when the token is expired', async () => {
      const { user, token } = await registerWithToken();
      await ctx.prisma.emailVerificationToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await confirm(token).expect(400);
      expect(
        (await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
      ).toBeNull();
    });

    it('rejects a superseded link when a newer one was requested', async () => {
      const { user, token: first } = await registerWithToken();
      await api.post('/auth/email-verification/request', {}, { token: user.token }).expect(200);
      await vi.waitFor(() =>
        expect(ctx.mail.sent.filter((m) => VERIFY.test(m.subject))).toHaveLength(2),
      );
      const second = tokenFromMail(ctx.mail, VERIFY, user.email);
      expect(second).not.toBe(first);

      await confirm(first).expect(400);
      expect((await api.me(user.token)).body.user.emailVerified).toBe(false);
      await confirm(second).expect(200);
    });

    it('only verifies the exact address the token was issued for', async () => {
      const { user, token } = await registerWithToken();
      await ownerPrisma().user.update({
        where: { id: user.id },
        data: { email: 'changed@example.test' },
      });
      await confirm(token).expect(400);
      expect(
        (await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
      ).toBeNull();
    });

    it('lets exactly one of many concurrent requests perform the verification', async () => {
      const { user, token } = await registerWithToken();
      const results = await Promise.all(Array.from({ length: 8 }, () => confirm(token)));
      for (const r of results) expect(r.status).toBe(200);
      const statuses = results.map((r) => r.body.status);
      expect(statuses.filter((s) => s === 'verified')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'already_verified')).toHaveLength(7);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'auth.email_verified', actorUserId: user.id },
        }),
      ).toBe(1);
    });

    it('rate-limits confirm attempts per IP (21st is 429)', async () => {
      for (let i = 0; i < 20; i++) await confirm('Q'.repeat(43)).expect(400);
      await confirm('Q'.repeat(43)).expect(429);
    });

    it('blocks cross-origin confirmation (CSRF)', async () => {
      const { token } = await registerWithToken();
      await confirm(token, { origin: 'https://evil.example' }).expect(403);
      await confirm(token).expect(200);
    });

    it('never writes the token to logs', async () => {
      const chunks: string[] = [];
      const out = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((c: unknown) => (chunks.push(String(c)), true));
      const err = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((c: unknown) => (chunks.push(String(c)), true));
      try {
        const { token } = await registerWithToken();
        await confirm(token).expect(200);
        await confirm(token).expect(200);
        expect(chunks.join('')).not.toContain(token);
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
    });
  });

  describe('resending', () => {
    it('requires authentication', async () => {
      await api.post('/auth/email-verification/request', {}).expect(401);
    });

    it('sends a fresh link to an unverified user', async () => {
      const { user } = await registerWithToken();
      const res = await api
        .post('/auth/email-verification/request', {}, { token: user.token })
        .expect(200);
      expect(res.body).toEqual({ status: 'sent' });
      await vi.waitFor(() =>
        expect(ctx.mail.sent.filter((m) => VERIFY.test(m.subject))).toHaveLength(2),
      );
    });

    it('is idempotent for verified users: no email, no new token', async () => {
      const { user, token } = await registerWithToken();
      await confirm(token).expect(200);
      const before = ctx.mail.sent.length;
      const res = await api
        .post('/auth/email-verification/request', {}, { token: user.token })
        .expect(200);
      expect(res.body).toEqual({ status: 'already_verified' });
      await new Promise((r) => setTimeout(r, 100));
      expect(ctx.mail.sent).toHaveLength(before);
      expect(await ctx.prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(1);
    });

    it('limits resends to 3 per hour per user (429 with Retry-After), without affecting others', async () => {
      const { user } = await registerWithToken();
      const other = await createUser(api);
      for (let i = 0; i < 3; i++) {
        await api.post('/auth/email-verification/request', {}, { token: user.token }).expect(200);
      }
      const blocked = await api
        .post('/auth/email-verification/request', {}, { token: user.token })
        .expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await api.post('/auth/email-verification/request', {}, { token: other.token }).expect(200);
    });

    it('survives a mail transport failure (the user can resend)', async () => {
      const { user } = await registerWithToken();
      const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const spy = vi.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error('smtp down'));
      await api.post('/auth/email-verification/request', {}, { token: user.token }).expect(200);
      await vi.waitFor(() => expect(quiet).toHaveBeenCalled());
      expect(String(quiet.mock.calls[0]?.[0])).not.toContain('smtp down');
      spy.mockRestore();
      quiet.mockRestore();
      await api.post('/auth/email-verification/request', {}, { token: user.token }).expect(200);
    });
  });

  describe('password reset also proves mailbox control', () => {
    it('verifies an unverified address when the reset completes', async () => {
      const { user } = await registerWithToken();
      await api.post('/auth/password-reset/request', { email: user.email }).expect(202);
      await vi.waitFor(() =>
        expect(ctx.mail.sent.some((m) => /reset/i.test(m.subject))).toBe(true),
      );
      const token = tokenFromMail(ctx.mail, /reset/i, user.email);
      await api
        .post('/auth/password-reset/confirm', { token, password: 'a-brand-new-passphrase-42' })
        .expect(200);
      const login = await api.login(user.email, 'a-brand-new-passphrase-42').expect(200);
      expect(login.body.user.emailVerified).toBe(true);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.email_verified' },
      });
      expect(audit.metadata).toEqual({ via: 'password_reset' });
      void STRONG_PASSWORD;
      void sessionTokenFrom;
    });
  });
});
