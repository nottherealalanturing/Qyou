import {
  STRONG_PASSWORD,
  client,
  createTestApp,
  createUser,
  resetDatabase,
  sessionTokenFrom,
  setCookieLine,
  type TestContext,
} from './support/test-app.js';

const NEW_PASSWORD = 'a-brand-new-passphrase-42';

describe('Account security: change password & log out everywhere (e2e, real PostgreSQL)', () => {
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
  });

  const change = (
    token: string | undefined,
    currentPassword: string,
    newPassword: string,
    opts = {},
  ) => api.post('/auth/password/change', { currentPassword, newPassword }, { token, ...opts });

  describe('change password', () => {
    it('changes the password, rotates the current session and revokes every other one', async () => {
      const user = await createUser(api);
      const phone = sessionTokenFrom(await api.login(user.email, user.password).expect(200))!;
      const laptop = sessionTokenFrom(await api.login(user.email, user.password).expect(200))!;

      const res = await change(user.token, user.password, NEW_PASSWORD).expect(200);
      const rotated = sessionTokenFrom(res)!;

      // Current device stays signed in, with a NEW token; the old token and all others are dead.
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(user.token);
      expect(setCookieLine(res)).toMatch(/HttpOnly/i);
      await api.me(rotated).expect(200);
      await api.me(user.token).expect(401);
      await api.me(phone).expect(401);
      await api.me(laptop).expect(401);

      // Subsequent requests keep enforcing it.
      await api.get('/auth/sessions', { token: phone }).expect(401);

      // Credentials actually changed.
      await api.login(user.email, user.password).expect(401);
      await api.login(user.email, NEW_PASSWORD).expect(200);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.password_changed' },
      });
      expect(audit.actorUserId).toBe(user.id);
      expect(audit.metadata).toEqual({ sessionsRevoked: 3 });
      expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
    });

    it('does not touch other users’ sessions', async () => {
      const user = await createUser(api);
      const bystander = await createUser(api);
      await change(user.token, user.password, NEW_PASSWORD).expect(200);
      await api.me(bystander.token).expect(200);
    });

    it('rejects a wrong current password with a field error and changes nothing', async () => {
      const user = await createUser(api);
      const res = await change(user.token, 'definitely-wrong-123', NEW_PASSWORD).expect(400);
      expect(res.body.issues).toEqual([
        { path: 'currentPassword', message: 'Your current password is incorrect' },
      ]);
      await api.me(user.token).expect(200); // session intact (a 400, not a 401)
      await api.login(user.email, user.password).expect(200);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'auth.password_change.failure' } }),
      ).toBe(1);
    });

    it('locks further attempts after 5 wrong current passwords, even with the right one', async () => {
      const user = await createUser(api);
      for (let i = 0; i < 5; i++)
        await change(user.token, `wrong-password-${i}-x`, NEW_PASSWORD).expect(400);
      const blocked = await change(user.token, user.password, NEW_PASSWORD).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await api.login(user.email, user.password).expect(200); // password unchanged
    });

    it('rejects reusing the current password and weak new passwords', async () => {
      const user = await createUser(api);
      const same = await change(user.token, user.password, user.password).expect(400);
      expect(same.body.issues[0].path).toBe('newPassword');
      await change(user.token, user.password, 'short').expect(400);
      await change(user.token, user.password, 'Password123').expect(400);
      await api.login(user.email, user.password).expect(200);
    });

    it('requires authentication and blocks cross-origin requests', async () => {
      const user = await createUser(api);
      await change(undefined, user.password, NEW_PASSWORD).expect(401);
      await change(user.token, user.password, NEW_PASSWORD, {
        origin: 'https://evil.example',
      }).expect(403);
      await api.login(user.email, user.password).expect(200);
    });

    it('lets exactly one of many concurrent changes win and keeps the winner’s password', async () => {
      const user = await createUser(api);
      const candidates = Array.from({ length: 5 }, (_, i) => `concurrent-passphrase-${i}-ok`);
      const results = await Promise.all(
        candidates.map((p) => change(user.token, user.password, p)),
      );
      const winners = results.filter((r) => r.status === 200);
      expect(winners).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200))
        expect([400, 409]).toContain(r.status);
      const winner = candidates[results.findIndex((r) => r.status === 200)]!;
      await api.login(user.email, winner).expect(200);
      for (const p of candidates.filter((c) => c !== winner))
        await api.login(user.email, p).expect(401);
    });

    it('does not weaken the existing password-reset flow (regression)', async () => {
      const user = await createUser(api);
      await change(user.token, user.password, NEW_PASSWORD).expect(200);
      await api.post('/auth/password-reset/request', { email: user.email }).expect(202);
      await vi.waitFor(() =>
        expect(ctx.mail.sent.some((m) => /reset/i.test(m.subject))).toBe(true),
      );
    });
  });

  describe('log out everywhere', () => {
    it('revokes every session including the current one, and keeps enforcing it', async () => {
      const user = await createUser(api);
      const a = sessionTokenFrom(await api.login(user.email, user.password).expect(200))!;
      const b = sessionTokenFrom(await api.login(user.email, user.password).expect(200))!;

      const res = await api.post('/auth/logout-all', {}, { token: a }).expect(204);
      expect(setCookieLine(res)).toMatch(/qyou_session=;/);

      for (const token of [user.token, a, b]) {
        await api.me(token).expect(401);
        await api.get('/auth/sessions', { token }).expect(401);
      }
      const rows = await ctx.prisma.session.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(3);
      expect(rows.every((s) => s.revokedAt !== null)).toBe(true);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.logout_all' },
      });
      expect(audit.metadata).toEqual({ sessionsRevoked: 3 });

      await api.login(user.email, user.password).expect(200); // account itself is fine
    });

    it('does not affect other users', async () => {
      const user = await createUser(api);
      const other = await createUser(api);
      await api.post('/auth/logout-all', {}, { token: user.token }).expect(204);
      await api.me(other.token).expect(200);
    });

    it('requires authentication, is not repeatable with a dead session, and is CSRF-protected', async () => {
      const user = await createUser(api);
      await api.post('/auth/logout-all', {}).expect(401);
      await api
        .post('/auth/logout-all', {}, { token: user.token, origin: 'https://evil.example' })
        .expect(403);
      await api.me(user.token).expect(200);
      await api.post('/auth/logout-all', {}, { token: user.token }).expect(204);
      await api.post('/auth/logout-all', {}, { token: user.token }).expect(401);
    });
  });

  void STRONG_PASSWORD;
});
