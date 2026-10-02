import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Reply to a suggestion as the signed-in user. If you posted the suggestion
// anonymously, your reply is anonymous too.
export async function POST(req, { params }) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const { id } = await params;
    const body = String((await req.json()).body || '').trim().slice(0, 5000);
    if (!body) return NextResponse.json({ error: 'Write something first.' }, { status: 400 });
    const s = (await sql`SELECT user_id, anonymous FROM suggestions WHERE id = ${id}`).rows[0];
    if (!s) return NextResponse.json({ error: 'That suggestion was deleted.' }, { status: 404 });
    const anonymous = !!s.anonymous && String(s.user_id) === String(me.id);
    const r = await sql`
      INSERT INTO suggestion_replies (suggestion_id, user_id, body, anonymous)
      VALUES (${id}, ${me.id}, ${body}, ${anonymous})
      RETURNING id`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
