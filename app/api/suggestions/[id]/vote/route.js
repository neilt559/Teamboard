import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// +1 (on: true) or take back your +1 (on: false). One per person.
export async function POST(req, { params }) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const { id } = await params;
    const { on } = await req.json();
    if (on) {
      await sql`INSERT INTO suggestion_votes (suggestion_id, user_id) VALUES (${id}, ${me.id}) ON CONFLICT DO NOTHING`;
    } else {
      await sql`DELETE FROM suggestion_votes WHERE suggestion_id = ${id} AND user_id = ${me.id}`;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
