import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const out: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader: (k: string, v: string) => (out.headers[k] = v),
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}

describe('AllExceptionsFilter', () => {
  const logged: string[] = [];
  beforeEach(() => {
    logged.length = 0;
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (m: unknown) => void logged.push(String(m)),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes HttpExceptions through', () => {
    const out = run(new BadRequestException({ statusCode: 400, message: 'nope' }));
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ statusCode: 400, message: 'nope' });
  });

  it('maps body-parser errors to 4xx', () => {
    expect(run(Object.assign(new Error('x'), { type: 'entity.too.large' })).status).toBe(413);
    expect(run(Object.assign(new Error('x'), { type: 'entity.parse.failed' })).status).toBe(400);
  });

  it('turns unknown errors into a generic 500 and never logs or returns their message', () => {
    const secret = 'insert into users (passwordHash) values ($argon2id$secret)';
    const out = run(Object.assign(new Error(secret), { code: 'P2002' }));
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toContain('argon2id');
    expect(logged.join(' ')).toBe('Unhandled Error (P2002)');
  });
});
