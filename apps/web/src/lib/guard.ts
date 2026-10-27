import { redirect } from 'next/navigation';
import { getSession } from './session';
import type { PublicUser } from './types';

/**
 * For pages that need a signed-in user: anonymous visitors are sent to log in and come back; an
 * unreachable API is reported as `unavailable` (never shown as "logged out"). Authorization itself
 * stays in the API; this only decides which page to render.
 */
export async function requireUser(
  next: string,
): Promise<{ user: PublicUser } | { unavailable: true }> {
  const session = await getSession();
  if (session.state === 'anonymous') redirect(`/login?next=${encodeURIComponent(next)}`);
  if (session.state === 'unavailable') return { unavailable: true };
  return { user: session.user };
}
