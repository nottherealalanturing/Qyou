import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, generateNonce } from './lib/csp';

/**
 * Next.js "proxy" (formerly middleware): attaches a per-request nonce + Content-Security-Policy
 * and, when HTTPS is enforced (`FORCE_HTTPS=true`), HSTS. Next reads the nonce from the request's
 * CSP header and applies it to its own scripts and styles during server rendering, so every page
 * must be dynamically rendered (they all are: the header reads the session cookie).
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const forceHttps = process.env.FORCE_HTTPS === 'true';
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === 'development', forceHttps });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (forceHttps) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: skip the API proxy (/api/v1 → handled by the API), static assets and prefetches.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
