import { NextResponse } from 'next/server';
import { handle, HttpError, safeNext } from '@/lib/http';
import { query } from '@/lib/db';
import {
  verifyPassword, createSession, COOKIE, cookieOptions, DUMMY_HASH, MAX_PASSWORD, normUsername,
  THROTTLE, throttleKey, throttleMessage, clientIp, throttleBlocked, throttleHit, throttleReset,
} from '@/lib/auth';
import { landingPath } from '@/lib/prefs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/auth/login { username, password, next? } (design §8.2, §13 #4 and #7).
// -> { ok, username, next } and the tb_session cookie. next is where the page should go:
//    /password (temporary password), /welcome (profile not finished), safeNext(next), or the landing preference.
// Throttle: 30 failures / 15 min per IP; 20 / 15 min per username, counted only for usernames that exist
// (unknown ones get the dummy scrypt, so timing doesn't tell them apart). Success resets the username's count.
// The old page's body { username, password, code } still works (code is ignored).
const WRONG = 'Wrong username or password.';

export const POST = handle(async ({ req, body }) => {
  const b = await body();
  const username = normUsername(b.username).slice(0, 200);
  const password = typeof b.password === 'string' ? b.password : String(b.password ?? '');
  const ip = clientIp(req);
  const ipCheck = { key: throttleKey.ip(ip), rule: THROTTLE.loginIp };

  const r = username
    ? await query(
      `SELECT id, username, password_hash, must_change, (disabled_at IS NOT NULL) AS disabled,
              (profile_completed_at IS NOT NULL) AS profile_done, prefs
       FROM users WHERE username = $1::text LIMIT 1`, [username])
    : { rows: [] };
  const user = r.rows[0] || null;
  const userCheck = user ? { key: throttleKey.user(user.username), rule: THROTTLE.loginUser } : null;
  const checks = userCheck ? [ipCheck, userCheck] : [ipCheck];

  if (await throttleBlocked(checks)) throw new HttpError(429, throttleMessage(THROTTLE.loginIp));

  // Always one scrypt, whether or not the username exists (§13 #7). Overlong passwords never reach scrypt.
  const ok = password.length <= MAX_PASSWORD
    ? verifyPassword(password, user ? user.password_hash : DUMMY_HASH) && !!user
    : (verifyPassword('', DUMMY_HASH), false);
  if (!ok) {
    await throttleHit(checks);
    throw new HttpError(401, WRONG);
  }
  // Leavers (design §13): the right password, but the account is turned off. Nothing is deleted.
  if (user.disabled) throw new HttpError(403, 'This account has been turned off. Ask an admin if that’s a mistake.');

  await throttleReset(userCheck.key);
  const token = await createSession(user.id);

  let next;
  if (user.must_change) next = '/password';
  else if (!user.profile_done) next = '/welcome';
  else next = safeNext(typeof b.next === 'string' ? b.next : '', 'http://teamboard.invalid') || landingPath(user.prefs);
  if (!next || /^\/(login|api)([/?#]|$)/.test(next)) next = '/';

  const res = NextResponse.json({ ok: true, username: user.username, next });
  res.cookies.set(COOKIE, token, cookieOptions);
  return res;
}, { auth: 'public', maxBody: 10_000 });
