import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { hashPassword, createSession, COOKIE, cookieOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const body = await req.json();
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';
    const code = body.code || '';

    if (username.length < 3) {
      return NextResponse.json({ error: 'Username must be at least 3 characters.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }
    // Optional signup gate: set SIGNUP_CODE in Vercel to require a team code.
    const required = process.env.SIGNUP_CODE;
    if (required && code !== required) {
      return NextResponse.json({ error: 'Invalid team code.' }, { status: 403 });
    }

    const existing = await sql`SELECT 1 FROM users WHERE username = ${username} LIMIT 1`;
    if (existing.rows.length) {
      return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
    }

    const ins = await sql`
      INSERT INTO users (username, password_hash)
      VALUES (${username}, ${hashPassword(password)})
      RETURNING id, username`;
    const user = ins.rows[0];
    const token = await createSession(user.id);

    const res = NextResponse.json({ ok: true, username: user.username });
    res.cookies.set(COOKIE, token, cookieOptions);
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
