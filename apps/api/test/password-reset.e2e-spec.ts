import { Logger } from '@nestjs/common';
import {
  STRONG_PASSWORD,
  client,
  createTestApp,
  resetDatabase,
  sessionTokenFrom,
  sha256,
  type TestContext,
} from './support/test-app.js';

const NEW_PASSWORD = 'a-brand-new-passphrase-42';
const GENERIC = 'If an account exists for that email, we have sent a link to reset the password.';

describe('Auth: password reset (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  const email = 'reset-me@example.test';

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.limiter.reset();
    ctx.mail.sent.length = 0;
  });

  const requestReset = (address: string, opts = {}) =>
    api.post('/auth/password-reset/request', { email: address }, opts);

  /** Requests a reset and extracts the token from the delivered email's link fragment. */
  async function issueToken(address = email): Promise<string> {
    const before = ctx.mail.sent.length;
    await requestReset(address).expect(202);
    await vi.waitFor(() => expect(ctx.mail.sent.length).toBe(before + 1));
    const message = ctx.mail.sent.at(-1)!;
    const match = /#token=([A-Za-z0-9_-]{43})/.exec(message.text);
    expect(match, 'reset link with token fragment').not.toBeNull();
    return match![1]!;
  }

  const confirm = (token: string, password = NEW_PASSWORD) =>
    api.post('/auth/password-reset/confirm', { token, password });

  beforeEach(async () => {
    await api.register({ email, name: 'Reset Me' }).expect(201);
  });

  describe('request (enumeration safety)', () => {
    it('returns the identical response for existing and unknown addresses', async () => {
      const known = await requestReset(email).expect(202);
      const unknown = await requestReset('ghost@example.test').expect(202);
      expect(known.body).toEqual({ message: GENERIC });
      expect(unknown.body).toEqual(known.body);
      expect(Object.keys(known.headers).toSorted()).toEqual(
        expect.arrayContaining(['content-type']),
      );
      expect(known.headers['set-cookie']).toBeUndefined();
      expect(unknown.headers['set-cookie']).toBeUndefined();
    });

    it('sends mail only to the existing account', async () => {
      await requestReset('ghost@example.test').expect(202);
      await requestReset(email).expect(202);
      await vi.waitFor(() => expect(ctx.mail.sent).toHaveLength(1));
      expect(ctx.mail.sent[0]!.to).toBe(email);
      expect(ctx.mail.sent[0]!.subject).toMatch(/reset/i);
    });

    it('puts the token in the URL fragment of the web link, not the query string', async () => {
      await requestReset(email).expect(202);
      await vi.waitFor(() => expect(ctx.mail.sent).toHaveLength(1));
      const { text, html } = ctx.mail.sent[0]!;
      expect(text).toMatch(/http:\/\/localhost:3000\/reset-password#token=/);
      expect(html).toContain('/reset-password#token=');
      expect(text).not.toMatch(/\?token=/);
    });

    it('stores only the hash of the token', async () => {
      const token = await issueToken();
      const rows = await ctx.prisma.passwordResetToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(rows)).not.toContain(token);
      const ttl = rows[0]!.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(29 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000);
    });

    it('rejects malformed input', async () => {
      await api.post('/auth/password-reset/request', { email: 'nope' }).expect(400);
      await api.post('/auth/password-reset/request', {}).expect(400);
      await api.post('/auth/password-reset/request', { email, extra: 1 }).expect(400);
    });

    it('does not email suspended accounts, with the same response', async () => {
      await ctx.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });
      const res = await requestReset(email).expect(202);
      expect(res.body).toEqual({ message: GENERIC });
      await new Promise((r) => setTimeout(r, 100));
      expect(ctx.mail.sent).toHaveLength(0);
    });

    it('silently stops sending after 3 emails/hour to one address, without changing the response', async () => {
      for (let i = 0; i < 3; i++) await issueToken();
      const fourth = await requestReset(email).expect(202);
      expect(fourth.body).toEqual({ message: GENERIC });
      await new Promise((r) => setTimeout(r, 100));
      expect(ctx.mail.sent).toHaveLength(3);
    });

    it('rate-limits request attempts per IP (11th is 429)', async () => {
      for (let i = 0; i < 10; i++) await requestReset(`n${i}@example.test`).expect(202);
      await requestReset('n11@example.test').expect(429);
    });

    it('swallows mail transport failures without changing the response', async () => {
      const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const spy = vi.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error('smtp down'));
      const res = await requestReset(email).expect(202);
      expect(res.body).toEqual({ message: GENERIC });
      await vi.waitFor(() => expect(quiet).toHaveBeenCalled());
      expect(String(quiet.mock.calls[0]?.[0])).not.toContain('smtp down');
      spy.mockRestore();
      quiet.mockRestore();
    });
  });

  describe('confirm', () => {
    it('sets the new password, revokes every session and consumes the token', async () => {
      const sessionA = sessionTokenFrom(await api.login(email, STRONG_PASSWORD).expect(200))!;
      const sessionB = sessionTokenFrom(await api.login(email, STRONG_PASSWORD).expect(200))!;
      const token = await issueToken();

      const res = await confirm(token).expect(200);
      expect(res.body.message).toMatch(/updated/i);
      expect(res.headers['set-cookie']).toBeUndefined(); // no auto-login after a reset

      await api.me(sessionA).expect(401);
      await api.me(sessionB).expect(401);
      await api.login(email, STRONG_PASSWORD).expect(401);
      await api.login(email, NEW_PASSWORD).expect(200);

      const row = await ctx.prisma.passwordResetToken.findFirstOrThrow();
      expect(row.usedAt).not.toBeNull();
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'auth.password_reset.completed' } }),
      ).toBe(1);
    });

    it('rejects reuse of a token', async () => {
      const token = await issueToken();
      await confirm(token).expect(200);
      const again = await confirm(token, 'another-new-passphrase-7').expect(400);
      expect(again.body.message).toBe('This reset link is invalid or has expired.');
      await api.login(email, NEW_PASSWORD).expect(200);
    });

    it('rejects an expired token', async () => {
      const token = await issueToken();
      await ctx.prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await confirm(token).expect(400);
      expect(res.body.message).toBe('This reset link is invalid or has expired.');
      await api.login(email, STRONG_PASSWORD).expect(200); // password unchanged
    });

    it('gives the same error for unknown, malformed and used tokens', async () => {
      const unknown = await confirm('Z'.repeat(43)).expect(400);
      expect(unknown.body.message).toBe('This reset link is invalid or has expired.');
      const malformed = await confirm('short').expect(400);
      expect(malformed.body.issues[0].message).toBe('This reset link is invalid or has expired');
    });

    it('invalidates older links when a new one is requested', async () => {
      const first = await issueToken();
      const second = await issueToken();
      await confirm(first).expect(400);
      await confirm(second).expect(200);
    });

    it('rejects a weak new password without consuming the token', async () => {
      const token = await issueToken();
      await confirm(token, 'short').expect(400);
      await confirm(token, 'Password123').expect(400);
      await confirm(token).expect(200);
    });

    it('lets exactly one of many concurrent requests use a token', async () => {
      const token = await issueToken();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => confirm(token, `concurrent-passphrase-${i}`)),
      );
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(5);
      // Final password is exactly the winner's, not a mixture or a lost update.
      const winner = results.findIndex((r) => r.status === 200);
      await api.login(email, `concurrent-passphrase-${winner}`).expect(200);
    });

    it('does not let a token for one account affect another', async () => {
      await api.register({ email: 'other@example.test' }).expect(201);
      const token = await issueToken(email);
      await confirm(token).expect(200);
      await api.login('other@example.test', STRONG_PASSWORD).expect(200);
    });

    it('rate-limits confirm attempts per IP (11th is 429)', async () => {
      for (let i = 0; i < 10; i++) await confirm('Q'.repeat(43)).expect(400);
      await confirm('Q'.repeat(43)).expect(429);
    });

    it('blocks cross-origin confirm requests (CSRF)', async () => {
      const token = await issueToken();
      await api
        .post(
          '/auth/password-reset/confirm',
          { token, password: NEW_PASSWORD },
          { origin: 'https://evil.example' },
        )
        .expect(403);
      await confirm(token).expect(200);
    });
  });
});
