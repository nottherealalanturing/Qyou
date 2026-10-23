import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/app.setup.js';
import { RateLimiter } from '../../src/common/rate-limit/rate-limiter.js';
import { MailService, type MailMessage } from '../../src/mail/mail.service.js';
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

export async function createTestApp(): Promise<TestContext> {
  const mail = new CapturingMailService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

/** Wipes auth data. Refuses to run unless the connected database is clearly a test database. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const database = rows[0]?.current_database;
  if (!database?.endsWith('_test')) {
    throw new Error(`Refusing to truncate non-test database "${database}"`);
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, password_reset_tokens, sessions, users RESTART IDENTITY CASCADE',
  );
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
