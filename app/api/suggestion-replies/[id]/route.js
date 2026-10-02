import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Only the person who wrote a reply can delete it.
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const { id } = await params;
    const r = await sql`DELETE FROM suggestion_replies WHERE id = ${id} AND user_id = ${me.id} RETURNING id`;
    if (!r.rows.length) return NextResponse.json({ error: 'Only the person who wrote a reply can delete it.' }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
