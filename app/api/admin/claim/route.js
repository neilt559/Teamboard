import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One-time setup: while NO admin exists, the signed-in user can become the
// first admin. Done in a single guarded UPDATE so two people can't both win.
// After that, only admins can make more admins (on the Accounts page).
export async function POST(req) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const r = await sql`
      UPDATE users SET is_admin = true
      WHERE id = ${me.id} AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)
      RETURNING id`;
    if (!r.rows.length) return NextResponse.json({ error: 'An admin is already set up.' }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
