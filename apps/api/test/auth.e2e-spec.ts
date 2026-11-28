import { PASSWORD_RESET_TTL_MS } from '../src/auth/auth.types.js';
import {
  ALLOWED_ORIGIN,
  STRONG_PASSWORD,
  client,
  createTestApp,
  resetDatabase,
  sessionTokenFrom,
  signUp,
  setCookieLine,
  sha256,
  uniqueEmail,
  type TestContext,
} from './support/test-app.js';

describe('Auth: registration, login, sessions, CSRF (e2e, real PostgreSQL)', () => {
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
  });

  describe('registration', () => {
    it('creates a customer without signing them in, and stores only hashes', async () => {
      const email = uniqueEmail();
      const res = await api.register({ email, name: '  Ada Lovelace  ' }).expect(202);

      // The body is the shared neutral message: no user, no id, nothing about the account.
      expect(Object.keys(res.body)).toEqual(['message']);
      expect(JSON.stringify(res.body)).not.toMatch(/password|hash|user|id/i);
      expect(setCookieLine(res)).toBe('');
      expect(await ctx.prisma.session.count()).toBe(0);

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ name: 'Ada Lovelace', role: 'CUSTOMER', status: 'ACTIVE' });
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(STRONG_PASSWORD);

      // The password set at registration works for the first login.
      const login = await api.login(email, STRONG_PASSWORD).expect(200);
      const token = sessionTokenFrom(login)!;
      expect(token).toHaveLength(43);
      const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.tokenHash).toBe(sha256(token));

      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'auth.register' } });
      expect(audit?.actorUserId).toBe(user.id);
      expect(JSON.stringify(audit)).not.toContain(STRONG_PASSWORD);
    });

    it('treats a case-variant duplicate exactly like a new address (no 409, one account)', async () => {
      await api.register({ email: '  Ada@Example.TEST ' }).expect(202);
      const dup = await api.register({ email: 'ADA@example.test' }).expect(202);
      expect(dup.body.message).toBeTruthy();
      expect(await ctx.prisma.user.count()).toBe(1);
    });

    it('keeps exactly one account under concurrent duplicate registrations', async () => {
      const email = uniqueEmail('race');
      const results = await Promise.all(Array.from({ length: 6 }, () => api.register({ email })));
      expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202, 202]);
      expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
      expect(await ctx.prisma.session.count()).toBe(0);
    });

    it.each([
      ['short password', { password: 'short' }],
      ['common password', { password: 'Password123' }],
      ['overlong password', { password: 'x'.repeat(129) }],
      ['invalid email', { email: 'not-an-email' }],
      ['empty name', { name: '   ' }],
      ['control characters in name', { name: 'Ada\u0000' }],
      [
        'password equal to email',
        { email: 'same-as-password@example.test', password: 'same-as-password@example.test' },
      ],
    ])('rejects %s with field-level errors and no echoed input', async (_label, override) => {
      const res = await api.register(override).expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.issues.length).toBeGreaterThan(0);
      for (const issue of res.body.issues) expect(typeof issue.path).toBe('string');
      expect(JSON.stringify(res.body)).not.toContain(String(Object.values(override)[0]));
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('rejects unknown fields, so a client cannot choose its own role', async () => {
      const res = await api
        .post('/auth/register', {
          email: uniqueEmail(),
          name: 'Mallory',
          password: STRONG_PASSWORD,
          role: 'ADMIN',
        })
        .expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('rejects bodies over the size limit with 413', async () => {
      await api
        .post('/auth/register', {
          email: uniqueEmail(),
          name: 'x'.repeat(40_000),
          password: STRONG_PASSWORD,
        })
        .expect(413);
    });

    it('rejects non-JSON content types', async () => {
      await ctx.app.getHttpServer().constructor; // keep reference to avoid unused-var lint in some setups
      const supertest = (await import('supertest')).default;
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({ email: uniqueEmail(), name: 'x', password: STRONG_PASSWORD }))
        .expect(400);
    });

    it('rate-limits registrations per IP (11th within an hour is 429)', async () => {
      for (let i = 0; i < 10; i++) await api.register().expect(202);
      const res = await api.register().expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('login', () => {
    const email = 'login-user@example.test';
    beforeEach(async () => {
      await api.register({ email }).expect(202);
    });

    it('signs in with the right password', async () => {
      const res = await api.login(email, STRONG_PASSWORD).expect(200);
      expect(res.body.user.email).toBe(email);
      const token = sessionTokenFrom(res)!;
      const me = await api.me(token).expect(200);
      expect(me.body.user.email).toBe(email);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.login.success' } })).toBe(1);
    });

    it('treats email case/whitespace-insensitively', async () => {
      await api.login('  LOGIN-USER@Example.test ', STRONG_PASSWORD).expect(200);
    });

    it('gives an identical 401 for a wrong password and an unknown account', async () => {
      const wrong = await api.login(email, 'wrong-password-123').expect(401);
      const unknown = await api.login('nobody@example.test', 'wrong-password-123').expect(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(setCookieLine(wrong)).toBe('');
    });

    it('records failures in the audit log without secrets', async () => {
      await api.login(email, 'wrong-password-123').expect(401);
      const rows = await ctx.prisma.auditLog.findMany({ where: { action: 'auth.login.failure' } });
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain('wrong-password-123');
    });

    it('rejects suspended accounts with the same generic 401', async () => {
      await ctx.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });
      const res = await api.login(email, STRONG_PASSWORD).expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rotates the session on login and revokes the previous one', async () => {
      const first = sessionTokenFrom(await api.login(email, STRONG_PASSWORD).expect(200))!;
      const second = sessionTokenFrom(
        await api.login(email, STRONG_PASSWORD, { token: first }).expect(200),
      )!;
      expect(second).not.toBe(first);
      await api.me(first).expect(401);
      await api.me(second).expect(200);
    });

    it('never adopts a client-supplied session token (fixation)', async () => {
      const attackerChosen = 'A'.repeat(43);
      const res = await api.login(email, STRONG_PASSWORD, { token: attackerChosen }).expect(200);
      const issued = sessionTokenFrom(res)!;
      expect(issued).not.toBe(attackerChosen);
      await api.me(attackerChosen).expect(401);
    });

    it('locks out after 5 failures per email+IP, even for the correct password', async () => {
      for (let i = 0; i < 5; i++) await api.login(email, 'wrong-password-123').expect(401);
      const blocked = await api.login(email, STRONG_PASSWORD).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.body.message).toMatch(/too many/i);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.login.blocked' } })).toBe(1);

      await ctx.limiter.reset(); // time passing
      await api.login(email, STRONG_PASSWORD).expect(200);
    });

    it('does not let X-Forwarded-For spoofing bypass the limit when no proxy is trusted', async () => {
      for (let i = 0; i < 5; i++) {
        await api.login(email, 'wrong-password-123', { ip: `203.0.113.${i + 1}` }).expect(401);
      }
      await api.login(email, STRONG_PASSWORD, { ip: '198.51.100.99' }).expect(429);
    });

    it('a successful login clears the failure counter for that email+IP', async () => {
      for (let i = 0; i < 4; i++) await api.login(email, 'wrong-password-123').expect(401);
      await api.login(email, STRONG_PASSWORD).expect(200);
      for (let i = 0; i < 4; i++) await api.login(email, 'wrong-password-123').expect(401);
    });
  });

  describe('sessions and protected routes', () => {
    let token: string;
    let userId: string;
    beforeEach(async () => {
      const signedUp = await signUp(api, { email: 'sess@example.test' });
      token = signedUp.token;
      userId = signedUp.id;
    });

    it('rejects unauthenticated requests to protected routes', async () => {
      const res = await api.get('/auth/me').expect(401);
      expect(res.body.message).toBe('Authentication required');
    });

    it.each([
      ['a random well-formed token', 'B'.repeat(43)],
      ['a malformed token', 'not-a-token'],
      ['an empty cookie', ''],
    ])('rejects %s', async (_label, bad) => {
      await api.me(bad || undefined).expect(401);
      if (bad === '') {
        await api.get('/auth/me', { token: undefined }).set('Cookie', 'qyou_session=').expect(401);
      }
    });

    it('rejects a tampered token', async () => {
      const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
      await api.me(tampered).expect(401);
    });

    it('rejects an expired session (absolute expiry)', async () => {
      await ctx.prisma.session.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await api.me(token).expect(401);
    });

    it('rejects an idle session (not seen for over 7 days)', async () => {
      await ctx.prisma.session.updateMany({
        where: { userId },
        data: { lastSeenAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      });
      await api.me(token).expect(401);
    });

    it('rejects sessions of a suspended user immediately', async () => {
      await api.me(token).expect(200);
      await ctx.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
      await api.me(token).expect(401);
    });

    it('refreshes lastSeenAt at most every few minutes', async () => {
      const stale = new Date(Date.now() - 10 * 60 * 1000);
      await ctx.prisma.session.updateMany({ where: { userId }, data: { lastSeenAt: stale } });
      await api.me(token).expect(200);
      const touched = await ctx.prisma.session.findFirstOrThrow({ where: { userId } });
      expect(touched.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime() + 5 * 60 * 1000);

      await api.me(token).expect(200);
      const again = await ctx.prisma.session.findFirstOrThrow({ where: { userId } });
      expect(again.lastSeenAt.getTime()).toBe(touched.lastSeenAt.getTime());
    });

    it('logout revokes the session server-side and clears the cookie', async () => {
      const res = await api.logout(token).expect(204);
      expect(setCookieLine(res)).toMatch(/qyou_session=;/);
      expect(setCookieLine(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
      await api.me(token).expect(401);
      const row = await ctx.prisma.session.findFirstOrThrow({ where: { userId } });
      expect(row.revokedAt).not.toBeNull();
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.logout' } })).toBe(1);
    });

    it('logout is idempotent and works without a session', async () => {
      await api.logout(token).expect(204);
      await api.logout(token).expect(204);
      await api.logout(undefined).expect(204);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.logout' } })).toBe(1);
    });

    it('logging out one session leaves the same user’s other sessions valid', async () => {
      const other = sessionTokenFrom(
        await api.login('sess@example.test', STRONG_PASSWORD).expect(200),
      )!;
      await api.logout(token).expect(204);
      await api.me(other).expect(200);
    });

    it('keeps sessions consistent under concurrent requests and logout', async () => {
      const results = await Promise.all([
        ...Array.from({ length: 8 }, () => api.me(token)),
        api.logout(token),
        ...Array.from({ length: 8 }, () => api.me(token)),
      ]);
      for (const r of results) expect([200, 204, 401]).toContain(r.status);
      await api.me(token).expect(401);
    });
  });

  describe('CSRF protection', () => {
    it('blocks state-changing requests from a foreign Origin, even without a session', async () => {
      await api
        .login('x@example.test', 'whatever-123', { origin: 'https://evil.example' })
        .expect(403);
      await api.register({}, { origin: 'https://evil.example' }).expect(403);
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('blocks Origin: null', async () => {
      await api.register({}, { origin: 'null' }).expect(403);
    });

    it('blocks cookie-authenticated unsafe requests with no Origin header', async () => {
      const token = (await signUp(api)).token;
      await api.logout(token, { origin: null }).expect(403);
      await api.me(token).expect(200); // still signed in
    });

    it('blocks cookie-authenticated unsafe requests from a foreign Origin', async () => {
      const token = (await signUp(api)).token;
      await api.logout(token, { origin: 'https://evil.example' }).expect(403);
      await api.me(token).expect(200);
    });

    it('allows cookie-authenticated requests from the allowed Origin', async () => {
      const token = (await signUp(api)).token;
      await api.logout(token, { origin: ALLOWED_ORIGIN }).expect(204);
    });

    it('does not restrict safe methods', async () => {
      const token = (await signUp(api)).token;
      await api.me(token, { origin: 'https://evil.example' }).expect(200);
    });
  });

  it('exposes the auth endpoints in the OpenAPI document with cookie auth', async () => {
    const res = await api.raw().get('/docs/openapi.json').expect(200);
    for (const path of [
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/auth/password-reset/request',
      '/api/v1/auth/password-reset/confirm',
    ]) {
      expect(res.body.paths[path]).toBeDefined();
    }
    expect(res.body.paths['/api/v1/auth/register'].post.requestBody).toBeDefined();
    expect(PASSWORD_RESET_TTL_MS).toBe(30 * 60 * 1000);
  });
});
