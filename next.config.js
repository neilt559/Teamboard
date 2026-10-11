// Content-Security-Policy only in production: `next dev` (React Refresh) needs
// 'unsafe-eval', which this policy deliberately leaves out.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    // Link navigations always fetch fresh server data. Back/forward does not consult staleTimes in 14.2
    // (it restores the router cache), so app/_ui/AppShell.js refreshes on popstate.
    staleTimes: { dynamic: 0, static: 180 },
  },
  async headers() {
    const headers = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ];
    if (process.env.NODE_ENV === 'production') headers.push({ key: 'Content-Security-Policy', value: CSP });
    return [{ source: '/:path*', headers }];
  },
};

module.exports = nextConfig;
