import { headers } from 'next/headers';
import { cache } from 'react';
import { apiBaseUrl } from './api';
import type { PublicUser } from './types';

export type SessionState =
  { state: 'authenticated'; user: PublicUser } | { state: 'anonymous' } | { state: 'unavailable' };

/**
 * Server-side session lookup: forwards the browser's cookies to the API, which is the only place
 * that can validate the session. Memoised per request. "unavailable" (API down/slow) is kept
 * distinct from "anonymous" so a backend outage is never shown as "you are logged out".
 */
export const getSession = cache(async (): Promise<SessionState> => {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return { state: 'anonymous' };

  try {
    const response = await fetch(`${apiBaseUrl()}/auth/me`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401) return { state: 'anonymous' };
    if (!response.ok) return { state: 'unavailable' };
    const body = (await response.json()) as { user?: PublicUser };
    return body.user ? { state: 'authenticated', user: body.user } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
});
