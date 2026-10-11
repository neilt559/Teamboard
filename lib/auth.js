import 'server-only';
import crypto from 'node:crypto';
import { query, transaction } from './db.js';

// Passwords, sessions, sign-in throttling and the small identity checks shared by the auth, profile and
// admin routes (design §5.1, §13). The pre-rebuild routes still import COOKIE, cookieOptions, hashPassword,
// verifyPassword, createSession, deleteSession, sessionUser, adminUser and MIN_PASSWORD from here, so those
// keep their old shapes until M1/M2 replace the routes.

export const COOKIE = 'tb_session';
export const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: MAX_AGE,
};

export const MIN_PASSWORD = 6;        // kept from today (§17 asks Neil about 8)
export const MAX_PASSWORD = 200;
export const MIN_TEMP_PASSWORD = 8;   // an admin-typed temporary password

// ---------------------------------------------------------------- passwords (format 'salt:hash', unchanged)

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw ?? ''), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verified against when the username doesn't exist, so an unknown user costs the same scrypt as a real one
// and sign-in timing doesn't reveal which usernames exist (§13 #7). Matches no password.
export const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

// Constant-time string comparison over SHA-256 digests (lengths never leak).
export function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const db = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

// ---------------------------------------------------------------- sessions

export const hashToken = (raw) => crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
const okToken = (raw) => typeof raw === 'string' && raw.length > 0 && raw.length <= 512;

// The cookie holds a random token; the row stores only its hash. token = 'v2;' || hash fills the old primary
// key. New code never matches a cookie against it (lookups go by hash), but it IS a credential to
// pre-rebuild code: Next percent-decodes cookies, so 'tb_session=v2%3B<hash>' arrives as 'v2;<hash>' and old
// code's `token = cookie` accepts it. A rollback must therefore expire these rows before old code serves
// traffic (UPDATE sessions SET expires_at = now() WHERE token LIKE 'v_;%'). Returns the raw token.
export async function createSession(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const h = hashToken(raw);
  await query(
    `INSERT INTO sessions (token, token_hash, user_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '365 days')`,
    ['v2;' + h, h, String(userId)]);
  return raw;
}

// Pre-rebuild routes only (new code uses lib/viewer.js). Same shape as before: { id, username, is_admin,
// must_change }. Looks the cookie up by hash, and still accepts a legacy plaintext session (made by old code
// during the deploy window), which it hashes in place. sessions is read before users (lock order, §3.1).
export async function sessionUser(raw) {
  if (!okToken(raw)) return null;
  const h = hashToken(raw);
  let row;
  try {
    row = (await query(
      `SELECT u.id, u.username, u.is_admin, u.must_change, (s.token_hash IS NULL) AS legacy_row
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE (s.token_hash = $1 OR (s.token_hash IS NULL AND s.token = $2))
         AND s.expires_at > now() AND u.disabled_at IS NULL
       LIMIT 1`, [h, raw])).rows[0];
  } catch (e) {
    if (e?.code !== '42703') throw e;
    // Columns not created yet (only before the first migration): today's lookup.
    row = (await query(
      `SELECT u.id, u.username, u.is_admin, u.must_change, false AS legacy_row
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()
       LIMIT 1`, [raw])).rows[0];
  }
  if (!row) return null;
  if (row.legacy_row) await hashLegacyRow(raw, h);
  return { id: row.id, username: row.username, is_admin: row.is_admin, must_change: row.must_change };
}

// A session made by old code (plaintext token, no hash yet) gets its hash written in place. Best effort:
// the lookup already succeeded, and the plaintext fallback keeps working if this write fails.
export async function hashLegacyRow(raw, h = hashToken(raw)) {
  try {
    await query('UPDATE sessions SET token_hash = $1 WHERE token = $2 AND token_hash IS NULL', [h, raw]);
  } catch (e) {
    console.error('session hash upgrade failed', e?.code || e);
  }
}

// The signed-in user if they're an admin, otherwise null (pre-rebuild admin routes).
export async function adminUser(req) {
  const me = await sessionUser(req.cookies.get(COOKIE)?.value);
  return me && me.is_admin ? me : null;
}

// Sign out this device: deletes this session row, as today. Matches exactly like the lookups (plaintext only
// for a row with no hash yet), so a cookie holding a stored 'v2;<hash>' value signs nobody out.
export async function deleteSession(raw) {
  if (!okToken(raw)) return;
  await query('DELETE FROM sessions WHERE token_hash = $1 OR (token_hash IS NULL AND token = $2)', [hashToken(raw), raw]);
}

// Ends a user's sessions (admin reset, disable, "sign out other devices", password change). Rows are kept
// and expired, not deleted. exceptRaw keeps the caller's own session alive (rule 30).
export async function expireSessions(userId, { exceptRaw } = {}) {
  if (okToken(exceptRaw)) {
    await query(
      `UPDATE sessions SET expires_at = now()
       WHERE user_id = $1 AND expires_at > now() AND token_hash IS DISTINCT FROM $2 AND token <> $3`,
      [String(userId), hashToken(exceptRaw), exceptRaw]);
  } else {
    await query('UPDATE sessions SET expires_at = now() WHERE user_id = $1 AND expires_at > now()', [String(userId)]);
  }
}

// ---------------------------------------------------------------- throttling (§13 #4)
// One auth_throttle row per key, upserted and reused in place (never deleted). A key is blocked while its
// window is open and failures >= limit. Login checks the IP and, only for usernames that EXIST, the
// username; a successful sign-in resets the username's row. Routes answer 429 with throttleMessage(rule).
//   const checks = [{ key: throttleKey.ip(clientIp(req)), rule: THROTTLE.loginIp }];
//   if (await throttleBlocked(checks)) throw new HttpError(429, throttleMessage(THROTTLE.loginIp));

export const THROTTLE = {
  loginIp: { limit: 30, minutes: 15 },
  loginUser: { limit: 20, minutes: 15 },
  signupIp: { limit: 10, minutes: 60 },
  password: { limit: 10, minutes: 15 },
};

export const throttleKey = {
  ip: (ip) => `ip:${ip}`,
  user: (username) => `u:${String(username).toLowerCase()}`,
  signup: (ip) => `signup:${ip}`,
  pw: (userId) => `pw:${userId}`,
};

export const throttleMessage = (rule = THROTTLE.loginIp) =>
  `Too many attempts — try again in ${rule.minutes >= 60 ? 'an hour' : `${rule.minutes} minutes`}.`;

// The client's address: first hop of x-forwarded-for, else x-real-ip.
export function clientIp(req) {
  const h = req.headers;
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || (h.get('x-real-ip') || '').trim();
  return (ip || 'unknown').slice(0, 64);
}

// True when any of checks [{ key, rule }] is over its limit inside its window.
export async function throttleBlocked(checks) {
  if (!checks.length) return false;
  const r = await query(
    `SELECT a.key FROM auth_throttle a
     JOIN unnest($1::text[], $2::int[], $3::int[]) AS c(key, lim, mins) ON c.key = a.key
     WHERE a.window_start > now() - make_interval(mins => c.mins) AND a.failures >= c.lim
     LIMIT 1`,
    [checks.map((c) => c.key), checks.map((c) => c.rule.limit), checks.map((c) => c.rule.minutes)]);
  return r.rows.length > 0;
}

// Counts one failure (or attempt) on each key; an expired window restarts at 1. Returns the new counts.
export async function throttleHit(checks) {
  if (!checks.length) return [];
  const res = await transaction(checks.map((c) => query(
    `INSERT INTO auth_throttle AS a (key, window_start, failures) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN a.window_start <= now() - make_interval(mins => $2::int) THEN 1 ELSE a.failures + 1 END,
       window_start = CASE WHEN a.window_start <= now() - make_interval(mins => $2::int) THEN now() ELSE a.window_start END
     RETURNING failures`, [c.key, c.rule.minutes])));
  return res.map((r) => Number(r.rows[0]?.failures ?? 0));
}

// Successful sign-in, or an admin's "Clear sign-in lock": the row stays, its count goes back to 0.
export async function throttleReset(key) {
  await query('UPDATE auth_throttle SET failures = 0, window_start = now() WHERE key = $1', [key]);
}

// ---------------------------------------------------------------- temporary passwords (§13 #15)
// Four words from a 256-word list plus two digits (about 38 bits): easy to read out, still forced to change.

const WORDS = [
  'acorn', 'amber', 'anchor', 'apple', 'apron', 'arrow', 'aspen', 'atlas', 'badge', 'bagel', 'bamboo', 'banjo',
  'barley', 'basil', 'beach', 'beacon', 'berry', 'birch', 'bison', 'blaze', 'bloom', 'bluff', 'bonus', 'brave',
  'breeze', 'brick', 'brook', 'bubble', 'cabin', 'cactus', 'camel', 'candle', 'canoe', 'canyon', 'cargo', 'carrot',
  'cedar', 'chalk', 'cheer', 'cherry', 'chess', 'cider', 'cinder', 'clover', 'cobalt', 'cocoa', 'comet', 'coral',
  'cotton', 'cove', 'crane', 'crater', 'creek', 'crisp', 'crown', 'daisy', 'delta', 'denim', 'desert', 'dolphin',
  'dove', 'dune', 'eagle', 'ember', 'falcon', 'fern', 'fiddle', 'field', 'flint', 'flute', 'forest', 'fossil',
  'frost', 'gadget', 'galaxy', 'garden', 'garnet', 'gecko', 'ginger', 'glacier', 'globe', 'goose', 'granite', 'grape',
  'gravel', 'grove', 'guitar', 'harbor', 'harvest', 'hazel', 'heron', 'hickory', 'honey', 'island', 'ivory', 'jasper',
  'jelly', 'jungle', 'kayak', 'kettle', 'kiwi', 'koala', 'ladder', 'lagoon', 'lantern', 'lemon', 'lily', 'llama',
  'locket', 'lotus', 'lunar', 'magnet', 'mango', 'maple', 'marble', 'meadow', 'melon', 'mesa', 'meteor', 'mint',
  'mitten', 'moose', 'mosaic', 'motor', 'muffin', 'nectar', 'nickel', 'noble', 'nutmeg', 'oasis', 'ocean', 'olive',
  'onyx', 'orbit', 'orchid', 'otter', 'oyster', 'paddle', 'panda', 'paper', 'parrot', 'peach', 'pebble', 'pecan',
  'pepper', 'piano', 'pickle', 'pilot', 'pine', 'planet', 'plaza', 'plum', 'pocket', 'polar', 'pony', 'poppy',
  'prairie', 'prism', 'pumpkin', 'puzzle', 'quail', 'quartz', 'quilt', 'rabbit', 'radar', 'raven', 'reef', 'ribbon',
  'ridge', 'river', 'robin', 'rocket', 'rover', 'ruby', 'saddle', 'safari', 'salmon', 'sandal', 'satin', 'scarf',
  'shell', 'sierra', 'silver', 'sketch', 'slate', 'sloth', 'socket', 'sonar', 'spark', 'spice', 'spruce', 'squash',
  'summit', 'sunset', 'swan', 'tango', 'teapot', 'thistle', 'thunder', 'tiger', 'timber', 'toast', 'topaz', 'tower',
  'trail', 'tulip', 'tundra', 'turtle', 'tuxedo', 'valley', 'velvet', 'violet', 'walnut', 'walrus', 'willow', 'window',
  'winter', 'wizard', 'yogurt', 'zebra', 'zephyr', 'basket', 'biscuit', 'blossom', 'button', 'compass', 'cricket', 'domino',
  'fable', 'feather', 'galleon', 'hammock', 'igloo', 'jigsaw', 'lemur', 'marlin', 'nugget', 'orange', 'pretzel', 'raisin',
  'sapphire', 'sequoia', 'sparrow', 'tractor', 'trumpet', 'umbrella', 'waffle', 'yonder', 'beetle', 'cashew', 'dahlia', 'fjord',
  'gazebo', 'hopper', 'juniper', 'kernel',
];
export const TEMP_WORDS = WORDS;   // exported for the unit check (exactly 256, all distinct)

export function tempPassword() {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${w()}-${w()}-${w()}-${w()}-${String(crypto.randomInt(100)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- signup code and identity input (§5.1)

const signupEnv = () => String(process.env.SIGNUP_CODE || '').trim();
// True while SIGNUP_CODE is unset and the old public fallback is in use (red banner on /admin).
export const signupCodeFallback = () => !signupEnv();
// Trimmed, case-insensitive (as today), now in constant time.
export const signupCodeOk = (code) =>
  safeEqual(String(code ?? '').trim().toLowerCase(), (signupEnv() || 'CUTIES').toLowerCase());

export const normUsername = (v) => String(v ?? '').trim().toLowerCase();
export const usernameOk = (u) => /^[a-z0-9._@-]{3,40}$/.test(u);

export const allowedEmailDomains = () =>
  String(process.env.ALLOWED_EMAIL_DOMAINS || 'cagecivil.com').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
export const normEmail = (v) => String(v ?? '').trim().toLowerCase();
// A work address in one of the allowed domains (matched in JS, §5.1).
export function emailAllowed(email) {
  const e = normEmail(email);
  const m = /^[^@\s]{1,64}@([a-z0-9.-]{1,190})$/.exec(e);
  return !!m && allowedEmailDomains().includes(m[1]);
}
