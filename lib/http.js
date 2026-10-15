import 'server-only';
import { NextResponse } from 'next/server.js';
import { ensureSchema, RELEASED_AT } from './db.js';
import { viewerFromRequest } from './viewer.js';
import { nowMs } from './clock.js';
import { isOrganizer } from './policy.js';
import { safeEqual } from './auth.js';

// The one guard every API route goes through (design §8.1), plus small input helpers.
//   export const PATCH = handle(async ({ viewer, params, body, now }) => { ... }, { legacyWrite: true });
// Handlers return a plain object (sent as JSON, default { ok: true }) or a Response, and throw HttpError
// for anything the user should see. Database text never reaches a response.

export { safeNext } from './policy.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (m = 'Invalid request.') => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'You can’t do that.') => new HttpError(403, m);
// Editing a row that no longer exists (or that the viewer can no longer see: same answer, no leak).
export const gone = () => new HttpError(404, 'gone', { message: 'This was deleted by someone else.' });

export const UPDATING = 'TeamBoard is updating — try again in a moment.';

// Legacy-client grace (§7.3): until 48 h after Release 1 first migrated, tabs left open across the deploy
// may skip the profile check and omit `base` on the legacy write routes.
const GRACE_MS = 48 * 3600 * 1000;
export const inLegacyGrace = (now) => RELEASED_AT != null && now < Number(RELEASED_AT) + GRACE_MS;

const AUTH_MODES = new Set(['user', 'admin', 'organizer', 'public', 'optional', 'cron']);

// auth: 'user' (default: signed in, password not pending, profile complete), 'admin' (404 for others),
// 'organizer', 'public' (no viewer), 'optional' (viewer or null, no other checks: /api/auth/me) or 'cron'.
export function handle(fn, { auth = 'user', allowIncomplete = false, allowMustChange = false, legacyWrite = false,
                             maxBody = 1_000_000 } = {}) {
  if (!AUTH_MODES.has(auth)) throw new Error(`handle(): unknown auth mode ${auth}`);
  return async (req, ctx) => {
    try {
      const write = !['GET', 'HEAD'].includes(req.method);
      if (write) checkWriteRequest(req);                                   // §13 #9
      if (auth === 'cron') requireCronSecret(req);                         // before any database work
      await ensureSchema();
      const now = nowMs(req);
      const legacyClient = write && legacyWrite && req.headers.get('x-tb-client') !== '2' && inLegacyGrace(now);
      let viewer = null;
      if (auth === 'optional') viewer = await viewerFromRequest(req);
      else if (auth !== 'public' && auth !== 'cron') {
        viewer = await viewerFromRequest(req);
        if (!viewer) throw new HttpError(401, 'Please sign in');
        if (viewer.must_change && !allowMustChange) throw new HttpError(403, 'Choose a new password first.', { code: 'must_change' });
        if (!viewer.profile_done && !allowIncomplete && !legacyClient)
          throw new HttpError(403, 'Finish your profile first.', { code: 'profile_required' });
        if (auth === 'admin' && !viewer.is_admin) throw new HttpError(404, 'Not found');
        if (auth === 'organizer' && !isOrganizer(viewer)) throw forbidden('Only culture organizers can do that.');
      }
      let parsed;
      const body = () => (parsed ??= readJson(req, maxBody));
      const out = await fn({ req, viewer, params: ctx?.params || {}, body, now, legacyClient });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

const PG_ERRORS = {
  23505: [409, 'That already exists.'],
  23503: [409, 'That item was removed or is still in use.'],
  // restrict_violation: an ON DELETE RESTRICT foreign key (users.office_id, geo_scores) refused the delete.
  23001: [409, 'That item was removed or is still in use.'],
  '22P02': [400, 'Invalid request.'],
  22007: [400, 'Invalid request.'],
  22003: [400, 'Invalid request.'],
  // Crafted input that only Postgres can judge: a date or time past its range (22008 datetime_field_overflow,
  // 22009 invalid_time_zone_displacement_value) and a NUL character, which TEXT can't hold (22021
  // character_not_in_repertoire; 22P05 untranslatable_character for \u0000 in JSON). Routes check first where
  // they can; this keeps the rest from answering 500.
  22008: [400, 'Invalid request.'],
  22009: [400, 'Invalid request.'],
  22021: [400, 'Invalid request.'],
  '22P05': [400, 'Invalid request.'],
  // check_violation: a CHECK refused a value the route didn't (A6 dates, statuses, review days). Routes validate
  // first; this keeps a missed case from answering 500.
  23514: [400, 'Invalid request.'],
  '55P03': [503, UPDATING],
  '40P01': [503, UPDATING],
  40001: [503, UPDATING],
  57014: [503, UPDATING],
  TB_PREVIEW: [503, 'This preview deployment has no database.'],
};

// Next's own control-flow errors (redirect(), notFound()) must pass through untouched.
const isNextSignal = (e) => typeof e?.digest === 'string' && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_)/.test(e.digest);

export function toErrorResponse(e) {
  if (isNextSignal(e)) throw e;
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  const known = e && PG_ERRORS[e.code];
  if (known) return NextResponse.json({ error: known[1] }, { status: known[0] });
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[api ${ref}]`, e);
  return NextResponse.json({ error: 'Something went wrong — please try again.', ref }, { status: 500 });
}

// CSRF (§13 #9). SameSite=Lax cookies plus: Sec-Fetch-Site, when sent, must be same-origin; Origin, when
// sent, must match the host; a request with a body must be JSON (a cross-site form can't send that).
export function checkWriteRequest(req) {
  const h = req.headers;
  const site = h.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw forbidden('This request was refused.');
  const origin = h.get('origin');
  if (origin) {
    const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim().toLowerCase();
    let from = null;
    try { from = new URL(origin).host.toLowerCase(); } catch { /* "null" or garbage */ }
    if (!from || from !== host) throw forbidden('This request was refused.');
  }
  const len = h.get('content-length');
  const hasBody = (len != null && Number(len) > 0) || h.has('transfer-encoding');
  if (hasBody) {
    const type = (h.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw forbidden('This request was refused.');
  }
}

// The JSON body as an object ({} when empty), capped at maxBody bytes while streaming.
export async function readJson(req, maxBody = 1_000_000) {
  const tooBig = () => new HttpError(413, 'That is too much to save at once.');
  if (Number(req.headers.get('content-length') || 0) > maxBody) throw tooBig();
  const chunks = [];
  let size = 0;
  const reader = req.body?.getReader?.();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBody) { reader.cancel().catch(() => {}); throw tooBig(); }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  if (!text.trim()) return {};
  let v;
  try { v = JSON.parse(text); } catch { throw bad(); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad();
  return v;
}

// Vercel cron: Authorization: Bearer ${CRON_SECRET}, compared in constant time; 401 while unset (A7).
export function requireCronSecret(req) {
  const secret = process.env.CRON_SECRET;
  // design-amendments A7: Neil may not have set CRON_SECRET yet; without it the route answers 401 like a wrong
  // secret (nothing runs, nothing breaks: the lazy resolver still advances brackets on the next visit).
  if (!secret) throw new HttpError(401, 'Unauthorized');
  if (!safeEqual(req.headers.get('authorization') || '', `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized');
}

// ---------------------------------------------------------------- input helpers

// A BIGINT id as a string (rule 39), or 400.
export const parseId = (v) => {
  const s = String(v ?? '');
  if (!/^[0-9]{1,18}$/.test(s)) throw bad('Invalid id.');
  return s;
};

// Any value as text: String(), optionally trimmed, capped at max characters (never splitting a surrogate pair).
export const str = (v, max, { trim = true } = {}) => {
  let s = v == null ? '' : String(v);
  if (trim) s = s.trim();
  if (s.length > max) {
    s = s.slice(0, max);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  }
  return s;
};

// A NUL character (U+0000) can't be stored in a Postgres TEXT column; text input carrying one is refused (400)
// before it reaches SQL. Returns v unchanged.
export const NUL_MESSAGE = 'That text contains a character that can’t be saved.';
export const noNul = (v) => {
  if (typeof v === 'string' && v.includes('\u0000')) throw bad(NUL_MESSAGE);
  return v;
};

// 'YYYY-MM-DD' for a real calendar date, else null.
export const ymd = (v) => {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null;
};
