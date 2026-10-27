import { API_URL, PASSWORD, WEB_URL } from './env.js';

export interface Account {
  id: string;
  email: string;
  name: string;
  password: string;
  token: string;
}

/** The few response fields the fixtures read; everything else stays opaque. */
export interface ApiJson {
  user: { id: string };
  request: { id: string };
  quote: { id: string };
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    what: string,
  ) {
    super(`${what} -> ${status} ${JSON.stringify(body)}`);
  }
}

/** Calls the real API over HTTP exactly like the web app's proxy does (cookie + allowed Origin). */
export async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: ApiJson; headers: Headers }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: WEB_URL,
      ...(token ? { cookie: `qyou_session=${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as ApiJson,
    headers: res.headers,
  };
}

/** Like `call` but throws unless the status is the expected one. */
export async function ok(
  expected: number,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const res = await call(method, path, body, token);
  if (res.status !== expected) throw new ApiError(res.status, res.body, `${method} ${path}`);
  return res;
}

export async function register(email: string, name: string): Promise<Account> {
  const res = await ok(201, 'POST', '/auth/register', { email, name, password: PASSWORD });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('qyou_session='));
  const token = cookie?.split(';')[0]?.slice('qyou_session='.length);
  if (!token) throw new Error('Registration returned no session cookie');
  return {
    id: res.body.user.id,
    email,
    name,
    password: PASSWORD,
    token: decodeURIComponent(token),
  };
}
