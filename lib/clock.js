import { headers, cookies } from 'next/headers.js';

// "Now" for request handling (design §8.1). The local test harness may move the clock with the
// x-tb-test-now header or the tb_test_now cookie (bracket time-travel tests); that is honored only when
// TB_SQL_ENDPOINT is set and VERCEL is not, so it can never apply to a real deployment.
const testClockAllowed = () => !!process.env.TB_SQL_ENDPOINT && !process.env.VERCEL;
const parse = (raw) => { const t = raw ? Date.parse(raw) : NaN; return Number.isFinite(t) ? t : null; };

// Route handlers (they have the request).
export function nowMs(req) {
  if (testClockAllowed()) {
    const t = parse(req?.headers?.get?.('x-tb-test-now') || req?.cookies?.get?.('tb_test_now')?.value);
    if (t != null) return t;
  }
  return Date.now();
}

// Server Component loaders and widgets (no req): pages read the same test clock through next/headers.
export function nowFromRequestContext() {
  if (testClockAllowed()) {
    const t = parse(headers().get('x-tb-test-now') || cookies().get('tb_test_now')?.value);
    if (t != null) return t;
  }
  return Date.now();
}
