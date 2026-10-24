import { headers } from 'next/headers';
import { apiBaseUrl } from './api';

/** Result of an authenticated server-side API call: every failure mode is explicit data. */
export type Authed<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthenticated' }
  | { status: 'forbidden'; code?: string }
  | { status: 'not_found' }
  | { status: 'unavailable' };

/**
 * GET from the API on behalf of the signed-in user by forwarding their cookies. Never cached
 * (`no-store`): the responses are personal. The API is the only place that authorises anything;
 * the pages merely react to what it answers.
 */
export async function apiAuthed<T>(path: string): Promise<Authed<T>> {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return { status: 'unauthenticated' };
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401) return { status: 'unauthenticated' };
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      return { status: 'forbidden', ...(body.code ? { code: body.code } : {}) };
    }
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };
    return { status: 'ok', data: (await response.json()) as T };
  } catch {
    return { status: 'unavailable' };
  }
}
