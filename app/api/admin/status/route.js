import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

// Used by the hidden Accounts entrance: is the viewer an admin, and has any
// admin been set up yet (if not, the first person in can claim it)?
export async function GET(req) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const r = await sql`SELECT EXISTS (SELECT 1 FROM users WHERE is_admin) AS any`;
    return NextResponse.json({ isAdmin: !!me.is_admin, adminExists: !!r.rows[0].any });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
