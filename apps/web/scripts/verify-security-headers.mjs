#!/usr/bin/env node
// Black-box check of a RUNNING web server's security headers and CSP/nonce wiring.
//   node scripts/verify-security-headers.mjs [baseUrl]      (default http://localhost:3000)
// Exits non-zero on any problem. Used locally and in CI after `next start`.
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const pages = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
const problems = [];
const fail = (page, message) => problems.push(`${page}: ${message}`);

for (const page of pages) {
  const response = await fetch(base + page, { redirect: 'manual' });
  const csp = response.headers.get('content-security-policy') ?? '';
  if (!csp) {
    fail(page, 'missing Content-Security-Policy header');
    continue;
  }
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src ')) ?? '';
  if (!nonce) fail(page, 'CSP has no nonce');
  if (scriptSrc.includes("'unsafe-inline'")) fail(page, "script-src allows 'unsafe-inline'");
  if (scriptSrc.includes("'unsafe-eval'") && process.env.ALLOW_UNSAFE_EVAL !== 'true') {
    fail(page, "script-src allows 'unsafe-eval' (is this a dev server?)");
  }
  if (!csp.includes("frame-ancestors 'none'")) fail(page, 'frame-ancestors not locked down');
  if (response.headers.get('x-content-type-options') !== 'nosniff') fail(page, 'missing nosniff');
  if (response.headers.get('x-frame-options') !== 'DENY')
    fail(page, 'missing X-Frame-Options: DENY');
  if (!response.headers.get('referrer-policy')) fail(page, 'missing Referrer-Policy');
  if (page === '/reset-password' || page === '/verify-email') {
    if (response.headers.get('referrer-policy') !== 'no-referrer')
      fail(page, 'token page must send Referrer-Policy: no-referrer');
  }
  if (response.headers.get('x-powered-by')) fail(page, 'x-powered-by is exposed');

  if (response.status === 200) {
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    if (scripts.length === 0) fail(page, 'no <script> tags found (page not server-rendered?)');
    for (const attrs of scripts) {
      const tagNonce = /\bnonce="([^"]*)"/.exec(attrs)?.[1];
      if (tagNonce !== nonce) fail(page, `<script ${attrs.slice(0, 60)}…> missing/incorrect nonce`);
    }
    if (/<[a-z][^>]*\sstyle="/i.test(html))
      fail(page, 'inline style="" attribute found (blocked by style-src)');
    if (/\son[a-z]+="/i.test(html)) fail(page, 'inline event-handler attribute found');
  }
}

// Nonces must differ per request.
const [a, b] = await Promise.all([fetch(base + '/login'), fetch(base + '/login')]);
const na = /'nonce-([^']+)'/.exec(a.headers.get('content-security-policy') ?? '')?.[1];
const nb = /'nonce-([^']+)'/.exec(b.headers.get('content-security-policy') ?? '')?.[1];
if (!na || na === nb) problems.push('nonce is not unique per request');

if (problems.length > 0) {
  console.error(`Security header verification FAILED (${base}):\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`Security header verification passed for ${pages.length} pages at ${base}`);
