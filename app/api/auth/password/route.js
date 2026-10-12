import { handle, HttpError, bad } from '@/lib/http';
import { query } from '@/lib/db';
import {
  verifyPassword, hashPassword, expireSessions, COOKIE, MIN_PASSWORD, MAX_PASSWORD,
  THROTTLE, throttleKey, throttleMessage, throttleBlocked, throttleHit,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/auth/password { current, next }: change your own password (inventory §1.1; design §8.2, §13 #3/#4).
// The user always comes from the session (rule 23). Works while must_change is set (that is how it gets
// cleared) and before the profile is finished. Keeps this session and ends every other one (rule 30): rows are
// expired, not deleted, and the comparison is by hash, so a 'v2;' session keeps this device signed in
// (amendment A3). Throttled: 10 wrong current passwords per user per 15 minutes.
export const POST = handle(async ({ req, viewer: me, body }) => {
  const b = await body();
  const current = typeof b.current === 'string' ? b.current : '';
  const next = typeof b.next === 'string' ? b.next : null;
  const check = { key: throttleKey.pw(me.id), rule: THROTTLE.password };
  if (await throttleBlocked([check])) throw new HttpError(429, throttleMessage(THROTTLE.password));

  const r = await query('SELECT password_hash FROM users WHERE id = $1::bigint', [me.id]);
  const okCurrent = current.length <= MAX_PASSWORD && r.rows.length > 0 && verifyPassword(current, r.rows[0].password_hash);
  if (!okCurrent) {
    await throttleHit([check]);
    throw bad('Your current password isn’t right.');
  }
  if (next == null || next.length < MIN_PASSWORD) throw bad(`The new password needs at least ${MIN_PASSWORD} characters.`);
  if (next.length > MAX_PASSWORD) throw bad(`The new password can be at most ${MAX_PASSWORD} characters.`);
  if (next === current) throw bad('Pick a password that’s different from the current one.');

  const u = await query(
    `WITH u AS (UPDATE users SET password_hash = $2::text, must_change = false, updated_at = now()
                WHERE id = $1::bigint RETURNING id)
     INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
     SELECT u.id, 'password.change', 'users', u.id::text, jsonb_build_object('was_temporary', $3::boolean) FROM u
     RETURNING entity_id`,
    [me.id, hashPassword(next), !!me.must_change]);
  if (!u.rows.length) throw new HttpError(401, 'Please sign in');
  await expireSessions(me.id, { exceptRaw: req.cookies.get(COOKIE)?.value });
  return { ok: true };
}, { allowMustChange: true, allowIncomplete: true, maxBody: 10_000 });

