import { describeError, postJson } from './forms';

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('describeError', () => {
  it('turns validation failures into a prompt to fix fields', () => {
    expect(describeError(400, { message: 'Validation failed' })).toBe(
      'Please fix the highlighted fields.',
    );
  });

  it('shows API messages for 401/409 and a retry hint for 429', () => {
    expect(describeError(401, { message: 'Invalid email or password' })).toBe(
      'Invalid email or password',
    );
    expect(describeError(429, { retryAfterSeconds: 90 })).toBe(
      'Too many attempts. Try again in about 2 minutes.',
    );
    expect(describeError(429, { retryAfterSeconds: 30 })).toContain('1 minute');
  });

  it('never surfaces server error details', () => {
    expect(describeError(500, { message: 'insert into users …' })).not.toContain('insert');
  });

  it('words each 403 for what it is, never with server text', () => {
    expect(
      describeError(403, { code: 'ASSISTANT_NOT_ELIGIBLE', message: 'internal reason 42' }),
    ).toBe('You are not currently eligible to do this. Check your application for what is needed.');
    expect(describeError(403, { code: 'EMAIL_NOT_VERIFIED' })).toMatch(/Verify your email/);
    expect(describeError(403, { message: 'Cross-site request blocked' })).toMatch(/blocked/);
    const generic = describeError(403, { message: 'secret detail from the server' });
    expect(generic).toBe('You do not have permission to do this.');
    expect(generic).not.toContain('secret');
  });

  it('words 401 and 404 without exposing details', () => {
    expect(describeError(401, {})).toBe('Please log in again to continue.');
    expect(describeError(401, { message: 'Invalid email or password' })).toBe(
      'Invalid email or password',
    );
    const missing = describeError(404, { message: 'Request not found: row 123' });
    expect(missing).toMatch(/could not find that/);
    expect(missing).not.toContain('123');
  });

  it('treats unexpected statuses as our problem, with fixed text', () => {
    for (const status of [500, 502, 504]) {
      expect(describeError(status, { message: 'stack trace at db.ts:42' })).toBe(
        'Something went wrong on our side. Please try again in a moment.',
      );
    }
  });
});

describe('postJson', () => {
  it('returns data on success', async () => {
    stubFetch(200, { user: { id: '1' } });
    await expect(postJson('/api/v1/auth/login', {})).resolves.toEqual({
      ok: true,
      data: { user: { id: '1' } },
    });
  });

  it('maps validation issues to field errors (first message wins)', async () => {
    stubFetch(400, {
      message: 'Validation failed',
      issues: [
        { path: 'email', message: 'Enter a valid email address' },
        { path: 'email', message: 'second' },
        { path: 'password', message: 'Use at least 10 characters' },
      ],
    });
    const result = await postJson('/api/v1/auth/register', {});
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      fieldErrors: { email: 'Enter a valid email address', password: 'Use at least 10 characters' },
    });
  });

  it('handles 204/empty bodies and non-JSON error pages', async () => {
    stubFetch(204, undefined);
    await expect(postJson('/x', {})).resolves.toMatchObject({ ok: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })),
    );
    await expect(postJson('/x', {})).resolves.toMatchObject({ ok: false, status: 502 });
  });

  it('reports network failures without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(postJson('/x', {})).resolves.toMatchObject({
      ok: false,
      status: 0,
      message: expect.stringContaining('could not reach'),
    });
  });
});
