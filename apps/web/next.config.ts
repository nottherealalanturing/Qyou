import type { NextConfig } from 'next';

// The browser only ever talks to the web origin. `/api/v1/*` is proxied to the API, so the
// session cookie is set on the web origin, no CORS is involved, and the API's CSRF Origin check
// sees the web origin. NOTE: rewrites are resolved at build time; API_BASE_URL must be set for
// `next build` as well as at runtime.
const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // The browser test suite builds into its own directory (with its own baked-in API address) so it
  // never overwrites, or is overwritten by, a developer's normal `.next` build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiBaseUrl}/:path*` }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Pages that receive a token in the URL fragment: never leak anything via Referer, never cache.
      {
        source: '/:page(reset-password|verify-email)',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
