import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { verifyPassword, createSession, COOKIE, cookieOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const body = await req.json();
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';

    const r = await sql`SELECT id, username, password_hash FROM users WHERE username = ${username} LIMIT 1`;
    const user = r.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'Wrong username or password.' }, { status: 401 });
    }

    const token = await createSession(user.id);
    const res = NextResponse.json({ ok: true, username: user.username });
    res.cookies.set(COOKIE, token, cookieOptions);
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
