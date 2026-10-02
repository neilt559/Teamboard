import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, verifyPassword, hashPassword, COOKIE, MIN_PASSWORD } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Change your own password. Needs the current one; signs you out everywhere
// except this browser.
export async function POST(req) {
  try {
    await ensureSchema();
    const token = req.cookies.get(COOKIE)?.value;
    const me = await sessionUser(token);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const { current, next } = await req.json();
    const r = await sql`SELECT password_hash FROM users WHERE id = ${me.id}`;
    if (!r.rows.length || !verifyPassword(current || '', r.rows[0].password_hash)) {
      return NextResponse.json({ error: 'Your current password isn’t right.' }, { status: 400 });
    }
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `The new password needs at least ${MIN_PASSWORD} characters.` }, { status: 400 });
    }
    if (next === current) {
      return NextResponse.json({ error: 'Pick a password that’s different from the current one.' }, { status: 400 });
    }
    await sql`UPDATE users SET password_hash = ${hashPassword(next)}, must_change = false WHERE id = ${me.id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${me.id} AND token <> ${token}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
