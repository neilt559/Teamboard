import 'server-only';
import * as React from 'react';
import { cookies, headers } from 'next/headers.js';
import { redirect } from 'next/navigation.js';
import { query, ensureSchema } from './db.js';
import { COOKIE, hashToken, hashLegacyRow } from './auth.js';
import { safeNext } from './policy.js';

// Who is signed in (design §4.4). One round trip per request; pages share it through React cache().
// React 18.3.1 itself has no cache(): Next's server build of React does, and plain Node (the test
// harness) gets a pass-through.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const RETRYABLE = new Set(['40P01', '55P03', '57014']);   // deadlock, lock timeout, statement timeout

// Errors that mean "a deploy is migrating; try again" (the same codes lib/http.js answers 503 for).
const UPDATING_CODES = new Set(['55P03', '40P01', '40001', '57014']);

// In production React strips a server error down to its digest before the browser sees it, so
// app/(app)/error.js can only recognize "updating" by digest. Next keeps a digest that is already set.
// Page loaders that rethrow their own query errors call this too: throw tagUpdating(e).
export function tagUpdating(e) {
  if (e && typeof e === 'object' && UPDATING_CODES.has(e.code) && !e.digest) e.digest = 'TB_UPDATING';
  return e;
}

// sessions before users (lock order, §3.1). $1 = sha256 of the cookie, $2 = the cookie itself, for a
// legacy plaintext row that old code created during the deploy window.
const VIEWER_SQL = `
SELECT u.id, u.username, COALESCE(NULLIF(u.display_name, ''), u.username) AS name, u.display_name, u.full_name, u.email,
       u.is_admin, u.is_organizer, u.must_change,
       (u.profile_completed_at IS NOT NULL) AS profile_done,
       (u.identity_verified_at IS NOT NULL) AS identity_verified,
       u.office_id, u.team_id, u.department_id, u.position_id, u.approved_position_id,
       (u.position_id IS DISTINCT FROM u.approved_position_id) AS position_pending,
       COALESCE(tb_user_level(u.id), 0) AS level,
       ARRAY(SELECT tb_user_office_ids(u.id)) AS office_ids,
       (SELECT p.id FROM people p WHERE p.user_id = u.id) AS person_id,
       COALESCE((SELECT o.tz FROM offices o WHERE o.id = u.office_id), 'America/Chicago') AS tz,
       u.prefs, s.token_hash IS NULL AS legacy_row
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE (s.token_hash = $1 OR (s.token_hash IS NULL AND s.token = $2))
  AND s.expires_at > now() AND u.disabled_at IS NULL
LIMIT 1`;

const idStr = (v) => (v == null ? null : String(v));

function shape(r) {
  return {
    id: String(r.id),
    username: r.username,
    name: r.name,
    display_name: r.display_name || '',
    full_name: r.full_name || '',
    email: r.email ?? null,
    is_admin: !!r.is_admin,
    is_organizer: !!r.is_organizer,
    must_change: !!r.must_change,
    profile_done: !!r.profile_done,
    identity_verified: !!r.identity_verified,
    office_id: idStr(r.office_id),
    team_id: idStr(r.team_id),
    department_id: idStr(r.department_id),
    position_id: idStr(r.position_id),
    approved_position_id: idStr(r.approved_position_id),
    position_pending: !!r.position_pending,
    level: Number(r.level) || 0,
    office_ids: (r.office_ids || []).map(String),
    person_id: idStr(r.person_id),
    tz: r.tz || 'America/Chicago',
    prefs: r.prefs && typeof r.prefs === 'object' && !Array.isArray(r.prefs) ? r.prefs : {},
  };
}

// The viewer for a raw cookie value, or null. A lock timeout, deadlock or statement timeout (a migration in
// progress) is retried once after 250 ms and then thrown, so callers answer 503 instead of "signed out".
export async function loadViewerByCookie(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 512) return null;
  await ensureSchema();                       // memoized; never read half-migrated tables
  const h = hashToken(raw);
  let rows;
  for (let attempt = 1; ; attempt++) {
    try {
      rows = (await query(VIEWER_SQL, [h, raw])).rows;
      break;
    } catch (e) {
      if (!RETRYABLE.has(e?.code) || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const r = rows[0];
  if (!r) return null;
  if (r.legacy_row) await hashLegacyRow(raw, h);
  return shape(r);
}

function readCookie(req, name) {
  const v = req?.cookies?.get?.(name);
  if (v !== undefined) return typeof v === 'string' ? v : v?.value;
  const header = req?.headers?.get?.('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const val = part.slice(i + 1).trim();
      try { return decodeURIComponent(val); } catch { return val; }
    }
  }
  return undefined;
}

// Route handlers (lib/http.js handle() calls this).
export async function viewerFromRequest(req) {
  return loadViewerByCookie(readCookie(req, COOKIE));
}

// Server Components: once per request. Pages never call this directly; they call requirePageViewer().
export const getViewer = cache(async () => loadViewerByCookie(cookies().get(COOKIE)?.value));

// The guard for every page under app/(app) (called by the layout AND by each page, because layouts don't
// re-render on client navigation), plus /welcome and /password with their allow flags.
// No session -> /login?next=<this page>; must_change -> /password; profile incomplete -> /welcome.
export async function requirePageViewer({ allowIncomplete = false, allowMustChange = false } = {}) {
  let v;
  // Only the data calls sit in the try: redirect() below throws Next's own signal, which must pass untouched.
  // On a client navigation the (app) layout doesn't run, so this tag is what error.js sees.
  try {
    await ensureSchema();
    v = await getViewer();
  } catch (e) {
    throw tagUpdating(e);
  }
  if (!v) {
    const next = safeNext(headers().get('x-tb-path') || '/', 'http://teamboard.invalid');
    redirect(next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }
  if (v.must_change && !allowMustChange) redirect('/password');
  if (!v.profile_done && !allowIncomplete) redirect('/welcome');
  return v;
}

// The subset handed to client components. It is the viewer's own data; internal fields stay on the server.
export function publicViewer(v) {
  if (!v) return null;
  const {
    id, username, name, display_name, email, is_admin, is_organizer, must_change, profile_done, identity_verified,
    office_id, team_id, department_id, position_id, approved_position_id, position_pending, level, office_ids,
    person_id, tz, prefs,
  } = v;
  return {
    id, username, name, display_name, email, is_admin, is_organizer, must_change, profile_done, identity_verified,
    office_id, team_id, department_id, position_id, approved_position_id, position_pending, level,
    office_ids: [...office_ids], person_id, tz, prefs: JSON.parse(JSON.stringify(prefs || {})),
  };
}
