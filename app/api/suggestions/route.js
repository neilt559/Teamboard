import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';
import { CATEGORIES } from '@/lib/suggestions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Post a suggestion as the signed-in user (optionally anonymous).
export async function POST(req) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const b = await req.json();
    const title = String(b.title || '').trim().slice(0, 160);
    if (!title) return NextResponse.json({ error: 'Give your suggestion a title.' }, { status: 400 });
    const details = String(b.details || '').trim().slice(0, 5000);
    const category = CATEGORIES.some((c) => c.key === b.category) ? b.category : 'other';
    const r = await sql`
      INSERT INTO suggestions (user_id, title, details, category, anonymous)
      VALUES (${me.id}, ${title}, ${details}, ${category}, ${!!b.anonymous})
      RETURNING id`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
