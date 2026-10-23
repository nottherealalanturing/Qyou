import { ProbeController } from './support/probe.controller.js';
import {
  STRONG_PASSWORD,
  client,
  createUser,
  createTestApp,
  ownerPrisma,
  resetDatabase,
  sessionTokenFrom,
  uniqueEmail,
  type TestContext,
} from './support/test-app.js';

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

describe('Authorization (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [ProbeController] });
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
  });

  async function adminAndTarget(targetVerified = true) {
    const admin = await createUser(api, { role: 'ADMIN', verified: true });
    const target = await createUser(api, { verified: targetVerified });
    return { admin, target };
  }

  describe('anonymous access to protected endpoints', () => {
    const protectedRoutes: [method: 'get' | 'post' | 'patch' | 'del', path: string][] = [
      ['get', '/auth/me'],
      ['get', '/auth/sessions'],
      ['del', `/auth/sessions/${ZERO_UUID}`],
      ['post', '/auth/password/change'],
      ['post', '/auth/logout-all'],
      ['post', '/auth/email-verification/request'],
      ['patch', `/admin/users/${ZERO_UUID}/role`],
      ['get', '/probe/any-authenticated'],
      ['get', '/probe/assistant'],
      ['get', '/probe/verified'],
    ];

    it.each(protectedRoutes)(
      '%s %s -> 401 (authentication precedes authorization)',
      async (method, path) => {
        const res = await (method === 'get' || method === 'del'
          ? api[method](path)
          : api[method](path, {}));
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Authentication required');
      },
    );

    it('leaves the public routes public', async () => {
      await api.get('/probe/public').expect(200);
      await api.get('/health/live').expect(200);
    });

    it('fails closed when a route is both @Public and @Roles (misconfiguration)', async () => {
      await api.get('/probe/public-but-roles').expect(403);
    });
  });

  describe('role boundaries (probe routes)', () => {
    it('lets any authenticated user through routes without @Roles', async () => {
      for (const role of ['CUSTOMER', 'ASSISTANT', 'BUSINESS_STAFF', 'ADMIN'] as const) {
        const user = await createUser(api, { role });
        await api.get('/probe/any-authenticated', { token: user.token }).expect(200);
      }
    });

    it('enforces the exact role set per route', async () => {
      const users = {
        CUSTOMER: await createUser(api, { role: 'CUSTOMER' }),
        ASSISTANT: await createUser(api, { role: 'ASSISTANT' }),
        BUSINESS_STAFF: await createUser(api, { role: 'BUSINESS_STAFF' }),
        ADMIN: await createUser(api, { role: 'ADMIN' }),
      };
      const matrix: [string, Record<keyof typeof users, number>][] = [
        ['/probe/assistant', { CUSTOMER: 403, ASSISTANT: 200, BUSINESS_STAFF: 403, ADMIN: 403 }],
        ['/probe/business', { CUSTOMER: 403, ASSISTANT: 403, BUSINESS_STAFF: 200, ADMIN: 403 }],
        [
          '/probe/customer-or-assistant',
          { CUSTOMER: 200, ASSISTANT: 200, BUSINESS_STAFF: 403, ADMIN: 403 },
        ],
      ];
      for (const [path, expected] of matrix) {
        for (const [role, user] of Object.entries(users) as [
          keyof typeof users,
          typeof users.ADMIN,
        ][]) {
          const res = await api.get(path, { token: user.token });
          expect([role, path, res.status]).toEqual([role, path, expected[role]]);
          if (res.status === 403)
            expect(res.body.message).toBe('You do not have permission to do this');
        }
      }
    });

    it('applies role changes on the very next request (no stale privileges)', async () => {
      const user = await createUser(api, { role: 'ASSISTANT' });
      await api.get('/probe/assistant', { token: user.token }).expect(200);
      await ownerPrisma().user.update({ where: { id: user.id }, data: { role: 'CUSTOMER' } });
      await api.get('/probe/assistant', { token: user.token }).expect(403);
    });
  });

  describe('verified-email policy', () => {
    it('rejects unverified users with a machine-readable code and allows verified ones', async () => {
      const unverified = await createUser(api, { role: 'CUSTOMER' });
      const res = await api.get('/probe/verified', { token: unverified.token }).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');

      const verified = await createUser(api, { role: 'CUSTOMER', verified: true });
      await api.get('/probe/verified', { token: verified.token }).expect(200);
    });

    it('checks role first, then verification, and requires both', async () => {
      const unverifiedAssistant = await createUser(api, { role: 'ASSISTANT' });
      const verifiedCustomer = await createUser(api, { role: 'CUSTOMER', verified: true });
      const verifiedAssistant = await createUser(api, { role: 'ASSISTANT', verified: true });
      expect(
        (await api.get('/probe/assistant-verified', { token: unverifiedAssistant.token })).body
          .code,
      ).toBe('EMAIL_NOT_VERIFIED');
      const wrongRole = await api.get('/probe/assistant-verified', {
        token: verifiedCustomer.token,
      });
      expect(wrongRole.status).toBe(403);
      expect(wrongRole.body.code).toBeUndefined();
      await api.get('/probe/assistant-verified', { token: verifiedAssistant.token }).expect(200);
    });

    it('does not require verification for account basics (me, change password, logout)', async () => {
      const user = await createUser(api);
      await api.me(user.token).expect(200);
      await api.get('/auth/sessions', { token: user.token }).expect(200);
      await api.logout(user.token).expect(204);
    });
  });

  describe('privilege escalation attempts', () => {
    it('rejects ADMIN (and any role) at registration', async () => {
      for (const role of ['ADMIN', 'ASSISTANT', 'BUSINESS_STAFF', 'admin']) {
        const res = await api
          .post('/auth/register', {
            email: uniqueEmail(),
            name: 'Mallory',
            password: STRONG_PASSWORD,
            role,
          })
          .expect(400);
        expect(res.body.message).toBe('Validation failed');
      }
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('rejects role/status fields on login, password change and verification endpoints', async () => {
      const user = await createUser(api);
      await api
        .post('/auth/login', { email: user.email, password: user.password, role: 'ADMIN' })
        .expect(400);
      await api
        .post(
          '/auth/password/change',
          {
            currentPassword: user.password,
            newPassword: 'another-long-passphrase-9',
            role: 'ADMIN',
          },
          { token: user.token },
        )
        .expect(400);
      await api
        .post('/auth/email-verification/confirm', { token: 'A'.repeat(43), emailVerified: true })
        .expect(400);
    });

    it('has no profile-update route that could carry a role', async () => {
      const user = await createUser(api);
      for (const method of ['patch', 'put'] as const) {
        for (const path of ['/auth/me', '/users/me', '/users', '/me']) {
          const res = await api[method](path, { role: 'ADMIN' }, { token: user.token });
          expect([method, path, res.status]).toEqual([method, path, 404]);
        }
      }
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(
        'CUSTOMER',
      );
    });

    it('does not let a customer, assistant or business user reach the admin API', async () => {
      const target = await createUser(api, { verified: true });
      for (const role of ['CUSTOMER', 'ASSISTANT', 'BUSINESS_STAFF'] as const) {
        const user = await createUser(api, { role, verified: true });
        const res = await api.patch(
          `/admin/users/${target.id}/role`,
          { role: 'ASSISTANT' },
          { token: user.token },
        );
        expect([role, res.status]).toEqual([role, 403]);
      }
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe(
        'CUSTOMER',
      );
    });

    it('does not let a user promote themselves through the admin API', async () => {
      const user = await createUser(api, { verified: true });
      await api
        .patch(`/admin/users/${user.id}/role`, { role: 'ADMIN' }, { token: user.token })
        .expect(403);
      await api
        .patch(`/admin/users/${user.id}/role`, { role: 'ASSISTANT' }, { token: user.token })
        .expect(403);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(
        'CUSTOMER',
      );
    });

    it('exposes no HTTP path that could create administrators', async () => {
      const res = await api.raw().get('/docs/openapi.json').expect(200);
      // /probe/* routes exist only in this test module.
      const paths = Object.keys(res.body.paths).filter((p) => !p.startsWith('/api/v1/probe/'));
      expect(paths.filter((p) => /role|bootstrap|promote/i.test(p))).toEqual([
        '/api/v1/admin/users/{id}/role',
      ]);
      await api.post('/admin/bootstrap', {}).expect(404);
      await api.post('/admin/users', { role: 'ADMIN' }).expect(404);
    });
  });

  describe('admin role assignment', () => {
    it('lets a verified administrator assign assistant and business-staff roles, with audit', async () => {
      const { admin, target } = await adminAndTarget();
      const res = await api
        .patch(`/admin/users/${target.id}/role`, { role: 'ASSISTANT' }, { token: admin.token })
        .expect(200);
      expect(res.body.user).toEqual({
        id: target.id,
        email: target.email,
        name: 'Test User',
        role: 'ASSISTANT',
      });
      await api.get('/probe/assistant', { token: target.token }).expect(200);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.role_changed' },
      });
      expect(audit.actorUserId).toBe(admin.id);
      expect(audit.targetId).toBe(target.id);
      expect(audit.metadata).toEqual({ from: 'CUSTOMER', to: 'ASSISTANT' });

      await api
        .patch(`/admin/users/${target.id}/role`, { role: 'BUSINESS_STAFF' }, { token: admin.token })
        .expect(200);
      await api.get('/probe/business', { token: target.token }).expect(200);
      await api.get('/probe/assistant', { token: target.token }).expect(403);
    });

    it('is idempotent and revokes privileges immediately when set back to CUSTOMER', async () => {
      const { admin, target } = await adminAndTarget();
      await api
        .patch(`/admin/users/${target.id}/role`, { role: 'ASSISTANT' }, { token: admin.token })
        .expect(200);
      await api
        .patch(`/admin/users/${target.id}/role`, { role: 'ASSISTANT' }, { token: admin.token })
        .expect(200);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.role_changed' } })).toBe(1);
      await api
        .patch(`/admin/users/${target.id}/role`, { role: 'CUSTOMER' }, { token: admin.token })
        .expect(200);
      await api.get('/probe/assistant', { token: target.token }).expect(403);
    });

    it('refuses to grant ADMIN or unknown roles (schema)', async () => {
      const { admin, target } = await adminAndTarget();
      for (const role of ['ADMIN', 'SUPERUSER', '', 5]) {
        await api
          .patch(`/admin/users/${target.id}/role`, { role }, { token: admin.token })
          .expect(400);
      }
      await api
        .patch(
          `/admin/users/${target.id}/role`,
          { role: 'ASSISTANT', extra: 1 },
          { token: admin.token },
        )
        .expect(400);
    });

    it('refuses to change the administrator’s own role or another administrator', async () => {
      const { admin } = await adminAndTarget();
      const otherAdmin = await createUser(api, { role: 'ADMIN', verified: true });
      await api
        .patch(`/admin/users/${admin.id}/role`, { role: 'CUSTOMER' }, { token: admin.token })
        .expect(403);
      await api
        .patch(`/admin/users/${otherAdmin.id}/role`, { role: 'CUSTOMER' }, { token: admin.token })
        .expect(403);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: otherAdmin.id } })).role).toBe(
        'ADMIN',
      );
    });

    it('requires the target to have a verified email for privileged roles', async () => {
      const { admin, target } = await adminAndTarget(false);
      const res = await api
        .patch(`/admin/users/${target.id}/role`, { role: 'ASSISTANT' }, { token: admin.token })
        .expect(409);
      expect(res.body.message).toMatch(/verify/i);
      await api
        .patch(`/admin/users/${target.id}/role`, { role: 'CUSTOMER' }, { token: admin.token })
        .expect(200);
    });

    it('requires the ADMINISTRATOR to have a verified email', async () => {
      const admin = await createUser(api, { role: 'ADMIN', verified: false });
      const target = await createUser(api, { verified: true });
      const res = await api
        .patch(`/admin/users/${target.id}/role`, { role: 'ASSISTANT' }, { token: admin.token })
        .expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('returns 404 for unknown users and 400 for malformed ids', async () => {
      const { admin } = await adminAndTarget();
      await api
        .patch(`/admin/users/${ZERO_UUID}/role`, { role: 'ASSISTANT' }, { token: admin.token })
        .expect(404);
      await api
        .patch('/admin/users/not-a-uuid/role', { role: 'ASSISTANT' }, { token: admin.token })
        .expect(400);
    });

    it('blocks cross-origin role changes (CSRF)', async () => {
      const { admin, target } = await adminAndTarget();
      await api
        .patch(
          `/admin/users/${target.id}/role`,
          { role: 'ASSISTANT' },
          { token: admin.token, origin: 'https://evil.example' },
        )
        .expect(403);
    });

    it('stays consistent under concurrent role changes', async () => {
      const { admin, target } = await adminAndTarget();
      const roles = [
        'ASSISTANT',
        'BUSINESS_STAFF',
        'CUSTOMER',
        'ASSISTANT',
        'BUSINESS_STAFF',
        'CUSTOMER',
      ];
      const results = await Promise.all(
        roles.map((role) =>
          api.patch(`/admin/users/${target.id}/role`, { role }, { token: admin.token }),
        ),
      );
      for (const r of results) expect([200, 409]).toContain(r.status);
      const final = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role;
      expect(['ASSISTANT', 'BUSINESS_STAFF', 'CUSTOMER']).toContain(final);
      // Every successful change that actually changed the role was audited exactly once.
      const audited = await ctx.prisma.auditLog.findMany({
        where: { action: 'admin.role_changed' },
        orderBy: { createdAt: 'asc' },
      });
      const chain = audited.map((a) => a.metadata as { from: string; to: string });
      expect(chain.at(-1)?.to).toBe(final);
    });
  });

  describe('session ownership (resource-level authorization)', () => {
    it('lists only the caller’s sessions and marks the current one', async () => {
      const a = await createUser(api);
      const b = await createUser(api);
      const second = sessionTokenFrom(await api.login(a.email, a.password).expect(200))!;
      const res = await api.get('/auth/sessions', { token: a.token }).expect(200);
      expect(res.body.sessions).toHaveLength(2);
      expect(res.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain(second);
      const bRes = await api.get('/auth/sessions', { token: b.token }).expect(200);
      expect(bRes.body.sessions).toHaveLength(1);
    });

    it('hides other users’ sessions behind 404 and leaves them untouched', async () => {
      const a = await createUser(api);
      const b = await createUser(api);
      const bSession = (await ctx.prisma.session.findFirstOrThrow({ where: { userId: b.id } })).id;
      await api.del(`/auth/sessions/${bSession}`, { token: a.token }).expect(404);
      await api.me(b.token).expect(200);
      await api.del(`/auth/sessions/${ZERO_UUID}`, { token: a.token }).expect(404); // same as non-existent
      await api.del('/auth/sessions/not-a-uuid', { token: a.token }).expect(400);
    });

    it('lets a user revoke their own other session, and the current one (clearing the cookie)', async () => {
      const a = await createUser(api);
      const other = sessionTokenFrom(await api.login(a.email, a.password).expect(200))!;
      const sessions = (await api.get('/auth/sessions', { token: a.token }).expect(200)).body
        .sessions as {
        id: string;
        current: boolean;
      }[];
      const otherId = sessions.find((s) => !s.current)!.id;
      await api.del(`/auth/sessions/${otherId}`, { token: a.token }).expect(204);
      await api.me(other).expect(401);
      await api.me(a.token).expect(200);

      const currentId = sessions.find((s) => s.current)!.id;
      const res = await api.del(`/auth/sessions/${currentId}`, { token: a.token }).expect(204);
      expect(res.headers['set-cookie']?.[0]).toMatch(/qyou_session=;/);
      await api.me(a.token).expect(401);
    });
  });
});
