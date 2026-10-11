import { NextResponse } from 'next/server.js';
import { neon, neonConfig } from '@neondatabase/serverless';
import { safeNext } from './lib/policy.js';

// Edge gate in front of every page and API (design §8.1). It only answers "is there a live session?";
// must_change, the profile check and all authorization happen in the node layer (lib/http.js handle(),
// lib/viewer.js requirePageViewer()). It also forwards the requested path to that layer in x-tb-path,
// because layouts and pages can't see the pathname (used to build /login?next=).

// Local testing only (see lib/db.js). Never set on Vercel.
if (process.env.TB_SQL_ENDPOINT) neonConfig.fetchEndpoint = process.env.TB_SQL_ENDPOINT;

// Paths reachable without a session.
const PUBLIC = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/me',
]);
const isPublic = (p) => PUBLIC.has(p) || p.startsWith('/api/cron/');   // cron routes check CRON_SECRET themselves
const isApi = (p) => p === '/api' || p.startsWith('/api/');

// Same rule as getSql(): a non-production Vercel deployment never touches a database unless it was pointed
// at a Neon branch.
const previewBlocked = () =>
  !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && !process.env.TB_PREVIEW_DB_OK;

// Deadlock, lock timeout, statement timeout: a migration is holding sessions/users for a few seconds.
const RETRYABLE = new Set(['40P01', '55P03', '57014']);
const UPDATING = 'TeamBoard is updating — try again in a moment.';

function page(status, title, text, { refresh = false } = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + (refresh ? '<meta http-equiv="refresh" content="3">' : '')
    + `<title>${title}</title></head>`
    + `<body style="margin:0;padding:16px;min-height:100vh;display:flex;align-items:center;justify-content:center;`
    + `font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#5B5859;background:#fff">`
    + `<p style="font-size:16px;text-align:center">${text}</p></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

// sessions before users (lock order, §3.1). A 42703 means the new columns don't exist yet (this middleware
// went live before the first node request ran the migration): fall back to today's lookup.
async function lookup(sql, raw, h) {
  try {
    const rows = await sql(
      `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE (s.token_hash = $1 OR (s.token_hash IS NULL AND s.token = $2))
         AND s.expires_at > now() AND u.disabled_at IS NULL
       LIMIT 1`, [h, raw]);
    return rows.length > 0;
  } catch (e) {
    if (e?.code !== '42703') throw e;
    const rows = await sql('SELECT 1 FROM sessions WHERE token = $1 AND expires_at > now() LIMIT 1', [raw]);
    return rows.length > 0;
  }
}

// 'ok' | 'none' | 'busy'. A transient lock error is retried once after 250 ms; if it persists the answer is
// 'busy' (503), never "signed out", so nobody is bounced to /login during a deploy. Any other error stays
// fail-closed, as today.
async function sessionState(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 512) return 'none';
  let sql, h;
  try {
    const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
    sql = neon(cs, { fetchOptions: { cache: 'no-store' } });
    h = await sha256hex(raw);
  } catch {
    return 'none';
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return (await lookup(sql, raw, h)) ? 'ok' : 'none';
    } catch (e) {
      if (!RETRYABLE.has(e?.code)) return 'none';
      if (attempt >= 2) return 'busy';
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const api = isApi(pathname);

  if (previewBlocked()) {
    const msg = 'This preview deployment has no database.';
    return api ? NextResponse.json({ error: msg }, { status: 503 }) : page(503, 'TeamBoard preview', msg);
  }

  // The path and query for the node layer (minus Next's internal _rsc cache-buster).
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete('_rsc');
  const qs = params.toString();
  const path = pathname + (qs ? `?${qs}` : '');
  const headers = new Headers(req.headers);
  headers.set('x-tb-path', path);
  const pass = () => NextResponse.next({ request: { headers } });

  if (isPublic(pathname)) return pass();

  const state = await sessionState(req.cookies.get('tb_session')?.value);
  if (state === 'ok') return pass();
  if (state === 'busy') {
    return api
      ? NextResponse.json({ error: UPDATING }, { status: 503 })
      : page(503, 'TeamBoard is updating', 'TeamBoard is updating… this page will refresh in a moment.', { refresh: true });
  }

  if (api) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const next = safeNext(path, req.nextUrl.origin);
  if (next && next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
