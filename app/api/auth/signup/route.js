import { NextResponse } from 'next/server';
import { handle, HttpError, str } from '@/lib/http';
import { query } from '@/lib/db';
import {
  hashPassword, createSession, COOKIE, cookieOptions, MIN_PASSWORD, MAX_PASSWORD, normUsername, usernameOk,
  normEmail, emailAllowed, allowedEmailDomains, signupCodeOk, THROTTLE, throttleKey, throttleMessage, clientIp,
  throttleBlocked, throttleHit,
} from '@/lib/auth';
import { auditStmt } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/auth/signup { display_name, email, username, password, code } (design §5.1, §13 #2, #4, #10).
// -> { ok, username, next: '/welcome' } and the tb_session cookie (signed in right away, as today).
// Order of checks keeps today's messages and never reveals a taken username or email to someone without the
// code: lengths, then the code (403), then uniqueness (409). No people row is created here (§5.1); the
// organizational fields come from the /welcome wizard every account goes through.
// Throttle: 10 failed attempts per IP per hour (wrong code, taken name, bad input). Successful signups don't
// count, so an office signing up together behind one address on launch day isn't locked out.
const TAKEN_EMAIL = 'That email is already registered. If it’s yours, ask an admin to clear it.';
const TAKEN_USER = 'That username is already taken.';

export const POST = handle(async ({ req, body }) => {
  const b = await body();
  const check = { key: throttleKey.signup(clientIp(req)), rule: THROTTLE.signupIp };
  if (await throttleBlocked([check])) throw new HttpError(429, throttleMessage(THROTTLE.signupIp));
  const fail = async (status, message) => {
    await throttleHit([check]);
    return new HttpError(status, message);
  };

  const username = normUsername(b.username);
  const password = typeof b.password === 'string' ? b.password : '';
  const displayName = str(b.display_name ?? b.name, 200).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ');
  const email = normEmail(b.email);
  const domains = allowedEmailDomains();

  if (username.length < 3) throw await fail(400, 'Username must be at least 3 characters.');
  if (!usernameOk(username)) {
    throw await fail(400, 'Usernames can be 3-40 characters: lowercase letters, numbers, and . _ - @');
  }
  if (password.length < MIN_PASSWORD) throw await fail(400, `Password must be at least ${MIN_PASSWORD} characters.`);
  if (password.length > MAX_PASSWORD) throw await fail(400, `Password can be at most ${MAX_PASSWORD} characters.`);
  if (displayName.length < 2 || displayName.length > 80) throw await fail(400, 'Enter your full name (2-80 characters).');
  if (!emailAllowed(email)) {
    throw await fail(400, `Use your work email (ending in @${domains[0] || 'cagecivil.com'}).`);
  }
  if (!signupCodeOk(b.code)) throw await fail(403, 'Invalid team code.');

  // Taken? A username, or an email that is someone's email or someone's username (jgnowak@... signs in by it).
  const taken = await query(
    `SELECT EXISTS (SELECT 1 FROM users WHERE username = $1::text) AS user_taken,
            EXISTS (SELECT 1 FROM users WHERE lower(email) = $2::text OR lower(username) = $2::text) AS email_taken`,
    [username, email]);
  if (taken.rows[0]?.user_taken) throw await fail(409, TAKEN_USER);
  if (taken.rows[0]?.email_taken) throw await fail(409, TAKEN_EMAIL);

  let user;
  try {
    const res = await query(
      `INSERT INTO users (username, password_hash, display_name, email)
       VALUES ($1::text, $2::text, $3::text, $4::text) RETURNING id, username`,
      [username, hashPassword(password), displayName, email]);
    user = res.rows[0];
  } catch (e) {
    // Two people signing up with the same name at the same moment: the unique index decides.
    if (e?.code === '23505') {
      const which = `${e.constraint || ''} ${e.detail || ''}`;
      throw await fail(409, /email/i.test(which) ? TAKEN_EMAIL : TAKEN_USER);
    }
    throw e;
  }
  await auditStmt(user.id, 'auth.signup', 'users', user.id, { username, email });
  const token = await createSession(user.id);

  const res = NextResponse.json({ ok: true, username: user.username, next: '/welcome' });
  res.cookies.set(COOKIE, token, cookieOptions);
  return res;
}, { auth: 'public', maxBody: 10_000 });
