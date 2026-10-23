'use client';

import { useEffect, useRef, useState } from 'react';

export type FragmentToken =
  { status: 'reading' } | { status: 'missing' } | { status: 'ready'; token: string };

/**
 * Reads a single-use token from the URL fragment (`#token=…`), which browsers never send to any
 * server, then strips it from the address bar and history entry.
 *
 * The ref makes this idempotent: React StrictMode runs effects twice in development, and the
 * second run would otherwise find the fragment already removed and wrongly report a missing
 * token (this exact bug shipped once; see reset-password-form.test.tsx).
 */
export function useFragmentToken(): FragmentToken {
  const [state, setState] = useState<FragmentToken>({ status: 'reading' });
  const tokenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (tokenRef.current === undefined) {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
      tokenRef.current = token;
      if (token) window.history.replaceState(null, '', window.location.pathname);
    }
    const token = tokenRef.current;
    // Reading the URL fragment is synchronisation with an external system (the browser
    // location) and it is unavailable during SSR, so state must be set after mount.
    // oxlint-disable-next-line react/set-state-in-effect
    setState(token ? { status: 'ready', token } : { status: 'missing' });
  }, []);

  return state;
}
