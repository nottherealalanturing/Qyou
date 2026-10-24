import { Logger } from '@nestjs/common';
import { hashPhoneCode } from '../src/assistants/phone-code.js';
import { PhoneVerificationService } from '../src/assistants/phone-verification.service.js';
import { SmsService } from '../src/assistants/sms/sms.service.js';
import { UnconfiguredSmsService } from '../src/assistants/sms/unconfigured-sms.service.js';
import {
  completeProfile,
  makeCatalog,
  requestPhoneCode,
  startApplication,
  uniquePhone,
  type Applicant,
  type Catalog,
} from './support/assistants.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
} from './support/test-app.js';

const as = (u: { token: string }) => ({ token: u.token });
const PEPPER = 'e2e-only-pepper-0123456789abcdef0123456789';

describe('Assistants: phone verification (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let catalog: Catalog;
  let a: Applicant;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
    await ctx.limiter.reset();
    ctx.mail.sent.length = 0;
    catalog = await makeCatalog();
    a = await startApplication(api);
    await completeProfile(api, a, catalog);
  });

  const verify = (code: string, user = a.user) =>
    api.post('/assistants/me/phone/verify', { code }, as(user));
  const wrongCodeFor = (right: string) => (right === '000000' ? '000001' : '000000');

  describe('requesting a code', () => {
    it('sends a code through the SIMULATED transport (clearly labelled, never claiming a real SMS)', async () => {
      const res = await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(200);
      expect(res.body).toMatchObject({
        status: 'sent',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
        transport: 'simulated-dev',
      });
      const sms = ctx.mail.sent.find((m) => /SIMULATED SMS/.test(m.subject))!;
      expect(sms.subject).toContain('not sent to any phone');
      expect(sms.text).toMatch(/nothing was sent to a phone/);
      expect(sms.text).toMatch(/code is \d{6}/);
      expect(sms.to).toBe(`sms+${a.phone.replace(/^0/, '234')}@sms.qyou.local`);
    });

    it('stores only an HMAC of the code (bound to token and number), never the code', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      const row = await ctx.prisma.phoneVerificationToken.findFirstOrThrow({
        where: { profileId: a.profileId },
      });
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(code);
      expect(row.codeHash).toBe(hashPhoneCode(PEPPER, row.id, row.phoneE164, code));
      expect(row.attempts).toBe(0);
      const ttl = row.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60_000);
      expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    });

    it('never logs the code or the number', async () => {
      const chunks: string[] = [];
      const out = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((c: unknown) => (chunks.push(String(c)), true));
      const err = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((c: unknown) => (chunks.push(String(c)), true));
      try {
        const code = await requestPhoneCode(ctx, api, a);
        await verify(wrongCodeFor(code)).expect(400);
        await verify(code).expect(200);
        const logs = chunks.join('');
        expect(logs).not.toContain(code);
        expect(logs).not.toContain(a.phone.slice(-7));
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
    });

    it('audits the request without the code or the full number', async () => {
      await requestPhoneCode(ctx, api, a);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'assistant.phone.code_requested' },
      });
      expect(audit.metadata).toEqual({ transport: 'simulated-dev', last4: a.phone.slice(-4) });
      expect(JSON.stringify(audit)).not.toMatch(/\+234\d{10}/);
    });

    it('needs a verified email, an application and a number', async () => {
      const unverified = await createUser(api, { verified: false });
      expect(
        (await api.post('/assistants/me/phone/code', {}, as(unverified)).expect(403)).body.code,
      ).toBe('EMAIL_NOT_VERIFIED');
      const noApp = await createUser(api, { verified: true });
      await api.post('/assistants/me/phone/code', {}, as(noApp)).expect(400);
      const noPhone = await startApplication(api);
      expect(
        (await api.post('/assistants/me/phone/code', {}, as(noPhone.user)).expect(400)).body
          .issues[0].path,
      ).toBe('phone');
      await api.post('/assistants/me/phone/code', {}, { origin: null }).expect(401);
      await api
        .post(
          '/assistants/me/phone/code',
          {},
          { token: a.user.token, origin: 'https://evil.example' },
        )
        .expect(403);
    });

    it('a newer code invalidates the previous one', async () => {
      const first = await requestPhoneCode(ctx, api, a);
      await ctx.limiter.reset(); // skip the 60 s cooldown for this test
      const second = await requestPhoneCode(ctx, api, a);
      if (first !== second) await verify(first).expect(400);
      await verify(second).expect(200);
    });

    it('is idempotent once the number is verified (no new code, no email)', async () => {
      await verify(await requestPhoneCode(ctx, api, a)).expect(200);
      ctx.mail.sent.length = 0;
      expect(
        (await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(200)).body,
      ).toEqual({ status: 'already_verified' });
      expect(ctx.mail.sent).toHaveLength(0);
    });
  });

  describe('provider availability (fail closed)', () => {
    it('answers 503 and creates NO code when no SMS provider is configured', async () => {
      const service = ctx.app.get(PhoneVerificationService);
      const unconfigured = new UnconfiguredSmsService();
      (service as unknown as { sms: SmsService }).sms = unconfigured;
      try {
        const res = await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(503);
        expect(res.body.message).toMatch(/not available yet/);
        expect(await ctx.prisma.phoneVerificationToken.count()).toBe(0);
        expect(ctx.mail.sent.filter((m) => /SIMULATED/.test(m.subject))).toHaveLength(0);
        expect(
          await ctx.prisma.auditLog.count({ where: { action: 'assistant.phone.code_requested' } }),
        ).toBe(0);
      } finally {
        (service as unknown as { sms: SmsService }).sms = ctx.app.get(SmsService);
      }
    });

    it('discards the code when delivery itself fails, so "sent" never describes an unsent message', async () => {
      const sms = ctx.app.get(SmsService);
      const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const spy = vi.spyOn(sms, 'send').mockRejectedValueOnce(new Error('provider down'));
      const res = await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(503);
      spy.mockRestore();
      quiet.mockRestore();
      expect(res.body.message).toMatch(/could not send/i);
      expect(JSON.stringify(res.body)).not.toContain('provider down');
      expect(await ctx.prisma.phoneVerificationToken.count()).toBe(0);
    });
  });

  describe('verifying a code', () => {
    it('verifies the number, marks it, and audits it', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      expect((await verify(code).expect(200)).body).toEqual({ status: 'verified' });
      const priv = await ctx.prisma.assistantPrivateDetails.findUniqueOrThrow({
        where: { profileId: a.profileId },
      });
      expect(priv.phoneVerifiedAt).not.toBeNull();
      expect((await api.get('/assistants/me', as(a.user))).body.private.phoneVerified).toBe(true);
      expect(
        (
          await ctx.prisma.auditLog.findFirstOrThrow({
            where: { action: 'assistant.phone.verified' },
          })
        ).metadata,
      ).toEqual({ last4: a.phone.slice(-4) });
    });

    it('rejects a wrong code with a field error that does not reveal the right one', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      const res = await verify(wrongCodeFor(code)).expect(400);
      expect(res.body.issues).toEqual([
        { path: 'code', message: 'That code is incorrect or has expired' },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(code);
      expect(
        (
          await ctx.prisma.phoneVerificationToken.findFirstOrThrow({
            where: { profileId: a.profileId },
          })
        ).attempts,
      ).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'assistant.phone.verification_failed' },
        }),
      ).toBe(1);
    });

    it('rejects malformed codes at validation without touching the token', async () => {
      await requestPhoneCode(ctx, api, a);
      for (const code of ['12345', '1234567', 'abcdef', '12 456', '', ' 123456'])
        await verify(code).expect(400);
      await api
        .post('/assistants/me/phone/verify', { code: '123456', extra: 1 }, as(a.user))
        .expect(400);
      expect(
        (
          await ctx.prisma.phoneVerificationToken.findFirstOrThrow({
            where: { profileId: a.profileId },
          })
        ).attempts,
      ).toBe(0);
    });

    it('burns the code after 5 wrong attempts — even the right code then fails', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      for (let i = 0; i < 5; i++) await verify(wrongCodeFor(code)).expect(400);
      await verify(code).expect(400);
      expect(
        (
          await ctx.prisma.phoneVerificationToken.findFirstOrThrow({
            where: { profileId: a.profileId },
          })
        ).attempts,
      ).toBe(5);
      expect(
        (
          await ctx.prisma.assistantPrivateDetails.findUniqueOrThrow({
            where: { profileId: a.profileId },
          })
        ).phoneVerifiedAt,
      ).toBeNull();
    });

    it('cannot be brute-forced in parallel: concurrent guesses never exceed the attempt cap', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      const guesses = Array.from({ length: 12 }, (_, i) => String(i).padStart(6, '0')).filter(
        (g) => g !== code,
      );
      await Promise.all(guesses.map((g) => verify(g)));
      expect(
        (
          await ctx.prisma.phoneVerificationToken.findFirstOrThrow({
            where: { profileId: a.profileId },
          })
        ).attempts,
      ).toBeLessThanOrEqual(5);
    });

    it('rejects an expired code even if it is correct', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      await ownerPrisma().phoneVerificationToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await verify(code).expect(400);
      expect(
        (
          await ctx.prisma.assistantPrivateDetails.findUniqueOrThrow({
            where: { profileId: a.profileId },
          })
        ).phoneVerifiedAt,
      ).toBeNull();
    });

    it('a code is single-use: replaying it after success is harmless', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      await verify(code).expect(200);
      expect((await verify(code).expect(200)).body).toEqual({ status: 'already_verified' });
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'assistant.phone.verified' } }),
      ).toBe(1);
    });

    it('lets exactly one of many concurrent correct submissions perform the verification', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      const results = await Promise.all(Array.from({ length: 6 }, () => verify(code)));
      for (const r of results) expect([200, 400]).toContain(r.status);
      expect(results.filter((r) => r.status === 200 && r.body.status === 'verified')).toHaveLength(
        1,
      );
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'assistant.phone.verified' } }),
      ).toBe(1);
    });

    it('cannot use a code sent to a PREVIOUS number to verify a new one', async () => {
      const code = await requestPhoneCode(ctx, api, a);
      await api.put('/assistants/me/private', { phone: uniquePhone() }, as(a.user)).expect(200);
      await verify(code).expect(400);
      expect(
        (
          await ctx.prisma.assistantPrivateDetails.findUniqueOrThrow({
            where: { profileId: a.profileId },
          })
        ).phoneVerifiedAt,
      ).toBeNull();
    });

    it('changing the number clears verification until the new number is verified', async () => {
      await verify(await requestPhoneCode(ctx, api, a)).expect(200);
      const fresh = uniquePhone();
      const res = await api.put('/assistants/me/private', { phone: fresh }, as(a.user)).expect(200);
      expect(res.body.private).toMatchObject({ phoneVerified: false });
      await ctx.limiter.reset();
      await verify(await requestPhoneCode(ctx, api, a)).expect(200);
    });

    it('refuses a number already verified by another assistant, without saying whose', async () => {
      const other = await startApplication(api, 'Other Person');
      await completeProfile(api, other, catalog);
      await verify(await requestPhoneCode(ctx, api, other), other.user).expect(200);

      await api.put('/assistants/me/private', { phone: other.phone }, as(a.user)).expect(200); // unverified duplicates are allowed
      await ctx.limiter.reset();
      const code = await requestPhoneCode(ctx, api, a);
      const res = await verify(code).expect(409);
      expect(res.body.message).toBe('This number cannot be used for verification');
      expect(JSON.stringify(res.body)).not.toMatch(/Other Person/);
      expect(
        (
          await ctx.prisma.assistantPrivateDetails.findUniqueOrThrow({
            where: { profileId: a.profileId },
          })
        ).phoneVerifiedAt,
      ).toBeNull();
    });

    it('is unavailable to rejected and suspended applications', async () => {
      for (const status of ['REJECTED', 'SUSPENDED'] as const) {
        await ownerPrisma().assistantProfile.update({
          where: { id: a.profileId },
          data: { status },
        });
        await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(409);
        await verify('123456').expect(409);
      }
    });
  });

  describe('rate limiting', () => {
    it('enforces a 60-second cooldown between codes (429 with Retry-After)', async () => {
      await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(200);
      const res = await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(await ctx.prisma.phoneVerificationToken.count({ where: { usedAt: null } })).toBe(1);
    });

    it('caps codes per number (3/hour), so Qyou cannot be used to spam a phone', async () => {
      const e164 = `+234${a.phone.slice(1)}`;
      for (let i = 0; i < 3; i++)
        expect((await ctx.limiter.hit(`phone-code-number:${e164}`, 3, 3_600_000)).allowed).toBe(
          true,
        );
      const res = await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(429);
      expect(res.body.message).toMatch(/too many/i);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(await ctx.prisma.phoneVerificationToken.count()).toBe(0);
      expect(ctx.mail.sent.filter((m) => /SIMULATED/.test(m.subject))).toHaveLength(0);
    });

    it('caps codes per user (5/hour)', async () => {
      for (let i = 0; i < 5; i++)
        expect((await ctx.limiter.hit(`phone-code-user:${a.user.id}`, 5, 3_600_000)).allowed).toBe(
          true,
        );
      await api.post('/assistants/me/phone/code', {}, as(a.user)).expect(429);
      expect(await ctx.prisma.phoneVerificationToken.count()).toBe(0);
    });

    it('the per-number cap protects the NUMBER, whoever asks', async () => {
      const other = await startApplication(api, 'Other Person');
      await completeProfile(api, other, catalog, { phone: a.phone });
      const e164 = `+234${a.phone.slice(1)}`;
      for (let i = 0; i < 3; i++) await ctx.limiter.hit(`phone-code-number:${e164}`, 3, 3_600_000);
      await api.post('/assistants/me/phone/code', {}, as(other.user)).expect(429);
    });

    it('caps verification attempts per user (429 after 10 in 15 minutes), across codes', async () => {
      await requestPhoneCode(ctx, api, a);
      let throttled = 0;
      for (let i = 0; i < 12; i++) {
        const res = await verify('123456');
        if (res.status === 429) throttled += 1;
        else expect(res.status).toBe(400);
      }
      expect(throttled).toBeGreaterThanOrEqual(1);
    });
  });
});
