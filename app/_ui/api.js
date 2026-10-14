// Client fetch helper for every new page (design §8.1). Always sends JSON and X-TB-Client: 2 (so the server
// applies the full checks, not the 48 h old-tab grace), merges caller headers instead of replacing them, and
// turns the server's answers into the behavior the UI expects:
//   401                        -> /login?next=<this page>
//   403 code must_change       -> /password
//   403 code profile_required  -> /welcome
//   409 error 'conflict'       -> throws ConflictError (fields, current) for ConflictNotice
//   428 (base_required)        -> shell banner "reload the page"
//   503                        -> shell banner "TeamBoard is updating"; GETs retry once after 2 s
//   anything else not 2xx      -> throws ApiError(json.error)
// Plain module (no hooks), so any client component can import it.

export const UPDATING = 'TeamBoard is updating — try again in a moment.';

export class ApiError extends Error {
  constructor(message, status = 0, json = {}) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = json.code || null;
    this.json = json;
  }
}

// 409 { error:'conflict', message, fields, current }: someone else changed a text field since you started.
export class ConflictError extends ApiError {
  constructor(json = {}) {
    super(json.message || 'Someone else changed this while you were editing.', 409, json);
    this.name = 'ConflictError';
    this.fields = Array.isArray(json.fields) ? json.fields : [];
    this.current = json.current || null;
  }
}

// The app shell listens for banners (428 reload, 503 updating). One listener at a time is plenty.
const listeners = new Set();
export function onApiBanner(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function showBanner(banner) {
  for (const fn of listeners) {
    try { fn(banner); } catch {}
  }
}

const herePath = () => (typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search);
const go = (href) => { if (typeof window !== 'undefined') window.location.href = href; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPlainBody = (b) => b != null && typeof b === 'object' && Object.getPrototypeOf(b) === Object.prototype;

// Writes in flight (every api() call that isn't a GET or HEAD, and anything passed to trackWrite), so a page can
// wait for them before it leaves: fields save on blur, so a click that navigates away (Generate report) would
// otherwise race the save it just triggered (2026-10-14 review). Per tab; settled writes drop out.
const inflight = new Set();
let failedWrites = 0;
export function trackWrite(promise) {
  inflight.add(promise);
  promise.then(() => inflight.delete(promise), () => { inflight.delete(promise); failedWrites += 1; });
  return promise;
}
// Resolves once every write in flight (including ones started while waiting) has settled:
//   { ok: true }                   all of them succeeded
//   { ok: false, failed: true }    at least one failed (the caller shows its error; don't navigate on stale data)
//   { ok: false, timedOut: true }  still running after timeoutMs
export async function settleWrites(timeoutMs = 20_000) {
  const t0 = Date.now();
  const failed0 = failedWrites;
  while (inflight.size) {
    const left = timeoutMs - (Date.now() - t0);
    if (left <= 0) return { ok: false, timedOut: true };
    await Promise.race([Promise.allSettled([...inflight]), sleep(left)]);
  }
  return failedWrites === failed0 ? { ok: true } : { ok: false, failed: true };
}

// api(path, { method, body, headers, quiet, signal, ... })
//   body: a JSON string (as old callers pass) or a plain object (stringified here).
//   quiet: no shell banner (background polls); errors still throw.
export function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const p = request(path, opts);
  return method === 'GET' || method === 'HEAD' ? p : trackWrite(p);
}

async function request(path, opts) {
  const { headers, quiet = false, body, ...rest } = opts;
  const method = String(rest.method || 'GET').toUpperCase();
  const init = {
    credentials: 'same-origin',
    cache: 'no-store',
    ...rest,
    method,
    headers: { 'Content-Type': 'application/json', 'X-TB-Client': '2', ...(headers || {}) },
  };
  if (body !== undefined) init.body = isPlainBody(body) || Array.isArray(body) ? JSON.stringify(body) : body;

  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(path, init);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new ApiError('Network error — check your connection and try again.', 0);
    }
    if (res.status === 503 && (method === 'GET' || method === 'HEAD') && attempt === 1) { await sleep(2000); continue; }
    break;
  }

  let json = {};
  try { json = await res.json(); } catch {}
  if (json == null || typeof json !== 'object') json = { value: json };
  if (res.ok) return json;

  const msg = json.error || 'Request failed';
  if (res.status === 401) {
    const next = herePath();
    go(next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');
    throw new ApiError('Please sign in', 401, json);
  }
  if (res.status === 403 && json.code === 'must_change') { go('/password'); throw new ApiError(msg, 403, json); }
  if (res.status === 403 && json.code === 'profile_required') { go('/welcome'); throw new ApiError(msg, 403, json); }
  if (res.status === 409 && json.error === 'conflict') throw new ConflictError(json);
  if (res.status === 428) {
    if (!quiet) showBanner({ kind: 'reload', message: msg });
    throw new ApiError(msg, 428, json);
  }
  if (res.status === 503) {
    if (!quiet) showBanner({ kind: 'updating', message: UPDATING });
    throw new ApiError(UPDATING, 503, json);
  }
  // 404 { error:'gone', message } = edited something that was deleted (or is no longer visible).
  throw new ApiError(json.error === 'gone' && json.message ? json.message : msg, res.status, json);
}

// Sign out this device, then go to /login. Never throws.
export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-TB-Client': '2' } }); } catch {}
  try { sessionStorage.removeItem('tb_landed'); } catch {}
  go('/login');
}
