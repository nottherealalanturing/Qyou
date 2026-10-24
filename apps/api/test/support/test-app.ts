import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/app.setup.js';
import { RateLimiter } from '../../src/common/rate-limit/rate-limiter.js';
import { MailService, type MailMessage } from '../../src/mail/mail.service.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export const ALLOWED_ORIGIN = 'http://localhost:3000';
export const COOKIE_NAME = 'qyou_session';
export const STRONG_PASSWORD = 'correct-horse-battery-staple';

/** Captures outgoing mail instead of sending it. */
export class CapturingMailService extends MailService {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  limiter: RateLimiter;
  mail: CapturingMailService;
  close(): Promise<void>;
}

export async function createTestApp(
  options: { controllers?: Type<unknown>[] } = {},
): Promise<TestContext> {
  const mail = new CapturingMailService();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app);
  await app.listen(0, '127.0.0.1'); // one real listener: avoids a socket per request
  return {
    app,
    prisma: app.get(PrismaService),
    limiter: app.get(RateLimiter),
    mail,
    close: () => app.close(),
  };
}

let ownerClient: PrismaClient | undefined;

/** Connection as the table OWNER (not the app's runtime role), for test setup and DB assertions. */
export function ownerPrisma(): PrismaClient {
  const url = process.env.TEST_ADMIN_DATABASE_URL;
  if (!url) throw new Error('TEST_ADMIN_DATABASE_URL is not set');
  ownerClient ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return ownerClient;
}

/**
 * Wipes all data. Refuses to run unless the connected database is clearly a test database.
 * audit_logs is protected by triggers that block TRUNCATE even for the owner, so the owner
 * disables them for the duration of this transaction only (the app's runtime role cannot).
 */
export async function resetDatabase(_prisma?: PrismaService): Promise<void> {
  const owner = ownerPrisma();
  const rows = await owner.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const database = rows[0]?.current_database;
  if (!database?.endsWith('_test')) {
    throw new Error(`Refusing to truncate non-test database "${database}"`);
  }
  await owner.$transaction([
    owner.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE TRIGGER USER'),
    owner.$executeRawUnsafe(
      'TRUNCATE TABLE audit_logs, email_verification_tokens, password_reset_tokens, rate_limit_counters, sessions, location_restrictions, service_locations, eligible_tasks, service_categories, cities, users RESTART IDENTITY CASCADE',
    ),
    owner.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE TRIGGER USER'),
  ]);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${counter}-${Date.now()}@example.test`;
}

export function sessionTokenFrom(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const line = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const value = line?.split(';')[0]?.slice(COOKIE_NAME.length + 1);
  return value ? decodeURIComponent(value) : undefined;
}

export function setCookieLine(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`)) ?? '';
}

interface Options {
  token?: string | undefined;
  origin?: string | null;
  ip?: string;
}

const prepare = (req: request.Test, { token, origin = ALLOWED_ORIGIN, ip }: Options) => {
  if (token) req.set('Cookie', `${COOKIE_NAME}=${token}`);
  if (origin) req.set('Origin', origin);
  if (ip) req.set('X-Forwarded-For', ip);
  return req;
};

/** Thin API client. Sends the allowed Origin by default, like the real browser would. */
export function client(app: NestExpressApplication) {
  // supertest is pointed at the live listener (see createTestApp).
  const base = () => `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const http = () => request(base());
  return {
    raw: http,
    get: (path: string, opts: Options = {}) => prepare(http().get(`/api/v1${path}`), opts),
    patch: (path: string, body: unknown, opts: Options = {}) =>
      prepare(
        http()
          .patch(`/api/v1${path}`)
          .send(body as object),
        opts,
      ),
    del: (path: string, opts: Options = {}) => prepare(http().delete(`/api/v1${path}`), opts),
    put: (path: string, body: unknown, opts: Options = {}) =>
      prepare(
        http()
          .put(`/api/v1${path}`)
          .send(body as object),
        opts,
      ),
    post: (path: string, body: unknown, opts: Options = {}) =>
      prepare(
        http()
          .post(`/api/v1${path}`)
          .send(body as object),
        opts,
      ),
    register: (
      body: Partial<{ email: string; name: string; password: string }> = {},
      opts: Options = {},
    ) =>
      prepare(
        http()
          .post('/api/v1/auth/register')
          .send({
            email: uniqueEmail(),
            name: 'Ada Lovelace',
            password: STRONG_PASSWORD,
            ...body,
          }),
        opts,
      ),
    login: (email: string, password: string, opts: Options = {}) =>
      prepare(http().post('/api/v1/auth/login').send({ email, password }), opts),
    me: (token: string | undefined, opts: Options = {}) =>
      prepare(http().get('/api/v1/auth/me'), { ...opts, token }),
    logout: (token: string | undefined, opts: Options = {}) =>
      prepare(http().post('/api/v1/auth/logout'), { ...opts, token }),
  };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
}

/**
 * Registers a user through the real API, then (as the DB owner) sets role / verification state.
 * Authorization data is read fresh on every request, so the returned session reflects it at once.
 */
export async function createUser(
  api: ReturnType<typeof client>,
  options: {
    role?: 'CUSTOMER' | 'ASSISTANT' | 'BUSINESS_STAFF' | 'ADMIN';
    verified?: boolean;
    email?: string;
    name?: string;
  } = {},
): Promise<TestUser> {
  const email = options.email ?? uniqueEmail();
  const res = await api.register({ email, name: options.name ?? 'Test User' }).expect(201);
  const id: string = res.body.user.id;
  await ownerPrisma().user.update({
    where: { id },
    data: {
      ...(options.role ? { role: options.role } : {}),
      ...(options.verified ? { emailVerifiedAt: new Date() } : {}),
    },
  });
  return { id, email, password: STRONG_PASSWORD, token: sessionTokenFrom(res)! };
}

/** Token from the newest captured email whose subject matches (links carry `#token=…`). */
export function tokenFromMail(mail: CapturingMailService, subject: RegExp, to?: string): string {
  const message = mail.sent.filter((m) => subject.test(m.subject) && (!to || m.to === to)).at(-1);
  const match = message ? /#token=([A-Za-z0-9_-]{43})/.exec(message.text) : null;
  if (!match) throw new Error(`No email matching ${subject} with a token link`);
  return match[1]!;
}

/** Polls until exactly `count` emails (optionally matching `subject`) have been captured. */
export async function waitForMail(
  mail: CapturingMailService,
  count: number,
  subject?: RegExp,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = subject
      ? mail.sent.filter((m) => subject.test(m.subject)).length
      : mail.sent.length;
    if (seen === count) return;
    if (Date.now() > deadline) throw new Error(`Expected ${count} emails, saw ${seen}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
