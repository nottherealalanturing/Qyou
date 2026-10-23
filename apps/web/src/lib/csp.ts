export interface CspOptions {
  nonce: string;
  /** Development needs `unsafe-eval` (React debugging) and the HMR websocket; production does not. */
  dev: boolean;
  /** Add `upgrade-insecure-requests`. Only when the site is really served over HTTPS. */
  forceHttps: boolean;
}

/** 128 random bits, base64. Fresh for every request. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Content Security Policy for the Qyou web app.
 *
 *  - `script-src` allows only same-origin scripts and ones carrying this request's nonce;
 *    `strict-dynamic` lets those trusted scripts load their own chunks. There is NO
 *    `unsafe-inline`, and `unsafe-eval` exists only in development.
 *  - `style-src` is nonce-based too (Tailwind ships as an external stylesheet; Next nonces its
 *    own inline styles). There are no inline `style=""` attributes in the app; keep it that way.
 *    The only relaxation is development-only and limited to styles (Next dev tooling).
 *  - The browser only ever talks to this origin (the API is proxied under `/api/v1`), so
 *    `connect-src` is `'self'`: a stolen script cannot exfiltrate to another host via fetch.
 */
export function buildCsp({ nonce, dev, forceHttps }: CspOptions): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Development only: Next's dev tooling injects <style> elements without the nonce, which a
    // nonce-based policy would block (noisy console, broken overlay). Scripts stay strict even in
    // development, and the production policy below is verified against a production build.
    dev ? `style-src 'self' 'unsafe-inline'` : `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (forceHttps) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
