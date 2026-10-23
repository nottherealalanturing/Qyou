import { Logger } from '@nestjs/common';
import {
  STRONG_PASSWORD,
  client,
  createTestApp,
  resetDatabase,
  sessionTokenFrom,
  type TestContext,
} from './support/test-app.js';

/** Collects everything written to stdout/stderr (where Nest logs) while a block runs. */
function captureOutput() {
  const chunks: string[] = [];
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return {
    text: () => chunks.join(''),
    stop: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

describe('Auth: secrets never leak (e2e, real PostgreSQL)', () => {
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
    ctx.mail.sent.length = 0;
  });

  it('writes no passwords, session tokens or reset tokens to the logs across every flow', async () => {
    const email = 'logs@example.test';
    const newPassword = 'logs-new-passphrase-9917';
    const output = captureOutput();
    try {
      const reg = await api.register({ email, name: 'Log Check' }).expect(201);
      const session = sessionTokenFrom(reg)!;
      await api.login(email, 'wrong-password-LOGSECRET').expect(401);
      await api.login(email, STRONG_PASSWORD, { token: session }).expect(200);
      await api.post('/auth/password-reset/request', { email }).expect(202);
      await vi.waitFor(() => expect(ctx.mail.sent).toHaveLength(1));
      const resetToken = /#token=([\w-]{43})/.exec(ctx.mail.sent[0]!.text)![1]!;
      await api
        .post('/auth/password-reset/confirm', { token: resetToken, password: newPassword })
        .expect(200);
      await api.logout(session).expect(204);

      const logs = output.text();
      for (const secret of [
        STRONG_PASSWORD,
        'wrong-password-LOGSECRET',
        newPassword,
        session,
        resetToken,
        '$argon2id',
      ]) {
        expect(logs, `log output must not contain ${secret.slice(0, 6)}…`).not.toContain(secret);
      }
    } finally {
      output.stop();
    }
  });

  it('returns a generic 500 and logs no internals when an unexpected error occurs', async () => {
    const leak = 'INSERT INTO users passwordHash=$argon2id$leaked-secret email=victim@example.test';
    const spy = vi.spyOn(ctx.prisma, '$transaction').mockRejectedValueOnce(new Error(leak));
    const output = captureOutput();
    try {
      const res = await api.register({ email: 'boom@example.test' }).expect(500);
      expect(res.body.message).toBe('Something went wrong. Please try again.');
      expect(JSON.stringify(res.body)).not.toContain('argon2id');
      expect(output.text()).not.toContain('leaked-secret');
      expect(output.text()).not.toContain('victim@example.test');
    } finally {
      output.stop();
      spy.mockRestore();
    }
  });

  it('never includes the password hash in any user-facing response', async () => {
    const email = 'shape@example.test';
    const reg = await api.register({ email }).expect(201);
    const token = sessionTokenFrom(reg)!;
    const login = await api.login(email, STRONG_PASSWORD).expect(200);
    const me = await api.me(token).expect(200);
    for (const body of [reg.body, login.body, me.body]) {
      expect(Object.keys(body.user).toSorted()).toEqual([
        'createdAt',
        'email',
        'id',
        'name',
        'role',
      ]);
    }
  });

  it('keeps Logger usage from emitting request bodies on validation failures', async () => {
    const spy = vi.spyOn(Logger.prototype, 'warn');
    await api.register({ email: 'not-an-email', password: 'hunter2-secret-LEAKCHECK' }).expect(400);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('LEAKCHECK');
    spy.mockRestore();
  });
});
